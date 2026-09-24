/**
 * `detect`'s scheduled-source resolution, exercised through the real CLI.
 *
 * These run `bun scripts/prebuilt.ts detect` as a subprocess with an injected releases payload, so
 * they prove the wiring - flags, `$GITHUB_OUTPUT`, exit codes - and not just the pure helper. No
 * `gh` call is reachable on these paths, so nothing touches the network.
 */
import { describe, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildMatrix, commitPatches, selectSourceRelease, sha256File, unionReleasePlatforms, workingTreePatches } from "../scripts/prebuilt";
import { loadManifest } from "../src/patch/manifest";

const root = join(import.meta.dir, "..");

interface CliRun {
  readonly status: number;
  readonly stderr: string;
  readonly outputs: Record<string, string>;
}

function runDetect(args: readonly string[], releases: unknown): CliRun {
  const dir = mkdtempSync(join(tmpdir(), "cxsl-detect-"));
  const payload = join(dir, "releases.json");
  const output = join(dir, "github-output");
  writeFileSync(payload, JSON.stringify(releases));
  writeFileSync(output, "");
  const env = { ...process.env, GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: join(dir, "summary.md") };
  const argv = ["scripts/prebuilt.ts", "detect", ...args, "--source-releases-file", payload];
  const result = spawnSync(process.execPath, argv, { cwd: root, encoding: "utf8", env, timeout: 30_000 });
  const status = result.status ?? -1;
  const stderr = result.stderr ?? "";
  const outputs: Record<string, string> = {};
  for (const line of readFileSync(output, "utf8").split("\n")) {
    const eq = line.indexOf("=");
    if (eq > 0) outputs[line.slice(0, eq)] = line.slice(eq + 1);
  }
  return { status, stderr, outputs };
}

describe("detect on a schedule", () => {
  test("publication includes both baseline platforms even when only one is requested", () => {
    const run = runDetect(["--event", "schedule", "--platforms", "linux-arm64", "--repo", "adrijshikhar/cxstatusline"], []);
    expect(run.status).toBe(0);
    expect(run.outputs.platforms?.split(",").sort()).toEqual(["darwin-arm64", "linux-arm64"]);
    const dry = runDetect(["--event", "schedule", "--publish-requested", "false", "--platforms", "linux-arm64", "--repo", "adrijshikhar/cxstatusline"], []);
    expect(dry.outputs.platforms).toBe("linux-arm64");
  });

  test("skips successfully when no v<CX> source release has been published", () => {
    const run = runDetect(["--event", "schedule", "--repo", "adrijshikhar/cxstatusline"], []);
    expect(run.status).toBe(0);
    expect(run.outputs["should_build"]).toBe("false");
    expect(run.outputs["skip_reason"]).toBe("no-source-release");
    expect(run.stderr).toContain("no v<CX> source release published; nothing to build");
  });

  test("treats a draft-only or prerelease-only source listing as nothing to build", () => {
    const releases = [
      { tag_name: "v0.9.0", draft: true, prerelease: false },
      { tag_name: "v0.8.0", draft: false, prerelease: true },
      { tag_name: "0.7.0", draft: false, prerelease: false },
    ];
    const run = runDetect(["--event", "schedule", "--repo", "adrijshikhar/cxstatusline"], releases);
    expect(run.status).toBe(0);
    expect(run.outputs["should_build"]).toBe("false");
    expect(selectSourceRelease(releases)).toBeNull();
  });

  test("refuses a repository slug that is not owner/name before any API call", () => {
    const run = runDetect(["--event", "schedule", "--repo", "https://evil.example/x?y=1"], []);
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/unusable repository/);
    expect(run.outputs["should_build"]).toBeUndefined();
  });

  test("a bad --platform is refused rather than defaulted", () => {
    const run = runDetect(["--event", "workflow_dispatch", "--platform", "solaris-x64"], []);
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/--platform must be one of/);
  });

  test("a bad --platforms is refused", () => {
    const run = runDetect(["--event", "workflow_dispatch", "--platforms", "arm64,solaris-x64"], []);
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/--platforms must be one of/);
  });

  test("self-hosted with x64 fails fast", () => {
    const run = runDetect(["--event", "workflow_dispatch", "--self-hosted", "--platforms", "arm64,x64"], []);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("self-hosted runner is arm64 only");
  });
});

