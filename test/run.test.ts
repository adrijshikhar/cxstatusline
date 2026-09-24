import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Context } from "../src/context";
import type { RunResult } from "../src/env";
import { resolvePaths } from "../src/paths";
import { describeOutcome, runAcquisition, runInstall, runPatch, runUpdate, simulateDrift } from "../src/patch/run";
import { MIN_FREE_BYTES, MIN_STAGING_FREE_BYTES, REQUIRED_TOOLCHAIN } from "../src/patch/preflight";
import { activeGeneration, readInstallation, isOurWrapper } from "../src/patch/wrapper";
import { readState, writeState, DEFAULT_STATE, RELEASE_UNAVAILABLE } from "../src/state";
import { VERSION } from "../src/version-info";
import { isOurGroup, type HooksFile } from "../src/hook/install";
import { fakeExec, tmpEnv } from "./helpers";
import { releaseFixture, releaseServer, routesFor, type Route } from "./release-fixture";

const UPSTREAM_COMMIT = "f".repeat(40);
const PATCH_BODY = "diff --git a/x b/x\n";
const PATCH_SHA = createHash("sha256").update(PATCH_BODY).digest("hex");

interface Options {
  upstreamVersion?: string;
  stagedVersion?: string;
  which?: (c: string) => string | null;
  cargoFails?: boolean;
  /** cargo exits 0 but one built path cannot be copied, so staging fails half-way. */
  hostUnusable?: boolean;
  manifest?: string;
  freeBytes?: (p: string) => number;
  gh?: (args: readonly string[]) => Partial<RunResult>;
  /** Refuse cargo/rustup outright: proof that a path never compiles. */
  noRust?: boolean;
}

/** A HOME with a space in it, a stock upstream launcher, and a local patch manifest. */
function ctx(over: Options = {}) {
  const { env, root } = tmpEnv("cxstatusline test ");
  const paths = resolvePaths(env);
  const real = join(root, ".codex/packages/standalone/current/bin/codex");
  mkdirSync(join(real, ".."), { recursive: true });
  writeFileSync(real, "UPSTREAM-ELF");
  writeFileSync(join(real, "..", "codex-code-mode-host"), "UPSTREAM-HOST");
  chmodSync(real, 0o755);
  mkdirSync(paths.binDir, { recursive: true });
  symlinkSync(real, paths.wrapperPath);
  const patchesDir = join(root, "patches");
  mkdirSync(patchesDir);
  writeFileSync(join(patchesDir, "manifest.json"), over.manifest
    ?? JSON.stringify({ version: 1, tag_prefix: "rust-v", patches: [{ min: "0.152.1", max: "0.153.0", file: "p.patch" }] }));
  writeFileSync(join(patchesDir, "p.patch"), PATCH_BODY);
  const said: string[] = [];
  const state = { upstreamVersion: over.upstreamVersion ?? "0.152.1" };
  const { run, calls } = fakeExec((cmd, args) => {
    if (over.noRust && (cmd === "cargo" || cmd === "rustup")) throw new Error(`this path must never run ${cmd}`);
    if (cmd === "gh") return over.gh ? over.gh(args) : { status: 1, stderr: "release not found" };
    if (args[0] === "--version") {
      const version = over.stagedVersion && cmd.includes("staging") ? over.stagedVersion : state.upstreamVersion;
      return { stdout: `codex-cli ${version}\n` };
    }
    if (cmd === "git" && args.includes("rev-parse")) return { stdout: `${UPSTREAM_COMMIT}\n` };
    if (cmd === "rustup" && args[0] === "toolchain") return { stdout: `${REQUIRED_TOOLCHAIN}-aarch64-apple-darwin\n` };
    if (cmd === "rustup" && args[0] === "component") return { stdout: "cargo\nclippy\nrust-src\nrustfmt\n" };
    if (cmd === "cargo" && args[0] === "build") {
      if (over.cargoFails) return { status: 101, stderr: "error[E0425]: cannot find value" };
      for (const name of ["codex", "codex-code-mode-host"]) {
        const bin = join(paths.sourceDir, "codex-rs/target/release", name);
        mkdirSync(join(bin, ".."), { recursive: true });
        // A directory passes buildPatched's exists/non-empty check and then fails the copy, which
        // is what an unusable build output looks like from the stager's side.
        if (over.hostUnusable && name === "codex-code-mode-host") mkdirSync(bin, { recursive: true });
        else writeFileSync(bin, `ELF-${name}`);
      }
      return {};
    }
    return {};
  });
  const c: Context = {
    env, paths, run,
    which: over.which ?? ((cmd) => (cmd === "just" ? null : `/usr/bin/${cmd}`)),
    freeBytes: over.freeBytes ?? (() => MIN_FREE_BYTES * 2),
    cxBin: join(paths.binDir, "cxstatusline"),
    patchesDir,
    now: () => new Date("2026-09-02T12:00:00Z"),
    log: () => {},
    say: (l) => said.push(l),
  };
  return { c, paths, real, said, calls, root, state };
}

