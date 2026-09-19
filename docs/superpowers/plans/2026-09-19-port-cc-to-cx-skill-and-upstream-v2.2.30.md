# Port CC to CX Skill & Upstream Parity (v2.2.30) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the `.agents/skills/port-cc-to-cx` skill and helper CLI tooling, and execute it to port `sirmalloc/ccstatusline` release `v2.2.30` upstream changes to `cxstatusline`, closing Issue #56 in a single verified PR.

**Architecture:** A hybrid upstream porting system composed of:
1. An agent skill with domain knowledge, code translation dictionaries, and commit triage rules in `.agents/skills/port-cc-to-cx/`.
2. A TypeScript CLI (`scripts/port-upstream.ts`) and shell/python helpers for fetching diffs via `gh api` or `--cc-checkout`, analyzing ranges, and updating baseline metadata.
3. TDD-based implementation of ported widgets (`GitChanges` symbol slots, terminal width probe caching, default flexMode to full, git runner timeouts, reset timer no-data placeholder hiding, and `llms.txt`).

**Tech Stack:** TypeScript 5, Bun, Zod, Ink, Node `node:child_process`, GitHub CLI (`gh`).

**Spec:** [`docs/superpowers/specs/2026-09-19-port-cc-to-cx-design.md`](docs/superpowers/specs/2026-09-19-port-cc-to-cx-design.md)

## Global Constraints

- Never push directly to `main`; all work stays on `feat/port-skill-and-upstream-v2.2.30`.
- All new/modified code must pass `bun test ./test ./src` (currently 776 passing tests).
- `bun run typecheck` (`tsc --noEmit`) must report zero errors.
- `bun run check:package` smoke test must pass.
- Attribution in `NOTICE` must be preserved and updated for all derived code.
- Claude-specific authentication, OAuth token refreshing, and keychain code are strictly excluded.

---

### Task 1: Create the `port-cc-to-cx` Skill Definition & References

**Files:**
- Create: `.agents/skills/port-cc-to-cx/SKILL.md`
- Create: `.agents/skills/port-cc-to-cx/references/translation-guide.md`
- Create: `.agents/skills/port-cc-to-cx/references/triage-matrix.md`

**Interfaces:**
- Produces: Agent-executable skill in `.agents/skills/port-cc-to-cx/` defining the triage matrix, translation rules, and verification checklist.

- [ ] **Step 1: Write `.agents/skills/port-cc-to-cx/SKILL.md`**

```markdown
---
name: port-cc-to-cx
description: "Ports features, widgets, bugfixes, and refactors from sirmalloc/ccstatusline (Claude Code statusline) to cxstatusline (OpenAI Codex statusline)."
---

# Porting from ccstatusline to cxstatusline

This skill guides agents through systematically porting upstream releases from `sirmalloc/ccstatusline` to `cxstatusline`.

## Workflow

1. **Check Upstream Baseline**:
   Run `bun run scripts/port-upstream.ts check` to list new commits since the current `baseCommit`.
2. **Triage Commits**:
   Classify each commit using `references/triage-matrix.md`:
   - Category A: Direct Port (UI, generic widgets, terminal, formatting)
   - Category B: Adapt (Usage / session telemetry adapted to Codex)
   - Category C: Skip (Claude-specific auth, keychains, external links)
   - Category D: Tooling (Dev dependencies)
3. **Port Changes using TDD**:
   Fetch diffs with `bun run scripts/port-upstream.ts diff <commit>`, adapt syntax with `references/translation-guide.md`, write tests first in `test/widgets/`, and implement in `src/`.
4. **Update Attribution & Baseline**:
   Bump `scripts/upstream-ccstatusline.json` and update `NOTICE`.
5. **Verify**:
   Run `bun test ./test ./src && bun run typecheck && bun run build && bun run check:package`.
```

- [ ] **Step 2: Write `.agents/skills/port-cc-to-cx/references/triage-matrix.md`**

