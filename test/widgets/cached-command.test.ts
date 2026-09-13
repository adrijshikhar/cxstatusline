import { describe, expect, test } from "bun:test";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  CACHE_VERSION,
  cacheKey,
  readDocument,
  resolveCommandText,
  scheduleRefresh,
  writeDocument,
  type CacheDeps,
  type CacheDocument,
} from "../../src/widgets/shared/cached-command";
import { tmpEnv } from "../helpers";
import type { WidgetItem } from "../../src/types/Widget";

describe("cacheKey", () => {
  test("returns 16 lowercase hex characters; stable for same (command, cwd); changes when either changes", () => {
    const k1 = cacheKey("date", "/repo");
    expect(k1).toMatch(/^[0-9a-f]{16}$/);
    expect(cacheKey("date", "/repo")).toBe(k1);
    expect(cacheKey("date -u", "/repo")).not.toBe(k1);
    expect(cacheKey("date", "/other")).not.toBe(k1);
  });

  test("cacheKey(cmd, undefined) equals cacheKey(cmd, '')", () => {
    expect(cacheKey("date", undefined)).toBe(cacheKey("date", ""));
  });
});

describe("readDocument", () => {
  test("returns 'miss' for absent file, non-JSON, wrong version, or missing command", () => {
    const { root } = tmpEnv();
    const missing = join(root, "missing.json");
    expect(readDocument(missing)).toBe("miss");

    const badJson = join(root, "bad.json");
    writeDocument(badJson, {
      version: CACHE_VERSION,
      command: "date",
      cwd: "",
      input: "{}",
      requestedAt: Date.now(),
      result: null,
      producedAt: null,
    });
    // Corrupt with invalid JSON:
    const { writeFileAtomic } = require("../../src/atomic");
    writeFileAtomic(badJson, "{ invalid json");
    expect(readDocument(badJson)).toBe("miss");

    // Wrong version:
    writeFileAtomic(badJson, JSON.stringify({ version: 99, command: "date" }));
    expect(readDocument(badJson)).toBe("miss");

    // Missing command:
    writeFileAtomic(badJson, JSON.stringify({ version: CACHE_VERSION }));
    expect(readDocument(badJson)).toBe("miss");
  });

  test("round-trips document fields including result: null", () => {
    const { root } = tmpEnv();
    const file = join(root, "doc.json");
    const doc: CacheDocument = {
      version: CACHE_VERSION,
      command: "printf hello",
      cwd: "/work/dir",
      input: '{"terminal_width":80}',
      requestedAt: 1757740000000,
      result: null,
      producedAt: null,
    };
    writeDocument(file, doc);
    expect(readDocument(file)).toEqual(doc);

    const populated: CacheDocument = {
      ...doc,
      result: {
        stdout: "hello\n",
        status: 0,
        signal: null,
        errorCode: undefined,
        timedOut: false,
      },
      producedAt: 1757740003000,
    };
    writeDocument(file, populated);
    expect(readDocument(file)).toEqual(populated);
  });
});

describe("permissions", () => {
  test("file written by writeDocument is 0600 and created directory is 0700", () => {
    const { root } = tmpEnv();
    // Path inside a non-existent directory to test directory creation
    const file = join(root, "new-cache-dir", "sub", "test.json");
    const doc: CacheDocument = {
      version: CACHE_VERSION,
      command: "test",
      cwd: "",
      input: "{}",
      requestedAt: 1000,
      result: null,
      producedAt: null,
    };
    writeDocument(file, doc);

    const fileStat = statSync(file);
    expect(fileStat.mode & 0o777).toBe(0o600);

    const dirStat = statSync(join(root, "new-cache-dir", "sub"));
    expect(dirStat.mode & 0o777).toBe(0o700);
  });

  test("refuses a symlinked command cache directory: throws, writes nothing, leaves target mode unchanged", () => {
    const { root } = tmpEnv();
    const { symlinkSync, chmodSync, readdirSync, mkdirSync } = require("node:fs");
    const targetDir = join(root, "real-target");
    mkdirSync(targetDir, { recursive: true, mode: 0o755 });
    chmodSync(targetDir, 0o755);
    const initialMode = statSync(targetDir).mode & 0o777;

    const cacheSymlinkDir = join(root, "symlinked-cache");
    symlinkSync(targetDir, cacheSymlinkDir);

    const file = join(cacheSymlinkDir, "test.json");
    const doc: CacheDocument = {
      version: CACHE_VERSION,
      command: "test",
      cwd: "",
      input: "{}",
      requestedAt: 1000,
      result: null,
      producedAt: null,
    };

    expect(() => writeDocument(file, doc)).toThrow();
    expect(readdirSync(targetDir).length).toBe(0);
    expect(statSync(targetDir).mode & 0o777).toBe(initialMode);
  });
});

