import { describe, expect, test } from "bun:test";
import { CANONICAL_WIDGET_TYPES } from "../src/types/canonical-widget-types";

describe("canonical widget catalog", () => {
  test("contains exactly the 31 Codex-supported types in order", () => {
    const expected = [
      "separator", "flex-separator", "model", "thinking-effort",
      "git-branch", "git-changes", "git-review", "git-root-dir",
      "context-bar", "context-length", "context-window", "context-percentage",
      "context-percentage-usable", "tokens-input", "tokens-output", "tokens-cached",
      "tokens-total", "cache-hit-rate", "input-speed", "output-speed", "total-speed",
      "weekly-usage", "weekly-reset-timer",
      "session-clock", "session-name", "claude-session-id", "version",
      "current-working-dir", "sandbox-status", "terminal-width", "free-memory",
    ] as const;

    expect(CANONICAL_WIDGET_TYPES).toEqual(expected);
    expect(new Set(CANONICAL_WIDGET_TYPES).size).toBe(expected.length);
    expect(CANONICAL_WIDGET_TYPES).not.toContain("reasoning" as any);
    expect(CANONICAL_WIDGET_TYPES).not.toContain("custom-command" as any);
  });
});
