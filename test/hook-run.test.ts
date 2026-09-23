import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import type { Context } from "../src/context";
import { realHookDeps, runHook } from "../src/hook/run";
import { resolvePaths } from "../src/paths";
import { WRAPPER_MARKER_V2, installWrapper, isOurWrapper } from "../src/patch/wrapper";
import { createGeneration, swapPointer } from "../src/patch/generation";
import { DEFAULT_STATE, readState, writeState, RELEASE_UNAVAILABLE, type State } from "../src/state";
import { fakeExec, tmpEnv } from "./helpers";

function setup(state: Partial<State>, upstreamVersion = "0.152.1", now = "2026-09-02T12:00:00Z") {
  const { env, root } = tmpEnv("cxstatusline test ");
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
    now: () => new Date(now), log: () => {}, say: () => {},
  };
  const deps = { spawnDetached: (bin: string, args: string[]) => { spawned.push([bin, ...args]); } };
  return { ctx, deps, paths, spawned, upstream, root };
}

/** Put a complete generation in place, the way `activatePair` leaves the machine. */
function installGeneration(paths: ReturnType<typeof resolvePaths>): string {
  const pair = {
    codexVersion: "0.152.1",
    provenance: {
      source: "prebuilt" as const,
      cxVersion: "0.1.0",
      platform: "darwin-arm64",
      patchSha256: "a".repeat(64),
      upstreamCommit: "b".repeat(40),
      sourceCommit: null,
      sourceDirty: false,
      installedAt: "2026-09-02T12:00:00.000Z",
      executables: {
        codex: digest("GEN-CODEX"),
        "codex-code-mode-host": digest("GEN-HOST"),
      },
    },
  };
  const staging = mkdtempSync(join(paths.libexecDir, "staging "));
  writeFileSync(join(staging, "codex"), "GEN-CODEX");
  writeFileSync(join(staging, "codex-code-mode-host"), "GEN-HOST");
  for (const f of ["LICENSE", "NOTICE", "THIRD_PARTY_NOTICES.md"]) writeFileSync(join(staging, f), `${f} body`);
  try {
    const dir = createGeneration({ ...pair, directory: staging }, paths);
    swapPointer(paths, dir);
    return dir;
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

function digest(text: string): { sha256: string; size: number } {
  return { sha256: createHash("sha256").update(text).digest("hex"), size: Buffer.byteLength(text) };
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
    expect(spawned).toEqual([["/cx", "hook", "acquire"]]);
    expect(readlinkSync(paths.wrapperPath)).toBe(newer);
    expect(existsSync(upstream)).toBe(true);
    expect(readState(paths.stateFile).state).toMatchObject({ upstream_bin: newer, launcher_restore: { kind: "symlink", target: newer } });
  });
  test("an active install takes precedence over an old failed attempt", () => {
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
      expect(spawned).toEqual([["/cx", "hook", "acquire"]]);
    }
  });
  test("drift under stable-minors: spawns patch detached and says so", () => {
    const { ctx, deps, spawned, paths } = setup({}, "0.153.0");
    const r = runHook(ctx, startup, deps);
    expect(spawned).toEqual([["/cx", "hook", "acquire"]]);
    expect(msg(r.stdout)).toMatch(/0\.153\.0.*0\.152\.1.*background.*reopen/i);
    expect(readState(paths.stateFile).state.patched_from).toBe("0.152.1"); // the child writes it, not us
  });
  test("on drift the wrapper is NOT re-placed, so the stale binary cannot take over", () => {
    const { ctx, deps, paths, upstream } = setup({}, "0.153.0");
    rmSync(paths.wrapperPath);
    symlinkSync(upstream, paths.wrapperPath); // upstream's installer took the path back
    const r = runHook(ctx, startup, deps);
    expect(readlinkSync(paths.wrapperPath)).toBe(upstream); // left alone during the install window
    expect(msg(r.stdout)).not.toMatch(/restored the cxstatusline wrapper/);
  });
  test("patch release within the minor: acquires under default policy 'every'", () => {
    const { ctx, deps, spawned } = setup({}, "0.152.2");
    const r = runHook(ctx, startup, deps);
    expect(msg(r.stdout)).toMatch(/0\.152\.2.*0\.152\.1.*background.*reopen/i);
    expect(spawned).toEqual([["/cx", "hook", "acquire"]]);
  });
  test("patch release within the minor: silent hold under stable-minors", () => {
    const { ctx, deps, spawned } = setup({ policy: "stable-minors" }, "0.152.2");
    expect(runHook(ctx, startup, deps).stdout).toBe("");
    expect(spawned).toEqual([]);
  });
  test("lock held by a live process: says the install is in progress, no spawn", () => {
    const { ctx, deps, spawned, paths } = setup({}, "0.153.0");
    mkdirSync(paths.stateDir, { recursive: true });
    writeFileSync(paths.lockFile, `${process.pid}\n`);
    expect(msg(runHook(ctx, startup, deps).stdout)).toMatch(/install for Codex 0\.153\.0 is already in progress/i);
    expect(spawned).toEqual([]);
  });
  test("previous attempt failed for this version: reports once, does not respawn", () => {
    const { ctx, deps, spawned } = setup({ last_attempt: { at: "t", ok: false, version: "0.153.0", reason: "cargo build: E0425" } }, "0.153.0");
    const r = runHook(ctx, startup, deps);
    expect(msg(r.stdout)).toMatch(/last install attempt for 0\.153\.0 failed: cargo build: E0425/);
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
  test("state.patched_from null but generation active on disk: detects drift and acquires", () => {
    const { ctx, deps, paths, spawned } = setup({ patched_from: null }, "0.153.0");
    rmSync(paths.patchedBin);
    rmSync(paths.patchedCodeModeHost);
    installGeneration(paths); // active generation is 0.152.1
    const r = runHook(ctx, startup, deps);
    expect(msg(r.stdout)).toMatch(/Codex updated to 0\.153\.0 \(installed pair is from 0\.152\.1\)/);
    expect(spawned).toEqual([["/cx", "hook", "acquire"]]);
  });
  test("generation active on disk takes precedence over state.patched_from for drift detection", () => {
    const { ctx, deps, paths, spawned } = setup({ patched_from: "0.153.0" }, "0.153.0");
    rmSync(paths.patchedBin);
    rmSync(paths.patchedCodeModeHost);
    installGeneration(paths); // active generation is 0.152.1, but state claimed 0.153.0
    const r = runHook(ctx, startup, deps);
    // Active generation is 0.152.1, upstream is 0.153.0 -> drift detected!
    expect(msg(r.stdout)).toMatch(/Codex updated to 0\.153\.0 \(installed pair is from 0\.152\.1\)/);
    expect(spawned).toEqual([["/cx", "hook", "acquire"]]);
  });
  test("garbage stdin is treated as startup", () => {
    const { ctx, deps, spawned } = setup({}, "0.153.0");
    runHook(ctx, "not json", deps);
    expect(spawned).toHaveLength(1);
  });
  test("a healthy generation install keeps the wrapper without any flat-layout binary", () => {
    const { ctx, deps, paths } = setup({});
    // The generation layout never writes paths.patchedBin, so its absence must not be reported as
    // a broken install once installation.json says a complete pair is active.
    rmSync(paths.patchedBin);
    rmSync(paths.patchedCodeModeHost);
    installGeneration(paths);
    // The first pass upgrades the v1 wrapper an older install left behind...
    expect(msg(runHook(ctx, startup, deps).stdout)).toMatch(/restored the cxstatusline wrapper/);
    expect(readFileSync(paths.wrapperPath, "utf8")).toContain(WRAPPER_MARKER_V2);
    // ...and from then on a healthy generation install is silent.
    expect(msg(runHook(ctx, startup, deps).stdout)).toBe("");
    expect(isOurWrapper(paths.wrapperPath)).toBe(true);
  });
  test("an unavailable prebuilt release is retried at most once a day", () => {
    const attempt = { at: "2026-09-02T12:00:00Z", ok: false, version: "0.153.0", reason: RELEASE_UNAVAILABLE };
    const soon = setup({ last_attempt: attempt }, "0.153.0", "2026-09-03T11:00:00Z");
    expect(msg(runHook(soon.ctx, startup, soon.deps).stdout)).toMatch(/no prebuilt Codex 0\.153\.0.*retry/i);
    expect(soon.spawned).toEqual([]);

    const later = setup({ last_attempt: attempt }, "0.153.0", "2026-09-03T13:00:00Z");
    runHook(later.ctx, startup, later.deps);
    expect(later.spawned).toEqual([["/cx", "hook", "acquire"]]); // a newly published release is not suppressed forever
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
