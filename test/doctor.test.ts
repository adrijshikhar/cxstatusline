import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Context } from "../src/context";
import { doctorReport, formatDoctor } from "../src/commands/doctor";
import type { ArtifactFile, FileDigest, Platform, PreparedPair, ReleaseManifest } from "../src/distribution";
import { installHook } from "../src/hook/install";
import { resolvePaths } from "../src/paths";
import { REQUIRED_TOOLCHAIN } from "../src/patch/preflight";
import { activatePair, activeGeneration, installWrapper } from "../src/patch/wrapper";
import { DEFAULT_STATE, RELEASE_UNAVAILABLE, writeState } from "../src/state";
import { VERSION } from "../src/version-info";
import { fakeExec, tmpEnv } from "./helpers";

function ctx(upstreamVersion: string, which: (c: string) => string | null = () => "/x") {
  const { env, root } = tmpEnv();
  const paths = resolvePaths(env);
  const upstream = join(root, "real-codex");
  writeFileSync(upstream, "");
  chmodSync(upstream, 0o755);
  const { run } = fakeExec((cmd, args) => {
    if (args[0] === "--version") return { stdout: `codex-cli ${upstreamVersion}\n` };
    if (cmd === "rustup" && args[0] === "toolchain") return { stdout: `${REQUIRED_TOOLCHAIN}-aarch64-apple-darwin\n` };
    if (cmd === "rustup" && args[0] === "component") return { stdout: "cargo\nclippy\nrust-src\nrustfmt\n" };
    return {};
  });
  const c: Context = { env, paths, run, which, freeBytes: () => 1e12, cxBin: "/cx", patchesDir: "/p", now: () => new Date(), log: () => {}, say: () => {} };
  return { c, paths, upstream, root };
}
const get = (lines: ReturnType<typeof doctorReport>, key: string) => lines.find((l) => l.key === key);

// ---------------------------------------------------------------------------
// Generation fixtures: real files, built through `activatePair` (task 3/4), then tampered where a
// test needs a broken one. Shaped like `test/wrapper.test.ts`'s `stagePair`.
// ---------------------------------------------------------------------------

const LEGAL_FILES = ["LICENSE", "NOTICE", "THIRD_PARTY_NOTICES.md"] as const;

function fakeDigest(seed: string): FileDigest {
  return { sha256: createHash("sha256").update(seed).digest("hex"), size: Buffer.byteLength(seed) };
}

/** A structurally valid `ReleaseManifest`-shaped object, just complete enough to pass `validateManifest`. */
function fakeManifest(codexVersion: string, cxVersion: string, platform: Platform): ReleaseManifest {
  const d = fakeDigest("asset");
  const files = Object.fromEntries(
    (["codex", "codex-code-mode-host", ...LEGAL_FILES] as const).map((k) => [k, d]),
  ) as Record<ArtifactFile, FileDigest>;
  return {
    schema: 1,
    cxVersion,
    codexVersion,
    upstreamTag: `rust-v${codexVersion}`,
    upstreamCommit: "b".repeat(40),
    patchFile: `codex-${codexVersion}.patch`,
    patchSha256: "a".repeat(64),
    sourceCommit: "c".repeat(40),
    workflowUrl: "https://github.com/adrijshikhar/cxstatusline/actions/runs/123",
    createdAt: "2026-09-07T12:13:14.000Z",
    artifacts: [{
      platform,
      filename: `cxstatusline-codex-${codexVersion}-${platform}.tar.gz`,
      sha256: fakeDigest("archive").sha256,
      size: 12_345,
      files,
    }],
  };
}