/** The pair a fresh `codex` would actually run. */
function activePair(paths: ReturnType<typeof resolvePaths>): { codex: string; host: string } {
  const dir = activeGeneration(paths);
  if (dir === null) throw new Error("no active generation");
  return { codex: readFileSync(join(dir, "codex"), "utf8"), host: readFileSync(join(dir, "codex-code-mode-host"), "utf8") };
}

/** Everything under libexec that is not the pointer or the generations tree. */
function strayStaging(paths: ReturnType<typeof resolvePaths>): string[] {
  if (!existsSync(paths.libexecDir)) return [];
  return readdirSync(paths.libexecDir).filter((n) => n !== "current" && n !== "generations");
}

describe("runAcquisition (compiled)", () => {
  test("first run: builds both binaries, activates one generation, records provenance", async () => {
    const { c, paths, real, calls } = ctx();
    expect(await runAcquisition(c, { source: "compiled", force: false }))
      .toEqual({ kind: "installed", version: "0.152.1", source: "compiled", reused: false });
    expect(activePair(paths)).toEqual({ codex: "ELF-codex", host: "ELF-codex-code-mode-host" });
    expect(isOurWrapper(paths.wrapperPath)).toBe(true);
    const installed = readInstallation(paths);
    expect(installed?.provenance).toMatchObject({
      source: "compiled",
      cxVersion: VERSION,
      upstreamCommit: UPSTREAM_COMMIT,
      patchSha256: PATCH_SHA,
      sourceCommit: null,
      sourceDirty: false,
    });
    expect(installed?.provenance.release).toBeUndefined();
    const { state } = readState(paths.stateFile);
    expect(state.patched_from).toBe("0.152.1");
    expect(state.upstream_bin).toBe(real);
    expect(state.launcher_restore).toEqual({ kind: "symlink", target: real });
    expect(state.last_attempt).toMatchObject({ ok: true, version: "0.152.1" });
    expect(calls.some((k) => k.cmd === "cargo" && k.args[0] === "build")).toBe(true);
    expect(existsSync(paths.lockFile)).toBe(false);
    expect(readFileSync(real, "utf8")).toBe("UPSTREAM-ELF"); // upstream never written
    expect(strayStaging(paths)).toEqual([]); // the staging directory is removed
  });
  test("a staging failure removes the half-written compiled- directory", async () => {
    const { c, paths } = ctx({ hostUnusable: true });
    const outcome = await runAcquisition(c, { source: "compiled", force: false });
    expect(outcome.kind).toBe("failed");
    // The first executable was already copied when the second one failed; nothing may survive.
    expect(strayStaging(paths)).toEqual([]);
    expect(readInstallation(paths)).toBeNull();
  });
  test("a newer launcher wins over the saved upstream_bin", async () => {
    const { c, paths, root } = ctx({ upstreamVersion: "0.153.0" });
    const old = join(root, "old-codex");
    writeFileSync(old, "OLD");
    chmodSync(old, 0o755);
    writeState(paths.stateFile, { ...DEFAULT_STATE, upstream_bin: old, patched_from: "0.152.1" });
    const run: Context["run"] = (cmd, args, opts) => cmd === old
      ? { status: 0, stdout: "codex-cli 0.152.1", stderr: "" } : c.run(cmd, args, opts);
    expect(await runAcquisition({ ...c, run }, { source: "compiled", force: false }))
      .toEqual({ kind: "installed", version: "0.153.0", source: "compiled", reused: false });
    expect(readState(paths.stateFile).state.patched_from).toBe("0.153.0");
    expect(readFileSync(old, "utf8")).toBe("OLD");
  });
  test("held: same minor under stable-minors -> no build, no state change", async () => {
    const { c, paths, calls } = ctx({ upstreamVersion: "0.152.1" });
    writeState(paths.stateFile, { ...DEFAULT_STATE, policy: "stable-minors", patched_from: "0.152.0", upstream_bin: "/x" });
    expect(await runAcquisition(c, { source: "compiled", force: false }))
      .toEqual({ kind: "held", upstream: "0.152.1", patched: "0.152.0" });
    expect(calls.some((k) => k.cmd === "cargo")).toBe(false);
  });
  test("every: same minor patch bump builds and updates state", async () => {
    const { c, paths, calls } = ctx({ upstreamVersion: "0.152.1" });
    writeState(paths.stateFile, { ...DEFAULT_STATE, policy: "every", patched_from: "0.152.0", upstream_bin: "/x" });
    expect(await runAcquisition(c, { source: "compiled", force: false }))
      .toEqual({ kind: "installed", version: "0.152.1", source: "compiled", reused: false });
    expect(calls.some((k) => k.cmd === "cargo")).toBe(true);
  });
  test("held: a freshly re-resolved upstream_bin is persisted even with no rebuild", async () => {
    const { c, paths, real } = ctx({ upstreamVersion: "0.152.1" });
    writeState(paths.stateFile, { ...DEFAULT_STATE, patched_from: "0.152.1", upstream_bin: "/stale/codex" });
    const baseRun = c.run;
    const run: typeof c.run = (cmd, args, opts) =>
      cmd === "/stale/codex" ? { status: 127, stdout: "", stderr: "" } : baseRun(cmd, args, opts);
    expect(await runAcquisition({ ...c, run }, { source: "compiled", force: false }))
      .toEqual({ kind: "held", upstream: "0.152.1", patched: "0.152.1" });
    const { state } = readState(paths.stateFile);
    expect(state.upstream_bin).toBe(real);
    expect(state.launcher_restore).toEqual({ kind: "symlink", target: real });
    expect(state.patched_from).toBe("0.152.1");
  });
  test("--force overrides the hold", async () => {
    const { c, paths } = ctx();
    writeState(paths.stateFile, { ...DEFAULT_STATE, patched_from: "0.152.0" });
    expect((await runAcquisition(c, { source: "compiled", force: true })).kind).toBe("installed");
  });
  test("refused: version outside every manifest range; last_attempt records why", async () => {
    const { c, paths } = ctx({ upstreamVersion: "0.160.0" });
    expect(await runAcquisition(c, { source: "compiled", force: false }))
      .toMatchObject({ kind: "refused", reason: expect.stringContaining("0.160.0") });
    expect(readState(paths.stateFile).state.last_attempt).toMatchObject({ ok: false, version: "0.160.0" });
  });
  test("refused: a malformed manifest is a refusal, not a crash", async () => {
    const { c, paths } = ctx({ manifest: '{"version":1,"tag_prefix":"rust-v","patches":[{}]}' });
    expect(await runAcquisition(c, { source: "compiled", force: false }))
      .toMatchObject({ kind: "refused", reason: expect.stringMatching(/manifest is malformed/) });
    expect(readState(paths.stateFile).state.last_attempt).toMatchObject({ ok: false });
  });
  test("refused: preflight failure never reaches git or cargo", async () => {
    const { c, calls } = ctx({ which: (cmd) => (cmd === "rustup" ? null : "/x") });
    expect(await runAcquisition(c, { source: "compiled", force: false }))
      .toMatchObject({ kind: "refused", reason: expect.stringMatching(/rustup/) });
    expect(calls.filter((k) => k.cmd === "git" || k.cmd === "cargo")).toEqual([]);
  });
  test("failed: a cargo error leaves the stock launcher untouched and records the reason", async () => {
    const { c, paths, real } = ctx({ cargoFails: true });
    expect(await runAcquisition(c, { source: "compiled", force: false }))
      .toMatchObject({ kind: "failed", reason: expect.stringContaining("E0425") });
    expect(isOurWrapper(paths.wrapperPath)).toBe(false);
    expect(readlinkSync(paths.wrapperPath)).toBe(real);
    expect(activeGeneration(paths)).toBeNull();
    expect(strayStaging(paths)).toEqual([]);
    expect(readState(paths.stateFile).state.last_attempt).toMatchObject({ ok: false });
  });
  test("locked: another live process holds the lock", async () => {
    const { c, paths } = ctx();
    mkdirSync(paths.stateDir, { recursive: true });
    writeFileSync(paths.lockFile, `${process.pid}\n`);
    expect(await runAcquisition(c, { source: "compiled", force: false })).toEqual({ kind: "locked" });
  });
  test("corrupt state.json is reported and recovered from the backup", async () => {
    const { c, paths, said, real } = ctx();
    writeState(paths.stateFile, { ...DEFAULT_STATE, patched_from: "0.152.0", upstream_bin: real });
    writeFileSync(paths.stateFile, "{{");
    expect((await runAcquisition(c, { source: "compiled", force: true })).kind).toBe("installed");
    expect(said.some((l) => /state\.json was corrupt/i.test(l))).toBe(true);
  });
  test("refused: a foreign launcher is named before anything is built", async () => {
    const { c, paths, calls } = ctx();
    rmSync(paths.wrapperPath);
    writeFileSync(paths.wrapperPath, "#!/bin/sh\nexec /opt/homebrew/bin/codex-real\n");
    expect(await runAcquisition(c, { source: "compiled", force: true }))
      .toMatchObject({ kind: "refused", reason: expect.stringContaining("refusing to overwrite it") });
    expect(readFileSync(paths.wrapperPath, "utf8")).toContain("codex-real");
    expect(calls.some((k) => k.cmd === "cargo")).toBe(false);
  });
  test("refused before any download when the launcher is a foreign file we could still resolve past", async () => {
    const { c, paths, real, calls } = ctx({ noRust: true });
    writeState(paths.stateFile, { ...DEFAULT_STATE, upstream_bin: real, patched_from: "0.152.0" });
    rmSync(paths.wrapperPath);
    writeFileSync(paths.wrapperPath, "#!/bin/sh\nexec /opt/homebrew/bin/codex-real\n");
    chmodSync(paths.wrapperPath, 0o755);
    const fetchSpy = (): Promise<Response> => { throw new Error("the network must not be touched"); };
    expect(await runAcquisition(c, { source: "prebuilt", force: true }, { fetch: fetchSpy }))
      .toMatchObject({ kind: "refused", reason: expect.stringMatching(/refusing to (replace|overwrite) it/) });
    expect(readFileSync(paths.wrapperPath, "utf8")).toContain("codex-real");
    expect(calls.some((k) => k.cmd === "gh")).toBe(false);
  });
});

