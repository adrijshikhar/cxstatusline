import { expect, test } from "bun:test";
import type { WidgetItem, WidgetType } from "../src/types";
import type { RenderContext } from "../src/types/RenderContext";
import { WidgetTypeSchema } from "../src/types/Widget";
import { DEFAULT_SETTINGS } from "../src/types/Settings";
import { WIDGET_MANIFEST } from "../src/utils/widget-manifest";
import { getWidget } from "../src/utils/widgets";

const now = new Date("2026-09-03T12:00:00Z");
const fullContext: RenderContext = {
  data: {
    payload_version: 1,
    model: { name: "gpt-5-codex", reasoning: "high" },
    git: { branch: "main", changes: { additions: 12, deletions: 3 }, pr: 42 },
    usage: {
      context_used: 0.25,
      context_remaining: 0.75,
      context_tokens: 50_000,
      context_window: 200_000,
      used_tokens: 51_234,
      input_tokens: 1_000,
      output_tokens: 500,
      cached_input_tokens: 250,
      five_hour: { used: 0.31, resets_at: "2026-09-03T14:00:00Z" },
      weekly: { used: 0.08, resets_at: "2026-09-08T00:00:00Z" },
    },
    session: {
      id: "0192a7f0-6c3e-7c1a-9b1e-3f5c2d1a0b9c",
      cwd: "/repo/cxstatusline",
      project_root: "/repo/cxstatusline",
      hostname: "host",
      approval_mode: "on-request",
      permissions: "workspace-write",
      run_state: "ready",
      codex_version: "0.152.1",
      started_at: "2026-09-03T11:59:50Z",
      thread_title: "Port widgets",
    },
  },
  now,
  terminalWidth: 120,
  freeMemoryBytes: 2 * 1024 ** 3,
  usageData: {
    fiveHourUsage: 31,
    fiveHourResetAt: "2026-09-03T14:00:00Z",
    weeklyUsage: 8,
    weeklyResetAt: "2026-09-08T00:00:00Z",
  },
  isPreview: false,
};

// Fields the user-defined widgets need before they render anything.
const CUSTOM_FIELDS: Partial<Record<WidgetType, Partial<WidgetItem>>> = {
  "custom-text": { customText: "[PROD]" },
  "custom-symbol": { customSymbol: "⚡" },
};
const item = (type: WidgetType, rawValue = false): WidgetItem => ({ id: type, type, rawValue, ...CUSTOM_FIELDS[type] });
const render = (type: WidgetType, context = fullContext): string | null =>
  getWidget(type).render(item(type), context, DEFAULT_SETTINGS);

test("manifest and schema contain exactly the same widget IDs", () => {
  expect(new Set(WIDGET_MANIFEST.map((entry) => entry.type))).toEqual(new Set(WidgetTypeSchema.options));
});

test("session clock uses the former block timer color by default", () => {
  expect(getWidget("session-clock").getDefaultColor()).toBe("hex:D19A66");
});

test("every non-layout catalog widget renders from a full Codex context", () => {
  for (const { type } of WIDGET_MANIFEST) {
    // custom-command spawns a process; covered with an injected runner in test/widgets/custom-command.test.ts
    if (type === "separator" || type === "flex-separator" || type === "custom-command") continue;
    expect(render(type), type).not.toBeNull();
  }
});

test("canonical widgets use Codex payload values", () => {
  expect(Object.fromEntries([
    "model", "thinking-effort", "git-branch", "git-changes", "git-review", "current-working-dir", "git-root-dir",
    "sandbox-status", "claude-session-id", "version",
  ].map((type) => [type, render(type as WidgetType)]))).toEqual({
    model: "Model: gpt-5-codex",
    "thinking-effort": "Thinking: high",
    "git-branch": "⎇ main",
    "git-changes": "(+12,-3)",
    "git-review": "PR #42",
    "current-working-dir": "cwd: /repo/cxstatusline",
    "git-root-dir": "cxstatusline",
    "sandbox-status": "SB: ●",
    "claude-session-id": "Session ID: 0192a7f0-6c3e-7c1a-9b1e-3f5c2d1a0b9c",
    version: "v0.152.1",
  });
});

test("model retains parenthetical names exactly", () => {
  const context: RenderContext = {
    ...fullContext,
    data: { payload_version: 1, model: { name: "gpt-5-codex (high)" } },
  };
  expect(render("model", context)).toBe("Model: gpt-5-codex");
});