describe("resolveCommandText cached render path and throttling", () => {
  const liveContext = (cacheDir?: string): any => ({
    data: { payload_version: 1, session: { cwd: "/my/repo" } },
    now: new Date(0),
    terminalWidth: 80,
    isPreview: false,
    commandCacheDir: cacheDir,
  });

  const makeItem = (overrides: Partial<WidgetItem> = {}): WidgetItem => ({
    id: "c",
    type: "custom-command",
    commandPath: "date",
    ...overrides,
  });

  const fakeRunner = (stdout = "hello\n", status = 0, signal = null, errorCode?: string) => {
    let callCount = 0;
    const runner = () => {
      callCount++;
      return { status, signal, stdout, errorCode };
    };
    return { runner, getCalls: () => callCount };
  };

  const fakeSpawnHarness = () => {
    const calls: Array<{ command: string; args: readonly string[]; options: any; unrefCalled: boolean }> = [];
    const spawn = (cmd: string, args: readonly string[], options: any) => {
      const rec = { command: cmd, args, options, unrefCalled: false };
      calls.push(rec);
      return {
        on: () => {},
        unref: () => { rec.unrefCalled = true; },
      };
    };
    return { spawn: spawn as any, calls };
  };

  test("refreshMs absent -> synchronous path, byte-identical to Phase 1", () => {
    const runner = fakeRunner("sync output\n");
    const ctx = liveContext("/some/cache");
    const item = makeItem();
    expect(resolveCommandText(item, ctx, runner.runner)).toBe("sync output");
    expect(runner.getCalls()).toBe(1);
  });

  test("refreshMs present but context.commandCacheDir absent -> synchronous fallback", () => {
    const runner = fakeRunner("fallback sync\n");
    const ctx = liveContext(undefined);
    const item = makeItem({ refreshMs: 5000 });
    expect(resolveCommandText(item, ctx, runner.runner)).toBe("fallback sync");
    expect(runner.getCalls()).toBe(1);
  });

  test("document absent -> [Loading], runner not called, document written with result: null, spawned once with correct options and unref", () => {
    const { root } = tmpEnv();
    const cacheDir = join(root, "commands");
    const ctx = liveContext(cacheDir);
    const item = makeItem({ refreshMs: 5000 });
    const runner = fakeRunner("should not run");
    const { spawn, calls } = fakeSpawnHarness();
    let nowTime = 100_000;
    const deps: CacheDeps = { spawn, scriptPath: "/bin/cxstatusline", now: () => nowTime };

    const rendered = resolveCommandText(item, ctx, runner.runner, deps);
    expect(rendered).toBe("[Loading]");
    expect(runner.getCalls()).toBe(0);
    expect(calls.length).toBe(1);
    expect(calls[0]!.command).toBe(process.execPath);
    expect(calls[0]!.args).toEqual(["/bin/cxstatusline", "--internal-refresh-command", cacheKey("date", "/my/repo")]);
    expect(calls[0]!.options).toEqual({ detached: true, stdio: "ignore", windowsHide: true });
    expect(calls[0]!.unrefCalled).toBe(true);

    const docPath = join(cacheDir, `${cacheKey("date", "/my/repo")}.json`);
    const doc = readDocument(docPath);
    expect(doc).not.toBe("miss");
    if (doc !== "miss") {
      expect(doc.result).toBeNull();
      expect(doc.producedAt).toBeNull();
      expect(doc.requestedAt).toBe(100_000);
      expect(doc.command).toBe("date");
      expect(doc.cwd).toBe("/my/repo");
    }
  });

  test("result: null and requestedAt within REQUEST_STALE_MS -> [Loading], zero spawns across several renders", () => {
    const { root } = tmpEnv();
    const cacheDir = join(root, "commands");
    const ctx = liveContext(cacheDir);
    const item = makeItem({ refreshMs: 5000 });
    const runner = fakeRunner();
    const { spawn, calls } = fakeSpawnHarness();
    let nowTime = 100_000;
    const deps: CacheDeps = { spawn, scriptPath: "/bin/cxstatusline", now: () => nowTime };

    // Initial render spawns once:
    expect(resolveCommandText(item, ctx, runner.runner, deps)).toBe("[Loading]");
    expect(calls.length).toBe(1);

    // 5 more renders while requestedAt is fresh (within 60s):
    for (let i = 1; i <= 5; i++) {
      nowTime += 5_000; // 5s later each
      expect(resolveCommandText(item, ctx, runner.runner, deps)).toBe("[Loading]");
      expect(calls.length).toBe(1); // still 1! zero new spawns
    }
  });

  test("result: null and requestedAt older than REQUEST_STALE_MS -> [Error], requestedAt rewritten, spawned once", () => {
    const { root } = tmpEnv();
    const cacheDir = join(root, "commands");
    const ctx = liveContext(cacheDir);
    const item = makeItem({ refreshMs: 5000 });
    const runner = fakeRunner();
    const { spawn, calls } = fakeSpawnHarness();
    let nowTime = 100_000;
    const deps: CacheDeps = { spawn, scriptPath: "/bin/cxstatusline", now: () => nowTime };

    // Initial render:
    resolveCommandText(item, ctx, runner.runner, deps);
    expect(calls.length).toBe(1);

    // Advance beyond REQUEST_STALE_MS (60_000):
    nowTime += 65_000;
    expect(resolveCommandText(item, ctx, runner.runner, deps)).toBe("[Error]");
    expect(calls.length).toBe(2);

    const docPath = join(cacheDir, `${cacheKey("date", "/my/repo")}.json`);
    const doc = readDocument(docPath);
    if (doc !== "miss") {
      expect(doc.requestedAt).toBe(165_000);
    }
  });

  test("result present, fresh -> processed value, no spawn", () => {
    const { root } = tmpEnv();
    const cacheDir = join(root, "commands");
    const key = cacheKey("date", "/my/repo");
    const docPath = join(cacheDir, `${key}.json`);
    const doc: CacheDocument = {
      version: CACHE_VERSION,
      command: "date",
      cwd: "/my/repo",
      input: "{}",
      requestedAt: 100_000,
      result: { stdout: "fresh output\n", status: 0, signal: null, errorCode: undefined, timedOut: false },
      producedAt: 100_000,
    };
    writeDocument(docPath, doc);

    const ctx = liveContext(cacheDir);
    const item = makeItem({ refreshMs: 10_000 });
    const runner = fakeRunner();
    const { spawn, calls } = fakeSpawnHarness();
    const deps: CacheDeps = { spawn, scriptPath: "/bin/cxstatusline", now: () => 105_000 };

    expect(resolveCommandText(item, ctx, runner.runner, deps)).toBe("fresh output");
    expect(calls.length).toBe(0);
  });

  test("result present, stale, no refresh in flight -> processed value and one spawn", () => {
    const { root } = tmpEnv();
    const cacheDir = join(root, "commands");
    const key = cacheKey("date", "/my/repo");
    const docPath = join(cacheDir, `${key}.json`);
    const doc: CacheDocument = {
      version: CACHE_VERSION,
      command: "date",
      cwd: "/my/repo",
      input: "{}",
      requestedAt: 100_000,
      result: { stdout: "old output\n", status: 0, signal: null, errorCode: undefined, timedOut: false },
      producedAt: 100_000,
    };
    writeDocument(docPath, doc);

    const ctx = liveContext(cacheDir);
    const item = makeItem({ refreshMs: 5_000 });
    const runner = fakeRunner();
    const { spawn, calls } = fakeSpawnHarness();
    // 6 seconds later (> 5s refreshMs):
    let nowTime = 106_000;
    const deps: CacheDeps = { spawn, scriptPath: "/bin/cxstatusline", now: () => nowTime };

    expect(resolveCommandText(item, ctx, runner.runner, deps)).toBe("old output");
    expect(calls.length).toBe(1);

    const updated = readDocument(docPath);
    if (updated !== "miss") {
      expect(updated.requestedAt).toBe(106_000);
      expect(updated.result?.stdout).toBe("old output\n");
    }
  });

  test("result present, stale, refresh in flight -> processed value and zero spawns across several renders", () => {
    const { root } = tmpEnv();
    const cacheDir = join(root, "commands");
    const key = cacheKey("date", "/my/repo");
    const docPath = join(cacheDir, `${key}.json`);
    // inFlight condition: requestedAt > producedAt && (now - requestedAt) <= REQUEST_STALE_MS
    const doc: CacheDocument = {
      version: CACHE_VERSION,
      command: "date",
      cwd: "/my/repo",
      input: "{}",
      requestedAt: 106_000,
      result: { stdout: "old value\n", status: 0, signal: null, errorCode: undefined, timedOut: false },
      producedAt: 100_000,
    };
    writeDocument(docPath, doc);

    const ctx = liveContext(cacheDir);
    const item = makeItem({ refreshMs: 5_000 });
    const runner = fakeRunner();
    const { spawn, calls } = fakeSpawnHarness();
    let nowTime = 107_000;
    const deps: CacheDeps = { spawn, scriptPath: "/bin/cxstatusline", now: () => nowTime };

    for (let i = 0; i < 5; i++) {
      nowTime += 500;
      expect(resolveCommandText(item, ctx, runner.runner, deps)).toBe("old value");
      expect(calls.length).toBe(0);
    }
  });

  test("cached failure document renders Phase 1 token", () => {
    const { root } = tmpEnv();
    const cacheDir = join(root, "commands");
    const key = cacheKey("date", "/my/repo");
    const docPath = join(cacheDir, `${key}.json`);
    const doc: CacheDocument = {
      version: CACHE_VERSION,
      command: "date",
      cwd: "/my/repo",
      input: "{}",
      requestedAt: 100_000,
      result: { stdout: "", status: 3, signal: null, errorCode: undefined, timedOut: false },
      producedAt: 100_000,
    };
    writeDocument(docPath, doc);

    const ctx = liveContext(cacheDir);
    const item = makeItem({ refreshMs: 10_000 });
    const runner = fakeRunner();
    const { spawn } = fakeSpawnHarness();
    const deps: CacheDeps = { spawn, scriptPath: "/bin/cxstatusline", now: () => 101_000 };

    expect(resolveCommandText(item, ctx, runner.runner, deps)).toBe("[Exit: 3]");
  });

  test("cached path does not call takeBudget: renders value even when render budget is exhausted", () => {
    const { root } = tmpEnv();
    const cacheDir = join(root, "commands");
    const key = cacheKey("date", "/my/repo");
    const docPath = join(cacheDir, `${key}.json`);
    const doc: CacheDocument = {
      version: CACHE_VERSION,
      command: "date",
      cwd: "/my/repo",
      input: "{}",
      requestedAt: 100_000,
      result: { stdout: "budget-free output\n", status: 0, signal: null, errorCode: undefined, timedOut: false },
      producedAt: 100_000,
    };
    writeDocument(docPath, doc);

    const ctx = liveContext(cacheDir);
    // Exhaust the budget on ctx:
    const { takeBudget, RENDER_BUDGET_MS } = require("../../src/widgets/shared/command-runner");
    takeBudget(ctx, RENDER_BUDGET_MS);

    const item = makeItem({ refreshMs: 10_000 });
    const runner = fakeRunner();
    const { spawn } = fakeSpawnHarness();
    const deps: CacheDeps = { spawn, scriptPath: "/bin/cxstatusline", now: () => 101_000 };

    expect(resolveCommandText(item, ctx, runner.runner, deps)).toBe("budget-free output");
  });

  test.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "unwritable directory falls back to synchronous execution and consumes budget",
    () => {
      const { root } = tmpEnv();
      const parentDir = join(root, "unwritable-parent");
      const { mkdirSync, chmodSync } = require("node:fs");
      mkdirSync(parentDir, { recursive: true });
      const cacheDir = join(parentDir, "cache", "commands");
      chmodSync(parentDir, 0o500);

      try {
        const ctx = liveContext(cacheDir);
        const item = makeItem({ refreshMs: 5000 });
        const runner = fakeRunner("sync fallback ok\n");
        const { spawn } = fakeSpawnHarness();
        const deps: CacheDeps = { spawn, scriptPath: "/bin/cxstatusline", now: () => 100_000 };

        const rendered = resolveCommandText(item, ctx, runner.runner, deps);
        expect(rendered).toBe("sync fallback ok");
        expect(runner.getCalls()).toBe(1);

        // Verify budget was consumed:
        const { takeBudget } = require("../../src/widgets/shared/command-runner");
        const granted = takeBudget(ctx, 1000);
        expect(granted).toBeLessThan(600);
      } finally {
        chmodSync(parentDir, 0o700);
      }
    }
  );

  test("deps.scriptPath undefined -> no spawn, no throw", () => {
    const { root } = tmpEnv();
    const cacheDir = join(root, "commands");
    const ctx = liveContext(cacheDir);
    const item = makeItem({ refreshMs: 5000 });
    const runner = fakeRunner();
    const { spawn, calls } = fakeSpawnHarness();
    const deps: CacheDeps = { spawn, scriptPath: undefined, now: () => 100_000 };

    expect(resolveCommandText(item, ctx, runner.runner, deps)).toBe("[Loading]");
    expect(calls.length).toBe(0);
  });
});

