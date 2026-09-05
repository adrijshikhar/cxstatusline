import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Context } from "../src/context";
import { resolvePaths } from "../src/paths";
import { describeOutcome, runInstall, runPatch, simulateDrift } from "../src/patch/run";
import { MIN_FREE_BYTES, REQUIRED_TOOLCHAIN } from "../src/patch/preflight";
import { readState, writeState, DEFAULT_STATE } from "../src/state";
import { isOurWrapper } from "../src/patch/wrapper";
import { isOurGroup, type HooksFile } from "../src/hook/install";
import { fakeExec, tmpEnv } from "./helpers";

function ctx(over: { upstreamVersion?: string; which?: (c: string) => string | null; cargoFails?: boolean; manifest?: string } = {}) {
  const { env, root } = tmpEnv();
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
    ?? JSON.stringify({ version: 1, tag_prefix: "rust-v", patches: [{ min: "0.152.1", max: "0.152.1", file: "p.patch" }] }));
  writeFileSync(join(patchesDir, "p.patch"), "");
  const said: string[] = [];
  const { run, calls } = fakeExec((cmd, args) => {
    if (args[0] === "--version") return { stdout: `codex-cli ${over.upstreamVersion ?? "0.152.1"}\n` };
    if (cmd === "rustup" && args[0] === "toolchain") return { stdout: `${REQUIRED_TOOLCHAIN}-aarch64-apple-darwin\n` };
    if (cmd === "rustup" && args[0] === "component") return { stdout: "cargo\nclippy\nrust-src\nrustfmt\n" };
    if (cmd === "cargo") {
      if (over.cargoFails) return { status: 101, stderr: "error[E0425]: cannot find value" };
      const bin = join(paths.sourceDir, "codex-rs/target/release/codex");
      mkdirSync(join(bin, ".."), { recursive: true });
      writeFileSync(bin, "ELF");
      return {};
    }
    return {};
  });
  const c: Context = {
    env, paths, run,
    which: over.which ?? ((cmd) => `/usr/bin/${cmd}`),
    freeBytes: () => MIN_FREE_BYTES * 2,
    cxBin: "/cx",
    patchesDir,
    now: () => new Date("2026-09-02T12:00:00Z"),
    log: () => {},
    say: (l) => said.push(l),
  };
  return { c, paths, real, said, calls, root };
}

