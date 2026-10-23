#!/usr/bin/env python3
"""
codex_port.py - Upstream OpenAI Codex release auditing, patch porting, and verification.

Automates:
  1. check: Audits upstream Codex releases against repository version coverage policy.
  2. patch: Clones upstream tag, tests patch, extracts clean patch diff, updates manifest and test fixtures.
  3. verify: Validates patch application against upstream and runs repository test suite.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

ROOT_DIR = Path(__file__).resolve().parent.parent
PATCHES_DIR = ROOT_DIR / "patches"
MANIFEST_PATH = PATCHES_DIR / "manifest.json"
TEST_MANIFEST_PATH = ROOT_DIR / "test" / "manifest.test.ts"
TEST_PACKAGE_PATH = ROOT_DIR / "test" / "package.test.ts"
TEST_CI_PREBUILT_PATH = ROOT_DIR / "test" / "ci-prebuilt.test.ts"
DEFAULT_UPSTREAM_REPO = "openai/codex"
DEFAULT_UPSTREAM_URL = "https://github.com/openai/codex.git"
SUPPORT_FLOOR = (0, 152, 1)

SEMVER_RE = re.compile(r"^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$")
TAG_PREFIX = "rust-v"


def parse_semver(ver: str) -> Optional[Tuple[int, int, int, Optional[str]]]:
    clean = ver.removeprefix(TAG_PREFIX).removeprefix("v")
    m = SEMVER_RE.match(clean)
    if not m:
        return None
    return int(m.group(1)), int(m.group(2)), int(m.group(3)), m.group(4)


def semver_key(v_tuple: Tuple[int, int, int, Optional[str]]) -> Tuple[int, int, int, int, str]:
    major, minor, patch, pre = v_tuple
    # Stable releases rank higher than pre-releases
    pre_rank = 1 if pre is None else 0
    return major, minor, patch, pre_rank, pre or ""


def format_semver(v_tuple: Tuple[int, int, int, Optional[str]]) -> str:
    major, minor, patch, pre = v_tuple
    base = f"{major}.{minor}.{patch}"
    return f"{base}-{pre}" if pre else base


def run_cmd(cmd: List[str], cwd: Optional[Path] = None, check: bool = True, capture: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        cmd,
        cwd=cwd or ROOT_DIR,
        check=check,
        text=True,
        capture_output=capture,
    )


def fetch_upstream_releases(repo: str) -> List[Dict[str, Any]]:
    # First try gh CLI on releases (single page of 100 is plenty to cover active + recent baselines)
    if shutil.which("gh"):
        res = run_cmd(["gh", "api", f"repos/{repo}/releases?per_page=100"], check=False)
        if res.returncode == 0 and res.stdout.strip():
            try:
                data = json.loads(res.stdout)
                if isinstance(data, list):
                    return data
            except json.JSONDecodeError:
                pass

    # Next try git ls-remote tags (lightning fast, zero auth required)
    git_url = f"https://github.com/{repo}.git"
    res = run_cmd(["git", "ls-remote", "--tags", git_url, f"{TAG_PREFIX}*"], check=False)
    if res.returncode == 0 and res.stdout.strip():
        tags: List[Dict[str, Any]] = []
        for line in res.stdout.splitlines():
            parts = line.split()
            if len(parts) >= 2:
                ref = parts[1]
                if ref.endswith("^{}"):
                    continue
                tag_name = ref.removeprefix("refs/tags/")
                tags.append({
                    "tag_name": tag_name,
                    "draft": False,
                    "prerelease": False,
                })
        if tags:
            return tags

    # Fallback to urllib on GitHub releases API
    headers = {
        "Accept": "application/vnd.github+json",
        "User-Agent": "cxstatusline-codex-port",
    }
    token = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"

    url = f"https://api.github.com/repos/{repo}/releases?per_page=100"
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode())
            if isinstance(data, list):
                return data
    except Exception as e:
        raise RuntimeError(f"Failed to fetch releases from GitHub: {e}") from e
    return []


def load_manifest() -> Dict[str, Any]:
    with open(MANIFEST_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def save_manifest(data: Dict[str, Any]) -> None:
    with open(MANIFEST_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
        f.write("\n")


# ---------------------------------------------------------------------------
# Command: check
# ---------------------------------------------------------------------------

def cmd_check(args: argparse.Namespace) -> int:
    print(f"Fetching upstream releases for {args.repo}...")
    raw_releases = fetch_upstream_releases(args.repo)
    manifest = load_manifest()

    manifest_versions = set()
    for entry in manifest.get("patches", []):
        min_v = entry.get("min")
        max_v = entry.get("max")
        if min_v:
            manifest_versions.add(min_v)
        if max_v:
            manifest_versions.add(max_v)

    stable_releases = []
    for r in raw_releases:
        if r.get("draft") or r.get("prerelease"):
            continue
        tag = r.get("tag_name", "")
        if not tag.startswith(TAG_PREFIX):
            continue
        v_tuple = parse_semver(tag)
        if not v_tuple or v_tuple[3] is not None:
            continue
        # Check support floor
        if (v_tuple[0], v_tuple[1], v_tuple[2]) < SUPPORT_FLOOR:
            continue
        stable_releases.append(v_tuple)

    stable_releases.sort(key=semver_key, reverse=True)
    if not stable_releases:
        print("No upstream stable releases found above support floor.")
        return 0

    newest_minor = stable_releases[0][1]
    candidate = manifest.get("candidate", "")

    rows: List[Tuple[str, str, str]] = []
    open_gaps: List[str] = []

    for v_tuple in stable_releases:
        ver_str = format_semver(v_tuple)
        is_covered = ver_str in manifest_versions
        is_baseline = v_tuple[2] == 0
        is_active_series = v_tuple[1] == newest_minor

        if is_active_series or is_baseline:
            # Must be supported per policy
            if is_covered:
                status = "Supported"
                detail = f"Covered in manifest (candidate: {candidate})"
            else:
                status = "UNSUPPORTED (GAP)"
                detail = "Requires patch and manifest entry"
                open_gaps.append(ver_str)
        else:
            # Older series non-baseline: intentionally skipped
            if is_covered:
                status = "Supported (Historical)"
                detail = "Covered in manifest"
            else:
                status = "Skipped"
                detail = "Older minor series patch release intentionally omitted"

        rows.append((ver_str, status, detail))

    if args.json:
        out = {
            "candidate": candidate,
            "newestMinor": newest_minor,
            "openGaps": open_gaps,
            "releases": [{"version": r[0], "status": r[1], "detail": r[2]} for r in rows],
        }
        print(json.dumps(out, indent=2))
        return 0 if not open_gaps else 1

    print(f"\nCodex Coverage Audit (Candidate: {candidate}, Active Series: 0.{newest_minor}.x)")
    print(f"{'Codex Version':<16} | {'Status':<22} | {'Detail'}")
    print("-" * 75)
    for ver_str, status, detail in rows:
        print(f"{ver_str:<16} | {status:<22} | {detail}")

    if open_gaps:
        print(f"\n[!] Open coverage gaps detected ({len(open_gaps)}): {', '.join(open_gaps)}")
        return 1
    else:
        print("\n[OK] All eligible Codex releases are covered.")
        return 0


# ---------------------------------------------------------------------------
# Command: patch
# ---------------------------------------------------------------------------

def find_latest_existing_patch() -> Path:
    manifest = load_manifest()
    patches = manifest.get("patches", [])
    if not patches:
        raise RuntimeError("No existing patches found in manifest.json")
    last_file = patches[-1].get("file")
    p = PATCHES_DIR / last_file
    if not p.exists():
        raise RuntimeError(f"Patch file {p} does not exist")
    return p


def cmd_patch(args: argparse.Namespace) -> int:
    target_ver = args.version.removeprefix("v")
    v_tuple = parse_semver(target_ver)
    if not v_tuple:
        print(f"Error: Invalid version string: {args.version}", file=sys.stderr)
        return 1

    tag_name = f"{TAG_PREFIX}{target_ver}"
    worktree_dir = Path(args.worktree) if args.worktree else Path(f"/tmp/codex-{target_ver}")
    source_patch = Path(args.source_patch) if args.source_patch else find_latest_existing_patch()

    print(f"Target version: {target_ver} (tag: {tag_name})")
    print(f"Base patch:     {source_patch.name}")
    print(f"Worktree:       {worktree_dir}")

    # Prepare upstream clone
    if not worktree_dir.exists():
        print(f"Cloning upstream {tag_name} into {worktree_dir}...")
        res = run_cmd([
            "git", "clone", "--depth", "1", "--branch", tag_name, DEFAULT_UPSTREAM_URL, str(worktree_dir)
        ], check=False)
        if res.returncode != 0:
            print(f"Error cloning upstream tag {tag_name}:\n{res.stderr}", file=sys.stderr)
            return 1
    else:
        print(f"Using existing worktree at {worktree_dir}")
        run_cmd(["git", "-C", str(worktree_dir), "reset", "--hard", "HEAD"])
        run_cmd(["git", "-C", str(worktree_dir), "clean", "-fd"])

    # Test patch application
    print("Testing patch application with `git apply --check`...")
    check_res = run_cmd(["git", "-C", str(worktree_dir), "apply", "--check", str(source_patch)], check=False)

    if check_res.returncode != 0:
        print(f"\n[!] Patch conflicts detected against {tag_name}:", file=sys.stderr)
        print(check_res.stderr, file=sys.stderr)
        print("\nAttempting reject apply to isolate conflicting hunks...")
        run_cmd(["git", "-C", str(worktree_dir), "apply", "--reject", str(source_patch)], check=False)
        print(f"Conflicted files and .rej files left in: {worktree_dir}")
        print("Consult .agents/skills/support-codex-version/references/conflict-resolution.md for guidance.")
        return 1

    print("[OK] Patch applies cleanly!")

    # Apply to index and generate new patch file
    run_cmd(["git", "-C", str(worktree_dir), "apply", "--index", str(source_patch)])
    new_patch_filename = f"codex-{target_ver}.patch"
    new_patch_path = PATCHES_DIR / new_patch_filename

    diff_res = run_cmd(["git", "-C", str(worktree_dir), "diff", "--cached"])
    with open(new_patch_path, "w", encoding="utf-8") as f:
        f.write(diff_res.stdout)
    print(f"Generated clean patch: {new_patch_path.relative_to(ROOT_DIR)}")

    # Update patches/manifest.json
    manifest = load_manifest()
    manifest["candidate"] = target_ver
    patches_list = manifest.get("patches", [])

    # Check if entry already exists
    existing = [p for p in patches_list if p.get("min") == target_ver and p.get("max") == target_ver]
    if not existing:
        patches_list.append({
            "min": target_ver,
            "max": target_ver,
            "file": new_patch_filename,
            "patchVersion": 2,
        })
        manifest["patches"] = patches_list
        save_manifest(manifest)
        print(f"Updated {MANIFEST_PATH.relative_to(ROOT_DIR)}: candidate = {target_ver}, added patch entry.")
    else:
        save_manifest(manifest)
        print(f"Updated {MANIFEST_PATH.relative_to(ROOT_DIR)}: candidate = {target_ver}.")

    # Update test/manifest.test.ts
    if TEST_MANIFEST_PATH.exists():
        content = TEST_MANIFEST_PATH.read_text(encoding="utf-8")
        # Replace candidate expectation
        content = re.sub(
            r'expect\(shipped\.candidate\)\.toBe\("[^"]+"\);',
            f'expect(shipped.candidate).toBe("{target_ver}");',
            content,
        )
        # Replace resolved patch expectation
        content = re.sub(
            r'expect\(resolvePatch\(shipped, v\(shipped\.candidate!\)\)\?\.file\)\.toBe\("[^"]+"\);',
            f'expect(resolvePatch(shipped, v(shipped.candidate!))?.file).toBe("{new_patch_filename}");',
            content,
        )
        TEST_MANIFEST_PATH.write_text(content, encoding="utf-8")
        print(f"Updated {TEST_MANIFEST_PATH.relative_to(ROOT_DIR)} candidate expectations.")

    # Update test/package.test.ts
    if TEST_PACKAGE_PATH.exists():
        content = TEST_PACKAGE_PATH.read_text(encoding="utf-8")
        patch_entry = f'"patches/{new_patch_filename}"'
        if patch_entry not in content:
            # Append before the closing bracket of PACKAGE_FILES or the patches array
            content = re.sub(
                r'("patches/codex-[^"]+\.patch")\];',
                rf'\1, {patch_entry}];',
                content,
            )
            TEST_PACKAGE_PATH.write_text(content, encoding="utf-8")
            print(f"Updated {TEST_PACKAGE_PATH.relative_to(ROOT_DIR)} package files list.")

    # Update test/ci-prebuilt.test.ts if target_ver is used as negative test case
    if TEST_CI_PREBUILT_PATH.exists():
        content = TEST_CI_PREBUILT_PATH.read_text(encoding="utf-8")
        if f'"{target_ver}"' in content:
            next_minor_ver = f"{v_tuple[0]}.{v_tuple[1] + 1}.0"
            content = content.replace(f'"{target_ver}"', f'"{next_minor_ver}"')
            TEST_CI_PREBUILT_PATH.write_text(content, encoding="utf-8")
            print(f"Updated {TEST_CI_PREBUILT_PATH.relative_to(ROOT_DIR)} unsupported test version to {next_minor_ver}.")

    print(f"\nSuccessfully prepared support for Codex {target_ver}.")
    print(f"Next step: run `python3 scripts/codex_port.py verify {target_ver}`")
    return 0


# ---------------------------------------------------------------------------
# Command: verify
# ---------------------------------------------------------------------------

def cmd_verify(args: argparse.Namespace) -> int:
    target_ver = args.version.removeprefix("v")
    patch_filename = f"codex-{target_ver}.patch"
    patch_path = PATCHES_DIR / patch_filename

    if not patch_path.exists():
        print(f"Error: Patch file {patch_path} not found.", file=sys.stderr)
        return 1

    worktree_dir = Path(args.worktree) if args.worktree else Path(f"/tmp/codex-{target_ver}")
    if worktree_dir.exists():
        print(f"Verifying patch application on {worktree_dir}...")
        run_cmd(["git", "-C", str(worktree_dir), "reset", "--hard", "HEAD"])
        run_cmd(["git", "-C", str(worktree_dir), "clean", "-fd"])
        res = run_cmd(["git", "-C", str(worktree_dir), "apply", "--check", str(patch_path)], check=False)
        if res.returncode != 0:
            print(f"Error: Patch does not apply cleanly:\n{res.stderr}", file=sys.stderr)
            return 1
        print("[OK] `git apply --check` passed.")

    print("\nRunning test suite (`bun test ./test ./src`)...")
    t_res = run_cmd(["bun", "test", "./test", "./src"], check=False)
    if t_res.returncode != 0:
        print(t_res.stderr or t_res.stdout, file=sys.stderr)
        return 1
    print(t_res.stdout.strip().splitlines()[-1])

    print("\nRunning `bun run typecheck`...")
    tc_res = run_cmd(["bun", "run", "typecheck"], check=False)
    if tc_res.returncode != 0:
        print(tc_res.stderr or tc_res.stdout, file=sys.stderr)
        return 1
    print("[OK] TypeScript typecheck passed.")

    print("\nRunning `bun run build`...")
    b_res = run_cmd(["bun", "run", "build"], check=False)
    if b_res.returncode != 0:
        print(b_res.stderr or b_res.stdout, file=sys.stderr)
        return 1
    print("[OK] Build passed.")

    print("\nRunning `bun run check:package`...")
    cp_res = run_cmd(["bun", "run", "check:package"], check=False)
    if cp_res.returncode != 0:
        print(cp_res.stderr or cp_res.stdout, file=sys.stderr)
        return 1
    print("[OK] Package check passed.")

    print("\nRunning prebuilt release detector (`bun scripts/prebuilt.ts detect`)...")
    det_res = run_cmd(["bun", "scripts/prebuilt.ts", "detect"], check=False)
    print(det_res.stdout)
    if det_res.returncode != 0:
        print(f"Error: prebuilt detect exited with code {det_res.returncode}", file=sys.stderr)
        return 1

    if "should_build=true" in det_res.stdout:
        print("[OK] Prebuilt detect resolved candidate and confirmed should_build=true.")
    else:
        print("[!] Prebuilt detect did not output should_build=true.")
        return 1

    print(f"\nAll verifications passed for Codex {target_ver}!")
    return 0


# ---------------------------------------------------------------------------
# Main CLI
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="Upstream OpenAI Codex porting & verification automation")
    subparsers = parser.add_subparsers(dest="command", required=True)

    # check
    p_check = subparsers.add_parser("check", help="Check upstream releases against version coverage policy")
    p_check.add_argument("--repo", default=DEFAULT_UPSTREAM_REPO, help=f"Upstream repository (default: {DEFAULT_UPSTREAM_REPO})")
    p_check.add_argument("--json", action="store_true", help="Output JSON format")

    # patch
    p_patch = subparsers.add_parser("patch", help="Prepare and apply patch for a Codex version")
    p_patch.add_argument("version", help="Target Codex version (e.g. 0.164.0)")
    p_patch.add_argument("--source-patch", help="Path to base patch file to adapt (defaults to newest in manifest)")
    p_patch.add_argument("--worktree", help="Directory for upstream checkout (defaults to /tmp/codex-<version>)")

    # verify
    p_verify = subparsers.add_parser("verify", help="Run full verification suite for a Codex version")
    p_verify.add_argument("version", help="Codex version being verified")
    p_verify.add_argument("--worktree", help="Directory of upstream checkout")

    args = parser.parse_args()

    if args.command == "check":
        sys.exit(cmd_check(args))
    elif args.command == "patch":
        sys.exit(cmd_patch(args))
    elif args.command == "verify":
        sys.exit(cmd_verify(args))


if __name__ == "__main__":
    main()
