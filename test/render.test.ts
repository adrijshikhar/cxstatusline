import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { runRender } from "../src/commands/render";
import { resolvePaths } from "../src/paths";
import { tmpEnv } from "./helpers";

const fixture = readFileSync(new URL("./fixtures/payload-v1.json", import.meta.url), "utf8");
const now = new Date("2026-09-02T12:00:00Z");

function writeThreeRows(env: ReturnType<typeof tmpEnv>["env"]): void {
  const paths = resolvePaths(env);
  mkdirSync(paths.configDir, { recursive: true });
  writeFileSync(paths.settingsFile, JSON.stringify({
    version: 2,
    colorLevel: 0,
    lines: [
      [{ id: "model", type: "model" }, { id: "width", type: "terminal-width" }],
      [{ id: "window", type: "context-window" }],
      [{ id: "memory", type: "free-memory" }, { id: "title", type: "session-name" }],
    ],
  }));
}

describe("runRender", () => {
  test("honors named settings colors in a fresh non-TTY renderer process", () => {
    const { env } = tmpEnv();
    const paths = resolvePaths(env);
    mkdirSync(paths.configDir, { recursive: true });
    writeFileSync(paths.settingsFile, JSON.stringify({
      version: 2,
      colorLevel: 2,
      lines: [[{ id: "model", type: "model", color: "red" }]],
    }));
    const renderUrl = new URL("../src/commands/render.ts", import.meta.url).href;
    const script = [
      `import { runRender } from ${JSON.stringify(renderUrl)};`,
      "const env = { HOME: process.env.HOME, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME, XDG_STATE_HOME: process.env.XDG_STATE_HOME, XDG_DATA_HOME: process.env.XDG_DATA_HOME, CODEX_HOME: process.env.CODEX_HOME, PATH: process.env.PATH };",
      "const result = await runRender(process.env.CXSTATUSLINE_PAYLOAD ?? '', { env, now: new Date('2026-09-02T12:00:00Z'), terminalWidth: 120, freeMemoryBytes: 0 });",
      "process.stdout.write(result.stdout);",
    ].join("\n");

    const child = spawnSync(process.execPath, ["-e", script], {
      encoding: "utf8",
      env: { ...process.env, ...env, FORCE_COLOR: "0", CXSTATUSLINE_PAYLOAD: fixture },
    });

    expect(child.status).toBe(0);
    expect(child.stdout).toContain("\x1b[38;5;160m");
  });

  test("emits exactly the configured rows with one final newline", async () => {
    const { env } = tmpEnv();
    writeThreeRows(env);

    const result = await runRender(fixture, {
      env,
      now,
      terminalWidth: 120,
      freeMemoryBytes: 2 * 1024 ** 3,
    });

    expect(result.code).toBe(0);
    expect(result.stdout.endsWith("\n")).toBe(true);
    expect(result.stdout.trimEnd().split("\n")).toHaveLength(3);
    expect(result.stdout).toContain("gpt-5-codex");
    expect(result.stdout).toContain("Term: 120");
    expect(result.stdout).toContain("Win: 200.0k");
    expect(result.stdout).toContain("Mem: 2.0G");
    expect(result.stdout).toContain("Session: dsl");
    expect(result.stderr).toBe("");
  });

  test("keeps rendering with a warning when settings are malformed", async () => {
    const { env } = tmpEnv();
    const paths = resolvePaths(env);
    mkdirSync(paths.configDir, { recursive: true });
    writeFileSync(paths.settingsFile, "{");

    const result = await runRender(fixture, {
      env,
      now,
      terminalWidth: 120,
      freeMemoryBytes: 0,
    });

    expect(result.code).toBe(0);
    expect(result.stdout).not.toBe("");
    expect(result.stderr).toMatch(/settings\.json/);
  });

  test("sanitizes each rendered row without removing renderer ANSI", async () => {
    const { env } = tmpEnv();
    const paths = resolvePaths(env);
    mkdirSync(paths.configDir, { recursive: true });
    writeFileSync(paths.settingsFile, JSON.stringify({
      version: 2,
      lines: [
        [{ id: "model", type: "model", color: "cyan" }],
        [{ id: "branch", type: "git-branch", color: "cyan" }],
        [{ id: "title", type: "session-name", color: "cyan" }],
      ],
    }));
    const payload = JSON.parse(fixture) as Record<string, Record<string, string>>;
    payload.model!.name = "one\r\u009b31m";
    payload.git!.branch = "two\u0007";
    payload.session!.thread_title = "three\u007f";

    const result = await runRender(JSON.stringify(payload), {
      env,
      now,
      terminalWidth: 120,
      freeMemoryBytes: 0,
    });

    const rows = result.stdout.trimEnd().split("\n");
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row).toContain("\x1b[");
      expect(row.replace(/\x1b\[[0-9;]*m/g, "")).not.toMatch(/[\u0000-\u001F\u007F-\u009F]/);
    }
  });

  test("emits no ANSI at color level zero, including Powerline styling", async () => {
    const { env } = tmpEnv();
    const paths = resolvePaths(env);
    mkdirSync(paths.configDir, { recursive: true });
    writeFileSync(paths.settingsFile, JSON.stringify({
      version: 2,
      colorLevel: 0,
      globalBold: true,
      lines: [[
        { id: "model", type: "model", color: "ansi256:201", backgroundColor: "hex:123456", bold: true },
        { id: "branch", type: "git-branch", color: "hex:654321", backgroundColor: "ansi256:24" },
      ]],
      powerline: {
        enabled: true,
        separators: ["\uE0B0"],
        separatorInvertBackground: [false],
        startCaps: ["\uE0B6"],
        endCaps: ["\uE0B4"],
        autoAlign: false,
        continueThemeAcrossLines: false,
      },
    }));

    const result = await runRender(fixture, {
      env,
      now,
      terminalWidth: 120,
      freeMemoryBytes: 0,
    });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("\uE0B0");
    expect(result.stdout).not.toContain("\x1b");
  });
});