// --- prebuilt -----------------------------------------------------------------

const CODEX = "0.153.0";
const fixture = () => releaseFixture({ cxVersion: VERSION, codexVersion: CODEX });

async function withServer<T>(routes: Record<string, Route>, body: (baseUrl: string, requests: string[]) => Promise<T>): Promise<T> {
  const server = await releaseServer(routes);
  try {
    return await body(server.baseUrl, server.requests);
  } finally {
    await server.close();
  }
}

describe("runAcquisition (prebuilt)", () => {
  test("downloads, verifies and activates the published pair without any Rust toolchain", async () => {
    const f = fixture();
    const { c, paths, calls } = ctx({ upstreamVersion: CODEX, noRust: true });
    await withServer(routesFor(f), async (baseUrl) => {
      expect(await runAcquisition(c, { source: "prebuilt", force: false }, { baseUrl }))
        .toEqual({ kind: "installed", version: CODEX, source: "prebuilt", reused: false });
    });
    expect(activePair(paths)).toEqual({ codex: "CODEX-BINARY", host: "HOST-BINARY" });
    expect(readInstallation(paths)?.provenance).toMatchObject({ source: "prebuilt", cxVersion: VERSION });
    expect(readInstallation(paths)?.provenance.release?.tag).toBe(f.tag);
    expect(isOurWrapper(paths.wrapperPath)).toBe(true);
    expect(readState(paths.stateFile).state).toMatchObject({ patched_from: CODEX, last_attempt: { ok: true, version: CODEX } });
    expect(calls.some((k) => k.cmd === "cargo" || k.cmd === "rustup" || k.cmd === "git")).toBe(false);
    expect(strayStaging(paths)).toEqual([]);
  });
  test("a second install of the same pair reuses the existing generation and downloads no archive", async () => {
    const f = fixture();
    const { c, paths } = ctx({ upstreamVersion: CODEX, noRust: true });
    await withServer(routesFor(f), async (baseUrl, requests) => {
      await runAcquisition(c, { source: "prebuilt", force: true }, { baseUrl });
      const first = activeGeneration(paths);
      expect(await runAcquisition(c, { source: "prebuilt", force: true }, { baseUrl }))
        .toEqual({ kind: "installed", version: CODEX, source: "prebuilt", reused: true });
      expect(activeGeneration(paths)).toBe(first);
      expect(requests.filter((r) => r.endsWith(".tar.gz"))).toHaveLength(1);
    });
  });
  test("refused: targetVersion not supported by manifest", async () => {
    const { c } = ctx({ noRust: true });
    expect(await runAcquisition(c, { source: "prebuilt", force: true, targetVersion: "0.99.0" }))
      .toEqual({
        kind: "refused",
        reason: expect.stringMatching(/0\.99\.0 is not supported/i),
      });
  });
  test("installs requested targetVersion even when local upstream is different", async () => {
    const f = fixture();
    const { c, paths } = ctx({ upstreamVersion: "0.152.1", stagedVersion: CODEX, noRust: true });
    await withServer(routesFor(f), async (baseUrl) => {
      expect(await runAcquisition(c, { source: "prebuilt", force: true, targetVersion: CODEX }, { baseUrl }))
        .toEqual({ kind: "installed", version: CODEX, source: "prebuilt", reused: false });
    });
    expect(readInstallation(paths)?.provenance.release?.tag).toBe(f.tag);
    expect(readState(paths.stateFile).state.patched_from).toBe(CODEX);
  });
  test("installs prebuilt standalone when no local upstream binary exists", async () => {
    const f = fixture();
    const { c, paths } = ctx({ noRust: true, stagedVersion: CODEX, which: () => null });
    rmSync(paths.wrapperPath, { force: true });
    await withServer(routesFor(f), async (baseUrl) => {
      expect(await runAcquisition(c, { source: "prebuilt", force: true, targetVersion: CODEX }, { baseUrl }))
        .toEqual({ kind: "installed", version: CODEX, source: "prebuilt", reused: false });
    });
    expect(activePair(paths)).toEqual({ codex: "CODEX-BINARY", host: "HOST-BINARY" });
    expect(isOurWrapper(paths.wrapperPath)).toBe(true);
    expect(readState(paths.stateFile).state.patched_from).toBe(CODEX);
  });
  test("no published release: unavailable, the old pair keeps running, nothing compiles", async () => {
    const f = fixture();
    const { c, paths, calls } = ctx({ upstreamVersion: CODEX, noRust: true });
    await withServer(routesFor(f), async (baseUrl) => {
      await runAcquisition(c, { source: "prebuilt", force: true }, { baseUrl });
    });
    const before = activeGeneration(paths);
    // Upstream moves on; nothing is published for the new version.
    const next = ctx({ upstreamVersion: "0.154.0", noRust: true });
    await withServer({}, async (baseUrl) => {
      expect(await runAcquisition(next.c, { source: "prebuilt", force: true }, { baseUrl }))
        .toMatchObject({ kind: "unavailable", version: "0.154.0" });
    });
    expect(activeGeneration(paths)).toBe(before);
    expect(activePair(paths)).toEqual({ codex: "CODEX-BINARY", host: "HOST-BINARY" });
    expect(next.calls.some((k) => k.cmd === "cargo" || k.cmd === "rustup")).toBe(false);
  });
  test("an unavailable release records the bounded-retry reason in last_attempt", async () => {
    const { c, paths } = ctx({ upstreamVersion: CODEX, noRust: true });
    await withServer({}, async (baseUrl) => {
      await runAcquisition(c, { source: "prebuilt", force: true }, { baseUrl });
    });
    expect(readState(paths.stateFile).state.last_attempt)
      .toEqual({ at: "2026-09-02T12:00:00.000Z", ok: false, version: CODEX, reason: RELEASE_UNAVAILABLE });
  });
  test("gh auth failure is reported as an auth problem, not as a missing release", async () => {
    const { c, paths } = ctx({
      upstreamVersion: CODEX,
      noRust: true,
      which: (cmd) => (cmd === "gh" ? "/usr/bin/gh" : null),
      gh: () => ({ status: 1, stderr: "gh: To get started with GitHub CLI, please run: gh auth login" }),
    });
    await withServer({}, async (baseUrl) => {
      expect(await runAcquisition(c, { source: "prebuilt", force: true }, { baseUrl }))
        .toMatchObject({ kind: "failed", reason: expect.stringMatching(/not logged in|auth/i) });
    });
    // Not the bounded-retry token: the hook must not apply the 24h "not published yet" backoff.
    const attempt = readState(paths.stateFile).state.last_attempt;
    expect(attempt?.reason).not.toBe(RELEASE_UNAVAILABLE);
    expect(attempt?.reason).toMatch(/not logged in|auth/i);
  });
  test("a digest mismatch keeps the real reason, not 'release-unavailable'", async () => {
    const badFixture = releaseFixture({ cxVersion: VERSION, codexVersion: CODEX, archiveSha: "b".repeat(64) });
    const { c, paths } = ctx({ upstreamVersion: CODEX, noRust: true });
    await withServer(routesFor(badFixture), async (baseUrl) => {
      const outcome = await runAcquisition(c, { source: "prebuilt", force: true }, { baseUrl });
      expect(outcome).toMatchObject({ kind: "failed", reason: expect.stringMatching(/sha256|digest/i) });
      expect(describeOutcome(outcome)).not.toMatch(/published yet/i);
    });
    const attempt = readState(paths.stateFile).state.last_attempt;
    expect(attempt?.reason).not.toBe(RELEASE_UNAVAILABLE);
    expect(attempt?.reason).toMatch(/sha256|digest/i);
  });
  test("a real 404 (public miss, gh also reports not found) still yields release-unavailable and the backoff", async () => {
    const { c, paths } = ctx({
      upstreamVersion: CODEX,
      noRust: true,
      which: (cmd) => (cmd === "gh" ? "/usr/bin/gh" : null),
      gh: () => ({ status: 1, stderr: "HTTP 404: Not Found" }),
    });
    await withServer({}, async (baseUrl) => {
      expect(await runAcquisition(c, { source: "prebuilt", force: true }, { baseUrl }))
        .toMatchObject({ kind: "unavailable" });
    });
    expect(readState(paths.stateFile).state.last_attempt)
      .toEqual({ at: "2026-09-02T12:00:00.000Z", ok: false, version: CODEX, reason: RELEASE_UNAVAILABLE });
  });
  test("refused before any network when there is no room to stage", async () => {
    const { c, calls } = ctx({
      upstreamVersion: CODEX,
      noRust: true,
      freeBytes: () => MIN_STAGING_FREE_BYTES - 1,
    });
    const fetchSpy = (): Promise<Response> => { throw new Error("the network must not be touched"); };
    expect(await runAcquisition(c, { source: "prebuilt", force: true }, { fetch: fetchSpy }))
      .toMatchObject({ kind: "refused", reason: expect.stringContaining("2 GiB") });
    expect(calls.some((k) => k.cmd === "cargo" || k.cmd === "gh")).toBe(false);
  });
});

