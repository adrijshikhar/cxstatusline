# Upstream Commit Triage Matrix

This document defines the deterministic rules for classifying upstream commits from `sirmalloc/ccstatusline` when porting changes to `cxstatusline`.

Every upstream commit between the previous `baseCommit` and the target commit must be categorized into exactly one of the four categories below.

---

## Triage Categories

### Category A: Direct Port (UI, Generic Widgets, Terminal, Formatting)

**Definition:**  
Changes that apply directly to generic statusline presentation, terminal capabilities, version control widgets, or rendering infrastructure without Claude-specific dependencies.

**In-Scope Components:**
- **Git & Jujutsu (JJ) Widgets**: Branch, status, changes, ahead/behind counters, commit hashes, symbol slots.
- **Generic Widgets**: Custom Command, Custom Symbol, Custom Text, Static Text.
- **Powerline Infrastructure**: Powerline themes, separators, colors, background styling, glyphs, and palette index.
- **Terminal Capabilities**: Terminal width detection, process tree ancestor walking, width caching (`CXSTATUSLINE_WIDTH`), resize handling.
- **Layout & Sizing Engine**: Flex mode (`full`, `full-minus-40`), padding, alignment, margin, truncation, and ellipsis formatting.
- **ANSI & Text Helpers**: SGR stripping, visible length calculation, color sanitization.
- **Documentation & Metadata**: Project summaries (e.g. `llms.txt`), generic CLI flags, preview mode improvements.

**Porting Action:**
1. Fetch the upstream diff.
2. Apply code translation patterns from [`translation-guide.md`](translation-guide.md) (e.g. `ccstatusline` $\rightarrow$ `cxstatusline`).
3. Port or author unit tests in `test/widgets/` using `bun:test` before applying code.
4. Implement in `src/`.
5. Preserve Matthew Breedlove's copyright attribution in `NOTICE`.

---

### Category B: Adapt to Codex (Usage, Session & Telemetry)

**Definition:**  
Changes that involve usage statistics, rate limits, session duration, or telemetry that are architecturally shared between Claude Code and OpenAI Codex, but require data-model adaptation.

**In-Scope Components:**
- **Usage Percentage Widgets**: Five-hour usage (`FiveHourUsage`), weekly usage (`WeeklyUsage`), model-specific rate limits.
- **Reset Timers**: Five-hour reset timer (`FiveHourResetTimer`), weekly reset timer (`WeeklyResetTimer`).
- **Session Duration & Accounting**: Session elapsed time, active turn duration, token usage counters.
- **Hideable States**: Hiding widgets under specific conditions (e.g. `no-data` placeholder hiding when rate limit telemetry is unavailable).

**Adaptation Criteria & Rules:**
- **Data Model Translation**: Claude Code stores session JSON files on disk; Codex CLI provides telemetry structures via `RenderContext.data.session`. Adapt all property accesses to match the Codex data schema.
- **Keybind Collision Prevention**:
  The shared item editor reserves `h` for toggling the hide checklist. When upstream introduces mode toggles that use `h`, remap them:
  - Weekly Reset Timer `(h)ours only` $\rightarrow$ `(o)nly hours` (`key: 'o'`)
  - Time format `12/24 (h)our` $\rightarrow$ `12/24 (f)ormat` (`key: 'f'`)
- **Zero-Usage vs No-Data**:
  Ensure that 0% utilization with valid session telemetry is rendered as `0%` rather than triggering missing-data / `[Loading]` placeholders.

**Porting Action:**
1. Map Claude data structures to `RenderContext.data.session` equivalents.
2. Write unit tests with mock Codex session fixtures covering edge cases (0% usage, missing fields, reset dates in past/future).
3. Implement in `src/widgets/` and verify no keybind collisions with existing items editor shortcuts.

---

### Category C: Skip / Drop (Claude-Specific Infrastructure & Auth)

**Definition:**  
Features, modules, or dependencies tightly coupled to Anthropic infrastructure, Claude Code credentials, or third-party Claude-only tooling that have no functional relevance to OpenAI Codex CLI.

