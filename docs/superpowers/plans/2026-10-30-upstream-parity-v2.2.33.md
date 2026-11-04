# Upstream Parity v2.2.33 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port upstream features, bug fixes, performance optimizations, and TUI enhancements from `sirmalloc/ccstatusline` v2.2.33 (commit `c78cc4d8107d095c4798f0d8e87671dd4f6ee2e6`) into `cxstatusline` while preserving OpenAI Codex session telemetry and runtime compatibility.

**Architecture:**
1. Core utilities and ANSI/terminal sanitization are updated to parse 8-bit C1 sequences into standard 7-bit representations and eliminate invalid fallback color names (`gray` -> `brightBlack`).
2. Widget improvements (clickable CWD links, memory rounding boundary rollover, GitBranch fish-style and JJ detached HEAD handling, and usage remaining-mode time cursor) are ported with unit tests.
3. Powerline and Renderer improvements (preserving manual separators on toggle, ending merges at hidden unmerged widgets, and Shift+Tab bulk glyph blanking) are ported to Ink components and renderer modules.
4. TUI enhancements (windowed widget picker with live statusline preview and dynamic default terminal width labeling) are integrated.
5. Baseline tracking (`scripts/upstream-ccstatusline.json`), legal notices (`NOTICE`), and baseline tests are bumped to `c78cc4d8107d095c4798f0d8e87671dd4f6ee2e6`.

**Tech Stack:** TypeScript, Bun (`bun:test`), React/Ink, Node APIs (`node:fs`, `node:child_process`, `node:path`), Git / JJ CLI.