describe("describeOutcome", () => {
  test("every variant has a distinct sentence and none of them says 'built'", () => {
    const lines = [
      describeOutcome({ kind: "installed", version: "0.152.1", source: "prebuilt", reused: false }),
      describeOutcome({ kind: "installed", version: "0.152.1", source: "prebuilt", reused: true }),
      describeOutcome({ kind: "installed", version: "0.152.1", source: "compiled", reused: false }),
      describeOutcome({ kind: "held", upstream: "0.152.2", patched: "0.152.1" }),
      describeOutcome({ kind: "refused", reason: "nope" }),
      describeOutcome({ kind: "unavailable", version: "0.152.1", reason: "nope" }),
      describeOutcome({ kind: "locked" }),
      describeOutcome({ kind: "failed", reason: "boom" }),
    ];
    expect(new Set(lines).size).toBe(8);
    expect(lines.join("\n")).not.toMatch(/\bbuilt\b/);
    expect(lines.slice(0, 3).every((l) => /open a new session/i.test(l))).toBe(true);
  });
});

describe("simulateDrift", () => {
  test("records the given version as patched_from and says what to do next", () => {
    const { c, paths } = ctx();
    const msg = simulateDrift(c, "0.151.0");
    expect(readState(paths.stateFile).state.patched_from).toBe("0.151.0");
    expect(msg).toMatch(/start a Codex session/i);
  });
  test("rejects a non-semver argument", () => {
    const { c } = ctx();
    expect(() => simulateDrift(c, "banana")).toThrow(/semver/);
  });
  test("locked: another live process holds the lock, and state.json is left untouched", () => {
    const { c, paths } = ctx();
    mkdirSync(paths.stateDir, { recursive: true });
    writeFileSync(paths.lockFile, `${process.pid}\n`);
    expect(() => simulateDrift(c, "0.151.0")).toThrow(/already running/);
    expect(readState(paths.stateFile).state.patched_from).toBeNull();
  });
});