Define exact categorization criteria:
- **Category A (Direct Port)**: Git widgets, JJ widgets, Custom Command/Symbol/Text, Powerline themes, terminal width, layout flex mode, ANSI helpers.
- **Category B (Adapt to Codex)**: FiveHour / Weekly usage widgets, session time widgets, telemetry models (translate Claude session JSON structures into Codex telemetry).
- **Category C (Skip/Drop)**: Claude macOS Keychain reads, Anthropic OAuth refresh tokens, `claudenews`, Anthropic pricing constants.
- **Category D (Tooling)**: Dev-dependency bumps (TypeScript, Chalk, Biome) evaluated independently against Bun compatibility.

- [ ] **Step 3: Write `.agents/skills/port-cc-to-cx/references/translation-guide.md`**

Code translation reference:
- `ccstatusline` $\rightarrow$ `cxstatusline`
- `CCSTATUSLINE_WIDTH` $\rightarrow$ `CXSTATUSLINE_WIDTH` (retain `CCSTATUSLINE_WIDTH` as fallback)
- Claude session telemetry $\rightarrow$ `RenderContext.data.session`
- Test framework: Jest/Vitest idioms $\rightarrow$ Bun test (`bun:test`: `describe`, `it`, `expect`, `mock`).

- [ ] **Step 4: Verify files exist and are well-formed**

Run: `ls -la .agents/skills/port-cc-to-cx/ .agents/skills/port-cc-to-cx/references/`
Expected: 3 files present.

- [ ] **Step 5: Commit**

```bash
git add .agents/skills/port-cc-to-cx/
git commit -m "feat(skills): add port-cc-to-cx skill definition and references"
```

---

### Task 2: Build CLI Tool & Helper Scripts

**Files:**
- Create: `.agents/skills/port-cc-to-cx/scripts/fetch-diff.sh`
- Create: `.agents/skills/port-cc-to-cx/scripts/triage.py`
- Create: `.agents/skills/port-cc-to-cx/scripts/update-baseline.sh`
- Create: `scripts/port-upstream.ts`
- Create: `test/port-upstream.test.ts`

**Interfaces:**
- Consumes: `scripts/upstream-ccstatusline.json`, GitHub API via `gh` CLI.
- Produces: `scripts/port-upstream.ts` executable with commands `check`, `diff`, `apply-baseline`.

- [ ] **Step 1: Write failing test in `test/port-upstream.test.ts`**

```typescript
import { describe, expect, it } from "bun:test";
import { formatTriageTable, parseCompareResult } from "../scripts/port-upstream";

describe("port-upstream helpers", () => {
  it("parses compare payload into commit entries", () => {
    const raw = {
      total_commits: 1,
      commits: [
        {
          sha: "747b7f1427bf678d4d2f2fd632437a1feed1ed1f",
          commit: { message: "feat(widgets): give the remaining git and jj widgets symbol slots (#574)" },
          html_url: "https://github.com/sirmalloc/ccstatusline/commit/747b7f1",
        },
      ],
    };
    const parsed = parseCompareResult(raw);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].shortSha).toBe("747b7f1");
    expect(parsed[0].title).toBe("feat(widgets): give the remaining git and jj widgets symbol slots (#574)");
    expect(parsed[0].category).toBe("A (Direct)");
  });

  it("formats triage table as markdown", () => {
    const commits = [
      {
        shortSha: "747b7f1",
        title: "feat(widgets): git symbols (#574)",
        category: "A (Direct)" as const,
        url: "https://...",
      },
    ];
    const table = formatTriageTable(commits);
    expect(table).toContain("| SHA | Category | Title |");
    expect(table).toContain("| 747b7f1 | A (Direct) | feat(widgets): git symbols (#574) |");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/port-upstream.test.ts`
Expected: FAIL (module `../scripts/port-upstream` not found)

- [ ] **Step 3: Implement `scripts/port-upstream.ts` and helper scripts**

Implement `scripts/port-upstream.ts` with exported helper functions `parseCompareResult`, `formatTriageTable`, and CLI subcommands:
- `check`: queries `gh api repos/sirmalloc/ccstatusline/compare/<baseCommit>...HEAD`
- `diff <commit>`: queries `gh api repos/sirmalloc/ccstatusline/commits/<sha>` or reads from `--cc-checkout`
- `apply-baseline <commit>`: writes updated commit into `scripts/upstream-ccstatusline.json`.

