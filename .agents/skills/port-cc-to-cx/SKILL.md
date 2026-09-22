---
name: port-cc-to-cx
description: "Ports features, widgets, bugfixes, and refactors from sirmalloc/ccstatusline (Claude Code statusline) to cxstatusline (OpenAI Codex statusline)."
---

# Porting from ccstatusline to cxstatusline

This skill guides agents through systematically porting upstream releases and commits from `sirmalloc/ccstatusline` (Claude Code statusline) to `cxstatusline` (OpenAI Codex statusline).

## Overview

`cxstatusline` is derived from `sirmalloc/ccstatusline` and adapted for OpenAI Codex CLI. While `ccstatusline` targets Claude Code with Anthropic OAuth, macOS keychain tokens, and Claude session JSON files, `cxstatusline` targets OpenAI Codex with Codex telemetry, decoupled command caches, and Bun runtime optimizations.

Upstream changes must be ported regularly to ensure feature parity, bugfix alignment, and UI consistency, while strictly maintaining Codex telemetry compatibility and legal attribution.

## Workflow

1. **Check Upstream Baseline**:
   Run `bun run scripts/port-upstream.ts check` to list new commits since the current `baseCommit` in `scripts/upstream-ccstatusline.json`.
2. **Triage Commits**:
   Classify each commit using [`references/triage-matrix.md`](references/triage-matrix.md):
   - **Category A**: Direct Port (UI, generic widgets, terminal width, layout flex mode, ANSI helpers)
   - **Category B**: Adapt to Codex (Usage / session telemetry adapted to Codex)
   - **Category C**: Skip / Drop (Claude-specific auth, keychains, external links)
   - **Category D**: Tooling & Dependencies (Dev dependencies, build tools evaluated independently)
3. **Port Changes using TDD**:
   Fetch diffs with `bun run scripts/port-upstream.ts diff <commit>` (or `.agents/skills/port-cc-to-cx/scripts/fetch-diff.sh`), adapt syntax using [`references/translation-guide.md`](references/translation-guide.md), write tests first in `test/widgets/` or `test/`, and implement in `src/`.
4. **Update Attribution & Baseline**:
   Bump `scripts/upstream-ccstatusline.json` using `bun run scripts/port-upstream.ts update-baseline <commit>` and update `NOTICE` with copyright attribution for newly derived files.
5. **Verify**:
   Run full verification suite:
   ```bash
   bun test ./test ./src && bun run typecheck && bun run build && bun run check:package
   ```

---

## Detailed Step-by-Step Guide

### Step 1: Upstream Baseline & Discovery

- The current baseline commit is tracked in `scripts/upstream-ccstatusline.json`:
  ```json
  {
    "repo": "sirmalloc/ccstatusline",
    "baseCommit": "05554cd087249167d570aed3c869915b6a18d4d2"
  }
  ```
- To inspect new upstream commits:
  ```bash
  # Check commits via GitHub API
  bun run scripts/port-upstream.ts check

  # Or check against a local clone of ccstatusline
  bun run scripts/port-upstream.ts check --cc-checkout ../ccstatusline
  ```

### Step 2: Triage Commits

Review every commit between `baseCommit` and the upstream target tag/commit. For each commit:
1. Examine the commit title and changed files:
   ```bash
   bun run scripts/port-upstream.ts diff <commit> --stat
   ```
2. Apply the classification rules defined in [`references/triage-matrix.md`](references/triage-matrix.md).
3. Produce a triage summary table noting:
   - Commit SHA and title
   - Assigned Category (A, B, C, or D)
   - Target files in `cxstatusline`
   - Specific adaptation notes (e.g. keybind collisions, telemetry mappings)

### Step 3: Test-Driven Porting (TDD)

For each Category A and Category B commit:
1. **Fetch Commit Diff**:
   ```bash
   bun run scripts/port-upstream.ts diff <commit>
   ```
2. **Translate Code**:
   Apply translation rules from [`references/translation-guide.md`](references/translation-guide.md):
   - Replace `ccstatusline` with `cxstatusline`
   - Map environment variables (e.g. `CXSTATUSLINE_WIDTH` with fallback `CCSTATUSLINE_WIDTH`)
   - Translate session/telemetry models to `RenderContext.data.session`
   - Resolve UI keybind collisions (e.g. `h` reserved for hide checklist)
3. **Write Tests First**:
   - Write failing unit tests in `test/widgets/` or corresponding test directory using Bun test (`bun:test`).
   - Run tests to confirm red state:
     ```bash
     bun test ./test/widgets/<target>.test.ts
     ```
4. **Implement Code**:
   - Apply the changes in `src/`.
   - Run tests to confirm green state:
     ```bash
     bun test ./test/widgets/<target>.test.ts
     ```

### Step 4: Attribution & Baseline Management

Legal attribution is strictly required under the MIT license:
1. Update `NOTICE`:
   - If new files or components are ported from upstream, add them to the file patterns listed in `NOTICE`.
   - Reference the upstream commit and retain copyright notices:
     ```
     Copyright (c) 2025 Matthew Breedlove (https://github.com/sirmalloc)
     Original repository: https://github.com/sirmalloc/ccstatusline
     Licensed under the MIT License.
     ```
2. Update Baseline Commit:
   ```bash
   bun run scripts/port-upstream.ts update-baseline <target-commit>
   ```

### Step 5: Verification Checklist

Before committing or submitting a pull request, run all verification gates:
- [ ] `bun test ./test ./src` (All tests must pass, 0 failures)
- [ ] `bun run typecheck` (`tsc --noEmit` must report 0 errors)
- [ ] `bun run build` (Build artifact in `dist/cxstatusline.js` must compile cleanly)
- [ ] `bun run check:package` (Smoke tests and packaging sanity checks must pass)
- [ ] `git diff` shows no unintended modifications or stray debugging logs

### Step 6: PR & Branch Policy

- **Never push directly to `main`**: All work must be on a descriptive feature branch (e.g. `feat/port-skill-and-upstream-v2.2.30`).
- **Conventional Commits**: Commit messages and PR titles must follow Conventional Commits format (`feat: ...`, `fix: ...`, `chore: ...`).
- **Attribution in PR Description**: Mention the upstream release tag, base and target commit hashes, and summary of ported vs skipped commits.
