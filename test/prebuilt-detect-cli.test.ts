/**
 * `detect`'s scheduled-source resolution, exercised through the real CLI.
 *
 * These run `bun scripts/prebuilt.ts detect` as a subprocess with an injected releases payload, so
 * they prove the wiring - flags, `$GITHUB_OUTPUT`, exit codes - and not just the pure helper. No
 * `gh` call is reachable on these paths, so nothing touches the network.
 */
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { selectSourceRelease } from "../scripts/prebuilt";

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
    const run = runDetect(["--event", "workflow_dispatch", "--platform", "linux-x64"], []);
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/--platform must be one of darwin-arm64, darwin-x64/);
  });
});