describe("buildMatrix", () => {
  test("replacement targets keep every previously published platform", () => {
    expect(unionReleasePlatforms(["darwin-arm64", "linux-arm64"], ["darwin-x64", "linux-arm64"]))
      .toEqual(["darwin-arm64", "linux-arm64", "darwin-x64"]);
  });

  test("self-hosted runner is pinned to ARM64 runner array", () => {
    const m = buildMatrix(["darwin-arm64"]);
    expect(m).toEqual([{
      runner: ["self-hosted", "macOS", "ARM64", "m5-pro"],
      arch: "arm64",
      target: "aarch64-apple-darwin",
      platform: "darwin-arm64",
    }]);
  });

  test("self-hosted runner maps both darwin-arm64 and linux-arm64", () => {
    const m = buildMatrix(["darwin-arm64", "linux-arm64"]);
    expect(m).toEqual([
      {
        runner: ["self-hosted", "macOS", "ARM64", "m5-pro"],
        arch: "arm64",
        target: "aarch64-apple-darwin",
        platform: "darwin-arm64",
      },
      {
        runner: ["self-hosted", "macOS", "ARM64", "m5-pro"],
        arch: "arm64",
        target: "aarch64-unknown-linux-gnu",
        platform: "linux-arm64",
      },
    ]);
  });

  test("unsupported platforms never fall back to hosted runners", () => {
    expect(() => buildMatrix(["darwin-x64"])).toThrow(/hosted fallback is forbidden/);
    expect(() => buildMatrix(["linux-x64"])).toThrow(/hosted fallback is forbidden/);
  });

  test("an explicit hosted request fails before discovery or publication", () => {
    const run = runDetect(["--event", "schedule", "--self-hosted", "false"], []);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("hosted fallback is forbidden");
    expect(run.outputs.should_build).toBeUndefined();
  });

  test("workflow pins every job to the M5 and serializes platform builds", () => {
    const workflow = readFileSync(join(root, ".github/workflows/prebuilt.yml"), "utf8");
    const runners = workflow.match(/^    runs-on: .+$/gm)!;
    expect(runners.length).toBe(6);
    expect(runners.every((line) => line === "    runs-on: [self-hosted, macOS, ARM64, m5-pro]")).toBe(true);
    expect(workflow).not.toContain("self_hosted:");
    expect(workflow).not.toContain("inputs.self_hosted");
    expect(workflow).toContain("max-parallel: 1");
    expect(workflow).toContain('CARGO_BUILD_JOBS: "3"');
    expect(readFileSync(join(root, "scripts/build-prebuilt-docker.sh"), "utf8")).toContain("CARGO_BUILD_JOBS:-8");
    expect(workflow).not.toContain("actions/setup-python");
    expect(workflow).not.toContain("pip install");
    expect(readFileSync(join(root, "scripts/build-prebuilt-docker.sh"), "utf8")).not.toContain("pip install");
    expect(readFileSync(join(root, "docker/Dockerfile.prebuilt"), "utf8")).not.toContain("python3-venv");
  });

});

describe("detect on a manual dispatch", () => {
  /**
   * Fix round 1, finding #1: both exit-3 paths used to `process.exit(3)` without emitting
   * anything, so `needs.detect.outputs.codex_version` was empty and `report` filed every block -
   * including one that knows its version exactly - under the "upstream detection" title.
   */
  test("a blocked uncovered upstream still emits the identity the reporter needs", () => {
    const run = runDetect(["--event", "workflow_dispatch", "--codex-version", "9.9.9"], []);
    expect(run.status).toBe(3);
    expect(run.outputs["codex_version"]).toBe("9.9.9");
    expect(run.outputs["cx_version"]).toMatch(/^\d+\.\d+\.\d+$/);
    expect(run.outputs["release_state"]).toBe("unknown");
    expect(run.outputs["should_build"]).toBe("false");
    expect(run.outputs["blocked_reason"]).toContain("not covered by patches/manifest.json");
    // Single-line: $GITHUB_OUTPUT is a key=value file.
    expect(run.outputs["blocked_reason"]).not.toContain("\n");
    expect(run.stderr).toContain("Prebuilt blocked: Codex 9.9.9");
  });
});

