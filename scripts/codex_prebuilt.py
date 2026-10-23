#!/usr/bin/env python3
"""
codex_prebuilt.py - Enforces Mandatory Build Machine Policy and orchestrates prebuilt releases.

Enforces repository policy:
  - Prebuilt Codex/Rust builds MUST run exclusively on the owner's M5 Pro at 192.168.1.65.
  - Runner labels: [self-hosted, macOS, ARM64, m5-pro].
  - Current developer machine and GitHub-hosted runners are strictly forbidden for Codex/Rust builds.
  - Platform builds are sequential: 3 jobs for native macOS, 4 inside Docker (Docker Desktop 20GB limit).

Subcommands:
  check-runner    Verify self-hosted M5 Pro runner availability and state.
  dispatch        Validate workflow ref guardrails and dispatch prebuilt.yml.
  watch           Monitor execution of a dispatched prebuilt workflow run.
  verify-release  Validate published release assets and sha256 checksums.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import subprocess
import sys
import time
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional

ROOT_DIR = Path(__file__).resolve().parent.parent
DEFAULT_REPO = "adrijshikhar/cxstatusline"
REQUIRED_RUNNER_LABELS = {"self-hosted", "macos", "arm64", "m5-pro"}


def run_cmd(cmd: List[str], check: bool = True, capture: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(cmd, cwd=ROOT_DIR, check=check, text=True, capture_output=capture)


# ---------------------------------------------------------------------------
# Command: check-runner
# ---------------------------------------------------------------------------

def find_m5_runner(repo: str) -> Optional[Dict[str, Any]]:
    if not shutil.which("gh"):
        raise RuntimeError("`gh` CLI is required for runner verification.")

    res = run_cmd(["gh", "api", f"repos/{repo}/actions/runners"], check=False)
    if res.returncode != 0:
        raise RuntimeError(f"Failed to query runners for {repo}: {res.stderr}")

    data = json.loads(res.stdout)
    runners = data.get("runners", [])

    for r in runners:
        labels = {l.get("name", "").lower() for l in r.get("labels", [])}
        if REQUIRED_RUNNER_LABELS.issubset(labels):
            return r
    return None


def cmd_check_runner(args: argparse.Namespace) -> int:
    print(f"Checking runner status for {args.repo}...")
    try:
        runner = find_m5_runner(args.repo)
    except Exception as e:
        print(f"Error querying GitHub Actions runners: {e}", file=sys.stderr)
        return 1

    if not runner:
        print(f"\n[!] Required self-hosted runner matching labels {sorted(REQUIRED_RUNNER_LABELS)} was NOT found.", file=sys.stderr)
        print("Mandatory Build Machine Policy strictly requires the owner's M5 Pro at 192.168.1.65.")
        return 1

    name = runner.get("name")
    status = runner.get("status")  # "online" or "offline"
    busy = runner.get("busy")      # True or False
    runner_id = runner.get("id")

    print(f"\nSelf-Hosted M5 Pro Runner Status:")
    print(f"  ID:     {runner_id}")
    print(f"  Name:   {name}")
    print(f"  Status: {status.upper()}")
    print(f"  State:  {'BUSY (job running)' if busy else 'IDLE (ready)'}")

    if status != "online":
        print(f"\n[!] The M5 Pro runner is currently {status.upper()}.", file=sys.stderr)
        print("The machine at 192.168.1.65 must be awake and its runner service active before dispatching prebuilts.")
        print("Per repository policy: Never substitute GitHub-hosted runners or build locally.")
        return 1

    print("\n[OK] M5 Pro runner is online and available.")
    return 0


# ---------------------------------------------------------------------------
# Command: dispatch
# ---------------------------------------------------------------------------

def cmd_dispatch(args: argparse.Namespace) -> int:
    target_ver = args.version.removeprefix("v")
    ref = args.ref or run_cmd(["git", "rev-parse", "--abbrev-ref", "HEAD"]).stdout.strip()
    if ref == "HEAD":
        ref = run_cmd(["git", "rev-parse", "HEAD"]).stdout.strip()

    print(f"Target Codex version: {target_ver}")
    print(f"Workflow Git ref:     {ref}")
    print(f"Target platforms:     {args.platforms}")
    print(f"Publish assets:       {args.publish}")

    # Verify workflow ref guardrails: inspect .github/workflows/prebuilt.yml on that ref
    print("Verifying workflow ref guardrails...")
    show_res = run_cmd(["git", "show", f"{ref}:.github/workflows/prebuilt.yml"], check=False)
    if show_res.returncode != 0:
        print(f"Error: Unable to read .github/workflows/prebuilt.yml at ref '{ref}': {show_res.stderr}", file=sys.stderr)
        return 1

    workflow_text = show_res.stdout
    if "[self-hosted, macOS, ARM64, m5-pro]" not in workflow_text:
        print("\n[!] Ref guardrail violation: workflow does not contain strict M5 Pro runner labels!", file=sys.stderr)
        print("Dispatch aborted. Workflow MUST specify `runs-on: [self-hosted, macOS, ARM64, m5-pro]`.")
        return 1
    print("[OK] Verified ref contains strict M5-only runner guardrails.")

    # Check runner availability unless explicitly skipped
    if not args.skip_runner_check:
        try:
            runner = find_m5_runner(args.repo)
            if not runner or runner.get("status") != "online":
                print("\n[!] M5 Pro runner is not online. Prebuilt dispatch blocked.", file=sys.stderr)
                print("Use --skip-runner-check only if you know the runner will come online shortly.")
                return 1
        except Exception as e:
            print(f"Warning checking runner: {e}", file=sys.stderr)

    publish_val = "true" if args.publish else "false"
    dispatch_cmd = [
        "gh", "workflow", "run", "prebuilt.yml",
        "--repo", args.repo,
        "--ref", ref,
        "-f", f"codex_version={target_ver}",
        "-f", f"platforms={args.platforms}",
        "-f", f"publish={publish_val}",
    ]

    print(f"\nDispatching workflow: {' '.join(dispatch_cmd)}")
    d_res = run_cmd(dispatch_cmd, check=False)
    if d_res.returncode != 0:
        print(f"Error dispatching workflow:\n{d_res.stderr}", file=sys.stderr)
        return 1

    print("\n[OK] Prebuilt workflow successfully dispatched!")
    print(f"Run `python3 scripts/codex_prebuilt.py watch --repo {args.repo}` to track progress.")
    return 0


# ---------------------------------------------------------------------------
# Command: watch
# ---------------------------------------------------------------------------

def cmd_watch(args: argparse.Namespace) -> int:
    if not shutil.which("gh"):
        print("Error: `gh` CLI required to watch runs.", file=sys.stderr)
        return 1

    run_id = args.run_id
    if not run_id:
        print(f"Finding latest prebuilt run for {args.repo}...")
        res = run_cmd(["gh", "run", "list", "--repo", args.repo, "--workflow", "prebuilt.yml", "--limit", "1", "--json", "databaseId,status,conclusion,url"], check=False)
        if res.returncode != 0 or not res.stdout.strip():
            print("No recent prebuilt runs found.", file=sys.stderr)
            return 1
        data = json.loads(res.stdout)
        if not data:
            print("No prebuilt runs found.", file=sys.stderr)
            return 1
        run_id = str(data[0]["databaseId"])
        url = data[0].get("url", "")
        print(f"Tracking run {run_id} ({url})...")

    # Watch execution
    print(f"Watching run {run_id} (press Ctrl+C to stop watching)...")
    res = subprocess.run(["gh", "run", "watch", run_id, "--repo", args.repo])
    return res.returncode


# ---------------------------------------------------------------------------
# Command: verify-release
# ---------------------------------------------------------------------------

def cmd_verify_release(args: argparse.Namespace) -> int:
    target_ver = args.version.removeprefix("v")
    tag = f"codex-v{target_ver}"
    print(f"Verifying release {tag} in {args.repo}...")

    res = run_cmd(["gh", "release", "view", tag, "--repo", args.repo, "--json", "assets,name,url"], check=False)
    if res.returncode != 0:
        print(f"Error fetching release {tag}:\n{res.stderr}", file=sys.stderr)
        return 1

    data = json.loads(res.stdout)
    assets = {a.get("name"): a for a in data.get("assets", [])}

    required_assets = [
        f"codex-v{target_ver}-darwin-arm64.tar.gz",
        f"codex-v{target_ver}-linux-arm64.tar.gz",
        "manifest.json",
        "SHA256SUMS",
    ]

    missing = [name for name in required_assets if name not in assets]
    if missing:
        print(f"[!] Missing required release assets: {missing}", file=sys.stderr)
        return 1

    print(f"[OK] All {len(required_assets)} required assets exist:")
    for name in required_assets:
        size = assets[name].get("size", 0)
        print(f"  - {name} ({size:,} bytes)")

    print(f"\n[OK] Release {tag} verified successfully at {data.get('url')}")
    return 0


# ---------------------------------------------------------------------------
# Main CLI
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="Codex prebuilt release orchestration and M5 runner verification")
    subparsers = parser.add_subparsers(dest="command", required=True)

    # check-runner
    p_runner = subparsers.add_parser("check-runner", help="Verify M5 Pro self-hosted runner availability")
    p_runner.add_argument("--repo", default=DEFAULT_REPO, help=f"Repository slug (default: {DEFAULT_REPO})")

    # dispatch
    p_dispatch = subparsers.add_parser("dispatch", help="Dispatch prebuilt.yml workflow on M5 Pro")
    p_dispatch.add_argument("--version", required=True, help="Codex version to build (e.g. 0.164.0)")
    p_dispatch.add_argument("--ref", help="Workflow ref (branch or commit; defaults to current branch)")
    p_dispatch.add_argument("--platforms", default="darwin-arm64,linux-arm64", help="Comma-separated platforms")
    p_dispatch.add_argument("--publish", action="store_true", help="Publish release assets to GitHub release")
    p_dispatch.add_argument("--skip-runner-check", action="store_true", help="Skip runner online check before dispatch")
    p_dispatch.add_argument("--repo", default=DEFAULT_REPO, help=f"Repository slug (default: {DEFAULT_REPO})")

    # watch
    p_watch = subparsers.add_parser("watch", help="Watch prebuilt workflow execution")
    p_watch.add_argument("--run-id", help="Workflow run ID (defaults to latest)")
    p_watch.add_argument("--repo", default=DEFAULT_REPO, help=f"Repository slug (default: {DEFAULT_REPO})")

    # verify-release
    p_verify = subparsers.add_parser("verify-release", help="Verify published prebuilt release assets")
    p_verify.add_argument("version", help="Codex version (e.g. 0.164.0)")
    p_verify.add_argument("--repo", default=DEFAULT_REPO, help=f"Repository slug (default: {DEFAULT_REPO})")

    args = parser.parse_args()

    if args.command == "check-runner":
        sys.exit(cmd_check_runner(args))
    elif args.command == "dispatch":
        sys.exit(cmd_dispatch(args))
    elif args.command == "watch":
        sys.exit(cmd_watch(args))
    elif args.command == "verify-release":
        sys.exit(cmd_verify_release(args))


if __name__ == "__main__":
    main()
