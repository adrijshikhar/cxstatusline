# Upstream Parity with ccstatusline v2.2.30 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring `cxstatusline` to full parity with upstream `ccstatusline` v2.2.30 (Issue #56).

**Architecture:** Port relevant upstream enhancements while preserving cxstatusline's Codex-specific optimizations, prebuilt binary support, and architecture. Refactor usage percentage widgets to a shared module, add symbol slots to git changes, add no-data hideable states to reset timers, add terminal width probe optimizations with zero-subprocess Linux support and caching, default flex mode to full, add llms.txt, and update upstream tracking metadata.

**Tech Stack:** TypeScript, Bun, React/Ink (TUI), Zod, Node.js stdlib (`child_process`, `fs`).

**Spec:** GitHub Issue #56 (`feat: upstream parity with ccstatusline v2.2.30`). Upstream range: `v2.2.29..v2.2.30`.

## Global Constraints

- Zero regression on all existing tests (773+ tests).
- Cross-platform compatibility on both macOS (arm64, x64) and Linux (x64, arm64).
- Preserve Codex session telemetry and types (no Claude-specific OAuth/API assumptions).
- Both `CXSTATUSLINE_WIDTH` and legacy `CCSTATUSLINE_WIDTH` environment variables supported.

---

### Task 1: Terminal Width Probing Optimization & Caching (#501)

**Files:**
- Create: `src/utils/terminal-native.ts`
- Create: `src/utils/terminal-width-cache.ts`
- Modify: `src/utils/terminal.ts`
- Modify: `src/types/Settings.ts`
- Test: `test/terminal-native.test.ts`
- Test: `test/terminal-width-cache.test.ts`
- Test: `test/terminal.test.ts`

**Interfaces:**
- `getTerminalWidth(options?: { sessionId?: string; ttlSeconds?: number }): number | null`
- `resetTerminalWidthCache(): void`
- `probeWidthNative(): number | null`
- `readCachedWidth(sessionId: string, ttlSeconds: number): { width: number | null } | null`
- `writeCachedWidth(sessionId: string, width: number | null): void`

- [ ] **Step 1: Write tests for terminal native probe and width cache**
- [ ] **Step 2: Implement `src/utils/terminal-native.ts` (Linux `/proc` ancestry + `TIOCGWINSZ`)**
- [ ] **Step 3: Implement `src/utils/terminal-width-cache.ts` (session-based no-TTY file cache under tmp/cache dir)**
- [ ] **Step 4: Update `src/utils/terminal.ts` with `execFileSync`, in-process memoization, native probe, and L2 cache**
- [ ] **Step 5: Run tests and verify all pass**

---

### Task 2: Reset Timers Hideable No-Data Placeholders (#542)

**Files:**
- Modify: `src/widgets/shared/usage-display.ts`
- Modify: `src/widgets/WeeklyResetTimer.ts`
- Modify: `src/widgets/FiveHourResetTimer.ts`
- Test: `test/widgets/weekly-reset-timer.test.ts`
- Test: `test/widgets/five-hour-reset-timer.test.ts`

**Interfaces:**
- `USAGE_NO_DATA_HIDEABLE_STATE`: `{ key: 'no-data', label: 'when usage data is unavailable' }`
- `HOUR_FORMAT_TOGGLE_KEYBIND`: changed key from `'h'` to `'f'` (`12/24 (f)ormat`)
- `WeeklyResetTimer`: changed hours toggle keybind from `'h'` to `'o'` (`(o)nly hours`)
- `WeeklyResetTimer.getHideableStates()`: returns `[USAGE_NO_DATA_HIDEABLE_STATE]`
- `FiveHourResetTimer.getHideableStates()`: returns `[USAGE_NO_DATA_HIDEABLE_STATE]`

- [ ] **Step 1: Update `HOUR_FORMAT_TOGGLE_KEYBIND` in `src/widgets/shared/usage-display.ts`**
- [ ] **Step 2: Update `WeeklyResetTimer.ts` to declare `USAGE_NO_DATA_HIDEABLE_STATE`, gate on `isHidden`, and update keybind**
- [ ] **Step 3: Update `FiveHourResetTimer.ts` to declare `USAGE_NO_DATA_HIDEABLE_STATE` and gate on `isHidden`**
- [ ] **Step 4: Update and add tests in `test/widgets/weekly-reset-timer.test.ts` and `test/widgets/five-hour-reset-timer.test.ts`**
- [ ] **Step 5: Verify all tests pass**

