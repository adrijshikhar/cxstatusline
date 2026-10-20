# Upstream Parity v2.2.32 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port upstream features, security hardening, performance optimizations, bug fixes, and refactors from `sirmalloc/ccstatusline` v2.2.32 to `cxstatusline`, maintaining full compatibility with OpenAI Codex session telemetry and runtime requirements.

**Architecture:** 
1. Core security hardening (safe git argument handling, path resolution, control sequence sanitization) and ANSI/git performance optimizations are directly ported and covered with Bun unit tests.
2. Widget base refactors (shared Git count, Git status, JJ, and token count base classes) are ported to streamline widget definitions.
3. TUI enhancements (in-place label editing `e`, hotkey modifiers, Powerline editor fixes) are integrated into Ink components.
4. Telemetry and session usage metrics are adapted to Codex telemetry schemas (`RenderContext.data.session`), skipping Claude-specific OAuth/keychain dependencies.
5. Baseline configuration (`scripts/upstream-ccstatusline.json`), `NOTICE` legal attributions, and regression tests are updated to track commit `19c6665ecf14309a5ffcfcda5e31972833dd821a`.

**Tech Stack:** TypeScript, Bun (`bun:test`), React/Ink, Node APIs (`node:fs`, `node:child_process`, `node:path`), Git / JJ CLI tooling.

**Spec:** Issue [#157](https://github.com/adrijshikhar/cxstatusline/issues/157) & `.agents/skills/port-cc-to-cx/SKILL.md`.

## Global Constraints

- Never push directly to `main`; all changes live on `feat/upstream-parity-v2.2.32`.
- Preserve existing Codex session telemetry models in `RenderContext.data.session`.
- Preserve `CXSTATUSLINE_*` environment variables with `CCSTATUSLINE_*` fallback.
- Retain strict MIT license attribution in `NOTICE` for newly derived upstream components.
- Verification gates must all pass: `bun test ./test ./src && bun run typecheck && bun run build && bun run check:package`.

---

## Plan Structure & Tasks

### Task 1: Security Hardening & Safe Execution
- Harden Git invocations against repository-controlled commands and untrusted args (`810d424`).
- Resolve Windows executables securely from `PATH` (`758fad2`).
- Sanitize terminal control sequences from input (`3d94211`).
- Pass branch and host names safely after `--` to `gh`, `glab`, and `ssh` (`f51332a`).
- Download Powerline fonts into private temp directory (`6aefa6b`).
- Keep private configuration permissions restricted (0600) on save and backup (`4c62e31`).

### Task 2: Core Performance & Robustness
- Fast-path ASCII rendering and memoize cluster widths in ANSI utils (`c74f402`).
- Never truncate ANSI text wider than `maxWidth` (`055ae22`).
- Parse `.git` files and remote URLs in linear time (`ae9721e`).
- Bound timeouts on stalled proxy and jj calls (`610dcc9`).
- Prevent git process respawning outside repos across session cwds (`07589a2`).
- Direct connection for hosts matching `NO_PROXY` (`e8ef3cb`).
- Handle jsonl leading newline in reverse reader (`ea66b39`).
- Input guards accepting nulls for version, cost, workspace (`726cdc6`).

### Task 3: Widget Refactors & Base Classes
- Introduce shared base classes:
  - `src/widgets/shared/git-count-widget.ts` (`4424292`).
  - `src/widgets/shared/git-status-widget.ts` (`e99c9e0`).
  - `src/widgets/shared/jj-widget-base.ts` (`da3c355`).
  - `src/widgets/shared/git-remote-widget-base.ts` (`88712e2`).
  - `src/widgets/shared/format-options.ts` and `raw-or-labeled.ts` (`fb9b530`).
- Update existing Git, JJ, and token widgets to extend shared base classes.

### Task 4: Widget Features & Renderer Fixes
- `GitIsFork` widget: render forks as editable glyph (`12a6233`).
- Text-label widgets: add editable label prefix (`7bed5f2`).
- `CurrentWorkingDir`: fish-style boundary abbreviation & `~` segment counting (`236805c`, `92baba9`).
- `CustomCommand`: truncate `maxWidth` output by display width (`8abcefa`).
- `CacheTimer`: stop reporting HOT after interrupts and local commands (`72b85a4`).
- Renderer: truncate at zero width, keep FLEX text, preserve Powerline backgrounds after resets (`01e1f16`, `1a6e588`).
- Codex adaptations: session cost rate, daily budget, and usage lock cleanup (`31983de`, `75c7a1d`, `0bcc7eb`).

### Task 5: TUI Enhancements & Configuration
- Add in-TUI label editing with `e` hotkey (`LabelEditor.tsx`, `994dd68`).
- Hotkey modifier filtering: ignore single-letter navigation when Ctrl/Alt is held (`04ede95`).
- ColorMenu: number keys and separator preservation, reset format preservation (`5f95f44`, `dfa54ba`).
- PowerlineSetup & ThemeSelector: preserve displayed theme colors when customizing, keep separator inversion list dense (`9953489`, `bf6f33e`).
- ImportPreviewDialog: show and confirm new shell commands (`4031a93`).
- Settings migration: don't migrate settings with non-numeric version as v1 (`9137d26`).

### Task 6: Upstream Baseline, Attribution & Final Verification
- Update `scripts/upstream-ccstatusline.json` baseCommit to `19c6665ecf14309a5ffcfcda5e31972833dd821a`.
- Update `NOTICE` with new ported file notices and upstream attribution.
- Update `test/upstream-ccstatusline.test.ts` baseline expectation.
- Run full verification suite: `bun test ./test ./src && bun run typecheck && bun run build && bun run check:package`.
- Commit changes and open Pull Request referencing issue [#157](https://github.com/adrijshikhar/cxstatusline/issues/157).
