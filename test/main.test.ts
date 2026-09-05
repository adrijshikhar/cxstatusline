import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { main } from "../src/main";
import { resolvePaths } from "../src/paths";
import { tmpEnv } from "./helpers";

const golden = readFileSync(new URL("./fixtures/payload-v1.json", import.meta.url), "utf8");

function io(stdin: string, envOverride: Record<string, string> = {}) {
  const { env } = tmpEnv();
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: {
      env: { ...env, ...envOverride },
      stdin: () => stdin,
      stdout: (s: string) => out.push(s),
      stderr: (s: string) => err.push(s),
      now: () => new Date("2026-09-02T12:00:00Z"),
    },
    out,
    err,
  };
}

describe("main", () => {
  test("locked revert returns failure through CLI dispatch", async () => {
    const t = io("");
    const p = resolvePaths(t.io.env);
    mkdirSync(p.binDir, { recursive: true });
    writeFileSync(p.rendererLink, "test renderer");
    mkdirSync(p.stateDir, { recursive: true });
    writeFileSync(p.lockFile, `${process.pid}\n`);
    expect(await main(["revert"], t.io)).toBe(1);
    expect(t.out.join("")).toContain("patch is running");
  });
  test("bare cxstatusline opens the TUI", async () => {
    const t = io("");
    const calls: string[] = [];
    const tuiSpy = async (settingsPath: string): Promise<void> => { calls.push(settingsPath); };

    expect(await main([], t.io, { runTUI: tuiSpy })).toBe(0);
    expect(calls).toEqual([resolvePaths(t.io.env).settingsFile]);
  });
  test("render never opens the TUI", async () => {
    const t = io(golden, { NO_COLOR: "1" });
    const tuiSpy = async (): Promise<void> => { throw new Error("TUI must not run"); };

    expect(await main(["render"], t.io, { runTUI: tuiSpy })).toBe(0);
  });
  test("bare cxstatusline refuses a non-interactive stream", async () => {
    const t = io("");
    let called = false;

    expect(await main([], { ...t.io, isTTY: false }, { runTUI: async () => { called = true; } })).toBe(2);
    expect(called).toBe(false);
    expect(t.err.join("")).toContain("usage:");
  });
  test("render prints one to three lines and exits 0", async () => {
    const t = io(golden, { NO_COLOR: "1" });
    expect(await main(["render"], t.io)).toBe(0);
    expect(t.out).toHaveLength(1);
    expect(t.out[0]).toMatch(/^.*gpt-5-codex.*\n$/s);
    expect(t.err).toEqual([]);
  });
  test("render on a bad payload prints nothing on stdout and exits 2", async () => {
    const t = io('{"payload_version": 9}');
    expect(await main(["render"], t.io)).toBe(2);
    expect(t.out).toEqual([]);
    expect(t.err.join("")).toMatch(/payload_version 9/);
  });
  test("render with a malformed settings file still renders and warns on stderr", async () => {
    const t = io(golden, { NO_COLOR: "1" });
    const { mkdirSync, writeFileSync } = await import("node:fs");
    const { resolvePaths } = await import("../src/paths");
    const p = resolvePaths(t.io.env);
    mkdirSync(p.configDir, { recursive: true });
    writeFileSync(p.settingsFile, "{{");
    expect(await main(["render"], t.io)).toBe(0);
    expect(t.out).toHaveLength(1);
    expect(t.err.join("")).toMatch(/settings\.json/);
  });
  test("--version prints the version", async () => {
    const t = io("");
    expect(await main(["--version"], t.io)).toBe(0);
    expect(t.out[0]).toMatch(/^cxstatusline (dev|\d+\.\d+\.\d+)\n$/);
  });
  test("unknown subcommand exits 2 with usage on stderr", async () => {
    const t = io("");
    expect(await main(["frobnicate"], t.io)).toBe(2);
    expect(t.out).toEqual([]);
    expect(t.err.join("")).toMatch(/usage/i);
  });
});

describe("main(['hook']) always exits 0", () => {
  test("a healthy but uninstalled machine: exit 0, no stdout", async () => {
    const t = io(JSON.stringify({ source: "startup" }));
    expect(await main(["hook"], t.io)).toBe(0);
    expect(t.out).toEqual([]);
  });
  test("a context that cannot even be built still exits 0 with a systemMessage", async () => {
    // No HOME -> resolvePaths throws inside realContext, before runHook is reached.
    const t = io(JSON.stringify({ source: "startup" }), {});
    const broken = { ...t.io, env: { PATH: "/usr/bin" } };
    expect(await main(["hook"], broken)).toBe(0);
    expect(t.out).toHaveLength(1);
    const parsed = JSON.parse(t.out[0]!) as { systemMessage: string };
    expect(parsed.systemMessage).toMatch(/cxstatusline hook error: .*HOME/);
  });
  test("garbage on stdin still exits 0", async () => {
    const t = io("not json at all");
    expect(await main(["hook"], t.io)).toBe(0);
  });
});
