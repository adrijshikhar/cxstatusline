import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { hookCommand, hookEntry, installHook, isOurGroup, mergeHook, removeHook, uninstallHook, type HooksFile } from "../src/hook/install";
import { resolvePaths } from "../src/paths";
import { tmpEnv } from "./helpers";

/** Shaped like the real ~/.codex/hooks.json: several events, and a SessionStart group WITH a matcher. */
const existing: HooksFile = {
  hooks: {
    SessionStart: [
      { hooks: [{ type: "command", command: "'/Users/x/.caveman/bin/caveman-proxy' native-hook codex" }] },
      { matcher: "startup|resume", hooks: [{ type: "command", command: "'/Users/x/.notchi/bin/notchi' hook", timeout: 5 }] },
    ],
    PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo pre" }] }],
    Stop: [{ hooks: [{ type: "command", command: "echo stop" }] }],
  },
};

describe("hook entry", () => {
  test("command is the absolute path, single-quoted, plus 'hook'", () => {
    expect(hookCommand("/Users/n/.local/bin/cxstatusline")).toBe("'/Users/n/.local/bin/cxstatusline' hook");
    expect(hookEntry("/cx")).toEqual({
      hooks: [{ type: "command", command: "'/cx' hook", timeout: 10, statusMessage: "cxstatusline: checking Codex version" }],
    });
  });
});

describe("isOurGroup", () => {
  test("identifies group by exact statusMessage", () => {
    expect(isOurGroup({ hooks: [{ type: "command", command: "'/x' hook", statusMessage: "cxstatusline: checking Codex version" }] })).toBe(true);
  });
  test("identifies group by command string fallback when statusMessage is missing or altered", () => {
    expect(isOurGroup({ hooks: [{ type: "command", command: "'/Users/n/.local/bin/cxstatusline' hook" }] })).toBe(true);
    expect(isOurGroup({ hooks: [{ type: "command", command: "bun /path/to/cxstatusline hook", statusMessage: "custom message" }] })).toBe(true);
  });
  test("returns false for unrelated hooks", () => {
    expect(isOurGroup({ hooks: [{ type: "command", command: "'/Users/x/.caveman/bin/caveman-proxy' native-hook codex" }] })).toBe(false);
  });
});

describe("mergeHook", () => {
  test("appends to SessionStart without touching other groups or events", () => {
    const { file, changed } = mergeHook(existing, "/cx");
    expect(changed).toBe(true);
    expect(file.hooks.SessionStart).toHaveLength(3);
    expect(file.hooks.SessionStart?.[0]).toEqual(existing.hooks.SessionStart![0]!);
    expect(file.hooks.SessionStart?.[1]).toEqual(existing.hooks.SessionStart![1]!); // matcher group intact
    expect(file.hooks.PreToolUse).toEqual(existing.hooks.PreToolUse!);
    expect(file.hooks.Stop).toEqual(existing.hooks.Stop!);
    expect(existing.hooks.SessionStart).toHaveLength(2); // input not mutated
  });
  test("is idempotent: an equal entry is not duplicated or rewritten", () => {
    const once = mergeHook(existing, "/cx").file;
    const twice = mergeHook(once, "/cx");
    expect(twice.changed).toBe(false);
    expect(twice.file).toEqual(once);
  });
  test("a stale entry with a different path is replaced in place", () => {
    const once = mergeHook(existing, "/old/cx").file;
    const moved = mergeHook(once, "/new/cx");
    expect(moved.changed).toBe(true);
    expect(moved.file.hooks.SessionStart).toHaveLength(3);
    expect(moved.file.hooks.SessionStart?.[2]?.hooks[0]?.command).toBe("'/new/cx' hook");
  });
  test("replaces existing cxstatusline hook even if statusMessage was modified", () => {
    const customized: HooksFile = {
      hooks: {
        SessionStart: [
          { hooks: [{ type: "command", command: "'/old/cxstatusline' hook", statusMessage: "custom message" }] },
        ],
      },
    };
    const { file, changed } = mergeHook(customized, "/new/cxstatusline");
    expect(changed).toBe(true);
    expect(file.hooks.SessionStart).toHaveLength(1);
    expect(file.hooks.SessionStart?.[0]?.hooks[0]?.command).toBe("'/new/cxstatusline' hook");
    expect(file.hooks.SessionStart?.[0]?.hooks[0]?.statusMessage).toBe("cxstatusline: checking Codex version");
  });
  test("null file -> fresh file with only our entry", () => {
    expect(mergeHook(null, "/cx").file).toEqual({ hooks: { SessionStart: [hookEntry("/cx")] } });
  });
});

describe("removeHook", () => {
  test("removes only ours; drops an emptied SessionStart array", () => {
    const withOurs = mergeHook({ hooks: {} }, "/cx").file;
    const { file, changed } = removeHook(withOurs);
    expect(changed).toBe(true);
    expect(file).toEqual({ hooks: {} });
    expect(removeHook(existing)).toEqual({ file: existing, changed: false });
  });
  test("removes hook by command fallback when statusMessage was omitted", () => {
    const fileWithOursNoMsg: HooksFile = {
      hooks: {
        SessionStart: [
          { hooks: [{ type: "command", command: "'/Users/n/.local/bin/cxstatusline' hook" }] },
        ],
      },
    };
    expect(removeHook(fileWithOursNoMsg).file).toEqual({ hooks: {} });
  });
  test("round-trips the real-shaped file back to exactly what it was", () => {
    const withOurs = mergeHook(existing, "/cx").file;
    expect(removeHook(withOurs).file).toEqual(existing);
  });
});

describe("install/uninstall on disk", () => {
  test("creates the file when absent, then reports unchanged, then removes", () => {
    const { env } = tmpEnv();
    const p = resolvePaths(env);
    expect(installHook(p.hooksFile, "/cx")).toBe("added");
    expect(JSON.parse(readFileSync(p.hooksFile, "utf8"))).toEqual({ hooks: { SessionStart: [hookEntry("/cx")] } });
    expect(installHook(p.hooksFile, "/cx")).toBe("unchanged");
    expect(uninstallHook(p.hooksFile)).toBe("removed");
    expect(uninstallHook(p.hooksFile)).toBe("absent");
  });
  test("preserves an existing file's other content structurally (the file is reformatted)", () => {
    const { env } = tmpEnv();
    const p = resolvePaths(env);
    mkdirSync(join(p.hooksFile, ".."), { recursive: true });
    writeFileSync(p.hooksFile, JSON.stringify(existing, null, 2));
    installHook(p.hooksFile, "/cx");
    const after = JSON.parse(readFileSync(p.hooksFile, "utf8")) as HooksFile;
    expect(after.hooks.PreToolUse).toEqual(existing.hooks.PreToolUse!);
    expect(after.hooks.Stop).toEqual(existing.hooks.Stop!);
    expect(after.hooks.SessionStart?.[0]).toEqual(existing.hooks.SessionStart![0]!);
    expect(after.hooks.SessionStart?.[1]).toEqual(existing.hooks.SessionStart![1]!);
  });
  test("refuses to touch a malformed hooks.json", () => {
    const { env } = tmpEnv();
    const p = resolvePaths(env);
    mkdirSync(join(p.hooksFile, ".."), { recursive: true });
    writeFileSync(p.hooksFile, "{ nope");
    expect(() => installHook(p.hooksFile, "/cx")).toThrow(/hooks\.json.*not valid JSON/);
    expect(readFileSync(p.hooksFile, "utf8")).toBe("{ nope");
  });
});