test("project root retains backslash paths exactly", () => {
  const context: RenderContext = {
    ...fullContext,
    data: { payload_version: 1, session: { project_root: "C:\\repo\\cxstatusline" } },
  };
  expect(render("git-root-dir", context)).toBe("cxstatusline");
});

test("data widgets omit unavailable values without hiding environment widgets", () => {
  const context: RenderContext = { ...fullContext, data: { payload_version: 1 }, usageData: undefined };
  for (const type of ["model", "thinking-effort", "git-review", "tokens-input", "tokens-output", "tokens-cached", "tokens-total", "five-hour-usage", "weekly-usage", "session-name", "claude-session-id", "version", "current-working-dir", "sandbox-status"] as const) {
    expect(render(type, context), type).toBeNull();
  }
  expect(render("cache-hit-rate", context)).toBe("Cache Hit: n/a");
  expect(render("terminal-width", context)).not.toBeNull();
  expect(render("free-memory", context)).not.toBeNull();
});

test("cache hit rate uses cumulative Codex counters", () => {
  const context: RenderContext = {
    ...fullContext,
    data: { payload_version: 1, usage: { input_tokens: 1_000, cached_input_tokens: 750 } },
  };
  expect(render("cache-hit-rate", context)).toBe("Cache Hit: 75.0%");
});

test("speed is the cumulative session average", () => {
  expect(render("input-speed")).toBe("In: 100.0 t/s");
  expect(render("output-speed")).toBe("Out: 50.0 t/s");
  expect(render("total-speed")).toBe("Total: 150.0 t/s");
});

test("speed widgets omit unavailable counters instead of rendering null", () => {
  const context: RenderContext = { ...fullContext, data: { payload_version: 1, session: { started_at: fullContext.data.session?.started_at } } };
  expect(render("input-speed", context)).toBeNull();
  expect(render("output-speed", context)).toBeNull();
  expect(render("total-speed", context)).toBeNull();
});

test("git-branch, git-changes, git-root-dir each declare exactly one hideable state with key 'no-git'", () => {
  for (const type of ["git-branch", "git-changes", "git-root-dir"] as const) {
    const w = getWidget(type);
    const states = w.getHideableStates?.();
    expect(states, type).toBeDefined();
    expect(states!.length, type).toBe(1);
    expect(states![0]!.key, type).toBe("no-git");
  }
});

test("cache-hit-rate declares exactly one hideable state with key 'zero'", () => {
  const w = getWidget("cache-hit-rate");
  const states = w.getHideableStates?.();
  expect(states).toBeDefined();
  expect(states!.length).toBe(1);
  expect(states![0]!.key).toBe("zero");
});

test("git widgets with no-git state enabled and no git data render null", () => {
  const noGitContext: RenderContext = { ...fullContext, data: { payload_version: 1 } };
  for (const type of ["git-branch", "git-changes", "git-root-dir"] as const) {
    const w = getWidget(type);
    const hideItem: WidgetItem = { id: type, type, metadata: { hide: "no-git" } };
    expect(w.render(hideItem, noGitContext, DEFAULT_SETTINGS), `${type} hidden`).toBeNull();
  }
});

test("git widgets without no-git state enabled and no git data render their fallback", () => {
  const noGitContext: RenderContext = { ...fullContext, data: { payload_version: 1 } };
  for (const type of ["git-branch", "git-changes", "git-root-dir"] as const) {
    const w = getWidget(type);
    const showItem: WidgetItem = { id: type, type };
    expect(w.render(showItem, noGitContext, DEFAULT_SETTINGS), `${type} shown`).not.toBeNull();
  }
});

test("cache-hit-rate with zero state enabled and zero data renders null", () => {
  const w = getWidget("cache-hit-rate");
  const emptyContext: RenderContext = { ...fullContext, data: { payload_version: 1 } };
  const hideItem: WidgetItem = { id: "c", type: "cache-hit-rate", metadata: { hide: "zero" } };
  expect(w.render(hideItem, emptyContext, DEFAULT_SETTINGS)).toBeNull();
});

test("cache-hit-rate without zero state enabled renders 'Cache Hit: n/a'", () => {
  const w = getWidget("cache-hit-rate");
  const emptyContext: RenderContext = { ...fullContext, data: { payload_version: 1 } };
  const showItem: WidgetItem = { id: "c", type: "cache-hit-rate" };
  expect(w.render(showItem, emptyContext, DEFAULT_SETTINGS)).toBe("Cache Hit: n/a");
});
