import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { acquireLock, lockHolder, pidAlive } from "../src/lock";
import { tmpEnv } from "./helpers";

const file = () => join(tmpEnv().root, ".local", "state", "cxstatusline", "patch.lock");

describe("acquireLock", () => {
  test("acquires, writes our pid, and releases", () => {
    const f = file();
    const release = acquireLock(f);
    expect(release).not.toBeNull();
    expect(readFileSync(f, "utf8").trim()).toBe(String(process.pid));
    release!();
    expect(existsSync(f)).toBe(false);
  });
  test("refuses while held by a live process", () => {
    const f = file();
    const release = acquireLock(f, () => true);
    expect(acquireLock(f, () => true)).toBeNull();
    release!();
  });
  test("steals a lock whose pid is dead", () => {
    const f = file();
    acquireLock(f, () => true); // leave it "held"
    const release = acquireLock(f, () => false);
    expect(release).not.toBeNull();
    release!();
  });
  test("releasing does not delete a lock another process stole from us", () => {
    const f = file();
    const release = acquireLock(f, () => false);
    mkdirSync(join(f, ".."), { recursive: true });
    writeFileSync(f, "999999\n"); // someone else stole it
    release!();
    expect(existsSync(f)).toBe(true);
  });
});

describe("lockHolder", () => {
  test("reports the pid, or null when absent or garbage", () => {
    const f = file();
    expect(lockHolder(f)).toBeNull();
    const release = acquireLock(f);
    expect(lockHolder(f)).toBe(process.pid);
    release!();
    mkdirSync(join(f, ".."), { recursive: true });
    writeFileSync(f, "not-a-pid\n");
    expect(lockHolder(f)).toBeNull();
  });
});

describe("pidAlive", () => {
  test("true for this process, false for an unused pid", () => {
    expect(pidAlive(process.pid)).toBe(true);
    expect(pidAlive(0x7ffffff)).toBe(false);
  });
});
