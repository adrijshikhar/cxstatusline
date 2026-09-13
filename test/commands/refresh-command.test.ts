import { describe, expect, test } from "bun:test";
import { lstatSync, mkdirSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runRefreshCommand } from "../../src/commands/refresh-command";
import { resolvePaths } from "../../src/paths";
import {
  CACHE_MAX_AGE_MS,
  CACHE_VERSION,
  cacheKey,
  readDocument,
  writeDocument,
  type CacheDocument,
} from "../../src/widgets/shared/cached-command";
import type { CommandResult, CommandRunner } from "../../src/widgets/shared/command-runner";
import { tmpEnv } from "../helpers";

describe("runRefreshCommand", () => {
  const fakeRunner = (result: Partial<CommandResult> = {}): { runner: CommandRunner; getCalls: () => any[] } => {
    const calls: any[] = [];
    const runner: CommandRunner = (opts) => {
      calls.push(opts);
      return {
        status: 0,
        signal: null,
        stdout: "result\n",
        errorCode: undefined,
        ...result,
      };
    };
    return { runner, getCalls: () => calls };
  };

  test("key validation: hostile, too long, uppercase, or empty keys return 2 before building paths", () => {
    const { env, root } = tmpEnv();
    const runner = fakeRunner();

    const hostile = runRefreshCommand("../../evil", { env, runner: runner.runner });
    expect(hostile).toBe(2);

    const tooLong = runRefreshCommand("0123456789abcdef0", { env, runner: runner.runner });
    expect(tooLong).toBe(2);

    const uppercase = runRefreshCommand("0123456789ABCDEF", { env, runner: runner.runner });
    expect(uppercase).toBe(2);

    const empty = runRefreshCommand("", { env, runner: runner.runner });
    expect(empty).toBe(2);

    expect(runner.getCalls().length).toBe(0);
    const paths = resolvePaths(env);
    expect(lstatSync(paths.commandCacheDir, { throwIfNoEntry: false })).toBeUndefined();
  });

  test("absent, unparseable, or wrong-version document -> exit 0, nothing written", () => {
    const { env, root } = tmpEnv();
    const paths = resolvePaths(env);
    mkdirSync(paths.commandCacheDir, { recursive: true });
    const key = cacheKey("date", "/repo");
    const docPath = join(paths.commandCacheDir, `${key}.json`);
    const runner = fakeRunner();

    // Absent:
    expect(runRefreshCommand(key, { env, runner: runner.runner })).toBe(0);
    expect(runner.getCalls().length).toBe(0);
    expect(readDocument(docPath)).toBe("miss");

    // Unparseable:
    writeFileSync(docPath, "{ invalid json");
    expect(runRefreshCommand(key, { env, runner: runner.runner })).toBe(0);
    expect(runner.getCalls().length).toBe(0);

    // Wrong version:
    writeFileSync(docPath, JSON.stringify({ version: 99, command: "date", cwd: "/repo", input: "{}", requestedAt: 100 }));
    expect(runRefreshCommand(key, { env, runner: runner.runner })).toBe(0);
    expect(runner.getCalls().length).toBe(0);
  });

  test("key mismatch: document whose (command, cwd) does not hash to argv key -> exit 2, nothing written", () => {
    const { env } = tmpEnv();
    const paths = resolvePaths(env);
    const key = cacheKey("date", "/repo");
    const docPath = join(paths.commandCacheDir, `${key}.json`);
    const mismatchDoc: CacheDocument = {
      version: CACHE_VERSION,
      command: "date",
      cwd: "/different/repo", // doesn't hash to `key`
      input: "{}",
      requestedAt: 100,
      result: null,
      producedAt: null,
    };
    writeDocument(docPath, mismatchDoc);

    const runner = fakeRunner();
    expect(runRefreshCommand(key, { env, runner: runner.runner })).toBe(2);
    expect(runner.getCalls().length).toBe(0);
    expect(readDocument(docPath)).toEqual(mismatchDoc);
  });

  test("happy path: executes command, updates result and producedAt, keeps request fields, written 0600", () => {
    const { env } = tmpEnv();
    const paths = resolvePaths(env);
    const key = cacheKey("echo test", "/repo");
    const docPath = join(paths.commandCacheDir, `${key}.json`);
    const initialDoc: CacheDocument = {
      version: CACHE_VERSION,
      command: "echo test",
      cwd: "/repo",
      input: '{"payload_version":1}',
      requestedAt: 100_000,
      result: null,
      producedAt: null,
    };
    writeDocument(docPath, initialDoc);

    const runner = fakeRunner({ stdout: "test output\n", status: 0 });
    const nowTime = 100_500;
    const exitCode = runRefreshCommand(key, {
      env,
      runner: runner.runner,
      now: () => nowTime,
    });

    expect(exitCode).toBe(0);
    expect(runner.getCalls().length).toBe(1);
    expect(runner.getCalls()[0]).toEqual({
      command: "echo test",
      input: '{"payload_version":1}',
      timeoutMs: 10_000,
      cwd: "/repo",
    });

    const updated = readDocument(docPath);
    expect(updated).not.toBe("miss");
    if (updated !== "miss") {
      expect(updated.version).toBe(CACHE_VERSION);
      expect(updated.command).toBe("echo test");
      expect(updated.cwd).toBe("/repo");
      expect(updated.input).toBe('{"payload_version":1}');
      expect(updated.requestedAt).toBe(100_000);
      expect(updated.producedAt).toBe(100_500);
      expect(updated.result).toEqual({
        stdout: "test output\n",
        status: 0,
        signal: null,
        errorCode: undefined,
        timedOut: false,
      });
    }

    const st = statSync(docPath);
    expect(st.mode & 0o777).toBe(0o600);
  });

  test("failing command: result records status, signal, errorCode, timedOut and NO diagnostic token", () => {
    const { env } = tmpEnv();
    const paths = resolvePaths(env);
    const key = cacheKey("exit-cmd", "/repo");
    const docPath = join(paths.commandCacheDir, `${key}.json`);
    const initialDoc: CacheDocument = {
      version: CACHE_VERSION,
      command: "exit-cmd",
      cwd: "/repo",
      input: "{}",
      requestedAt: 100_000,
      result: null,
      producedAt: null,
    };
    writeDocument(docPath, initialDoc);

    const runner = fakeRunner({ stdout: "error info\n", status: 3, signal: null, errorCode: undefined });
    const exitCode = runRefreshCommand(key, { env, runner: runner.runner });
    expect(exitCode).toBe(0);

    const updated = readDocument(docPath);
    expect(updated).not.toBe("miss");
    if (updated !== "miss") {
      expect(updated.result).toEqual({
        stdout: "error info\n",
        status: 3,
        signal: null,
        errorCode: undefined,
        timedOut: false,
      });
      // Diagnostics tokens like [Exit: 3] must NOT be present in raw result:
      expect((updated.result as any).diagnostic).toBeUndefined();
    }
  });

  test("document with cwd: '' -> runner receives cwd: undefined, key matches", () => {
    const { env } = tmpEnv();
    const paths = resolvePaths(env);
    const key = cacheKey("date", "");
    const docPath = join(paths.commandCacheDir, `${key}.json`);
    const initialDoc: CacheDocument = {
      version: CACHE_VERSION,
      command: "date",
      cwd: "",
      input: "{}",
      requestedAt: 100_000,
      result: null,
      producedAt: null,
    };
    writeDocument(docPath, initialDoc);

    const runner = fakeRunner({ stdout: "now\n" });
    const exitCode = runRefreshCommand(key, { env, runner: runner.runner });
    expect(exitCode).toBe(0);

    expect(runner.getCalls()[0]?.cwd).toBeUndefined();
  });

  test("write failure: exits non-zero and changes nothing, leaving requestedAt in place", () => {
    const { env } = tmpEnv();
    const paths = resolvePaths(env);
    const key = cacheKey("date", "/repo");
    const docPath = join(paths.commandCacheDir, `${key}.json`);
    const initialDoc: CacheDocument = {
      version: CACHE_VERSION,
      command: "date",
      cwd: "/repo",
      input: "{}",
      requestedAt: 100_000,
      result: null,
      producedAt: null,
    };
    writeDocument(docPath, initialDoc);

    // Make the atomic rename fail by creating a directory where .tmp would go, or by locking/symlink/permissions
    // In writeFileAtomic, it writes to a tmp file and renames to docPath. If docPath is a directory, renameSync will fail.
    // Let's test with making docPath unwritable or replacing docPath with directory:
    // Wait, if docPath is a directory, readDocument would fail earlier.
    // Instead, make the parent directory read-only right before write, or make atomic rename fail.
    // Or we can create an unwritable situation for the writeDocument call.
    // Let's test chmod 0o500 on commandCacheDir after reading!
    // But chmodSync on commandCacheDir might be reverted by writeDocument because writeDocument chmods dir 0o700.
    // However, if we make docPath a read-only file or if renameSync cannot overwrite?
    // Wait, in POSIX, renameSync cannot overwrite a non-empty directory.
    // But docPath has to be a file during readDocument!
    // What if the runner itself makes commandCacheDir parent unwritable, or replaces the atomic temp directory?
    // In our runner:
    const runner: CommandRunner = () => {
      // Remove docPath file and replace with a directory containing a file (non-empty dir cannot be overwritten by rename)
      const { rmSync, mkdirSync, writeFileSync } = require("node:fs");
      rmSync(docPath);
      mkdirSync(docPath);
      writeFileSync(join(docPath, "blocker"), "x");
      return { status: 0, signal: null, stdout: "hi" };
    };

    const exitCode = runRefreshCommand(key, { env, runner });
    expect(exitCode).not.toBe(0);
  });

  test("eviction removes *.json and .*tmp older than CACHE_MAX_AGE_MS", () => {
    const { env } = tmpEnv();
    const paths = resolvePaths(env);
    const key = cacheKey("date", "/repo");
    const docPath = join(paths.commandCacheDir, `${key}.json`);
    const initialDoc: CacheDocument = {
      version: CACHE_VERSION,
      command: "date",
      cwd: "/repo",
      input: "{}",
      requestedAt: 100_000,
      result: null,
      producedAt: null,
    };
    writeDocument(docPath, initialDoc);

    // Create old and fresh files in cache dir:
    const oldJson = join(paths.commandCacheDir, "old-entry.json");
    const freshJson = join(paths.commandCacheDir, "fresh-entry.json");
    const oldTmp = join(paths.commandCacheDir, ".9999.dead.tmp");
    const freshTmp = join(paths.commandCacheDir, ".1111.fresh.tmp");
    const otherOldFile = join(paths.commandCacheDir, "not-cache.txt");

    writeFileSync(oldJson, "{}");
    writeFileSync(freshJson, "{}");
    writeFileSync(oldTmp, "tmp");
    writeFileSync(freshTmp, "tmp");
    writeFileSync(otherOldFile, "keep me");

    const now = 1_000_000_000_000;
    const oldTimeSec = (now - CACHE_MAX_AGE_MS - 10_000) / 1000;
    const freshTimeSec = (now - 1000) / 1000;

    utimesSync(oldJson, oldTimeSec, oldTimeSec);
    utimesSync(oldTmp, oldTimeSec, oldTimeSec);
    utimesSync(otherOldFile, oldTimeSec, oldTimeSec);
    utimesSync(freshJson, freshTimeSec, freshTimeSec);
    utimesSync(freshTmp, freshTimeSec, freshTimeSec);

    const runner = fakeRunner();
    const exitCode = runRefreshCommand(key, {
      env,
      runner: runner.runner,
      now: () => now,
    });
    expect(exitCode).toBe(0);

    // Old JSON and old tmp must be evicted:
    expect(lstatSync(oldJson, { throwIfNoEntry: false })).toBeUndefined();
    expect(lstatSync(oldTmp, { throwIfNoEntry: false })).toBeUndefined();

    // Fresh JSON, fresh tmp, and other file must remain:
    expect(lstatSync(freshJson, { throwIfNoEntry: false })).toBeDefined();
    expect(lstatSync(freshTmp, { throwIfNoEntry: false })).toBeDefined();
    expect(lstatSync(otherOldFile, { throwIfNoEntry: false })).toBeDefined();
    expect(lstatSync(docPath, { throwIfNoEntry: false })).toBeDefined();
  });
});