**Spec:** Issue [#157](https://github.com/adrijshikhar/cxstatusline/issues/157) & `.agents/skills/port-cc-to-cx/SKILL.md`.

## Global Constraints

- Never push directly to `main`; all development must reside on `.worktrees/feat/port-upstream-v2.2.33` on branch `feat/port-upstream-v2.2.33`.
- Retain existing Codex session telemetry models in `RenderContext.data.session`.
- Preserve `CXSTATUSLINE_*` environment variables with `CCSTATUSLINE_*` backward compatibility fallback.
- Retain strict MIT license attribution in `NOTICE` for newly derived upstream components.
- Keep `CANONICAL_WIDGET_TYPES` aligned with the 37 Codex-supported widget types.
- Verification gates must all pass: `bun test ./test ./src && bun run typecheck && bun run build && bun run check:package`.

---

## Tasks

### Task 1: ANSI, Color & Terminal Sanitization Hardening

**Files:**
- Modify: `src/utils/ansi.ts`
- Modify: `src/utils/terminal-sanitize.ts`
- Modify: `src/utils/renderer.ts`
- Modify: `src/widgets/GitSha.ts`
- Modify: `src/widgets/TerminalWidth.ts`
- Modify: `src/widgets/Version.ts`
- Test: `test/utils/ansi-8bit.test.ts`
- Test: `test/utils/default-colors.test.ts`

**Interfaces:**
- Consumes: `stripSgrCodes`, `sanitizeTerminalText`, `sgrClearsBackground`
- Produces: 8-bit C1 SGR/OSC sanitization to 7-bit, `brightBlack` default color replacement for invalid `gray`

- [ ] **Step 1: Write failing tests for 8-bit escape sequences and default colors**

```typescript
// test/utils/ansi-8bit.test.ts
import { describe, expect, it } from "bun:test";
import { stripSgrCodes } from "../../src/utils/ansi";
import { sanitizeTerminalText } from "../../src/utils/terminal-sanitize";

describe("8-bit ANSI and C1 control sanitization", () => {
  it("strips 8-bit CSI color sequences", () => {
    const text = "\x9b31mred\x9b0m";
    expect(stripSgrCodes(text)).toBe("red");
  });

  it("converts 8-bit C1 color codes to 7-bit in sanitizeTerminalText", () => {
    const text = "\x9b31mred\x9b39m";
    expect(sanitizeTerminalText(text)).toBe("\x1b[31mred\x1b[39m");
  });

  it("drops hazardous 8-bit sequences whole while keeping text", () => {
    const text = "safe\x9d8;;https://example.com\x9cpayload\x9d8;;\x9cmore";
    expect(sanitizeTerminalText(text)).toBe("safe\x1b]8;;https://example.com\x1b\\payload\x1b]8;;\x1b\\more");
  });
});
```

```typescript
// test/utils/default-colors.test.ts
import { describe, expect, it } from "bun:test";
import { COLOR_MAP } from "../../src/utils/colors";
import { TerminalWidthWidget } from "../../src/widgets/TerminalWidth";
import { VersionWidget } from "../../src/widgets/Version";

describe("default widget colors", () => {
  it("uses brightBlack instead of unmapped gray", () => {
    const known = new Set(COLOR_MAP.map((c) => c.name));
    const termWidth = new TerminalWidthWidget();
    const version = new VersionWidget();
    expect(known.has(termWidth.getDefaultColor())).toBe(true);
    expect(termWidth.getDefaultColor()).toBe("brightBlack");
    expect(known.has(version.getDefaultColor())).toBe(true);
    expect(version.getDefaultColor()).toBe("brightBlack");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd .worktrees/feat/port-upstream-v2.2.33 && bun test ./test/utils/ansi-8bit.test.ts ./test/utils/default-colors.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement 8-bit handling in `ansi.ts`, `terminal-sanitize.ts`, and `brightBlack` defaults**

In `src/utils/ansi.ts`:
Update `SGR_REGEX = /(?:\x1b\[|\x9b)[0-9;]*m/g;` and update `sgrClearsBackground` to check `sequence.startsWith('\x9b') ? 1 : 2`.

In `src/utils/terminal-sanitize.ts`:
Add `C1_INTRODUCERS` map (`\x90` -> `P`, `\x98` -> `X`, `\x9b` -> `[`, `\x9d` -> `]`, `\x9e` -> `^`, `\x9f` -> `_`), convert to 7-bit representations, and update regexes to match `\x9b` and `\x9d`.

In `src/utils/renderer.ts`, `src/widgets/TerminalWidth.ts`, `src/widgets/Version.ts`:
Replace fallback `'gray'` with `'brightBlack'`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd .worktrees/feat/port-upstream-v2.2.33 && bun test ./test/utils/ansi-8bit.test.ts ./test/utils/default-colors.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/ansi.ts src/utils/terminal-sanitize.ts src/utils/renderer.ts src/widgets/TerminalWidth.ts src/widgets/Version.ts test/utils/ansi-8bit.test.ts test/utils/default-colors.test.ts
git commit -m "fix: keep 8-bit color codes, strip them, and fix unknown color gray fallback"
```

---

### Task 2: Text Cursor Bar & Blinking Cursor

**Files:**
- Create: `src/widgets/shared/BlinkingCursor.tsx`
- Create: `src/widgets/shared/cursor-blink.ts`
- Modify: `src/widgets/shared/text-cursor.ts`
- Test: `test/widgets/cursor-blink.test.tsx`

**Interfaces:**
- Consumes: Ink `Text`, `useInput`
- Produces: `BlinkingCursor` component, `useCursorBlink` hook, `renderTextWithCursor({ text, cursor }, visible)`

- [ ] **Step 1: Write failing test for text cursor blink and rendering**

```typescript
// test/widgets/cursor-blink.test.tsx
import { describe, expect, it } from "bun:test";
import { renderTextWithCursor } from "../../src/widgets/shared/text-cursor";

describe("renderTextWithCursor", () => {
  it("renders cursor at end of text with visible toggle", () => {
    const text = "hello";
    const visible = renderTextWithCursor({ text, cursor: 5 }, true);
    expect(visible).toBe("hello\x1b[7m \x1b[27m");

    const hidden = renderTextWithCursor({ text, cursor: 5 }, false);
    expect(hidden).toBe("hello ");
  });

  it("renders cursor within text with visible toggle", () => {
    const text = "ab";
    const visible = renderTextWithCursor({ text, cursor: 1 }, true);
    expect(visible).toBe("a\x1b[7mb\x1b[27m");

    const hidden = renderTextWithCursor({ text, cursor: 1 }, false);
    expect(hidden).toBe("ab");
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `cd .worktrees/feat/port-upstream-v2.2.33 && bun test ./test/widgets/cursor-blink.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implement `BlinkingCursor.tsx`, `cursor-blink.ts`, and update `text-cursor.ts`**

Port `BlinkingCursor.tsx` and `cursor-blink.ts` from upstream commit `cac366b`.
Update `renderTextWithCursor` in `src/widgets/shared/text-cursor.ts` to accept `visible = true`.

- [ ] **Step 4: Run test to verify success**

Run: `cd .worktrees/feat/port-upstream-v2.2.33 && bun test ./test/widgets/cursor-blink.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/widgets/shared/BlinkingCursor.tsx src/widgets/shared/cursor-blink.ts src/widgets/shared/text-cursor.ts test/widgets/cursor-blink.test.tsx
git commit -m "feat(tui): draw text cursor as bar and add blinking cursor hook"
```

---

### Task 3: Memory Formatting & Context Window Percentage Calculation

**Files:**
- Modify: `src/widgets/FreeMemory.ts`
- Modify: `src/utils/context-window.ts`
- Test: `test/widgets/free-memory-rounding.test.ts`
- Test: `test/widgets/context-percentage.test.ts`

**Interfaces:**
- Consumes: `renderMagnitude`, `resolveNumberFormat`, `getContextWindowMetrics`
- Produces: Proper unit promotion rollover for memory, exclusion of output tokens from used percentage calculation

- [ ] **Step 1: Write failing test for FreeMemory rollover and Context Window calculation**

```typescript
// test/widgets/free-memory-rounding.test.ts
import { describe, expect, it } from "bun:test";
import { FreeMemoryWidget } from "../../src/widgets/FreeMemory";
import { DEFAULT_SETTINGS } from "../../src/types/Settings";

describe("FreeMemory unit rollover", () => {
  it("promotes to next unit when rounded value reaches 1024", () => {
    const widget = new FreeMemoryWidget();
    // 1023.6 MB used -> should display as 1.0G, not 1024M
    const item = { id: "mem", type: "free-memory" as const, rawValue: true };
    const context = {
      data: {
        memory: {
          totalBytes: 2 * 1024 ** 3,
          freeBytes: 2 * 1024 ** 3 - 1023.6 * 1024 ** 2,
        },
      },
    };
    const rendered = widget.render(item, context as any, DEFAULT_SETTINGS);
    expect(rendered).toContain("1.0G");
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `cd .worktrees/feat/port-upstream-v2.2.33 && bun test ./test/widgets/free-memory-rounding.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement memory rollover in `FreeMemory.ts` and context percentage in `context-window.ts`**

In `src/widgets/FreeMemory.ts`:
Calculate `rollover = 1024 - 0.5 / 10 ** effectiveDecimals(format, 0)`.
Promote `bytes >= MB * rollover` to GB and `bytes >= KB * rollover` to MB.

In `src/utils/context-window.ts`:
Compute `percentageTokens = contextLengthTokens ?? usedTokens;` so output tokens are not included in `usedPercentage`.

- [ ] **Step 4: Run test to verify success**

Run: `cd .worktrees/feat/port-upstream-v2.2.33 && bun test ./test/widgets/free-memory-rounding.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/widgets/FreeMemory.ts src/utils/context-window.ts test/widgets/free-memory-rounding.test.ts
git commit -m "fix(memory): promote to next unit before rounding up to 1024 and align context percentage"
```

---

### Task 4: Jujutsu & Git Enhancements

**Files:**
- Modify: `src/widgets/GitBranch.ts`
- Modify: `src/utils/git.ts`
- Modify: `src/utils/jj.ts`
- Test: `test/widgets/git-branch-jj.test.ts`
- Test: `test/utils/jj-diff-stat.test.ts`

**Interfaces:**
- Consumes: `isInsideJjRepo`, `runGit`, `parseDiffStat`
- Produces: `isColocatedJjRepo`, fish-style Git branch abbreviation, Git cache TTL timestamped after execution

- [ ] **Step 1: Write failing tests for JJ detached HEAD and JJ diff parsing**

```typescript
// test/utils/jj-diff-stat.test.ts
import { describe, expect, it } from "bun:test";
import { getJjChangeCounts } from "../../src/utils/jj";

describe("getJjChangeCounts parsing", () => {
  it("ignores insertion counts in filenames preceding summary", () => {
    const stat = "777 insertions.txt | 1 +\n1 file changed, 1 insertion(+), 0 deletions(-)\n";
    // Mock runJj or call parseDiffStat directly if exported
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `cd .worktrees/feat/port-upstream-v2.2.33 && bun test ./test/utils/jj-diff-stat.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement JJ detached HEAD check, fish-style branch, git cache TTL, and JJ stat parsing**

In `src/widgets/GitBranch.ts`:
Add `isColocatedJjRepo` check on detached HEAD.
Add fish-style branch abbreviation (`toggle-fish-style`, `key: 'f'`).

In `src/utils/git.ts`:
Set cache entry timestamp to `Date.now()` after `execGit` completes.

In `src/utils/jj.ts`:
Parse `parseDiffStat` strictly on `stat.split('\n').pop()`.

- [ ] **Step 4: Run tests to verify success**

Run: `cd .worktrees/feat/port-upstream-v2.2.33 && bun test ./test/utils/jj-diff-stat.test.ts ./test/git-utils.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/widgets/GitBranch.ts src/utils/git.ts src/utils/jj.ts test/utils/jj-diff-stat.test.ts
git commit -m "fix(git-branch): treat colocated jj detached HEAD as no branch and parse jj diff summary"
```

---

### Task 5: Clickable Current Working Dir Links

**Files:**
- Modify: `src/utils/hyperlink.ts`
- Modify: `src/widgets/CurrentWorkingDir.tsx`
- Test: `test/utils/hyperlink-file.test.ts`
- Test: `test/widgets/current-working-dir-links.test.ts`

**Interfaces:**
- Consumes: `isSafeHyperlinkUrl`, `renderOsc8Link`
- Produces: `buildFileUrl`, `buildIdeFileUrl`, `cycle-link` action in `CurrentWorkingDir`

- [ ] **Step 1: Write failing tests for file URLs and CWD links**

```typescript
// test/utils/hyperlink-file.test.ts
import { describe, expect, it } from "bun:test";
import { buildFileUrl, buildIdeFileUrl } from "../../src/utils/hyperlink";

describe("buildFileUrl and buildIdeFileUrl", () => {
  it("builds file:// URLs for posix paths", () => {
    expect(buildFileUrl("/usr/local/bin")).toBe("file:///usr/local/bin");
  });

  it("builds vscode:// and cursor:// URLs", () => {
    expect(buildIdeFileUrl("/home/user/code", "vscode")).toBe("vscode://file/home/user/code");
    expect(buildIdeFileUrl("/home/user/code", "cursor")).toBe("cursor://file/home/user/code");
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `cd .worktrees/feat/port-upstream-v2.2.33 && bun test ./test/utils/hyperlink-file.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `buildFileUrl`, `buildIdeFileUrl` and link cycling in `CurrentWorkingDir.tsx`**

In `src/utils/hyperlink.ts`:
Implement `buildFileUrl`, `buildIdeFileUrl`, `encodeUncHost`, `encodeFilePathForUri`.

In `src/widgets/CurrentWorkingDir.tsx`:
Add `l` hotkey (`cycle-link` cycling `off` -> `file` -> `vscode` -> `cursor`).
Wrap rendered output in `renderOsc8Link` targeting the full absolute path.

- [ ] **Step 4: Run tests to verify success**

Run: `cd .worktrees/feat/port-upstream-v2.2.33 && bun test ./test/utils/hyperlink-file.test.ts ./test/widgets/current-working-dir.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/hyperlink.ts src/widgets/CurrentWorkingDir.tsx test/utils/hyperlink-file.test.ts
git commit -m "feat: add clickable Current Working Dir links (file, VS Code, Cursor)"
```

---

### Task 6: Powerline & Renderer Merge Boundary Fixes

**Files:**
- Modify: `src/utils/renderer.ts`
- Modify: `src/utils/separator-index.ts`
- Modify: `src/utils/powerline-theme-index.ts`
- Modify: `src/utils/powerline-settings.ts`
- Modify: `src/tui/components/PowerlineSetup.tsx`
- Modify: `src/widgets/shared/symbol-override.tsx`
- Test: `test/renderer-merge.test.ts`
- Test: `test/powerline-settings-preserve.test.ts`

**Interfaces:**
- Consumes: `advanceSeparatorSlots`, `countSeparatorSlots`, `assignPowerlineThemeSlots`
- Produces: Preservation of manual separators in Powerline toggle, ending merge at hidden unmerged widgets, Shift+Tab bulk glyph toggle

- [ ] **Step 1: Write failing test for separator preservation on Powerline toggle**

```typescript
// test/powerline-settings-preserve.test.ts
import { describe, expect, it } from "bun:test";
import { buildEnabledPowerlineSettings } from "../../src/utils/powerline-settings";
import { DEFAULT_SETTINGS } from "../../src/types/Settings";

describe("buildEnabledPowerlineSettings", () => {
  it("keeps manual separators in config when enabling Powerline", () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      lines: [[
        { id: "1", type: "model" as const },
        { id: "2", type: "separator" as const },
        { id: "3", type: "context-length" as const },
      ]],
    };
    const updated = buildEnabledPowerlineSettings(settings);
    expect(updated.lines[0]?.map((i) => i.type)).toEqual(["model", "separator", "context-length"]);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `cd .worktrees/feat/port-upstream-v2.2.33 && bun test ./test/powerline-settings-preserve.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement merge termination at hidden widgets and separator preservation**

In `src/utils/separator-index.ts` and `src/utils/powerline-theme-index.ts`:
Refactor slot advancement to `advanceSeparatorSlots` and drop pending merges when skipping empty widgets that are not merged onward.

In `src/utils/powerline-settings.ts` and `src/tui/components/PowerlineSetup.tsx`:
Remove manual separator deletion in `buildEnabledPowerlineSettings`.

In `src/widgets/shared/symbol-override.tsx`:
Add `Shift+Tab` handler to toggle all symbols between blank and default.

- [ ] **Step 4: Run tests to verify success**

Run: `cd .worktrees/feat/port-upstream-v2.2.33 && bun test ./test/powerline-settings-preserve.test.ts ./test/renderer-separator-collapse.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/renderer.ts src/utils/separator-index.ts src/utils/powerline-theme-index.ts src/utils/powerline-settings.ts src/tui/components/PowerlineSetup.tsx src/widgets/shared/symbol-override.tsx test/powerline-settings-preserve.test.ts
git commit -m "fix(renderer): end merge at hidden widget and preserve manual separators on powerline toggle"
```

---

### Task 7: TUI Enhancements & Live Widget Picker Preview

**Files:**
- Create: `src/tui/components/items-editor/list-window.ts`
- Create: `src/tui/components/items-editor/picker-selection.ts`
- Modify: `src/tui/components/TerminalWidthMenu.tsx`
- Modify: `src/tui/components/ItemsEditor.tsx`
- Modify: `src/tui/App.tsx`
- Test: `test/tui-list-window.test.ts`
- Test: `test/tui-terminal-width.test.ts`

**Interfaces:**
- Consumes: `getListWindow`, `placePickerSelection`
- Produces: Windowed widget picker with live status line preview, dynamic `DEFAULT_SETTINGS.flexMode` default marking

- [ ] **Step 1: Write failing test for list-window helper**

```typescript
// test/tui-list-window.test.ts
import { describe, expect, it } from "bun:test";
import { getListWindow } from "../../src/tui/components/items-editor/list-window";

describe("getListWindow", () => {
  it("keeps selection centered within visible window", () => {
    const window = getListWindow(20, 10, 5);
    expect(window.start).toBe(8);
    expect(window.end).toBe(13);
    expect(window.hiddenAbove).toBe(8);
    expect(window.hiddenBelow).toBe(7);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `cd .worktrees/feat/port-upstream-v2.2.33 && bun test ./test/tui-list-window.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement list-window, picker-selection, and TerminalWidthMenu updates**

Port `list-window.ts` and `picker-selection.ts`.
Update `ItemsEditor.tsx` to use `renderWindowedList` and trigger `onPreviewChange`.
In `TerminalWidthMenu.tsx`: use `DEFAULT_SETTINGS.flexMode` to mark `(default)` and document 6 reserved columns.

- [ ] **Step 4: Run tests to verify success**

Run: `cd .worktrees/feat/port-upstream-v2.2.33 && bun test ./test/tui-list-window.test.ts ./test/tui/components/__tests__/TerminalWidthMenu.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/tui/components/items-editor/list-window.ts src/tui/components/items-editor/picker-selection.ts src/tui/components/TerminalWidthMenu.tsx src/tui/components/ItemsEditor.tsx src/tui/App.tsx test/tui-list-window.test.ts
git commit -m "feat(tui): live preview highlighted widget in picker and dynamic default flexMode label"
```

---

### Task 8: Usage Metrics Time Cursor Alignment

**Files:**
- Modify: `src/widgets/FiveHourUsage.ts`
- Modify: `src/widgets/WeeklyUsage.ts`
- Test: `test/widgets/usage-cursor-remaining.test.ts`

**Interfaces:**
- Consumes: `resolveUsageWindowWithFallback`, `makeSliderBar`
- Produces: Time cursor aligned to `window.remainingPercent` when `invert: 'true'`

- [ ] **Step 1: Write failing test for usage cursor in inverted/remaining mode**

```typescript
// test/widgets/usage-cursor-remaining.test.ts
import { describe, expect, it } from "bun:test";
import { FiveHourUsageWidget } from "../../src/widgets/FiveHourUsage";
import { DEFAULT_SETTINGS } from "../../src/types/Settings";

describe("FiveHourUsage time cursor in remaining mode", () => {
  it("positions cursor at time left when inverted", () => {
    const widget = new FiveHourUsageWidget();
    const item = {
      id: "5h",
      type: "five-hour-usage" as const,
      metadata: { cursor: "true", display: "slider", invert: "true" },
    };
    const context = {
      data: {
        session: {
          rateLimits: {
            fiveHour: {
              usedPercentage: 30,
              resetsAt: new Date(Date.now() + 14400000).toISOString(),
            },
          },
        },
      },
    };
    const rendered = widget.render(item, context as any, DEFAULT_SETTINGS);
    expect(rendered).toContain("│");
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `cd .worktrees/feat/port-upstream-v2.2.33 && bun test ./test/widgets/usage-cursor-remaining.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement inverted time cursor positioning in `FiveHourUsage.ts` and `WeeklyUsage.ts`**

In `FiveHourUsage.ts` and `WeeklyUsage.ts`:
When `invert` is enabled, set `cursorPercent: window.remainingPercent` instead of `window.elapsedPercent`.

- [ ] **Step 4: Run test to verify success**

Run: `cd .worktrees/feat/port-upstream-v2.2.33 && bun test ./test/widgets/usage-cursor-remaining.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/widgets/FiveHourUsage.ts src/widgets/WeeklyUsage.ts test/widgets/usage-cursor-remaining.test.ts
git commit -m "fix(usage): put time cursor at time left in remaining mode"
```

---

### Task 9: Upstream Baseline, NOTICE Legal Attribution & Full Verification

**Files:**
- Modify: `scripts/upstream-ccstatusline.json`
- Modify: `test/upstream-ccstatusline.test.ts`
- Modify: `NOTICE`

**Interfaces:**
- Consumes: Baseline commit hash `c78cc4d8107d095c4798f0d8e87671dd4f6ee2e6`
- Produces: Updated baseline tracking, license attribution for v2.2.33, complete verified build

- [ ] **Step 1: Update baseline configuration and tests**

In `scripts/upstream-ccstatusline.json`:
Set `"baseCommit": "c78cc4d8107d095c4798f0d8e87671dd4f6ee2e6"`.

In `test/upstream-ccstatusline.test.ts`:
Update `expect(config.baseCommit).toBe("c78cc4d8107d095c4798f0d8e87671dd4f6ee2e6")`.

In `NOTICE`:
Update commit hash and file paths to document derivation from `c78cc4d8107d095c4798f0d8e87671dd4f6ee2e6` (v2.2.33).

- [ ] **Step 2: Run full verification suite**

```bash
bun test ./test ./src && bun run typecheck && bun run build && bun run check:package
```
Expected: 0 errors, all tests pass.

- [ ] **Step 3: Commit and open Pull Request**

```bash
git add scripts/upstream-ccstatusline.json test/upstream-ccstatusline.test.ts NOTICE docs/superpowers/plans/2026-10-30-upstream-parity-v2.2.33.md
git commit -m "feat: port upstream ccstatusline v2.2.33 parity"
```