describe("runPatch", () => {
  test("builds the new launcher release while the saved old binary remains", () => {
    const { c, paths, root } = ctx({ upstreamVersion: "0.153.0", manifest: JSON.stringify({ version: 1, tag_prefix: "rust-v", patches: [{ min: "0.153.0", max: "0.153.0", file: "p.patch" }] }) });
    const old = join(root, "old-codex");
    writeFileSync(old, "OLD");
    chmodSync(old, 0o755);
    writeState(paths.stateFile, { ...DEFAULT_STATE, upstream_bin: old, patched_from: "0.152.1" });
    const run: Context["run"] = (cmd, args, opts) => cmd === old
      ? { status: 0, stdout: "codex-cli 0.152.1", stderr: "" } : c.run(cmd, args, opts);
    expect(runPatch({ ...c, run }, { force: false })).toEqual({ kind: "built", version: "0.153.0" });
    expect(readState(paths.stateFile).state.patched_from).toBe("0.153.0");
    expect(readFileSync(old, "utf8")).toBe("OLD");
  });
  test("first run: builds, installs binary + wrapper, records state", () => {
    const { c, paths, real, calls } = ctx();
    expect(runPatch(c, { force: false })).toEqual({ kind: "built", version: "0.152.1" });
    expect(readFileSync(paths.patchedBin, "utf8")).toBe("ELF");
    expect(readFileSync(paths.patchedCodeModeHost, "utf8")).toBe("UPSTREAM-HOST");
    expect(isOurWrapper(paths.wrapperPath)).toBe(true);
    const { state } = readState(paths.stateFile);
    expect(state.patched_from).toBe("0.152.1");
    expect(state.upstream_bin).toBe(real);
    expect(state.launcher_restore).toEqual({ kind: "symlink", target: real });
    expect(state.last_attempt).toMatchObject({ ok: true, version: "0.152.1" });
    expect(calls.some((k) => k.cmd === "cargo")).toBe(true);
    expect(existsSync(paths.lockFile)).toBe(false);
    expect(readFileSync(real, "utf8")).toBe("UPSTREAM-ELF"); // upstream never written
  });
  test("held: same minor under stable-minors -> no build, no state change", () => {
    const { c, paths } = ctx({ upstreamVersion: "0.152.1" });
    writeState(paths.stateFile, { ...DEFAULT_STATE, patched_from: "0.152.0", upstream_bin: "/x" });
    expect(runPatch(c, { force: false })).toEqual({ kind: "held", upstream: "0.152.1", patched: "0.152.0" });
  });
  test("held: a freshly re-resolved upstream_bin/launcher_restore is persisted even with no rebuild", () => {
    const { c, paths, real } = ctx({ upstreamVersion: "0.152.1" });
    // Record a stale upstream_bin that no longer answers --version, forcing upstreamFor to
    // re-resolve via resolveUpstream, which finds `real` through the wrapper's own symlink.
    writeState(paths.stateFile, { ...DEFAULT_STATE, patched_from: "0.152.1", upstream_bin: "/stale/codex" });
    const baseRun = c.run;
    const run: typeof c.run = (cmd, args, opts) =>
      cmd === "/stale/codex" ? { status: 127, stdout: "", stderr: "" } : baseRun(cmd, args, opts);
    const c2: Context = { ...c, run };
    expect(runPatch(c2, { force: false })).toEqual({ kind: "held", upstream: "0.152.1", patched: "0.152.1" });
    const { state } = readState(paths.stateFile);
    expect(state.upstream_bin).toBe(real); // re-resolved, and persisted despite the held outcome
    expect(state.launcher_restore).toEqual({ kind: "symlink", target: real });
    expect(state.patched_from).toBe("0.152.1"); // unaffected: no rebuild happened
  });
  test("--force overrides the hold", () => {
    const { c, paths } = ctx();
    writeState(paths.stateFile, { ...DEFAULT_STATE, patched_from: "0.152.0" });
    expect(runPatch(c, { force: true }).kind).toBe("built");
  });
  test("refused: version outside every manifest range; last_attempt records why", () => {
    const { c, paths } = ctx({ upstreamVersion: "0.160.0" });
    const r = runPatch(c, { force: false });
    expect(r).toMatchObject({ kind: "refused", reason: expect.stringContaining("0.160.0") });
    expect(readState(paths.stateFile).state.last_attempt).toMatchObject({ ok: false, version: "0.160.0" });
  });
  test("refused: a malformed manifest is a refusal, not a crash", () => {
    const { c, paths } = ctx({ manifest: '{"version":1,"tag_prefix":"rust-v","patches":[{}]}' });
    const r = runPatch(c, { force: false });
    expect(r).toMatchObject({ kind: "refused", reason: expect.stringMatching(/manifest is malformed/) });
    expect(readState(paths.stateFile).state.last_attempt).toMatchObject({ ok: false });
  });
  test("refused: preflight failure never reaches git or cargo", () => {
    const { c, calls } = ctx({ which: (cmd) => (cmd === "rustup" ? null : "/x") });
    expect(runPatch(c, { force: false })).toMatchObject({ kind: "refused", reason: expect.stringMatching(/rustup/) });
    expect(calls.filter((k) => k.cmd === "git" || k.cmd === "cargo")).toEqual([]);
  });
  test("failed: cargo error leaves the stock launcher untouched and records the reason", () => {
    const { c, paths, real } = ctx({ cargoFails: true });
    const r = runPatch(c, { force: false });
    expect(r).toMatchObject({ kind: "failed", reason: expect.stringContaining("E0425") });
    expect(isOurWrapper(paths.wrapperPath)).toBe(false);
    expect(readlinkSync(paths.wrapperPath)).toBe(real); // still upstream's symlink
    expect(readFileSync(paths.wrapperPath, "utf8")).toBe("UPSTREAM-ELF"); // reads through the link
    expect(existsSync(paths.patchedBin)).toBe(false);
    expect(readState(paths.stateFile).state.last_attempt).toMatchObject({ ok: false });
  });
  test("locked: another live process holds the lock", () => {
    const { c, paths } = ctx();
    mkdirSync(paths.stateDir, { recursive: true });
    writeFileSync(paths.lockFile, `${process.pid}\n`);
    expect(runPatch(c, { force: false })).toEqual({ kind: "locked" });
  });
  test("corrupt state.json is reported and recovered from the backup", () => {
    const { c, paths, said, real } = ctx();
    writeState(paths.stateFile, { ...DEFAULT_STATE, patched_from: "0.152.0", upstream_bin: real });
    writeFileSync(paths.stateFile, "{{");
    expect(runPatch(c, { force: true }).kind).toBe("built");
    expect(said.some((l) => /state\.json was corrupt/i.test(l))).toBe(true);
  });
  test("refused: a foreign regular file at the launcher path is named as such", () => {
    const { c, paths } = ctx();
    // rmSync first: writeFileSync would follow the symlink and overwrite upstream's binary,
    // which is exactly the thing the production code must never do.
    rmSync(paths.wrapperPath);
    writeFileSync(paths.wrapperPath, "#!/bin/sh\nexec /opt/homebrew/bin/codex-real\n");
    const r = runPatch(c, { force: true });
    expect(r).toMatchObject({ kind: "refused", reason: expect.stringContaining("refusing to overwrite it") });
    expect(readFileSync(paths.wrapperPath, "utf8")).toContain("codex-real");
  });
});

