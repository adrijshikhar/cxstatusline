import { describe, expect, test } from "bun:test";
import type { RenderContext } from "../../src/types/RenderContext";
import type { WidgetItem } from "../../src/types/Widget";
import {
  DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS, MIN_TIMEOUT_MS, RENDER_BUDGET_MS,
  describeFailure, refundBudget, resolveTimeout, spawnCommand, takeBudget,
} from "../../src/widgets/shared/command-runner";

const item = (timeout?: number): WidgetItem => ({ id: "c", type: "model", ...(timeout !== undefined && { timeout }) });
const context = (): RenderContext => ({ data: { payload_version: 1 }, now: new Date(0), terminalWidth: 80, isPreview: false });

describe("resolveTimeout", () => {
  test("defaults, clamps low and high, keeps in-range values", () => {
    expect(resolveTimeout(item())).toBe(DEFAULT_TIMEOUT_MS);
    expect(resolveTimeout(item(4000))).toBe(MAX_TIMEOUT_MS);
    expect(resolveTimeout(item(10))).toBe(MIN_TIMEOUT_MS);
    expect(resolveTimeout(item(450))).toBe(450);
  });
});

describe("takeBudget and refundBudget", () => {
  test("is shared per render context and independent across contexts", () => {
    const a = context();
    const b = context();
    expect(takeBudget(a, 250)).toBe(250);
    expect(takeBudget(a, 600)).toBe(RENDER_BUDGET_MS - 250);
    expect(takeBudget(a, 100)).toBe(0);
    expect(takeBudget(b, 600)).toBe(RENDER_BUDGET_MS);
  });

  test("refundBudget adds unused time back, capping at RENDER_BUDGET_MS", () => {
    const c = context();
    expect(takeBudget(c, 400)).toBe(400);
    refundBudget(c, 150);
    expect(takeBudget(c, 600)).toBe(350);
    refundBudget(c, 1000);
    expect(takeBudget(c, 600)).toBe(RENDER_BUDGET_MS);
  });
});

describe("describeFailure", () => {
  const ok = { status: 0, signal: null, stdout: "x" } as const;
  test("maps results to upstream tokens", () => {
    expect(describeFailure(ok, false)).toBeNull();
    expect(describeFailure({ ...ok, errorCode: "ETIMEDOUT", signal: "SIGKILL", status: null }, true)).toBe("[Timeout]");
    expect(describeFailure({ ...ok, signal: "SIGKILL", status: null }, false)).toBe("[Signal: SIGKILL]");
    expect(describeFailure({ ...ok, signal: "SIGKILL", status: null }, true)).toBe("[Timeout]");
    expect(describeFailure({ ...ok, status: 127 }, false)).toBe("[Cmd not found]");
    expect(describeFailure({ ...ok, errorCode: "ENOENT", status: null }, false)).toBe("[Cmd not found]");
    expect(describeFailure({ ...ok, errorCode: "EACCES", status: null }, false)).toBe("[Permission denied]");
    expect(describeFailure({ ...ok, errorCode: "ENOBUFS", signal: "SIGKILL", status: null }, false)).toBe("[Error]");
    expect(describeFailure({ ...ok, signal: "SIGTERM", status: null }, false)).toBe("[Signal: SIGTERM]");
    expect(describeFailure({ ...ok, status: 3 }, false)).toBe("[Exit: 3]");
    expect(describeFailure({ ...ok, status: null }, false)).toBe("[Error]");
  });
});

describe.skipIf(process.platform === "win32")("spawnCommand", () => {
  test("runs through the shell, pipes stdin, returns stdout", () => {
    const result = spawnCommand({ command: "cat", input: '{"a":1}', timeoutMs: 500 });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('{"a":1}');
  });

  test("reports exit status and command-not-found", () => {
    expect(spawnCommand({ command: "exit 3", input: "", timeoutMs: 500 }).status).toBe(3);
    expect(spawnCommand({ command: "cxstatusline-no-such-command-xyz", input: "", timeoutMs: 500 }).status).toBe(127);
  });

  test("kills on timeout", () => {
    const result = spawnCommand({ command: "sleep 5", input: "", timeoutMs: MIN_TIMEOUT_MS });
    expect(describeFailure(result, true)).toBe("[Timeout]");
  });

  test("honours cwd", () => {
    const result = spawnCommand({ command: "pwd", input: "", timeoutMs: 500, cwd: "/" });
    expect(result.stdout.trim()).toBe("/");
  });
});