Implement `.agents/skills/port-cc-to-cx/scripts/fetch-diff.sh`, `triage.py`, and `update-baseline.sh`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/port-upstream.test.ts`
Expected: PASS

- [ ] **Step 5: Verify CLI runs cleanly**

Run: `bun run scripts/port-upstream.ts --help`
Expected: Exits 0 and outputs command usage.

- [ ] **Step 6: Commit**

```bash
git add scripts/port-upstream.ts test/port-upstream.test.ts .agents/skills/port-cc-to-cx/scripts/
git commit -m "feat(upstream): add port-upstream CLI and helper scripts"
```

---

### Task 3: Port Commit `f45823d` (Default Flex Mode to Full)

**Files:**
- Modify: `src/types/Settings.ts:28`
- Test: `test/distribution.test.ts` or settings tests

**Interfaces:**
- Consumes: `SettingsSchema`
- Produces: `DEFAULT_SETTINGS.flexMode === "full"`

- [ ] **Step 1: Write the failing test**

In `test/settings-defaults.test.ts` (or existing settings test):
```typescript
import { describe, expect, it } from "bun:test";
import { DEFAULT_SETTINGS, SettingsSchema } from "../src/types/Settings";

describe("SettingsSchema defaults", () => {
  it("defaults flexMode to full", () => {
    const parsed = SettingsSchema.parse({});
    expect(parsed.flexMode).toBe("full");
    expect(DEFAULT_SETTINGS.flexMode).toBe("full");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/settings-defaults.test.ts`
Expected: FAIL (`expected "full", received "full-minus-40"`)

- [ ] **Step 3: Update `src/types/Settings.ts` line 28**

Change:
```typescript
flexMode: FlexModeSchema.default("full"),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/settings-defaults.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/types/Settings.ts test/settings-defaults.test.ts
git commit -m "fix(settings): default flex mode to full"
```

---

### Task 4: Port Commits `273d997` & `ef7f973` (Git Runner Execution Timeout)

**Files:**
- Modify: `src/utils/git.ts:20-35`
- Test: `test/git-utils.test.ts`

**Interfaces:**
- Consumes: `spawnSync` from `node:child_process`
- Produces: `GIT_EXEC_TIMEOUT = 5_000` cap in git execution

- [ ] **Step 1: Write the failing test in `test/git-utils.test.ts`**

```typescript
import { describe, expect, it, mock } from "bun:test";
import { GIT_EXEC_TIMEOUT, defaultGitRunner } from "../src/utils/git";

describe("git runner timeout", () => {
  it("defines GIT_EXEC_TIMEOUT as 5000ms", () => {
    expect(GIT_EXEC_TIMEOUT).toBe(5000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/git-utils.test.ts`
Expected: FAIL (`GIT_EXEC_TIMEOUT is not defined`)

- [ ] **Step 3: Update `src/utils/git.ts`**

Export `GIT_EXEC_TIMEOUT = 5_000` and use it in `defaultGitRunner`:
```typescript
export const GIT_EXEC_TIMEOUT = 5_000;

export const defaultGitRunner: GitRunner = (args: string[], cwd: string): string => {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: GIT_EXEC_TIMEOUT,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    windowsHide: true,
  });
  // ...
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/git-utils.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/git.ts test/git-utils.test.ts
git commit -m "fix(git): standardize git execution timeout to 5000ms"
```

---

### Task 5: Port Commit `747b7f1` (`GitChanges` Named Symbol Slots)

**Files:**
- Modify: `src/widgets/GitChanges.ts`
- Test: `test/widgets/git-changes.test.ts`

**Interfaces:**
- Consumes: `SymbolSlot`, `getSlotSymbol` from `src/widgets/shared/symbol-override`
- Produces: `GitChangesWidget` with `symbolInsertions` and `symbolDeletions` slots and editor support

- [ ] **Step 1: Write the failing test in `test/widgets/git-changes.test.ts`**

```typescript
import { describe, expect, it } from "bun:test";
import { DEFAULT_SETTINGS } from "../../src/types/Settings";
import { GitChangesWidget } from "../../src/widgets/GitChanges";

describe("GitChangesWidget symbol overrides", () => {
  const widget = new GitChangesWidget();

  it("renders default symbols in preview", () => {
    expect(widget.render({ id: "1", type: "git-changes" }, { isPreview: true }, DEFAULT_SETTINGS)).toBe("(+42,-10)");
  });

  it("renders custom slot overrides", () => {
    const item = {
      id: "1",
      type: "git-changes",
      metadata: { symbolInsertions: "▲", symbolDeletions: "▼" },
    };
    expect(widget.render(item, { isPreview: true }, DEFAULT_SETTINGS)).toBe("(▲42,▼10)");
  });

  it("drops symbols on empty override", () => {
    const item = {
      id: "1",
      type: "git-changes",
      metadata: { symbolInsertions: "", symbolDeletions: "" },
    };
    expect(widget.render(item, { isPreview: true }, DEFAULT_SETTINGS)).toBe("(42,10)");
  });

  it("exposes glyph keybind 'g'", () => {
    const keys = (widget.getCustomKeybinds?.() ?? []).map((k) => k.key);
    expect(keys).toContain("g");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/widgets/git-changes.test.ts`
Expected: FAIL (`custom slot overrides` failed)

- [ ] **Step 3: Update `src/widgets/GitChanges.ts`**

Add slots:
```typescript
import {
  type SymbolSlot,
  getSlotSymbol,
  getSymbolKeybind,
  renderSymbolEditor,
} from './shared/symbol-override';

const INSERTIONS_SLOT: SymbolSlot = { id: 'symbolInsertions', label: 'Insertions symbol', defaultSymbol: '+' };
const DELETIONS_SLOT: SymbolSlot = { id: 'symbolDeletions', label: 'Deletions symbol', defaultSymbol: '-' };
```
Implement `getCustomKeybinds`, `renderEditor`, and format using `getSlotSymbol(item, INSERTIONS_SLOT)` and `getSlotSymbol(item, DELETIONS_SLOT)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/widgets/git-changes.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/widgets/GitChanges.ts test/widgets/git-changes.test.ts
git commit -m "feat(widgets): add custom symbol slots to git changes widget"
```

---

### Task 6: Port Commit `558c5bd` (Terminal Width Probing Optimization & Caching)

**Files:**
- Modify: `src/types/Settings.ts`
- Modify: `src/utils/terminal.ts`
- Test: `test/terminal.test.ts`

**Interfaces:**
- Consumes: `SettingsSchema`
- Produces: `terminalWidthCacheTtlSeconds: z.number().default(5)`, `CXSTATUSLINE_WIDTH` env check, probe memoization

- [ ] **Step 1: Write the failing test in `test/terminal.test.ts`**

```typescript
import { describe, expect, it } from "bun:test";
import { SettingsSchema } from "../src/types/Settings";
import { getTerminalWidth } from "../src/utils/terminal";

describe("terminal width settings & caching", () => {
  it("includes terminalWidthCacheTtlSeconds in SettingsSchema defaulting to 5", () => {
    const parsed = SettingsSchema.parse({});
    expect(parsed.terminalWidthCacheTtlSeconds).toBe(5);
  });

  it("respects CXSTATUSLINE_WIDTH environment override", () => {
    const original = process.env.CXSTATUSLINE_WIDTH;
    try {
      process.env.CXSTATUSLINE_WIDTH = "160";
      expect(getTerminalWidth()).toBe(160);
    } finally {
      process.env.CXSTATUSLINE_WIDTH = original;
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/terminal.test.ts`
Expected: FAIL (`terminalWidthCacheTtlSeconds is undefined`)

- [ ] **Step 3: Update `src/types/Settings.ts` and `src/utils/terminal.ts`**

1. In `src/types/Settings.ts`, add:
```typescript
terminalWidthCacheTtlSeconds: z.number().default(5),
```
2. In `src/utils/terminal.ts`:
   - Check `process.env.CXSTATUSLINE_WIDTH ?? process.env.CCSTATUSLINE_WIDTH`.
   - Add cached memoization for no-TTY ancestor process walk with TTL expiration.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/terminal.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/types/Settings.ts src/utils/terminal.ts test/terminal.test.ts
git commit -m "perf(terminal): cache terminal width probing and support CXSTATUSLINE_WIDTH"
```

---

### Task 7: Port Commit `f370720` (Reset Timer No-Data Hiding & Keybind Remapping)

**Files:**
- Modify: `src/widgets/shared/usage-display.ts`
- Modify: `src/widgets/FiveHourResetTimer.ts`
- Modify: `src/widgets/WeeklyResetTimer.ts`
- Test: `test/widgets/five-hour-reset-timer.test.ts`
- Test: `test/widgets/weekly-reset-timer.test.ts`

**Interfaces:**
- Consumes: `USAGE_NO_DATA_HIDEABLE_STATE` from `src/widgets/shared/usage-display.ts`
- Produces: `FiveHourResetTimer` and `WeeklyResetTimer` hideable states with no-collision keybinds (`f`, `o`)

- [ ] **Step 1: Write failing tests for reset timer no-data hiding**

In `test/widgets/five-hour-reset-timer.test.ts`:
```typescript
it("declares no-data hideable state", () => {
  const widget = new FiveHourResetTimerWidget();
  expect(widget.getHideableStates().map((s) => s.key)).toContain("no-data");
});

it("returns null when no-data state is enabled and reset time is absent", () => {
  const widget = new FiveHourResetTimerWidget();
  const item = { id: "1", type: "five-hour-reset-timer", metadata: { hide: "no-data" } };
  expect(widget.render(item, { data: { session: {} } }, DEFAULT_SETTINGS)).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/widgets/five-hour-reset-timer.test.ts`
Expected: FAIL (`getHideableStates does not contain no-data`)

- [ ] **Step 3: Update `src/widgets/shared/usage-display.ts` and Timer Widgets**

1. In `src/widgets/shared/usage-display.ts`:
   - Change `HOUR_FORMAT_TOGGLE_KEYBIND` key to `'f'` (`12/24 (f)ormat`).
2. In `src/widgets/WeeklyResetTimer.ts`:
   - Change hours-only toggle key to `'o'` (`(o)nly hours`).
   - Add `USAGE_NO_DATA_HIDEABLE_STATE` to `getHideableStates()`.
   - In `render()`, return `null` if reset window is missing and `isHideStateEnabled(item, USAGE_NO_DATA_HIDEABLE_STATE)` is true.
3. In `src/widgets/FiveHourResetTimer.ts`:
   - Add `USAGE_NO_DATA_HIDEABLE_STATE` to `getHideableStates()`.
   - In `render()`, return `null` if reset time is missing and `isHideStateEnabled(item, USAGE_NO_DATA_HIDEABLE_STATE)` is true.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test test/widgets/five-hour-reset-timer.test.ts test/widgets/weekly-reset-timer.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/widgets/shared/usage-display.ts src/widgets/FiveHourResetTimer.ts src/widgets/WeeklyResetTimer.ts test/widgets/five-hour-reset-timer.test.ts test/widgets/weekly-reset-timer.test.ts
git commit -m "feat(usage): allow reset timers to hide no-data placeholders and resolve keybind conflicts"
```

---

### Task 8: Port Commit `06786da` (Add `llms.txt` Project Summary)

**Files:**
- Create: `llms.txt`

**Interfaces:**
- Produces: LLM/agent-readable summary of `cxstatusline` at root.

- [ ] **Step 1: Write `llms.txt`**

```markdown
# cxstatusline

> A highly customizable, low-overhead status line formatter for OpenAI Codex CLI. Renders a configurable terminal status line (model info, git branch/changes, context usage, timers, and custom widgets) via an interactive Ink TUI, with support for Powerline separators and themes.

## Getting Started

- Quick Start: Run with `npx -y cxstatusline@latest` or `bunx -y cxstatusline@latest` — launches the interactive TUI to configure your status line.
- Native Hook Integration: Modifies Codex CLI statusline hooks to render live telemetry.

## Configuration

- Statusline Settings: Stored at `~/.config/cxstatusline/settings.json` by default. Override using `--config <path>`.
- CLI Options: Run `cxstatusline --help` for options including `--preview`, `--doctor`, and `--version`.

## Development

- Engine: Built on Node >= 22 and Bun >= 1.4.
- Checks: `bun test ./test ./src`, `bun run typecheck`, `bun run build`, and `bun run check:package`.
- License: MIT.
```

- [ ] **Step 2: Verify `llms.txt` formatting**

Run: `cat llms.txt`
Expected: Clean markdown text.

- [ ] **Step 3: Commit**

```bash
git add llms.txt
git commit -m "docs: add llms.txt project summary for AI agents"
```

---

### Task 9: Update Upstream Baseline Metadata & Legal Attribution

**Files:**
- Modify: `scripts/upstream-ccstatusline.json`
- Modify: `NOTICE`

**Interfaces:**
- Consumes: Target commit `05554cd087249167d570aed3c869915b6a18d4d2` (`v2.2.30`)
- Produces: Updated baseline tracking and accurate copyright attribution

- [ ] **Step 1: Update `scripts/upstream-ccstatusline.json`**

Update `baseCommit`:
```json
{
  "repo": "sirmalloc/ccstatusline",
  "baseCommit": "05554cd087249167d570aed3c869915b6a18d4d2"
}
```

- [ ] **Step 2: Update `NOTICE`**

Update `NOTICE` with derivations and reference to `v2.2.30` commit `05554cd087249167d570aed3c869915b6a18d4d2`.

- [ ] **Step 3: Verify with `scripts/port-upstream.ts`**

Run: `bun run scripts/port-upstream.ts check`
Expected: Reports repo is up to date with `v2.2.30`.

- [ ] **Step 4: Commit**

```bash
git add scripts/upstream-ccstatusline.json NOTICE
git commit -m "chore(upstream): update baseline commit to ccstatusline v2.2.30"
```

---

### Task 10: Full Test Suite, Smoke Check & Pull Request

**Files:**
- None (verification and GitHub PR creation)

**Interfaces:**
- Consumes: All repository tests, build tools, `gh pr create`
- Produces: GitHub PR closing Issue #56

- [ ] **Step 1: Run full test suite**

Run: `bun test ./test ./src`
Expected: 100% tests pass (780+ passing tests, 0 failures).

- [ ] **Step 2: Run TypeScript typecheck**

Run: `bun run typecheck`
Expected: Zero TypeScript compiler errors.

- [ ] **Step 3: Run package build**

Run: `bun run build`
Expected: Bundle generated in `dist/`, license notices validated.

- [ ] **Step 4: Run package smoke check**

Run: `bun run check:package`
Expected: Package smoke passed on Node/Bun.

- [ ] **Step 5: Push feature branch to GitHub**

Run: `git push -u origin feat/port-skill-and-upstream-v2.2.30`
Expected: Branch pushed to remote; pre-push hook succeeds because it is not targeting `main`.

- [ ] **Step 6: Open Pull Request**

Run:
```bash
gh pr create --title "feat(upstream): add port-cc-to-cx skill and port ccstatusline v2.2.30" --body "Resolves #56.

### Summary
1. Added .agents/skills/port-cc-to-cx/ and scripts/port-upstream.ts CLI helper for upstream parity workflows.
2. Ported ccstatusline v2.2.30 features:
   - GitChanges custom symbol slots (+insertions, -deletions)
   - Terminal width probe caching and CXSTATUSLINE_WIDTH env override
   - Default flexMode to 'full'
   - Standardized git execution timeout (5000ms)
   - Reset timer no-data placeholder hiding and keybind collision fixes
   - Added llms.txt project summary
3. Updated scripts/upstream-ccstatusline.json baseline to v2.2.30 and updated NOTICE."
```
Expected: PR created successfully.
