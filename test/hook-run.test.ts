import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Context } from "../src/context";
import { realHookDeps, runHook } from "../src/hook/run";
import { resolvePaths } from "../src/paths";
import { installWrapper, isOurWrapper } from "../src/patch/wrapper";
import { DEFAULT_STATE, readState, writeState, type State } from "../src/state";
import { fakeExec, tmpEnv } from "./helpers";

function setup(state: Partial<State>, upstreamVersion = "0.152.1") {
  const { env, root } = tmpEnv();
  const paths = resolvePaths(env);
  const upstream = join(root, ".codex/packages/standalone/current/bin/codex");
  mkdirSync(join(upstream, ".."), { recursive: true });
  writeFileSync(upstream, "UPSTREAM-ELF");
  chmodSync(upstream, 0o755);
  writeState(paths.stateFile, { ...DEFAULT_STATE, patched_from: "0.152.1", upstream_bin: upstream, ...state });
  // A healthy installation: the patched binary exists and our wrapper is in place.
  mkdirSync(paths.libexecDir, { recursive: true });
  writeFileSync(paths.patchedBin, "ELF");
  writeFileSync(paths.patchedCodeModeHost, "HOST");
  installWrapper(paths, "/cx");
  const { run } = fakeExec((_cmd, args) => (args[0] === "--version" ? { stdout: `codex-cli ${upstreamVersion}\n` } : {}));
  const spawned: string[][] = [];
  const ctx: Context = {
    env, paths, run, which: () => "/x", freeBytes: () => 1e12, cxBin: "/cx", patchesDir: "/p",
    now: () => new Date("2026-09-02T12:00:00Z"), log: () => {}, say: () => {},
  };
  const deps = { spawnDetached: (bin: string, args: string[]) => { spawned.push([bin, ...args]); } };
  return { ctx, deps, paths, spawned, upstream, root };
}

const startup = JSON.stringify({ session_id: "s", cwd: "/", hook_event_name: "SessionStart", source: "startup" });
const msg = (stdout: string): string => (stdout ? (JSON.parse(stdout) as { systemMessage: string }).systemMessage : "");