/** A staging directory shaped exactly like the one `preparePrebuilt`/`prepareCompiled` hand to `activatePair`. */
function stagePair(root: string, opts: {
  version?: string;
  source?: "prebuilt" | "compiled";
  legal?: boolean;
  sourceCommit?: string | null;
  sourceDirty?: boolean;
  cxVersion?: string;
} = {}): PreparedPair {
  const dir = mkdtempSync(join(root, "staging-"));
  const version = opts.version ?? "0.152.1";
  const codex = `#!/bin/sh\necho codex-cli ${version}\n`;
  const host = "HOST";
  writeFileSync(join(dir, "codex"), codex);
  chmodSync(join(dir, "codex"), 0o755);
  writeFileSync(join(dir, "codex-code-mode-host"), host);
  chmodSync(join(dir, "codex-code-mode-host"), 0o755);
  const source = opts.source ?? "prebuilt";
  if (opts.legal ?? source === "prebuilt") for (const f of LEGAL_FILES) writeFileSync(join(dir, f), `${f} body`);
  const cxVersion = opts.cxVersion ?? VERSION;
  return {
    directory: dir,
    codexVersion: version,
    provenance: {
      source,
      cxVersion,
      platform: "darwin-arm64",
      patchSha256: "a".repeat(64),
      upstreamCommit: "b".repeat(40),
      sourceCommit: opts.sourceCommit ?? null,
      sourceDirty: opts.sourceDirty ?? false,
      installedAt: "2026-09-07T12:13:14.000Z",
      executables: { codex: fakeDigest(codex), "codex-code-mode-host": fakeDigest(host) },
      ...(source === "prebuilt"
        ? { release: { tag: `cxstatusline-v${cxVersion}-codex-v${version}`, archiveSha256: "e".repeat(64), manifest: fakeManifest(version, cxVersion, "darwin-arm64") } }
        : {}),
    },
  };
}

/** A minimal Context: no upstream Codex anywhere, no toolchain, only `codex --version` answered. */
function bareCtx(env: ReturnType<typeof tmpEnv>["env"], paths: ReturnType<typeof resolvePaths>, codexVersion = "0.152.1"): Context {
  const run: Context["run"] = (_cmd, args) => (args[0] === "--version" ? { status: 0, stdout: `codex-cli ${codexVersion}\n`, stderr: "" } : { status: 0, stdout: "", stderr: "" });
  return { env, paths, run, which: () => null, freeBytes: () => 1e12, cxBin: "/cx", patchesDir: "/p", now: () => new Date(), log: () => {}, say: () => {} };
}