describe("runPatch", () => {
  test("is the compiled path", async () => {
    const { c, calls } = ctx();
    expect(await runPatch(c, { force: false }))
      .toEqual({ kind: "installed", version: "0.152.1", source: "compiled", reused: false });
    expect(calls.some((k) => k.cmd === "cargo" && k.args[0] === "build")).toBe(true);
  });
});

describe("runInstall", () => {
  test("prebuilt by default, then merges the SessionStart hook and prints the trust sentence", async () => {
    const f = fixture();
    const { c, paths, said, calls } = ctx({ upstreamVersion: CODEX, noRust: true });
    await withServer(routesFor(f), async (baseUrl) => {
      expect(await runInstall(c, { compile: false }, { baseUrl })).toBe(0);
    });
    expect(activePair(paths).codex).toBe("CODEX-BINARY");
    const hooks = JSON.parse(readFileSync(paths.hooksFile, "utf8")) as HooksFile;
    expect((hooks.hooks.SessionStart ?? []).some(isOurGroup)).toBe(true);
    expect(said.join("\n")).toContain("Start Codex once and accept the cxstatusline hook when prompted.");
    expect(said.join("\n")).toMatch(/prebuilt/);
    expect(calls.some((k) => k.cmd === "cargo")).toBe(false);
  });
  test("--compile builds from source", async () => {
    const { c, paths, calls, said } = ctx();
    expect(await runInstall(c, { compile: true })).toBe(0);
    expect(activePair(paths).codex).toBe("ELF-codex");
    expect(calls.some((k) => k.cmd === "cargo" && k.args[0] === "build")).toBe(true);
    expect(said.join("\n")).toMatch(/source/);
  });
  test("a second install leaves the hook entry byte-stable and says unchanged", async () => {
    const { c, paths, said } = ctx();
    await runInstall(c, { compile: true });
    const first = readFileSync(paths.hooksFile, "utf8");
    said.length = 0;
    expect(await runInstall(c, { compile: true })).toBe(0);
    expect(readFileSync(paths.hooksFile, "utf8")).toBe(first);
    expect(said.join("\n")).toContain("hook unchanged");
  });
  test("a refused install does not write a hook", async () => {
    const { c, paths } = ctx({ which: (cmd) => (cmd === "rustup" ? null : "/x") });
    expect(await runInstall(c, { compile: true })).toBe(1);
    expect(existsSync(paths.hooksFile)).toBe(false);
  });
  test("a malformed hooks.json is reported honestly, and the pair stays installed", async () => {
    const { c, paths, said } = ctx();
    mkdirSync(join(paths.hooksFile, ".."), { recursive: true });
    writeFileSync(paths.hooksFile, "{ nope");
    expect(await runInstall(c, { compile: true })).toBe(1);
    expect(activePair(paths).codex).toBe("ELF-codex");
    expect(said.join("\n")).toMatch(/hook could not be written/);
    expect(said.join("\n")).toMatch(/installed/);
    expect(readFileSync(paths.hooksFile, "utf8")).toBe("{ nope");
  });
  test("an unavailable release suggests --compile only when the local manifest covers the version", async () => {
    const covered = ctx({ upstreamVersion: CODEX, noRust: true });
    await withServer({}, async (baseUrl) => {
      expect(await runInstall(covered.c, { compile: false }, { baseUrl })).toBe(1);
    });
    expect(covered.said.join("\n")).toContain("cxstatusline install --compile");

    const uncovered = ctx({ upstreamVersion: "0.160.0", noRust: true });
    await withServer({}, async (baseUrl) => {
      expect(await runInstall(uncovered.c, { compile: false }, { baseUrl })).toBe(1);
    });
    expect(uncovered.said.join("\n")).not.toContain("--compile");
    expect(uncovered.said.join("\n")).toMatch(/neither a prebuilt release nor a local patch/i);
  });
  test("a tracking issue is linked only when gh finds one with the exact title", async () => {
    const found = ctx({
      upstreamVersion: "0.160.0",
      noRust: true,
      which: (cmd) => (cmd === "gh" ? "/usr/bin/gh" : null),
      gh: (args) => (args[0] === "issue"
        ? { stdout: JSON.stringify([{ title: "Prebuilt blocked: Codex 0.160.0", url: "https://github.com/adrijshikhar/cxstatusline/issues/7" }]) }
        : { status: 1, stderr: "release not found" }),
    });
    await withServer({}, async (baseUrl) => { await runInstall(found.c, { compile: false }, { baseUrl }); });
    expect(found.said.join("\n")).toContain("https://github.com/adrijshikhar/cxstatusline/issues/7");

    const none = ctx({
      upstreamVersion: "0.160.0",
      noRust: true,
      which: (cmd) => (cmd === "gh" ? "/usr/bin/gh" : null),
      gh: (args) => (args[0] === "issue" ? { stdout: "[]" } : { status: 1, stderr: "release not found" }),
    });
    await withServer({}, async (baseUrl) => { await runInstall(none.c, { compile: false }, { baseUrl }); });
    expect(none.said.join("\n")).not.toContain("issues/");
  });
});

