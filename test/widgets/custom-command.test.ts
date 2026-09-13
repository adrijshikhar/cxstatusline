import { describe, expect, test } from "bun:test";
import { DEFAULT_SETTINGS } from "../../src/types/Settings";
import type { RenderContext } from "../../src/types/RenderContext";
import type { WidgetItem } from "../../src/types/Widget";
import { CustomCommandWidget, truncateCommand } from "../../src/widgets/CustomCommand";
import { firstLine } from "../../src/widgets/shared/cached-command";
import type { CommandRequest, CommandResult, CommandRunner } from "../../src/widgets/shared/command-runner";
import { DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS, RENDER_BUDGET_MS } from "../../src/widgets/shared/command-runner";

function fakeRunner(script: (request: CommandRequest) => Partial<CommandResult>): { runner: CommandRunner; calls: CommandRequest[] } {
  const calls: CommandRequest[] = [];
  const runner: CommandRunner = (request) => {
    calls.push(request);
    const r = script(request);
    return { status: r.status ?? 0, signal: r.signal ?? null, stdout: r.stdout ?? "", errorCode: r.errorCode };
  };
  return { runner, calls };
}

const live = (): RenderContext => ({
  data: { payload_version: 1, model: { name: "gpt-5-codex" }, session: { cwd: "/repo/project" } },
  now: new Date(0),
  terminalWidth: 100,
  isPreview: false,
});
const item = (overrides: Partial<WidgetItem> = {}): WidgetItem => ({ id: "c", type: "custom-command", commandPath: "date", ...overrides });

describe("firstLine", () => {
  test("returns the first visibly non-empty line, trimmed", () => {
    expect(firstLine("  a  \nb\n")).toBe("a");
    expect(firstLine("\n\x1b[0m\n  second\nthird")).toBe("second");
    expect(firstLine("\r\n\r\n")).toBe("");
  });
});

describe("CustomCommandWidget.render", () => {
  test("passes the payload plus terminal_width on stdin, the session cwd, and the clamped timeout", () => {
    const { runner, calls } = fakeRunner(() => ({ stdout: "ok\n" }));
    expect(new CustomCommandWidget(runner).render(item({ timeout: 4000 }), live(), DEFAULT_SETTINGS)).toBe("ok");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.command).toBe("date");
    expect(calls[0]!.cwd).toBe("/repo/project");
    expect(calls[0]!.timeoutMs).toBe(MAX_TIMEOUT_MS);
    expect(JSON.parse(calls[0]!.input)).toEqual({ payload_version: 1, model: { name: "gpt-5-codex" }, session: { cwd: "/repo/project" }, terminal_width: 100 });
  });

  test("omits terminal_width and cwd when unknown and uses the default timeout", () => {
    const { runner, calls } = fakeRunner(() => ({ stdout: "ok" }));
    const context: RenderContext = { ...live(), terminalWidth: null, data: { payload_version: 1 } };
    new CustomCommandWidget(runner).render(item(), context, DEFAULT_SETTINGS);
    expect(calls[0]!.cwd).toBeUndefined();
    expect(calls[0]!.timeoutMs).toBe(DEFAULT_TIMEOUT_MS);
    expect(JSON.parse(calls[0]!.input)).toEqual({ payload_version: 1 });
  });

  test("keeps only the first line and applies maxWidth with an ellipsis", () => {
    const { runner } = fakeRunner(() => ({ stdout: "first line is long\nsecond\n" }));
    expect(new CustomCommandWidget(runner).render(item({ maxWidth: 8 }), live(), DEFAULT_SETTINGS)).toBe("first...");
  });

  test("strips ANSI unless preserveColors, then keeps SGR only", () => {
    const stdout = "\x1b[31mred\x1b[0m \x1b]8;;http://x\x1b\\link\x1b]8;;\x1b\\\x07\n";
    const { runner } = fakeRunner(() => ({ stdout }));
    const widget = new CustomCommandWidget(runner);
    expect(widget.render(item(), live(), DEFAULT_SETTINGS)).toBe("red link");
    expect(widget.render(item({ preserveColors: true }), live(), DEFAULT_SETTINGS)).toBe("\x1b[31mred\x1b[0m link");
  });

  test("returns null for empty output, unset command, and never executes in preview", () => {
    const { runner, calls } = fakeRunner(() => ({ stdout: "\n\n" }));
    const widget = new CustomCommandWidget(runner);
    expect(widget.render(item(), live(), DEFAULT_SETTINGS)).toBeNull();
    expect(widget.render(item({ commandPath: undefined }), live(), DEFAULT_SETTINGS)).toBeNull();
    const before = calls.length;
    expect(truncateCommand("git status -s | wc -l")).toBe("git status -s | w...");
    expect(truncateCommand("short")).toBe("short");
    expect(widget.render(item({ commandPath: "git status -s | wc -l" }), { ...live(), isPreview: true }, DEFAULT_SETTINGS)).toBe("[cmd: git status -s | wc -...]");
    expect(widget.render(item({ commandPath: "date" }), { ...live(), isPreview: true }, DEFAULT_SETTINGS)).toBe("[cmd: date]");
    expect(widget.render(item({ commandPath: undefined }), { ...live(), isPreview: true }, DEFAULT_SETTINGS)).toBe("[No command]");
    expect(calls.length).toBe(before);
  });

  test("renders diagnostic tokens for failures", () => {
    const widget = (r: Partial<CommandResult>) => new CustomCommandWidget(fakeRunner(() => r).runner);
    expect(widget({ status: 3 }).render(item(), live(), DEFAULT_SETTINGS)).toBe("[Exit: 3]");
    expect(widget({ status: 127 }).render(item(), live(), DEFAULT_SETTINGS)).toBe("[Cmd not found]");
    expect(widget({ status: null, signal: "SIGKILL", errorCode: "ETIMEDOUT" }).render(item(), live(), DEFAULT_SETTINGS)).toBe("[Timeout]");
    expect(widget({ status: null, signal: "SIGKILL" }).render(item(), live(), DEFAULT_SETTINGS)).toBe("[Signal: SIGKILL]");
  });

  test("shares one budget across the commands of a render and refunds unused time", () => {
    const { runner, calls } = fakeRunner(() => ({ stdout: "ok" }));
    const widget = new CustomCommandWidget(runner);
    const context = live();
    expect(widget.render(item({ timeout: 4000 }), context, DEFAULT_SETTINGS)).toBe("ok");
    expect(widget.render(item({ timeout: 2000 }), context, DEFAULT_SETTINGS)).toBe("ok");
    expect(widget.render(item(), context, DEFAULT_SETTINGS)).toBe("ok");
    expect(calls).toHaveLength(3);
  });

  test("deducts elapsed time from shared budget", () => {
    const { runner, calls } = fakeRunner(() => {
      const start = performance.now();
      while (performance.now() - start < 120) {}
      return { stdout: "ok" };
    });
    const widget = new CustomCommandWidget(runner);
    const context = live();
    expect(widget.render(item({ timeout: 600 }), context, DEFAULT_SETTINGS)).toBe("ok");
    expect(widget.render(item({ timeout: 600 }), context, DEFAULT_SETTINGS)).toBe("ok");
    expect(calls).toHaveLength(2);
    expect(calls[1]!.timeoutMs).toBeGreaterThanOrEqual(RENDER_BUDGET_MS - 140);
    expect(calls[1]!.timeoutMs).toBeLessThanOrEqual(RENDER_BUDGET_MS - 100);
  });
});

