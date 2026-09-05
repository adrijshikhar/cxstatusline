import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Context } from "../src/context";
import { doctorReport, formatDoctor } from "../src/commands/doctor";
import { installHook } from "../src/hook/install";
import { resolvePaths } from "../src/paths";
import { REQUIRED_TOOLCHAIN } from "../src/patch/preflight";
import { installWrapper } from "../src/patch/wrapper";
import { DEFAULT_STATE, writeState } from "../src/state";
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
    expect(get(lines, "toolchain")).toMatchObject({ ok: false, value: expect.stringMatching(/rustup/) });
    expect(get(lines, "lock")).toMatchObject({ value: "free" });
    expect(formatDoctor(lines)).toContain("toolchain");
  });
  test("the documented key order is exactly what is emitted", () => {
    const { c } = ctx("0.152.1");
    expect(doctorReport(c).map((l) => l.key)).toEqual([
      "renderer", "settings", "upstream", "state", "patched_from", "policy",
      "drift", "wrapper", "patched_bin", "code_mode_host", "hook", "last_attempt", "toolchain", "lock",
    ]);
  });
  test("installed and healthy", () => {
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
    expect(get(lines, "patched_bin")).toMatchObject({ ok: true });
    expect(get(lines, "code_mode_host")).toMatchObject({ ok: true });
    expect(get(lines, "hook")).toMatchObject({ ok: true, value: expect.stringContaining("installed") });
    expect(get(lines, "toolchain")).toMatchObject({ ok: true, value: expect.stringContaining(REQUIRED_TOOLCHAIN) });
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
  test("rebuild due", () => {
    const { c, paths, upstream } = ctx("0.153.0");
    writeState(paths.stateFile, { ...DEFAULT_STATE, patched_from: "0.152.1", upstream_bin: upstream });
    expect(get(doctorReport(c), "drift")).toMatchObject({ ok: false, value: expect.stringMatching(/rebuild due.*0\.152\.1.*0\.153\.0/) });
  });
});