describe("describeOutcome", () => {
  test("every variant has a distinct sentence", () => {
    const lines = [
      describeOutcome({ kind: "built", version: "0.152.1" }),
      describeOutcome({ kind: "held", upstream: "0.152.2", patched: "0.152.1" }),
      describeOutcome({ kind: "refused", reason: "nope" }),
      describeOutcome({ kind: "locked" }),
      describeOutcome({ kind: "failed", reason: "boom" }),
    ];
    expect(new Set(lines).size).toBe(5);
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

// --- added by Task 11 -------------------------------------------------------
describe("runInstall", () => {
  test("patches, then merges the SessionStart hook and prints the trust sentence", () => {
    const { c, paths, said } = ctx();
    expect(runInstall(c)).toBe(0);
    expect(readFileSync(paths.patchedBin, "utf8")).toBe("ELF");
    const hooks = JSON.parse(readFileSync(paths.hooksFile, "utf8")) as HooksFile;
    expect((hooks.hooks.SessionStart ?? []).some(isOurGroup)).toBe(true);
    expect(said.join("\n")).toContain("Start Codex once and accept the cxstatusline hook when prompted.");
  });
  test("a second install leaves the hook entry byte-stable and says unchanged", () => {
    const { c, paths, said } = ctx();
    runInstall(c);
    const first = readFileSync(paths.hooksFile, "utf8");
    said.length = 0;
    expect(runInstall(c)).toBe(0);
    expect(readFileSync(paths.hooksFile, "utf8")).toBe(first);
    expect(said.join("\n")).toContain("hook unchanged");
  });
  test("a refused patch does not write a hook", () => {
    const { c, paths } = ctx({ which: (cmd) => (cmd === "rustup" ? null : "/x") });
    expect(runInstall(c)).toBe(1);
    expect(existsSync(paths.hooksFile)).toBe(false);
  });
  test("a malformed hooks.json is reported without losing the installed binary", () => {
    const { c, paths, said } = ctx();
    mkdirSync(join(paths.hooksFile, ".."), { recursive: true });
    writeFileSync(paths.hooksFile, "{ nope");
    expect(runInstall(c)).toBe(1);
    expect(readFileSync(paths.patchedBin, "utf8")).toBe("ELF");
    expect(said.join("\n")).toMatch(/hook could not be written/);
    expect(readFileSync(paths.hooksFile, "utf8")).toBe("{ nope");
  });
});