**Excluded Components:**
- **macOS Keychain & Auth**: Reading Claude tokens from macOS Keychain, OAuth refresh token exchange, credential persistence.
- **Anthropic APIs**: Direct Anthropic API calls, billing headers, Anthropic status endpoints.
- **Pricing & Tier Constants**: Anthropic model pricing tables, tier definitions (e.g. Claude Pro/Max tier checks).
- **Claude-Specific Third-Party Links**: Integrations with Claude-only tools (e.g. `claudenews`, Claude plugins).

**Handling Action:**
1. Mark commit as **Category C (Skip)** in the triage log.
2. Document the specific reason (e.g. "Claude macOS Keychain credential access — out of scope for Codex").
3. Do not port any code, dependencies, or tests.

---

### Category D: Tooling & Dependencies (Dev-Dependencies & Build)

**Definition:**  
Upstream changes to dev-dependencies, build configurations, linting rules, or repository automation.

**Evaluation Rules:**
- `cxstatusline` uses **Bun** as its primary test runner and build runtime, targeting Node >=22.
- Upstream dev-dependency updates (e.g. TypeScript, Biome, Chalk, React, Ink) must be evaluated independently for compatibility with:
  1. Bun's native module loader and test runner (`bun test`)
  2. Patched dependencies (e.g. `patches/ink@6.2.0.patch`)
  3. Prebuilt single-binary compilation workflows
- Do not blindly upgrade dev-dependencies if they introduce breaking changes, runtime incompatibilities, or unnecessary churn.

**Handling Action:**
1. If the upstream dependency bump solves a verified bug or security vulnerability compatible with our stack, create a dedicated chore commit.
2. Otherwise, mark as **Category D (Skipped / Retained existing)** in the triage record and plan upgrades separately.

**Case Study: v2.2.30 Chalk 6 & TypeScript 7 Deferral**
- *Chalk*: Upstream bumped `chalk` to `6.0.0`. In `cxstatusline`, `ink@6.2.0` and `gradient-string@3.0.0` (used in `ink-gradient`) explicitly require `chalk@^5.3.0`. Upgrading root `chalk` to 6 breaks npm/bun deduplication, resulting in dual versions of Chalk (5.6.2 and 6.0.0) being installed and bundled into `dist/cxstatusline.js`. We deliberately retain `chalk ^5.5.0` to preserve clean deduplication.
- *TypeScript*: Upstream aliased `@typescript/native` preview to `npm:typescript@^7.0.2` while keeping `typescript` on version 6. `cxstatusline` keeps `typescript ^5` as its tested compiler for `tsc --noEmit`.
- *Rule*: Major dev-dependency upgrades must be planned and tested on separate `chore/deps` branches rather than piggybacking on feature/parity ports.

---

## Triage Procedure for Upstream Releases

When an agent executes an upstream port:

1. **List the Commit Range**:
   ```bash
   bun run scripts/port-upstream.ts check
   ```
2. **Examine Each Commit**:
   Inspect the diff and commit message:
   ```bash
   bun run scripts/port-upstream.ts diff <commit> --stat
   ```
3. **Build the Triage Table**:
   Record each commit in the implementation report using the following structure:

| Commit Hash | Upstream Title | Category | Target in `cxstatusline` | Notes / Actions |
|---|---|---|---|---|
| `747b7f1` | `feat(widgets): give the remaining git and jj widgets symbol slots` | Category A | `src/widgets/GitChanges.ts` | Direct port with tests |
| `f370720` | `feat(usage): let the reset timers hide their no-data placeholders` | Category B | `src/widgets/FiveHourResetTimer.ts` | Remap `h` keybinds to `o`/`f` |
| `0551b06` | `feat(auth): read claude token from macos keychain` | Category C | N/A | Skip: Claude-specific auth |
| `2ae993d` | `chore(deps-dev): bump typescript from 5.4 to 5.5` | Category D | N/A | Evaluated; keep current ts5 |

4. **Sequential Implementation**:
   Implement Category A and Category B commits in dependency order, running the test suite after each step.