describe("scheduleRefresh error resilience", () => {
  test("registers an error handler on the spawned child before unref() and does not crash when error is emitted", async () => {
    const { EventEmitter } = require("node:events");
    let errorListenerRegistered = false;
    let registeredBeforeUnref = false;
    let unrefCount = 0;
    const emitter = new EventEmitter();
    emitter.unref = () => {
      unrefCount++;
      registeredBeforeUnref = errorListenerRegistered;
    };
    emitter.on("newListener", (event: string) => {
      if (event === "error") {
        errorListenerRegistered = true;
      }
    });

    const spawn = () => emitter;
    const deps: CacheDeps = {
      spawn: spawn as any,
      scriptPath: "/bin/cxstatusline",
      now: () => 1000,
    };

    expect(() => {
      scheduleRefresh("0123456789abcdef", deps);
    }).not.toThrow();

    expect(errorListenerRegistered).toBe(true);
    expect(registeredBeforeUnref).toBe(true);

    await new Promise<void>((resolve) => {
      process.nextTick(() => {
        expect(() => {
          emitter.emit("error", new Error("spawn ENOENT"));
        }).not.toThrow();
        resolve();
      });
    });
  });

  test("unref() is called exactly once on the spawned child", () => {
    let unrefCalls = 0;
    const spawn = () => ({
      on: () => {},
      unref: () => {
        unrefCalls++;
      },
    });
    const deps: CacheDeps = {
      spawn: spawn as any,
      scriptPath: "/bin/cxstatusline",
      now: () => 1000,
    };

    scheduleRefresh("0123456789abcdef", deps);
    expect(unrefCalls).toBe(1);
  });
});