describe("CustomCommandWidget editor surface", () => {
  const widget = new CustomCommandWidget(fakeRunner(() => ({})).runner);

  test("display text, modifiers and keys match the spec", () => {
    expect(widget.getEditorDisplay(item())).toEqual({ displayText: "Custom Command (date)", modifierText: undefined });
    expect(widget.getEditorDisplay(item({ timeout: 300 }))).toEqual({ displayText: "Custom Command (date)", modifierText: undefined });
    expect(widget.getEditorDisplay(item({ refreshMs: 5000 }))).toEqual({ displayText: "Custom Command (date)", modifierText: "(refresh: 5000ms)" });
    expect(widget.getEditorDisplay(item({ commandPath: "git status --short | wc -l", maxWidth: 12, timeout: 4000, refreshMs: 2500, preserveColors: true })))
      .toEqual({ displayText: "Custom Command (git status --shor...)", modifierText: "(max:12, timeout:600ms, refresh: 2500ms, preserve)" });
    expect(widget.getEditorDisplay(item({ commandPath: undefined }))).toEqual({ displayText: "Custom Command (No command)", modifierText: undefined });
    expect(widget.getCustomKeybinds().map((k) => [k.key, k.action])).toEqual([
      ["e", "edit-command"], ["w", "edit-max-width"], ["t", "edit-timeout"], ["f", "edit-refresh"], ["p", "toggle-preserve"],
    ]);
  });

  test("custom-command keybinds are disjoint from items-editor reserved keys", () => {
    const reservedKeys = new Set(["a", "i", "d", "k", "c", " ", "r", "m", "x"]);
    for (const kb of widget.getCustomKeybinds()) {
      expect(reservedKeys.has(kb.key)).toBe(false);
    }
  });

  test("toggle-preserve is immediate; other actions open an editor", () => {
    expect(widget.handleEditorAction("toggle-preserve", item())).toEqual(item({ preserveColors: true }));
    expect(widget.handleEditorAction("toggle-preserve", item({ preserveColors: true }))).toEqual(item({ preserveColors: false }));
    expect(widget.handleEditorAction("edit-command", item())).toBeNull();
    expect(widget.handleEditorAction("edit-timeout", item())).toBeNull();
    expect(widget.handleEditorAction("edit-refresh", item())).toBeNull();
  });

  test("flags", () => {
    expect(widget.getCategory()).toBe("Custom");
    expect(widget.getDefaultColor()).toBe("white");
    expect(widget.supportsRawValue()).toBe(false);
    expect(widget.supportsColors(item())).toBe(true);
    expect(widget.supportsColors(item({ preserveColors: true }))).toBe(false);
    expect(widget.emitsStyledOutput(item())).toBe(false);
    expect(widget.emitsStyledOutput(item({ preserveColors: true }))).toBe(true);
  });
});
