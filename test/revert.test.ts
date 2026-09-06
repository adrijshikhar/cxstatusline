import { describe, expect, test } from "bun:test";
import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Context } from "../src/context";
import { revert } from "../src/commands/revert";
import { installHook, isOurGroup, type HooksFile } from "../src/hook/install";
import { resolvePaths } from "../src/paths";
import { generationWrapperScript, installWrapper, isOurWrapper } from "../src/patch/wrapper";
import { DEFAULT_STATE, readState, writeState } from "../src/state";
import { fakeExec, tmpEnv } from "./helpers";

function context(env: ReturnType<typeof tmpEnv>["env"]): Context {
  const paths = resolvePaths(env);
  return { env, paths, run: fakeExec(() => ({})).run, which: () => "/x", freeBytes: () => 1e12, cxBin: "/cx", patchesDir: "/p", now: () => new Date(), log: () => {}, say: () => {} };
}

describe("revert", () => {
  test("restores upstream's symlink, removes hook and patched binary, keeps settings and source", () => {
    const { env, root } = tmpEnv();
    const paths = resolvePaths(env);
    const real = join(root, "real-codex");
    writeFileSync(real, "");
    writeState(paths.stateFile, { ...DEFAULT_STATE, patched_from: "0.152.1", upstream_bin: real, launcher_restore: { kind: "symlink", target: real }, last_attempt: { at: "t", ok: true, version: "0.152.1" } });
    installWrapper(paths, "/cx");
    mkdirSync(paths.libexecDir, { recursive: true });
    writeFileSync(paths.patchedBin, "ELF");
    writeFileSync(paths.patchedCodeModeHost, "HOST");
    installHook(paths.hooksFile, "/cx");
    mkdirSync(paths.configDir, { recursive: true });
    writeFileSync(paths.settingsFile, "{}");
    mkdirSync(paths.sourceDir, { recursive: true });

    const actions = revert(context(env));

    expect(lstatSync(paths.wrapperPath).isSymbolicLink()).toBe(true);
    expect(readlinkSync(paths.wrapperPath)).toBe(real);
    expect(existsSync(paths.patchedBin)).toBe(false);
    expect(existsSync(paths.patchedCodeModeHost)).toBe(false);
    const hooks = JSON.parse(readFileSync(paths.hooksFile, "utf8")) as HooksFile;
    expect((hooks.hooks.SessionStart ?? []).some(isOurGroup)).toBe(false);
    expect(existsSync(paths.settingsFile)).toBe(true);
    expect(existsSync(paths.sourceDir)).toBe(true);
    const { state } = readState(paths.stateFile);
    expect(state.patched_from).toBeNull();
    expect(state.last_attempt).toBeNull();
    expect(state.upstream_bin).toBe(real);
    expect(actions.actions.join("\n")).toMatch(/restored.*symlink/);
    expect(actions.code).toBe(0);
  });
  test("with no recorded symlink the wrapper is simply removed", () => {
    const { env } = tmpEnv();
    const paths = resolvePaths(env);
    writeState(paths.stateFile, { ...DEFAULT_STATE, patched_from: "0.152.1", launcher_restore: { kind: "none" } });
    installWrapper(paths, "/cx");
    revert(context(env));
    expect(existsSync(paths.wrapperPath)).toBe(false);
  });
  test("never removes a wrapper path that is not ours", () => {
    const { env } = tmpEnv();
    const paths = resolvePaths(env);
    mkdirSync(paths.binDir, { recursive: true });
    writeFileSync(paths.wrapperPath, "#!/bin/sh\nexec /theirs\n");
    const actions = revert(context(env));
    expect(existsSync(paths.wrapperPath)).toBe(true);
    expect(actions.actions.join("\n")).toMatch(/not ours.*left in place/);
  });
  test("a malformed hooks.json is reported but revert still finishes and resets state", () => {
    const { env, root } = tmpEnv();
    const paths = resolvePaths(env);
    const real = join(root, "real-codex");
    writeFileSync(real, "");
    writeState(paths.stateFile, { ...DEFAULT_STATE, patched_from: "0.152.1", upstream_bin: real, launcher_restore: { kind: "symlink", target: real } });
    installWrapper(paths, "/cx");
    mkdirSync(paths.libexecDir, { recursive: true });
    writeFileSync(paths.patchedBin, "ELF");
    mkdirSync(join(paths.hooksFile, ".."), { recursive: true });
    writeFileSync(paths.hooksFile, "{ nope");

    const actions = revert(context(env));

    expect(actions.actions.join("\n")).toMatch(/could not update .*hooks\.json/);
    expect(actions.actions.join("\n")).toMatch(/by hand/);
    expect(actions.code).toBe(1);
    expect(existsSync(paths.patchedBin)).toBe(false);
    expect(readlinkSync(paths.wrapperPath)).toBe(real);
    // The critical part: state is no longer lying about a binary that is gone.
    expect(readState(paths.stateFile).state.patched_from).toBeNull();
  });
  test("removes the generation tree and the current pointer, keeps settings and source", () => {
    const { env, root } = tmpEnv("cxstatusline test ");
    const paths = resolvePaths(env);
    const real = join(root, "real-codex");
    writeFileSync(real, "");
    writeState(paths.stateFile, { ...DEFAULT_STATE, patched_from: "0.152.1", upstream_bin: real, launcher_restore: { kind: "symlink", target: real } });
    const older = join(paths.generationsDir, "0.152.0-20260901T000000-aaaaaa");
    const newer = join(paths.generationsDir, "0.152.1-20260907T121314-bbbbbb");
    for (const gen of [older, newer]) {
      mkdirSync(gen, { recursive: true });
      writeFileSync(join(gen, "codex"), "ELF");
      writeFileSync(join(gen, "codex-code-mode-host"), "HOST");
      writeFileSync(join(gen, "installation.json"), "{}");
    }
    symlinkSync(newer, paths.currentGeneration);
    mkdirSync(paths.binDir, { recursive: true });
    writeFileSync(paths.wrapperPath, generationWrapperScript(paths.currentGeneration, "/cx"));
    mkdirSync(paths.configDir, { recursive: true });
    writeFileSync(paths.settingsFile, "{}");
    mkdirSync(paths.sourceDir, { recursive: true });

    const actions = revert(context(env));

    expect(actions.code).toBe(0);
    expect(readlinkSync(paths.wrapperPath)).toBe(real);
    expect(existsSync(paths.currentGeneration)).toBe(false);
    expect(existsSync(older)).toBe(false);
    expect(existsSync(newer)).toBe(false);
    expect(existsSync(paths.generationsDir)).toBe(false);
    expect(existsSync(paths.settingsFile)).toBe(true);
    expect(existsSync(paths.sourceDir)).toBe(true);
    expect(actions.actions.join("\n")).toMatch(/removed 2 cxstatusline generations/);
  });

  test("removes the owner's old flat layout as well as generations", () => {
    const { env, root } = tmpEnv("cxstatusline test ");
    const paths = resolvePaths(env);
    const real = join(root, "real-codex");
    writeFileSync(real, "");
    writeState(paths.stateFile, { ...DEFAULT_STATE, patched_from: "0.152.1", upstream_bin: real, launcher_restore: { kind: "symlink", target: real } });
    mkdirSync(paths.libexecDir, { recursive: true });
    writeFileSync(paths.patchedBin, "ELF");
    writeFileSync(paths.patchedCodeModeHost, "HOST");
    installWrapper(paths, "/cx"); // the v1 wrapper an owner already has

    const actions = revert(context(env));

    expect(existsSync(paths.patchedBin)).toBe(false);
    expect(existsSync(paths.patchedCodeModeHost)).toBe(false);
    expect(readlinkSync(paths.wrapperPath)).toBe(real);
    expect(actions.code).toBe(0);
  });

  test("leaves a foreign directory under libexec alone", () => {
    const { env, root } = tmpEnv("cxstatusline test ");
    const paths = resolvePaths(env);
    writeState(paths.stateFile, { ...DEFAULT_STATE, patched_from: "0.152.1" });
    const foreign = join(paths.generationsDir, "not-ours");
    mkdirSync(foreign, { recursive: true });
    writeFileSync(join(foreign, "README"), "someone else lives here");
    expect(root).toContain(" ");

    const actions = revert(context(env));

    expect(existsSync(join(foreign, "README"))).toBe(true);
    expect(actions.actions.join("\n")).toMatch(/not a cxstatusline generation/);
  });

  test("locked: another live process holds the lock, refuses and touches nothing", () => {
    const { env, root } = tmpEnv();
    const paths = resolvePaths(env);
    const real = join(root, "real-codex");
    writeFileSync(real, "");
    writeState(paths.stateFile, { ...DEFAULT_STATE, patched_from: "0.152.1", upstream_bin: real, launcher_restore: { kind: "symlink", target: real } });
    installWrapper(paths, "/cx");
    mkdirSync(paths.libexecDir, { recursive: true });
    writeFileSync(paths.patchedBin, "ELF");
    mkdirSync(paths.stateDir, { recursive: true });
    writeFileSync(paths.lockFile, `${process.pid}\n`);
    writeFileSync(paths.patchedCodeModeHost, "HOST");
    mkdirSync(paths.generationsDir, { recursive: true });
    const gen = join(paths.generationsDir, "0.152.1-20260907T121314-cccccc");
    mkdirSync(gen, { recursive: true });
    writeFileSync(join(gen, "codex"), "ELF");
    writeFileSync(join(gen, "installation.json"), "{}");
    symlinkSync(gen, paths.currentGeneration);
    installHook(paths.hooksFile, "/cx");
    const files = [paths.wrapperPath, paths.patchedBin, paths.patchedCodeModeHost, paths.hooksFile, paths.stateFile];
    const before = files.map(file => readFileSync(file, "utf8"));

    const actions = revert(context(env));

    expect(actions).toEqual({ code: 1, actions: [expect.stringContaining("another cxstatusline patch is running")] });
    expect(actions.actions.join("\n")).toContain(`pid ${process.pid}`);
    expect(files.map(file => readFileSync(file, "utf8"))).toEqual(before);
    expect(isOurWrapper(paths.wrapperPath)).toBe(true); // untouched
    expect(existsSync(paths.patchedBin)).toBe(true); // untouched
    expect(existsSync(gen)).toBe(true); // untouched
    expect(readlinkSync(paths.currentGeneration)).toBe(gen); // untouched
    expect(readState(paths.stateFile).state.patched_from).toBe("0.152.1"); // untouched
  });
  test("after a corrupt state.json, launcher_restore still comes back from the backup", () => {
    const { env, root } = tmpEnv();
    const paths = resolvePaths(env);
    const real = join(root, "real-codex");
    writeFileSync(real, "");
    writeState(paths.stateFile, { ...DEFAULT_STATE, patched_from: "0.152.1", upstream_bin: real, launcher_restore: { kind: "symlink", target: real } });
    installWrapper(paths, "/cx");
    writeFileSync(paths.stateFile, "{{"); // corrupt the primary only

    const actions = revert(context(env));

    expect(actions.actions.join("\n")).toMatch(/state\.json was corrupt/);
    expect(readlinkSync(paths.wrapperPath)).toBe(real); // acceptance 5 still reachable
  });
});