describe("doctorReport", () => {
  test("reports the current launcher version rather than a saved old release", () => {
    const { c, paths, upstream, root } = ctx("0.152.1");
    const current = join(root, "new-codex");
    writeFileSync(current, "NEW");
    chmodSync(current, 0o755);
    mkdirSync(paths.binDir, { recursive: true });
    symlinkSync(current, paths.wrapperPath);
    writeState(paths.stateFile, { ...DEFAULT_STATE, upstream_bin: upstream, patched_from: "0.152.1" });
    const run: Context["run"] = (cmd, args, opts) => cmd === current
      ? { status: 0, stdout: "codex-cli 0.153.0", stderr: "" } : c.run(cmd, args, opts);
    const lines = doctorReport({ ...c, run });
    expect(get(lines, "upstream")?.value).toContain(`${current} 0.153.0`);
    expect(get(lines, "drift")).toMatchObject({ ok: false, value: expect.stringContaining("0.153.0") });
  });
  test("fresh machine: upstream via PATH, nothing installed, toolchain missing", () => {
    const { c, upstream } = ctx("0.152.1", (cmd) => (cmd === "rustup" ? null : "/x"));
    mkdirSync(c.env.PATH!, { recursive: true });
    symlinkSync(upstream, join(c.env.PATH!, "codex"));
    const lines = doctorReport(c);
    expect(get(lines, "upstream")).toMatchObject({ ok: true, value: expect.stringContaining("0.152.1") });
    expect(get(lines, "patched_from")).toMatchObject({ value: "never" });
    expect(get(lines, "wrapper")).toMatchObject({ value: "absent", ok: null });
    expect(get(lines, "hook")).toMatchObject({ value: "absent" });
    // Toolchain is only load-bearing for a compiled install; with none active it is optional.
    expect(get(lines, "toolchain")).toMatchObject({ ok: null, value: expect.stringMatching(/optional for prebuilt.*rustup/) });
    expect(get(lines, "active")).toMatchObject({ ok: null, value: "none" });
    expect(get(lines, "lock")).toMatchObject({ value: "free" });
    expect(formatDoctor(lines)).toContain("toolchain");
  });
  test("the documented key order is exactly what is emitted", () => {
    const { c } = ctx("0.152.1");
    expect(doctorReport(c).map((l) => l.key)).toEqual([
      "renderer", "settings", "upstream", "state", "patched_from", "policy", "drift", "wrapper",
      "active", "generation", "platform", "cx_version", "release", "patch", "source_commit",
      "upstream_commit", "codex_digest", "host_digest", "codex_version", "legal",
      "hook", "last_attempt", "toolchain", "lock",
    ]);
  });
  test("legacy flat-layout files without an active generation are flagged, not silently accepted", () => {
    const { c, paths, upstream } = ctx("0.152.1");
    writeState(paths.stateFile, { ...DEFAULT_STATE, patched_from: "0.152.1", upstream_bin: upstream });
    mkdirSync(paths.libexecDir, { recursive: true });
    writeFileSync(paths.patchedBin, "ELF");
    writeFileSync(paths.patchedCodeModeHost, "HOST");
    installWrapper(paths, "/cx");
    installHook(paths.hooksFile, "/cx");
    const lines = doctorReport(c);
    expect(get(lines, "drift")).toMatchObject({ ok: true, value: "none" });
    expect(get(lines, "wrapper")).toMatchObject({ ok: true, value: "ours" });
    expect(get(lines, "active")).toMatchObject({ ok: null, value: "none" });
    expect(get(lines, "legacy")).toMatchObject({ ok: false, value: expect.stringContaining("cxstatusline revert") });
    expect(get(lines, "hook")).toMatchObject({ ok: true, value: expect.stringContaining("installed") });
    expect(get(lines, "toolchain")).toMatchObject({ ok: null, value: expect.stringContaining("optional for prebuilt") });
  });
  test("hook trust is reported as decided by Codex, per spec L328", () => {
    const { c, paths } = ctx("0.152.1");
    installHook(paths.hooksFile, "/cx");
    expect(get(doctorReport(c), "hook")?.value).toMatch(/trust is decided in Codex's startup hooks review/);
  });
  test("a foreign file at the launcher path is distinguished from 'not found'", () => {
    const { c, paths } = ctx("0.152.1");
    mkdirSync(paths.binDir, { recursive: true });
    writeFileSync(paths.wrapperPath, "#!/bin/sh\nexec /opt/homebrew/bin/codex-real\n");
    const lines = doctorReport(c);
    expect(get(lines, "wrapper")).toMatchObject({ ok: false, value: expect.stringContaining("foreign file") });
    expect(get(lines, "upstream")).toMatchObject({ ok: false, value: expect.stringContaining("refusing to overwrite it") });
  });
  test("nothing anywhere says 'no upstream Codex found'", () => {
    const { c } = ctx("0.152.1");
    expect(get(doctorReport(c), "upstream")).toMatchObject({ ok: false, value: expect.stringContaining("no upstream Codex found") });
  });
  test("a corrupt state.json is reported and names the backup", () => {
    const { c, paths } = ctx("0.152.1");
    mkdirSync(paths.stateDir, { recursive: true });
    writeFileSync(paths.stateFile, "{{");
    expect(get(doctorReport(c), "state")).toMatchObject({ ok: false, value: expect.stringContaining("CORRUPT") });
  });
  test("a held lock names the pid", () => {
    const { c, paths } = ctx("0.152.1");
    mkdirSync(paths.stateDir, { recursive: true });
    writeFileSync(paths.lockFile, `${process.pid}\n`);
    expect(get(doctorReport(c), "lock")?.value).toBe(`held by pid ${process.pid} (a patch is running)`);
  });
  test("a stale lock is named as stale", () => {
    const { c, paths } = ctx("0.152.1");
    mkdirSync(paths.stateDir, { recursive: true });
    writeFileSync(paths.lockFile, "134217727\n");
    expect(get(doctorReport(c), "lock")?.value).toMatch(/stale pidfile for dead pid/);
  });
  test("behind within minor is reported but not ok=false", () => {
    const { c, paths, upstream } = ctx("0.152.3");
    writeState(paths.stateFile, { ...DEFAULT_STATE, patched_from: "0.152.1", upstream_bin: upstream });
    expect(get(doctorReport(c), "drift")).toMatchObject({ ok: null, value: expect.stringMatching(/behind within minor.*0\.152\.1.*0\.152\.3/) });
  });
  test("install due", () => {
    const { c, paths, upstream } = ctx("0.153.0");
    writeState(paths.stateFile, { ...DEFAULT_STATE, patched_from: "0.152.1", upstream_bin: upstream });
    expect(get(doctorReport(c), "drift")).toMatchObject({ ok: false, value: expect.stringMatching(/install due.*0\.152\.1.*0\.153\.0/) });
  });

  // -------------------------------------------------------------------------
  // Task 5: actual installation health, read from the active generation.
  // -------------------------------------------------------------------------

  test("healthy prebuilt install reports healthy even with no Rust toolchain installed", () => {
    const { env, root } = tmpEnv();
    const paths = resolvePaths(env);
    const codexVersion = "0.152.1";
    const upstream = join(root, "real-codex");
    writeFileSync(upstream, "");
    chmodSync(upstream, 0o755);
    mkdirSync(env.PATH!, { recursive: true });
    symlinkSync(upstream, join(env.PATH!, "codex"));
    const run: Context["run"] = (cmd, args) => {
      if (cmd === "cargo" || cmd === "rustup") throw new Error(`${cmd} must never run when the toolchain is absent`);
      if (args[0] === "--version") return { status: 0, stdout: `codex-cli ${codexVersion}\n`, stderr: "" };
      return { status: 0, stdout: "", stderr: "" };
    };
    const which = (cmd: string): string | null => (cmd === "git" || cmd === "cargo" || cmd === "rustup" ? null : "/x");
    const c: Context = { env, paths, run, which, freeBytes: () => 1e12, cxBin: "/cx", patchesDir: "/p", now: () => new Date(), log: () => {}, say: () => {} };
    activatePair(stagePair(root, { version: codexVersion }), c);

    const lines = doctorReport(c);
    expect(get(lines, "upstream")).toMatchObject({ ok: true });
    expect(get(lines, "active")).toMatchObject({ ok: true, value: `prebuilt ${codexVersion}` });
    expect(get(lines, "generation")?.ok).toBe(true);
    expect(get(lines, "cx_version")).toMatchObject({ ok: true });
    expect(get(lines, "release")).toMatchObject({ ok: true });
    expect(get(lines, "patch")).toMatchObject({ ok: null, value: "a".repeat(12) });
    expect(get(lines, "source_commit")).toMatchObject({ ok: null, value: "unknown" });
    expect(get(lines, "upstream_commit")).toMatchObject({ ok: null, value: "b".repeat(12) });
    expect(get(lines, "codex_digest")).toMatchObject({ ok: true, value: "verified" });
    expect(get(lines, "host_digest")).toMatchObject({ ok: true, value: "verified" });
    expect(get(lines, "codex_version")).toMatchObject({ ok: true });
    expect(get(lines, "legal")).toMatchObject({ ok: true, value: "present" });
    expect(get(lines, "toolchain")).toMatchObject({ ok: null, value: expect.stringContaining("optional for prebuilt") });
    expect(get(lines, "drift")).toMatchObject({ ok: true, value: "none" });
    expect(get(lines, "legacy")).toBeUndefined();
    expect(get(lines, "bookkeeping")).toBeUndefined();
  });

  test("compiled install requires the toolchain and never claims release verification", () => {
    const { env, root } = tmpEnv();
    const paths = resolvePaths(env);
    const codexVersion = "0.152.1";
    const c = bareCtx(env, paths, codexVersion);
    activatePair(stagePair(root, { version: codexVersion, source: "compiled", sourceCommit: "d".repeat(40) }), c);

    const lines = doctorReport(c);
    expect(get(lines, "active")).toMatchObject({ ok: true, value: `compiled ${codexVersion}` });
    expect(get(lines, "release")).toMatchObject({ ok: null, value: "not a verified release (compiled locally)" });
    expect(get(lines, "legal")).toMatchObject({ ok: null, value: "n/a (compiled build)" });
    expect(get(lines, "source_commit")).toMatchObject({ ok: null, value: "d".repeat(12) });
    expect(get(lines, "toolchain")).toMatchObject({ ok: false, value: expect.stringMatching(/git is not on PATH/) });
  });

  test("a locally dirty compiled source checkout is flagged", () => {
    const { env, root } = tmpEnv();
    const paths = resolvePaths(env);
    const c = bareCtx(env, paths);
    activatePair(stagePair(root, { source: "compiled", sourceCommit: "d".repeat(40), sourceDirty: true }), c);
    expect(get(doctorReport(c), "source_commit")).toMatchObject({ ok: false, value: `${"d".repeat(12)} (dirty)` });
  });

  test("a tampered executable is reported as a digest mismatch", () => {
    const { env, root } = tmpEnv();
    const paths = resolvePaths(env);
    const c = bareCtx(env, paths);
    activatePair(stagePair(root), c);
    const dir = activeGeneration(paths)!;
    writeFileSync(join(dir, "codex"), "TAMPERED-BYTES");

    const lines = doctorReport(c);
    expect(get(lines, "codex_digest")).toMatchObject({ ok: false, value: "MISMATCH" });
    expect(get(lines, "host_digest")).toMatchObject({ ok: true, value: "verified" });
    expect(get(lines, "active")).toMatchObject({ ok: true }); // metadata itself is still valid
  });

  test("a missing companion executable is reported as missing, not mismatched", () => {
    const { env, root } = tmpEnv();
    const paths = resolvePaths(env);
    const c = bareCtx(env, paths);
    activatePair(stagePair(root), c);
    const dir = activeGeneration(paths)!;
    rmSync(join(dir, "codex-code-mode-host"));

    expect(get(doctorReport(c), "host_digest")).toMatchObject({ ok: false, value: "missing" });
  });

  test("a dangling current pointer is reported as broken, not crashed", () => {
    const { env, root } = tmpEnv();
    const paths = resolvePaths(env);
    const c = bareCtx(env, paths);
    mkdirSync(paths.generationsDir, { recursive: true });
    symlinkSync(join(paths.generationsDir, "nowhere"), paths.currentGeneration);

    const lines = doctorReport(c);
    expect(get(lines, "generation")).toMatchObject({ ok: false, value: "dangling" });
    expect(get(lines, "active")).toMatchObject({ ok: false, value: "broken link" });
  });

  test("a current pointer outside the generations root is reported, not trusted", () => {
    const { env, root } = tmpEnv();
    const paths = resolvePaths(env);
    const c = bareCtx(env, paths);
    const outside = join(root, "outside-dir");
    mkdirSync(outside, { recursive: true });
    mkdirSync(paths.libexecDir, { recursive: true });
    symlinkSync(outside, paths.currentGeneration);

    const lines = doctorReport(c);
    expect(get(lines, "generation")).toMatchObject({ ok: false, value: "outside generations dir" });
    expect(get(lines, "active")).toMatchObject({ ok: false, value: "broken link" });
  });

  test("a current pointer at a foreign directory (not one of ours) is reported, not trusted", () => {
    const { env, root } = tmpEnv();
    const paths = resolvePaths(env);
    const c = bareCtx(env, paths);
    mkdirSync(paths.generationsDir, { recursive: true });
    const foreign = join(paths.generationsDir, "not-a-generation");
    mkdirSync(foreign, { recursive: true });
    mkdirSync(paths.libexecDir, { recursive: true });
    symlinkSync(foreign, paths.currentGeneration);

    const lines = doctorReport(c);
    expect(get(lines, "generation")).toMatchObject({ ok: false, value: "foreign" });
    expect(get(lines, "active")).toMatchObject({ ok: false, value: "broken link" });
  });

  test("malformed installation.json is reported as invalid metadata, not crashed", () => {
    const { env, root } = tmpEnv();
    const paths = resolvePaths(env);
    const c = bareCtx(env, paths);
    activatePair(stagePair(root), c);
    const dir = activeGeneration(paths)!;
    writeFileSync(join(dir, "installation.json"), "{ not json");

    const lines = doctorReport(c);
    expect(get(lines, "generation")).toMatchObject({ ok: true, value: dir });
    expect(get(lines, "active")).toMatchObject({ ok: false, value: "invalid metadata" });
    expect(get(lines, "codex_digest")).toMatchObject({ ok: null, value: expect.stringContaining("n/a") });
  });

  test("stale bookkeeping after activation is reported, not silently overridden", () => {
    const { env, root } = tmpEnv();
    const paths = resolvePaths(env);
    const c = bareCtx(env, paths);
    activatePair(stagePair(root, { version: "0.153.0" }), c);
    // Simulates a bookkeeping write that failed (or never ran) after a successful activation.
    writeState(paths.stateFile, { ...DEFAULT_STATE, patched_from: "0.152.1" });

    const lines = doctorReport(c);
    expect(get(lines, "bookkeeping")).toMatchObject({ ok: false, value: "state.json says 0.152.1, active generation is 0.153.0" });
    expect(get(lines, "patched_from")).toMatchObject({ value: "0.152.1" }); // raw state value, unchanged
  });

  test("upstream advancement is reported as drift, based on the active generation's version", () => {
    const { env, root } = tmpEnv();
    const paths = resolvePaths(env);
    const upstream = join(root, "real-codex");
    writeFileSync(upstream, "");
    chmodSync(upstream, 0o755);
    mkdirSync(env.PATH!, { recursive: true });
    symlinkSync(upstream, join(env.PATH!, "codex"));
    const run: Context["run"] = (_cmd, args) => (args[0] === "--version" ? { status: 0, stdout: "codex-cli 0.153.0\n", stderr: "" } : { status: 0, stdout: "", stderr: "" });
    const c: Context = { env, paths, run, which: () => "/x", freeBytes: () => 1e12, cxBin: "/cx", patchesDir: "/p", now: () => new Date(), log: () => {}, say: () => {} };
    activatePair(stagePair(root, { version: "0.152.1" }), c);
    // state.json's patched_from was never written; drift is still detected from the generation's own metadata.

    const lines = doctorReport(c);
    expect(get(lines, "drift")).toMatchObject({ ok: false, value: expect.stringMatching(/install due.*0\.152\.1.*0\.153\.0/) });
    expect(get(lines, "bookkeeping")).toBeUndefined();
  });

  test("a failed attempt shows the reason, and the release-unavailable backoff hint", () => {
    const { c, paths } = ctx("0.152.1");
    writeState(paths.stateFile, { ...DEFAULT_STATE, last_attempt: { at: "2026-09-01T00:00:00.000Z", ok: false, version: "0.153.0", reason: RELEASE_UNAVAILABLE } });
    expect(get(doctorReport(c), "last_attempt")).toMatchObject({
      ok: false,
      value: `failed 0.153.0 at 2026-09-01T00:00:00.000Z: ${RELEASE_UNAVAILABLE} (hook retries after 24h; run cxstatusline install to retry now)`,
    });
  });

  test("a failed attempt with an ordinary reason has no backoff hint", () => {
    const { c, paths } = ctx("0.152.1");
    writeState(paths.stateFile, { ...DEFAULT_STATE, last_attempt: { at: "2026-09-01T00:00:00.000Z", ok: false, version: "0.153.0", reason: "boom" } });
    expect(get(doctorReport(c), "last_attempt")).toMatchObject({ ok: false, value: "failed 0.153.0 at 2026-09-01T00:00:00.000Z: boom" });
  });
});
