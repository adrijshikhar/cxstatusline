import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolvePaths } from "../src/paths";
import { describeLookup, readUpstreamVersion, resolveUpstream } from "../src/codex/upstream";
import { fakeExec, tmpEnv } from "./helpers";
import { installWrapper, isOurWrapper } from "../src/patch/wrapper";

function exe(path: string): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, "#!/bin/sh\necho codex-cli 0.152.1\n");
  chmodSync(path, 0o755);
}

describe("resolveUpstream", () => {
  test("current PATH target wins over saved release; saved release is last resort", () => {
    const { env, root } = tmpEnv();
    const p = resolvePaths(env);
    const saved = join(root, "old", "codex");
    exe(saved);
    installWrapper(p, "/cx");
    expect(resolveUpstream(p, env, isOurWrapper, saved)).toMatchObject({ kind: "found", bin: saved });
    const current = join(root, "usr-bin", "codex");
    exe(current);
    expect(resolveUpstream(p, env, isOurWrapper, saved)).toMatchObject({ kind: "found", bin: current });
  });
  test("PATH aliases to our binaries are never upstream", () => {
    const { env, root } = tmpEnv();
    const p = resolvePaths(env);
    installWrapper(p, "/cx");
    exe(p.patchedBin);
    const alias = join(root, "alias");
    mkdirSync(alias);
    symlinkSync(p.wrapperPath, join(alias, "codex"));
    expect(resolveUpstream(p, { ...env, PATH: alias }, isOurWrapper)).toEqual({ kind: "not-found" });
    expect(resolveUpstream(p, { ...env, PATH: p.libexecDir }, isOurWrapper)).toEqual({ kind: "not-found" });
    expect(resolveUpstream(p, { ...env, PATH: "" }, isOurWrapper, p.patchedBin)).toEqual({ kind: "not-found" });
  });
  test("Standalone: ~/.local/bin/codex is upstream's symlink -> record its target and how to restore it", () => {
    const { env, root } = tmpEnv();
    const p = resolvePaths(env);
    const real = join(root, ".codex/packages/standalone/current/bin/codex");
    exe(real);
    mkdirSync(p.binDir, { recursive: true });
    symlinkSync(real, p.wrapperPath);
    expect(resolveUpstream(p, env, () => false)).toEqual({
      kind: "found",
      bin: real,
      launcher_restore: { kind: "symlink", target: real },
    });
  });
  test("our own wrapper at ~/.local/bin/codex is skipped; PATH walk finds upstream", () => {
    const { env, root } = tmpEnv();
    const p = resolvePaths(env);
    mkdirSync(p.binDir, { recursive: true });
    writeFileSync(p.wrapperPath, "#!/bin/sh\n# cxstatusline-wrapper v1\n");
    const brew = join(root, "usr-bin", "codex");
    exe(brew);
    expect(resolveUpstream(p, env, (f) => f === p.wrapperPath)).toEqual({
      kind: "found",
      bin: brew,
      launcher_restore: { kind: "none" },
    });
  });
  test("a foreign regular file at the launcher path is refused, distinctly from not-found", () => {
    const { env } = tmpEnv();
    const p = resolvePaths(env);
    exe(p.wrapperPath); // a regular file we did not write
    const r = resolveUpstream(p, { ...env, PATH: p.binDir }, () => false);
    expect(r).toEqual({ kind: "foreign", path: p.wrapperPath });
    expect(describeLookup(r)).toMatch(/refusing to overwrite/);
  });
  test("the PATH walk never returns anything inside our own bin dir", () => {
    const { env, root } = tmpEnv();
    const p = resolvePaths(env);
    // Our wrapper occupies ~/.local/bin/codex, and ~/.local/bin is first on PATH.
    mkdirSync(p.binDir, { recursive: true });
    writeFileSync(p.wrapperPath, "#!/bin/sh\n# cxstatusline-wrapper v1\n");
    chmodSync(p.wrapperPath, 0o755);
    const elsewhere = join(root, "usr-bin", "codex");
    exe(elsewhere);
    const r = resolveUpstream(p, { ...env, PATH: `${p.binDir}:${join(root, "usr-bin")}` }, (f) => f === p.wrapperPath);
    expect(r).toEqual({ kind: "found", bin: elsewhere, launcher_restore: { kind: "none" } });
  });
  test("nothing anywhere -> not-found", () => {
    const { env } = tmpEnv();
    const r = resolveUpstream(resolvePaths(env), env, () => false);
    expect(r).toEqual({ kind: "not-found" });
    expect(describeLookup(r)).toMatch(/no upstream Codex found/);
  });
});

describe("readUpstreamVersion", () => {
  test("parses `--version` output", () => {
    const { run, calls } = fakeExec(() => ({ stdout: "codex-cli 0.152.1\n" }));
    expect(readUpstreamVersion("/x/codex", run)?.raw).toBe("0.152.1");
    expect(calls[0]?.cmd).toBe("/x/codex");
    expect(calls[0]?.args).toEqual(["--version"]);
  });
  test("non-zero exit or garbage -> null", () => {
    expect(readUpstreamVersion("/x/codex", fakeExec(() => ({ status: 1 })).run)).toBeNull();
    expect(readUpstreamVersion("/x/codex", fakeExec(() => ({ stdout: "nope" })).run)).toBeNull();
  });
});
