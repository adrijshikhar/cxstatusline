import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, readlinkSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { resolvePaths } from "../src/paths";
import { WRAPPER_MARKER, ensureWrapper, installPatchedBinary, installWrapper, isOurWrapper, wrapperScript } from "../src/patch/wrapper";
import { tmpEnv } from "./helpers";

/** Give `paths.patchedBin` a body so `ensureWrapper(..., true)` is honest. */
function makePatchedBin(patchedBin: string): void {
  mkdirSync(join(patchedBin, ".."), { recursive: true });
  writeFileSync(patchedBin, "ELF");
  chmodSync(patchedBin, 0o755);
}

describe("wrapper", () => {
  test("script exports CXSTATUSLINE_COMMAND, execs the patched binary, intercepts update", () => {
    const s = wrapperScript("/lib/codex", "/bin/cx statusline");
    expect(s.startsWith("#!/bin/sh\n")).toBe(true);
    expect(s).toContain(WRAPPER_MARKER);
    // sq(sq("/bin/cx statusline") + " render") - the inner quotes are what shlex::split sees.
    expect(s).toContain(`CXSTATUSLINE_COMMAND=''"'"'/bin/cx statusline'"'"' render'`);
    expect(s).toContain(`exec '/lib/codex' "$@"`);
    expect(s).toContain(`exec '/bin/cx statusline' update`);
  });
  test("the script actually runs: update is routed, everything else reaches the binary with the env var", () => {
    const { root } = tmpEnv();
    const fakeCodex = join(root, "codex");
    writeFileSync(fakeCodex, '#!/bin/sh\necho "codex:$*:$CXSTATUSLINE_COMMAND"\n');
    chmodSync(fakeCodex, 0o755);
    const fakeCx = join(root, "cx");
    writeFileSync(fakeCx, '#!/bin/sh\necho "cx:$*"\n');
    chmodSync(fakeCx, 0o755);
    const w = join(root, "wrapper");
    writeFileSync(w, wrapperScript(fakeCodex, fakeCx));
    chmodSync(w, 0o755);
    expect(spawnSync(w, ["--version"], { encoding: "utf8" }).stdout.trim()).toBe(`codex:--version:'${fakeCx}' render`);
    expect(spawnSync(w, ["update"], { encoding: "utf8" }).stdout.trim()).toBe("cx:update");
  });
  test("isOurWrapper recognises the marker and nothing else", () => {
    const { root } = tmpEnv();
    const ours = join(root, "ours");
    writeFileSync(ours, wrapperScript("/a", "/b"));
    const theirs = join(root, "theirs");
    writeFileSync(theirs, "#!/bin/sh\nexec /real/codex\n");
    expect(isOurWrapper(ours)).toBe(true);
    expect(isOurWrapper(theirs)).toBe(false);
    expect(isOurWrapper(join(root, "missing"))).toBe(false);
    writeFileSync(theirs, `${"x".repeat(1024)}\n# cxstatusline-wrapper v1\n`);
    expect(isOurWrapper(theirs)).toBe(false); // a marker in a binary body is not our header
  });
  test("installWrapper replaces upstream's symlink with mode 755 and leaves no temp file", () => {
    const { env, root } = tmpEnv();
    const p = resolvePaths(env);
    mkdirSync(p.binDir, { recursive: true });
    const real = join(root, "real");
    writeFileSync(real, "UPSTREAM-ELF");
    symlinkSync(real, p.wrapperPath);
    expect(installWrapper(p, "/cx")).toEqual({ kind: "replaced" });
    expect(isOurWrapper(p.wrapperPath)).toBe(true);
    expect(statSync(p.wrapperPath).mode & 0o777).toBe(0o755);
    expect(readdirSync(p.binDir)).toEqual(["codex"]);
    // The symlink target - upstream's own binary - is untouched.
    expect(readFileSync(real, "utf8")).toBe("UPSTREAM-ELF");
  });
  test("installWrapper REFUSES a foreign regular file and leaves its bytes alone", () => {
    const { env } = tmpEnv();
    const p = resolvePaths(env);
    mkdirSync(p.binDir, { recursive: true });
    writeFileSync(p.wrapperPath, "#!/bin/sh\nexec /opt/homebrew/bin/codex-real\n");
    chmodSync(p.wrapperPath, 0o755);
    const r = installWrapper(p, "/cx");
    expect(r).toMatchObject({ kind: "refused", reason: expect.stringContaining("refusing to replace it") });
    expect(readFileSync(p.wrapperPath, "utf8")).toContain("codex-real");
    expect(readdirSync(p.binDir)).toEqual(["codex"]);
  });
  test("ensureWrapper: present, then replaced after upstream re-creates its symlink", () => {
    const { env, root } = tmpEnv();
    const p = resolvePaths(env);
    makePatchedBin(p.patchedBin);
    installWrapper(p, "/cx");
    expect(ensureWrapper(p, "/cx", true)).toEqual({ kind: "present" });
    // How the Standalone updater actually clobbers us: `curl ... install.sh | sh` re-creates
    // ~/.local/bin/codex as a symlink into ~/.codex/packages/standalone/current/bin/codex.
    const upstream = join(root, ".codex/packages/standalone/current/bin/codex");
    mkdirSync(join(upstream, ".."), { recursive: true });
    writeFileSync(upstream, "UPSTREAM-ELF");
    rmSync(p.wrapperPath);
    symlinkSync(upstream, p.wrapperPath);
    expect(ensureWrapper(p, "/cx", true)).toEqual({ kind: "replaced" });
    expect(readFileSync(p.wrapperPath, "utf8")).toContain(WRAPPER_MARKER);
    expect(readFileSync(upstream, "utf8")).toBe("UPSTREAM-ELF");
  });

  test("ensureWrapper leaves a re-placed wrapper alone on the next call", () => {
    const { env } = tmpEnv();
    const p = resolvePaths(env);
    makePatchedBin(p.patchedBin);
    installWrapper(p, "/cx");
    expect(ensureWrapper(p, "/cx", true)).toEqual({ kind: "present" });
    expect(ensureWrapper(p, "/cx", true)).toEqual({ kind: "present" });
  });
  test("ensureWrapper writes NOTHING when the patched binary is absent", () => {
    const { env, root } = tmpEnv();
    const p = resolvePaths(env);
    const real = join(root, "real-codex");
    writeFileSync(real, "UPSTREAM-ELF");
    mkdirSync(p.binDir, { recursive: true });
    symlinkSync(real, p.wrapperPath); // a working upstream launcher
    const r = ensureWrapper(p, "/cx", false);
    expect(r).toMatchObject({ kind: "refused", reason: expect.stringContaining(p.patchedBin) });
    expect(readlinkSync(p.wrapperPath)).toBe(real); // still upstream's symlink, still working
    expect(isOurWrapper(p.wrapperPath)).toBe(false);
  });
  test("ensureWrapper refuses a foreign regular file rather than deleting it", () => {
    const { env } = tmpEnv();
    const p = resolvePaths(env);
    makePatchedBin(p.patchedBin);
    mkdirSync(p.binDir, { recursive: true });
    writeFileSync(p.wrapperPath, "#!/bin/sh\nexec /opt/homebrew/bin/codex-real\n");
    expect(ensureWrapper(p, "/cx", true)).toMatchObject({ kind: "refused" });
    expect(readFileSync(p.wrapperPath, "utf8")).toContain("codex-real");
  });
  test("installPatchedBinary copies then renames into libexec", () => {
    const { env, root } = tmpEnv();
    const p = resolvePaths(env);
    const built = join(root, "built-codex");
    const upstream = join(root, "upstream", "codex");
    writeFileSync(built, "ELF");
    mkdirSync(join(upstream, ".."), { recursive: true });
    writeFileSync(upstream, "UPSTREAM-ELF");
    writeFileSync(join(upstream, "..", "codex-code-mode-host"), "HOST");
    installPatchedBinary(built, upstream, p);
    expect(readFileSync(p.patchedBin, "utf8")).toBe("ELF");
    expect(readFileSync(p.patchedCodeModeHost, "utf8")).toBe("HOST");
    expect(statSync(p.patchedBin).mode & 0o777).toBe(0o755);
    expect(statSync(p.patchedCodeModeHost).mode & 0o777).toBe(0o755);
    expect(readdirSync(p.libexecDir).sort()).toEqual(["codex", "codex-code-mode-host"]);
    expect(existsSync(`${p.patchedBin}.tmp-${process.pid}`)).toBe(false);
  });

  test("installPatchedBinary leaves the existing pair untouched when upstream lacks the host", () => {
    const { env, root } = tmpEnv();
    const p = resolvePaths(env);
    const built = join(root, "built-codex");
    const upstream = join(root, "upstream", "codex");
    mkdirSync(p.libexecDir, { recursive: true });
    writeFileSync(p.patchedBin, "OLD-CODEX");
    writeFileSync(p.patchedCodeModeHost, "OLD-HOST");
    mkdirSync(join(upstream, ".."), { recursive: true });
    writeFileSync(built, "NEW-CODEX");
    writeFileSync(upstream, "UPSTREAM-CODEX");

    expect(() => installPatchedBinary(built, upstream, p)).toThrow(/codex-code-mode-host/);
    expect(readFileSync(p.patchedBin, "utf8")).toBe("OLD-CODEX");
    expect(readFileSync(p.patchedCodeModeHost, "utf8")).toBe("OLD-HOST");
  });

  test("installPatchedBinary restores the old pair when the second activation rename fails", () => {
    const { env, root } = tmpEnv();
    const p = resolvePaths(env);
    const built = join(root, "built-codex");
    const upstream = join(root, "upstream", "codex");
    mkdirSync(p.libexecDir, { recursive: true });
    writeFileSync(p.patchedBin, "OLD-CODEX");
    writeFileSync(p.patchedCodeModeHost, "OLD-HOST");
    writeFileSync(built, "NEW-CODEX");
    mkdirSync(join(upstream, ".."), { recursive: true });
    writeFileSync(upstream, "UPSTREAM-CODEX");
    writeFileSync(join(upstream, "..", "codex-code-mode-host"), "NEW-HOST");
    const stagedCodex = `${p.patchedBin}.tmp-${process.pid}`;

    expect(() => installPatchedBinary(built, upstream, p, {
      rename(from, target) {
        if (from === stagedCodex && target === p.patchedBin) throw new Error("second activation rename failed");
        renameSync(from, target);
      },
    })).toThrow("second activation rename failed");

    expect(readFileSync(p.patchedBin, "utf8")).toBe("OLD-CODEX");
    expect(readFileSync(p.patchedCodeModeHost, "utf8")).toBe("OLD-HOST");
    expect(readdirSync(p.libexecDir).sort()).toEqual(["codex", "codex-code-mode-host"]);
  });
});
