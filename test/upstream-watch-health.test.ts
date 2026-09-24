import { describe, expect, test } from "bun:test";
import { checkWatcherHeartbeat, readWatcherHeartbeat, type WatchRun } from "../scripts/upstream-watch-health";
import type { GhRunner } from "../scripts/prebuilt/gh";

const now = Date.parse("2026-09-24T12:00:00Z");
const run = (hours: number, extra: Partial<WatchRun> = {}): WatchRun => ({
  event: "schedule", status: "completed", conclusion: "success",
  updated_at: new Date(now - hours * 3_600_000).toISOString(), ...extra,
});

describe("upstream watcher watchdog", () => {
  test("accepts runs at 35 and exactly 36 hours, then fails at 37 hours", () => {
    expect(checkWatcherHeartbeat([run(35)], now).healthy).toBe(true);
    expect(checkWatcherHeartbeat([run(36)], now).healthy).toBe(true);
    expect(checkWatcherHeartbeat([run(37)], now).healthy).toBe(false);
  });

  test("requires a successful scheduled run and ignores recent manual success", () => {
    expect(checkWatcherHeartbeat([], now).healthy).toBe(false);
    expect(checkWatcherHeartbeat([run(0, { event: "workflow_dispatch" })], now).healthy).toBe(false);
    expect(checkWatcherHeartbeat([run(0, { conclusion: "failure" })], now).healthy).toBe(false);
  });

  test("checks Actions API failures instead of interpreting them as no run", () => {
    const gh: GhRunner = () => ({ status: 1, stdout: "", stderr: "forbidden" });
    expect(() => readWatcherHeartbeat(gh, "adrijshikhar/cxstatusline")).toThrow(/gh api repos\/adrijshikhar/);
  });
});
