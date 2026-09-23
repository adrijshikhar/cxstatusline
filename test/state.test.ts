import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BACKUP_SUFFIX, DEFAULT_STATE, readState, writeState } from "../src/state";
import { tmpEnv } from "./helpers";

const file = () => join(tmpEnv().root, ".local", "state", "cxstatusline", "state.json");

describe("state", () => {
  test("absent -> default, not corrupt", () => {
    expect(readState(file())).toEqual({ state: DEFAULT_STATE, corrupt: false });
  });
  test("round-trips through writeState and writes a backup", () => {
    const f = file();
    const s = { ...DEFAULT_STATE, patched_from: "0.152.1", upstream_bin: "/x/codex" };
    writeState(f, s);
    expect(readState(f)).toEqual({ state: s, corrupt: false });
    expect(readFileSync(f, "utf8").endsWith("\n")).toBe(true);
    expect(existsSync(`${f}${BACKUP_SUFFIX}`)).toBe(true);
    expect(readFileSync(`${f}${BACKUP_SUFFIX}`, "utf8")).toBe(readFileSync(f, "utf8"));
  });
  test("corrupt JSON with no backup -> default + corrupt flag", () => {
    const f = file();
    mkdirSync(join(f, ".."), { recursive: true });
    writeFileSync(f, "{{{");
    expect(readState(f)).toEqual({ state: DEFAULT_STATE, corrupt: true });
  });
  test("corrupt JSON WITH a backup -> the backup, still flagged corrupt", () => {
    const f = file();
    const good = { ...DEFAULT_STATE, patched_from: "0.152.1", upstream_bin: "/real/codex", launcher_restore: { kind: "symlink" as const, target: "/real/codex" } };
    writeState(f, good);
    writeFileSync(f, "{{"); // only the primary is clobbered
    const r = readState(f);
    expect(r.corrupt).toBe(true);
    expect(r.state.upstream_bin).toBe("/real/codex");
    expect(r.state.launcher_restore).toEqual({ kind: "symlink", target: "/real/codex" });
  });
  test("both files corrupt -> default + corrupt flag", () => {
    const f = file();
    writeState(f, { ...DEFAULT_STATE, patched_from: "0.152.1" });
    writeFileSync(f, "{{");
    writeFileSync(`${f}${BACKUP_SUFFIX}`, "also broken");
    expect(readState(f)).toEqual({ state: DEFAULT_STATE, corrupt: true });
  });
  test("a v1 state.json written before generations still reads unchanged", () => {
    const f = file();
    mkdirSync(join(f, ".."), { recursive: true });
    // Byte-for-byte what the owner's installed cxstatusline wrote before this change.
    writeFileSync(f, JSON.stringify({
      version: 1,
      policy: "stable-minors",
      patched_from: "0.152.1",
      upstream_bin: "/Users/o/.codex/bin/codex",
      launcher_restore: { kind: "symlink", target: "/Users/o/.codex/bin/codex" },
      last_attempt: { at: "2026-09-01T00:00:00.000Z", ok: true, version: "0.152.1" },
    }, null, 2));
    const r = readState(f);
    expect(r.corrupt).toBe(false);
    expect(r.state.patched_from).toBe("0.152.1");
    expect(r.state.launcher_restore).toEqual({ kind: "symlink", target: "/Users/o/.codex/bin/codex" });
    // Generations added no State field: the shape is exactly the v1 shape.
    expect(Object.keys(r.state).sort()).toEqual(Object.keys(DEFAULT_STATE).sort());
  });

  test("wrong shape -> default + corrupt flag; unknown keys are dropped", () => {
    const f = file();
    mkdirSync(join(f, ".."), { recursive: true });
    writeFileSync(f, JSON.stringify({ version: 7 }));
    expect(readState(f).corrupt).toBe(true);
    rmSync(`${f}${BACKUP_SUFFIX}`, { force: true });
    writeFileSync(f, JSON.stringify({ ...DEFAULT_STATE, patched_from: "0.1.0", extra: 1, policy: "stable-minors" }));
    const r = readState(f);
    expect(r.corrupt).toBe(false);
    expect(r.state.policy).toBe("stable-minors");
    expect((r.state as unknown as Record<string, unknown>).extra).toBeUndefined();
  });
});