describe("runHook", () => {
  test("a newer launcher wins while the saved old release still exists", () => {
    const { ctx, deps, paths, spawned, root, upstream } = setup({});
    const newer = join(root, "new-codex");
    writeFileSync(newer, "NEW");
    chmodSync(newer, 0o755);
    rmSync(paths.wrapperPath);
    symlinkSync(newer, paths.wrapperPath);
    const run = fakeExec((cmd) => ({ stdout: `codex-cli ${cmd === newer ? "0.153.0" : "0.152.1"}\n` })).run;
    expect(msg(runHook({ ...ctx, run }, startup, deps).stdout)).toMatch(/0\.153\.0.*background/);
    expect(spawned).toEqual([["/cx", "patch"]]);
    expect(readlinkSync(paths.wrapperPath)).toBe(newer);
    expect(existsSync(upstream)).toBe(true);
    expect(readState(paths.stateFile).state).toMatchObject({ upstream_bin: newer, launcher_restore: { kind: "symlink", target: newer } });
  });
  test("active rebuild takes precedence over an old failed attempt", () => {
    const { ctx, deps, paths, spawned } = setup({ last_attempt: { at: "t", ok: false, version: "0.153.0", reason: "old failure" } }, "0.153.0");
    writeFileSync(paths.lockFile, `${process.pid}\n`);
    expect(msg(runHook(ctx, startup, deps).stdout)).toMatch(/already in progress/);
    expect(spawned).toEqual([]);
  });
  test("upstream discovery preserves a build result written after the initial read", () => {
    const { ctx, deps, paths, spawned, upstream } = setup({ upstream_bin: "/gone" });
    rmSync(paths.wrapperPath);
    symlinkSync(upstream, paths.wrapperPath);
    const run = fakeExec(() => {
      writeState(paths.stateFile, { ...readState(paths.stateFile).state, patched_from: "0.153.0", last_attempt: { at: "new", ok: true, version: "0.153.0" } });
      return { stdout: "codex-cli 0.153.0" };
    }).run;
    runHook({ ...ctx, run }, startup, deps);
    expect(readState(paths.stateFile).state).toMatchObject({ upstream_bin: upstream, patched_from: "0.153.0", last_attempt: { at: "new", ok: true } });
    expect(spawned).toEqual([]);
  });
  test("a broken current launcher is reported without falling back to the old release", () => {
    const { ctx, deps, paths, spawned } = setup({});
    rmSync(paths.wrapperPath);
    symlinkSync("/missing/new-codex", paths.wrapperPath);
    const run = fakeExec(cmd => cmd === "/missing/new-codex" ? { status: 127 } : { stdout: "codex-cli 0.152.1" }).run;
    expect(msg(runHook({ ...ctx, run }, startup, deps).stdout)).toContain("did not report a version");
    expect(readlinkSync(paths.wrapperPath)).toBe("/missing/new-codex");
    expect(spawned).toEqual([]);
  });
  test("healthy start: no output, nothing spawned", () => {
    const { ctx, deps, spawned } = setup({});
    expect(runHook(ctx, startup, deps).stdout).toBe("");
    expect(spawned).toEqual([]);
  });
  test("compact source: always silent, even with drift", () => {
    const { ctx, deps, spawned } = setup({}, "0.153.0");
    expect(runHook(ctx, JSON.stringify({ source: "compact" }), deps).stdout).toBe("");
    expect(spawned).toEqual([]);
  });
  test("an unknown future source is silent too (whitelist, not blacklist)", () => {
    const { ctx, deps, spawned } = setup({}, "0.153.0");
    expect(runHook(ctx, JSON.stringify({ source: "some-future-source" }), deps).stdout).toBe("");
    expect(spawned).toEqual([]);
  });
  test("resume and clear are acted on", () => {
    for (const source of ["resume", "clear"]) {
      const { ctx, deps, spawned } = setup({}, "0.153.0");
      runHook(ctx, JSON.stringify({ source }), deps);
      expect(spawned).toEqual([["/cx", "patch"]]);
    }
  });
  test("drift under stable-minors: spawns patch detached and says so", () => {
    const { ctx, deps, spawned, paths } = setup({}, "0.153.0");
    const r = runHook(ctx, startup, deps);
    expect(spawned).toEqual([["/cx", "patch"]]);
    expect(msg(r.stdout)).toMatch(/0\.153\.0.*0\.152\.1.*background.*reopen/i);
    expect(readState(paths.stateFile).state.patched_from).toBe("0.152.1"); // the child writes it, not us
  });
  test("on drift the wrapper is NOT re-placed, so the stale binary cannot take over", () => {
    const { ctx, deps, paths, upstream } = setup({}, "0.153.0");
    rmSync(paths.wrapperPath);
    symlinkSync(upstream, paths.wrapperPath); // upstream's installer took the path back
    const r = runHook(ctx, startup, deps);
    expect(readlinkSync(paths.wrapperPath)).toBe(upstream); // left alone during the rebuild window
    expect(msg(r.stdout)).not.toMatch(/restored the cxstatusline wrapper/);
  });
  test("patch release within the minor: silent hold", () => {
    const { ctx, deps, spawned } = setup({}, "0.152.2");
    expect(runHook(ctx, startup, deps).stdout).toBe("");
    expect(spawned).toEqual([]);
  });
  test("lock held by a live process: says rebuild is in progress, no spawn", () => {
    const { ctx, deps, spawned, paths } = setup({}, "0.153.0");
    mkdirSync(paths.stateDir, { recursive: true });
    writeFileSync(paths.lockFile, `${process.pid}\n`);
    expect(msg(runHook(ctx, startup, deps).stdout)).toMatch(/rebuild.*0\.153\.0.*already in progress/i);
    expect(spawned).toEqual([]);
  });
  test("previous attempt failed for this version: reports once, does not respawn", () => {
    const { ctx, deps, spawned } = setup({ last_attempt: { at: "t", ok: false, version: "0.153.0", reason: "cargo build: E0425" } }, "0.153.0");
    const r = runHook(ctx, startup, deps);
    expect(msg(r.stdout)).toMatch(/last repatch for 0\.153\.0 failed: cargo build: E0425/);
    expect(spawned).toEqual([]);
  });
  test("wrapper clobbered by upstream's installer, no drift: re-placed and reported", () => {
    const { ctx, deps, paths, upstream } = setup({});
    rmSync(paths.wrapperPath);
    symlinkSync(upstream, paths.wrapperPath);
    const r = runHook(ctx, startup, deps);
    expect(msg(r.stdout)).toMatch(/restored the cxstatusline wrapper/);
    expect(isOurWrapper(paths.wrapperPath)).toBe(true);
  });
  test("patched binary missing: says so and writes NO wrapper", () => {
    const { ctx, deps, paths, upstream } = setup({});
    rmSync(paths.patchedBin);
    rmSync(paths.wrapperPath);
    symlinkSync(upstream, paths.wrapperPath);
    const r = runHook(ctx, startup, deps);
    expect(msg(r.stdout)).toMatch(/patched binary .* is missing/);
    expect(readlinkSync(paths.wrapperPath)).toBe(upstream);
  });
  test("Code Mode host missing: says so and leaves the wrapper alone", () => {
    const { ctx, deps, paths } = setup({});
    rmSync(paths.patchedCodeModeHost);
    const r = runHook(ctx, startup, deps);
    expect(msg(r.stdout)).toMatch(/Code Mode host .* is missing/);
    expect(isOurWrapper(paths.wrapperPath)).toBe(true);
  });
  test("a foreign file at the launcher path is reported, never overwritten", () => {
    const { ctx, deps, paths } = setup({});
    rmSync(paths.wrapperPath);
    writeFileSync(paths.wrapperPath, "#!/bin/sh\nexec /opt/homebrew/bin/codex-real\n");
    const r = runHook(ctx, startup, deps);
    expect(msg(r.stdout)).toMatch(/refusing to overwrite it/);
  });
  test("corrupt state.json: reported, session continues", () => {
    const { ctx, deps, paths, spawned } = setup({});
    writeFileSync(paths.stateFile, "{{");
    const r = runHook(ctx, startup, deps);
    expect(msg(r.stdout)).toMatch(/state\.json was corrupt/);
    expect(spawned).toEqual([]);
  });
  test("upstream binary vanished and cannot be re-resolved: reported, no spawn", () => {
    const { ctx, deps, spawned } = setup({ upstream_bin: "/gone/codex" });
    const { run } = fakeExec((cmd) => (cmd === "/gone/codex" ? { status: 127 } : { stdout: "codex-cli 0.152.1\n" }));
    // ~/.local/bin/codex is our wrapper here and PATH is empty -> re-resolve fails
    const r = runHook({ ...ctx, run, env: { ...ctx.env, PATH: "" } }, startup, deps);
    expect(msg(r.stdout)).toMatch(/no upstream Codex found/);
    expect(spawned).toEqual([]);
  });
  test("locateUpstream's write is skipped when the lock is held; the resolved value is still used in-memory", () => {
    const { ctx, deps, paths, root } = setup({ upstream_bin: "/gone/codex" }, "0.152.1");
    // A second, PATH-discoverable upstream binary so the re-resolve branch actually succeeds
    // (tmpEnv's PATH already points at root/usr-bin).
    const altDir = join(root, "usr-bin");
    mkdirSync(altDir, { recursive: true });
    const altCodex = join(altDir, "codex");
    writeFileSync(altCodex, "ALT-ELF");
    chmodSync(altCodex, 0o755);
    const baseRun = ctx.run;
    const run: typeof ctx.run = (cmd, args, opts) =>
      cmd === "/gone/codex" ? { status: 127, stdout: "", stderr: "" } : baseRun(cmd, args, opts);

    mkdirSync(paths.stateDir, { recursive: true });
    writeFileSync(paths.lockFile, `${process.pid}\n`); // another process holds the lock

    const r = runHook({ ...ctx, run }, startup, deps);

    expect(r.stdout).toBe(""); // resolved fine in-memory: no error, no drift, no message
    expect(readState(paths.stateFile).state.upstream_bin).toBe("/gone/codex"); // NOT persisted
  });
  test("never installed (patched_from null): silent", () => {
    const { ctx, deps } = setup({ patched_from: null });
    expect(runHook(ctx, startup, deps).stdout).toBe("");
  });
  test("garbage stdin is treated as startup", () => {
    const { ctx, deps, spawned } = setup({}, "0.153.0");
    runHook(ctx, "not json", deps);
    expect(spawned).toHaveLength(1);
  });
  test("stdout is either empty or exactly one JSON object with only systemMessage", () => {
    const { ctx, deps } = setup({}, "0.153.0");
    const out = runHook(ctx, startup, deps).stdout;
    expect(out.includes("\n")).toBe(false);
    expect(Object.keys(JSON.parse(out) as object)).toEqual(["systemMessage"]);
  });
});

describe("realHookDeps().spawnDetached", () => {
  test("a missing cxBin does not throw, does not crash the process, and closes the log fd", async () => {
    const { root } = tmpEnv();
    const log = join(root, "state", "patch.log");
    expect(() => realHookDeps().spawnDetached(join(root, "does-not-exist"), ["patch"], log)).not.toThrow();
    // The ENOENT arrives asynchronously on the child's 'error' event; without a listener Node
    // would take this process down here. Still running after a tick == the listener is attached.
    await new Promise((r) => setTimeout(r, 150));
    expect(existsSync(log)).toBe(true);
    // The 'error' handler now writes a diagnostic line, so a dangling cxBin no longer leaves the
    // log empty forever with zero indication anywhere of what went wrong.
    expect(readFileSync(log, "utf8")).toMatch(/spawn failed/);
  });
});