/**
 * Fix round 1, finding #3: a scheduled run resolves an older source commit while `detect` is
 * checked out at the default branch, so `patches/` has to be read out of that commit. Hashing the
 * working tree's patch would publish a `patchSha256` that never belonged to the build.
 */
describe("patches at the frozen commit", () => {
  const git = (dir: string, args: readonly string[]) =>
    execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

  const manifest = (candidate: string) => JSON.stringify({
    version: 1,
    tag_prefix: "rust-v",
    candidate,
    patches: [{ min: candidate, max: candidate, file: `codex-${candidate}.patch` }],
  });

  /** A repo whose HEAD carries a different `patches/` tree than its tagged release commit. */
  function fixtureRepo(): { dir: string; tagged: string } {
    const dir = mkdtempSync(join(tmpdir(), "cxsl-frozen-"));
    git(dir, ["init", "--quiet", "-b", "main"]);
    git(dir, ["config", "user.email", "test@example.invalid"]);
    git(dir, ["config", "user.name", "Test"]);
    mkdirSync(join(dir, "patches"), { recursive: true });
    writeFileSync(join(dir, "patches", "manifest.json"), manifest("0.153.0"));
    writeFileSync(join(dir, "patches", "codex-0.153.0.patch"), "TAGGED patch bytes\n");
    git(dir, ["add", "."]);
    git(dir, ["commit", "--quiet", "-m", "release v0.1.0"]);
    const tagged = git(dir, ["rev-parse", "HEAD"]).trim();
    git(dir, ["tag", "v0.1.0"]);
    // main moves on: same file name, different bytes, and a different manifest candidate.
    writeFileSync(join(dir, "patches", "manifest.json"), manifest("0.154.0"));
    writeFileSync(join(dir, "patches", "codex-0.154.0.patch"), "HEAD patch bytes, much longer\n");
    writeFileSync(join(dir, "patches", "codex-0.153.0.patch"), "HEAD rewrote the old patch too\n");
    git(dir, ["add", "."]);
    git(dir, ["commit", "--quiet", "-m", "next"]);
    return { dir, tagged };
  }

  test("hashes the tagged commit's patch bytes, not HEAD's", async () => {
    const { dir, tagged } = fixtureRepo();
    const dest = mkdtempSync(join(tmpdir(), "cxsl-frozen-dest-"));
    const frozen = commitPatches(tagged, dest, dir);
    const head = workingTreePatches(join(dir, "patches"));

    expect(readFileSync(frozen.patchPath("codex-0.153.0.patch"), "utf8")).toBe("TAGGED patch bytes\n");
    const frozenSha = (await sha256File(frozen.patchPath("codex-0.153.0.patch"))).sha256;
    const headSha = (await sha256File(head.patchPath("codex-0.153.0.patch"))).sha256;
    expect(frozenSha).not.toBe(headSha);
    expect(frozen.describe).toBe(`commit ${tagged}`);
  });

  test("loads the tagged commit's manifest, not HEAD's", () => {
    const { dir, tagged } = fixtureRepo();
    const dest = mkdtempSync(join(tmpdir(), "cxsl-frozen-dest-"));
    expect(loadManifest(commitPatches(tagged, dest, dir).manifestDir).candidate).toBe("0.153.0");
    expect(loadManifest(join(dir, "patches")).candidate).toBe("0.154.0");
  });

  test("refuses a commit the checkout does not have, naming the fetch-depth fix", () => {
    const { dir } = fixtureRepo();
    const dest = mkdtempSync(join(tmpdir(), "cxsl-frozen-dest-"));
    expect(() => commitPatches("b".repeat(40), dest, dir)).toThrow(/fetch-depth: 0/);
  });

  test("refuses a patch name that is not a plain file inside patches/", () => {
    const { dir, tagged } = fixtureRepo();
    const dest = mkdtempSync(join(tmpdir(), "cxsl-frozen-dest-"));
    const frozen = commitPatches(tagged, dest, dir);
    expect(() => frozen.patchPath("../../etc/passwd")).toThrow(/unusable patch file name/);
    expect(() => workingTreePatches(join(dir, "patches")).patchPath("sub/dir.patch")).toThrow(
      /unusable patch file name/,
    );
  });
});