describe("runUpdate", () => {
  const mockFetchLatest = (targetVersion: string) => {
    return async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const urlStr = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
      if (urlStr.includes("api.github.com/repos/openai/codex/releases/latest")) {
        return new Response(JSON.stringify({ tag_name: `rust-v${targetVersion}` }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (urlStr.includes(`codex-v${targetVersion}/manifest.json`) && !urlStr.includes("127.0.0.1")) {
        return new Response(null, { status: 404 });
      }
      return fetch(url, init);
    };
  };

  test("runs upstream's updater, then installs the prebuilt pair for the new version", async () => {
    const f = releaseFixture({ cxVersion: VERSION, codexVersion: "0.154.0" });
    const { c, paths, calls, said, state } = ctx({ upstreamVersion: "0.153.0", noRust: true });
    const baseRun = c.run;
    const run: typeof c.run = (cmd, args, opts) => {
      if (args[0] === "update") {
        state.upstreamVersion = "0.154.0"; // the updater really did move upstream on
        return { status: 0, stdout: "", stderr: "" };
      }
      return baseRun(cmd, args, opts);
    };
    await withServer(routesFor(f), async (baseUrl) => {
      expect(await runUpdate({ ...c, run }, { baseUrl, fetch: mockFetchLatest("0.154.0") })).toBe(0);
    });
    expect(readState(paths.stateFile).state.patched_from).toBe("0.154.0");
    expect(activePair(paths).codex).toBe("CODEX-BINARY");
    expect(calls.some((k) => k.args[0] === "update")).toBe(false); // the updater went through `run`
    expect(said.join("\n")).toMatch(/open a new session/i);
  });
  test("a failed updater is not followed by any acquisition", async () => {
    const { c, said } = ctx({ noRust: true });
    const baseRun = c.run;
    const run: typeof c.run = (cmd, args, opts) =>
      args[0] === "update" ? { status: 3, stdout: "", stderr: "" } : baseRun(cmd, args, opts);
    const fetchSpy = (): Promise<Response> => { throw new Error("the network must not be touched"); };
    expect(await runUpdate({ ...c, run }, { fetch: fetchSpy })).toBe(1);
    expect(said.join("\n")).toMatch(/exited 3/);
  });
  test("a missing release after the updater keeps the older pair healthy and never compiles", async () => {
    const f = fixture();
    const { c, paths, calls, said, state } = ctx({ upstreamVersion: CODEX, noRust: true });
    await withServer(routesFor(f), async (baseUrl) => {
      expect(await runAcquisition(c, { source: "prebuilt", force: true }, { baseUrl })).toMatchObject({ kind: "installed" });
    });
    const before = activeGeneration(paths);
    const baseRun = c.run;
    const run: typeof c.run = (cmd, args, opts) => {
      if (args[0] === "update") {
        state.upstreamVersion = "0.154.0";
        return { status: 0, stdout: "", stderr: "" };
      }
      return baseRun(cmd, args, opts);
    };
    said.length = 0;
    await withServer({}, async (baseUrl) => {
      expect(await runUpdate({ ...c, run }, { baseUrl, fetch: mockFetchLatest("0.154.0") })).toBe(1);
    });
    expect(activeGeneration(paths)).toBe(before);
    expect(activePair(paths)).toEqual({ codex: "CODEX-BINARY", host: "HOST-BINARY" });
    expect(isOurWrapper(paths.wrapperPath)).toBe(true);
    expect(calls.some((k) => k.cmd === "cargo" || k.cmd === "rustup")).toBe(false);
    expect(said.join("\n")).toMatch(/0\.154\.0/);
  });
  test("a foreign launcher installed by the updater is refused, never overwritten", async () => {
    const { c, paths, said } = ctx({ upstreamVersion: CODEX, noRust: true });
    const baseRun = c.run;
    const run: typeof c.run = (cmd, args, opts) => {
      if (args[0] === "update") {
        rmSync(paths.wrapperPath);
        writeFileSync(paths.wrapperPath, "#!/bin/sh\nexec /opt/homebrew/bin/codex-real\n");
        chmodSync(paths.wrapperPath, 0o755);
        return { status: 0, stdout: "", stderr: "" };
      }
      return baseRun(cmd, args, opts);
    };
    const fetchSpy = (): Promise<Response> => { throw new Error("the network must not be touched"); };
    expect(await runUpdate({ ...c, run }, { fetch: fetchSpy })).toBe(1);
    expect(readFileSync(paths.wrapperPath, "utf8")).toContain("codex-real");
    expect(said.join("\n")).toMatch(/refusing to overwrite it/);
  });
  test("non-interactive update when prebuilt missing but newer prebuilt exists prints guidance and exits 1", async () => {
    const { c, said } = ctx({ upstreamVersion: "0.153.0", noRust: true });
    const fetchPrebuilts = async () => ["0.155.1", "0.155.0", "0.153.0"];
    const mockFetch = mockFetchLatest("0.156.1");
    const res = await runUpdate(c, {
      isTTY: false,
      fetchPrebuilts,
    }, { fetch: mockFetch });
    expect(res).toBe(1);
    const output = said.join("\n");
    expect(output).toMatch(/Upstream Codex update available: 0\.153\.0 -> 0\.156\.1/);
    expect(output).toMatch(/Newer prebuilt available: Codex 0\.155\.1 is published and ready to install/);
    expect(output).toMatch(/cxstatusline install --codex-version 0\.155\.1/);
  });
  test("interactive update when newer prebuilt exists and user selects choice 1 installs available prebuilt", async () => {
    const f = releaseFixture({ cxVersion: VERSION, codexVersion: "0.155.1" });
    const { c, paths, said } = ctx({
      upstreamVersion: "0.153.0",
      stagedVersion: "0.155.1",
      noRust: true,
      manifest: JSON.stringify({
        version: 1,
        tag_prefix: "rust-v",
        patches: [{ min: "0.152.1", max: "0.155.1", file: "p.patch" }],
      }),
    });
    const fetchPrebuilts = async () => ["0.155.1", "0.153.0"];
    const mockFetch = mockFetchLatest("0.156.1");
    let asked = false;
    const ask = async () => {
      asked = true;
      return "1";
    };

    await withServer(routesFor(f), async (baseUrl) => {
      const res = await runUpdate(c, {
        isTTY: true,
        ask,
        fetchPrebuilts,
      }, { baseUrl, fetch: mockFetch });
      expect(res).toBe(0);
    });

    expect(asked).toBe(true);
    expect(readState(paths.stateFile).state.patched_from).toBe("0.155.1");
    expect(said.join("\n")).toMatch(/Installing prebuilt binaries for Codex 0\.155\.1/);
  });
  test("interactive update when user selects cancel exits 0 without modifying system", async () => {
    const { c, paths, said } = ctx({ upstreamVersion: "0.153.0", noRust: true });
    const fetchPrebuilts = async () => ["0.155.1", "0.153.0"];
    const mockFetch = mockFetchLatest("0.156.1");
    const ask = async () => "4";

    const res = await runUpdate(c, {
      isTTY: true,
      ask,
      fetchPrebuilts,
    }, { fetch: mockFetch });

    expect(res).toBe(0);
    expect(said.join("\n")).toMatch(/Update cancelled/);
    expect(readState(paths.stateFile).state.patched_from).toBeNull();
  });
});