---

### Task 3: Shared Usage-Percent Widgets Extraction (#545)

**Files:**
- Create: `src/widgets/shared/usage-percent-widget.ts`
- Modify: `src/widgets/WeeklyUsage.ts`
- Modify: `src/widgets/FiveHourUsage.ts`
- Test: `test/widgets/weekly-usage.test.ts`
- Test: `test/widgets/five-hour-usage.test.ts`

**Interfaces:**
- `createUsagePercentWidget(options: UsagePercentWidgetOptions): Widget`

- [ ] **Step 1: Create `src/widgets/shared/usage-percent-widget.ts` parameterizing label, usage field, window resolver, display name, description**
- [ ] **Step 2: Refactor `src/widgets/WeeklyUsage.ts` to delegate to `createUsagePercentWidget`**
- [ ] **Step 3: Refactor `src/widgets/FiveHourUsage.ts` to delegate to `createUsagePercentWidget`**
- [ ] **Step 4: Run tests to verify behavior and editor contracts remain 100% identical**

---

### Task 4: Git Changes Customizable Symbol Slots (#574)

**Files:**
- Modify: `src/widgets/GitChanges.ts`
- Test: `test/widgets/git-changes.test.ts` (or `test/widgets.test.ts`)

**Interfaces:**
- `INSERTIONS_SLOT: SymbolSlot = { id: 'symbolInsertions', label: 'Insertions', defaultSymbol: '+' }`
- `DELETIONS_SLOT: SymbolSlot = { id: 'symbolDeletions', label: 'Deletions', defaultSymbol: '-' }`
- `GitChangesWidget.getCustomKeybinds()`: returns `[getSymbolKeybind()]`
- `GitChangesWidget.renderEditor(props)`: calls `renderSymbolSlotsEditor(props, [INSERTIONS_SLOT, DELETIONS_SLOT])`

- [ ] **Step 1: Write test for `GitChangesWidget` custom symbol overrides**
- [ ] **Step 2: Update `src/widgets/GitChanges.ts` to use `INSERTIONS_SLOT` and `DELETIONS_SLOT` via `getSlotSymbol`**
- [ ] **Step 3: Verify tests pass**

---

### Task 5: Git Runner Timeout (#559, #585)

**Files:**
- Modify: `src/utils/git.ts`
- Test: `test/git.test.ts`

**Interfaces:**
- `GIT_COMMAND_TIMEOUT_MS = 5_000` applied to git executions

- [ ] **Step 1: Update `defaultGitRunner` in `src/utils/git.ts` with `timeout: 5_000`**
- [ ] **Step 2: Test that hanging git processes terminate gracefully**

---

### Task 6: Default Flex Mode to Full (#590)

**Files:**
- Modify: `src/types/Settings.ts`
- Test: `test/settings.test.ts`

**Interfaces:**
- `flexMode: FlexModeSchema.default('full')`

- [ ] **Step 1: Update default `flexMode` to `'full'` in `src/types/Settings.ts`**
- [ ] **Step 2: Update any tests that assert default settings**

---

### Task 7: Project Context & Upstream Metadata Update (#527, #56)

**Files:**
- Create: `llms.txt`
- Modify: `scripts/upstream-ccstatusline.json`
- Modify: `NOTICE`
- Modify: `docs/usage.md` / `README.md` (if needed)

- [ ] **Step 1: Create `llms.txt` tailored to `cxstatusline` and Codex CLI**
- [ ] **Step 2: Update `scripts/upstream-ccstatusline.json` baseCommit to `05554cd087249167d570aed3c869915b6a18d4d2`**
- [ ] **Step 3: Update `NOTICE` with the new commit hash**
- [ ] **Step 4: Run full validation (`bun run typecheck`, `bun test`, `bun run build`, `bun run check:package`)**
