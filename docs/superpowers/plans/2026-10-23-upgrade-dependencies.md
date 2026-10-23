# Upgrade Dependencies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade project dependencies across the root CLI and the website packages to their latest versions (including major version upgrades for Ink, Chalk, React, TypeScript, and ecosystem packages), modernize Ink render invocations, retire obsolete Ink patches, and verify all build, typecheck, and test suites pass.

**Architecture:** 
1. Upgrade root CLI dependencies: upgrade Ink to v8.0.0, Chalk to v6.0.1, React & ReactDOM to 19.3.1, `@types/react` to 19.3.0, and dev tooling.
2. In Ink 8, terminal scrollback preservation and macOS backspace (`\x7f`) are natively supported upstream, and `isCI: false` is replaced by the official `interactive: true` option. Retire `patches/ink@6.2.0.patch` and update `render()` callers in `src/ui/progress.ts` and `src/ui/prompt.ts`.
3. Upgrade website dependencies: Astro, `@astrojs/react`, `@base-ui/react`, `lucide-react`, `vite`, React 19.3.1, and `@playwright/test`. Ensure compatibility with `ink-web` in the web playground.
4. Verify all tests pass (`bun test ./test ./src`, `bun run test:website`, `bun run typecheck`, `bun run build`).

**Tech Stack:** TypeScript, Bun, Ink 8, React 19.3, Chalk 6, Astro 7, Vite 7.

**Spec:** Direct user instruction to perform all dependency upgrades including major version jumps and patch re-evaluations.

## Global Constraints
- **Branch Policy**: Work on branch `chore/upgrade-dependencies` off `main`.
- **Quality Gates**: Local tests (`bun test ./test ./src`), website tests (`bun run test:website`), package checks (`bun run check:package`), and typechecks (`bun run typecheck`) must all pass with zero failures.
- **Convention**: Commit messages must follow Conventional Commits (`chore(deps): ...`, `refactor(ui): ...`).

---

### Task 1: Update Root Callers to Ink 8 Options (`interactive` mode)

**Files:**
- Modify: `src/ui/progress.ts:70-80`
- Modify: `src/ui/prompt.ts:10-15`

- [ ] **Step 1: Update `src/ui/progress.ts` Ink render options**
Replace `preserveScrollback: true` and `isCI: false` with native `interactive: true` (or remove obsolete flags since Ink 8 preserves scrollback by default):
```typescript
      interactive: true,
```
- [ ] **Step 2: Update `src/ui/prompt.ts` Ink render options**
Replace `{ exitOnCtrlC: false, preserveScrollback: true, isCI: false }` with `{ exitOnCtrlC: false, interactive: true }`.
- [ ] **Step 3: Run existing tests to verify callers still function**
Run: `bun test ./test/test-runner.test.ts ./test/cli-args.test.ts`
Expected: PASS
- [ ] **Step 4: Commit UI caller updates**
```bash
git add src/ui/progress.ts src/ui/prompt.ts
git commit -m "refactor(ui): modernize Ink render options for native interactive mode"
```

---

### Task 2: Upgrade Root Dependencies & Retire Obsolete Ink Patch

**Files:**
- Modify: `package.json`
- Remove / Unlink: `patches/ink@6.2.0.patch` from `patchedDependencies` in `package.json`
- Modify: `bun.lock`

- [ ] **Step 1: Update `package.json` dependencies**
Update versions in `package.json`:
- `"chalk": "^6.0.1"`
- `"ink": "^8.0.0"`
- `"react": "19.3.1"`
- `"react-dom": "19.3.1"`
- `"react-devtools-core": "^8.0.0"`
- `"@types/react": "^19.3.0"`
- `"zod": "^4.6.7"`
- Remove `ink@6.2.0` from `patchedDependencies` (remove the `patchedDependencies` block or empty it).
- [ ] **Step 2: Install updated packages with Bun**
Run: `bun install`
Expected: Successful resolution and lockfile update.
- [ ] **Step 3: Remove obsolete `patches/ink@6.2.0.patch` file**
Run: `git rm patches/ink@6.2.0.patch`
- [ ] **Step 4: Verify typecheck and tests pass with new dependencies**
Run: `bun run typecheck && bun test ./test ./src`
Expected: All tests pass (1248+ passed, 0 failed).
- [ ] **Step 5: Verify release package build**
Run: `CXSTATUSLINE_RELEASE_BUILD=1 bun run build && bun run check:package`
Expected: Build succeeds and package checks pass.
- [ ] **Step 6: Commit root dependency upgrades**
```bash
git add package.json bun.lock patches/ink@6.2.0.patch
git commit -m "chore(deps): upgrade root dependencies (ink 8, react 19.3, chalk 6)"
```

---

### Task 3: Upgrade Website Dependencies & Verify Playground

**Files:**
- Modify: `website/package.json`
- Modify: `website/bun.lock`

- [ ] **Step 1: Update `website/package.json` dependencies**
Update compatible dependency versions in `website/package.json`:
- `"@astrojs/react": "^7.1.1"`
- `"@base-ui/react": "^1.9.0"`
- `"astro": "^7.4.2"`
- `"lucide-react": "^1.61.0"`
- `"react": "19.3.1"`
- `"react-dom": "19.3.1"`
- `"@types/react": "^19.3.0"`
- `"vite": "^7.3.7"`
- `"@playwright/test": "^1.64.1"`
- Note: Keep `ink-web@0.2.0` and its companion `react-reconciler` / `scheduler` compatible with the browser terminal playground.
- [ ] **Step 2: Install updated website packages with Bun**
Run: `cd website && bun install`
- [ ] **Step 3: Run website build and unit tests**
Run: `bun run test:website`
Expected: Astro build succeeds and all 19 tests pass.
- [ ] **Step 4: Commit website dependency upgrades**
```bash
git add website/package.json website/bun.lock
git commit -m "chore(deps): upgrade website dependencies (astro 7.4, react 19.3, vite)"
```

---

### Task 4: Full Suite Verification, PR Creation & Merge

**Files:**
- Repository-wide verification

- [ ] **Step 1: Run comprehensive local test suites**
Run:
- `bun run typecheck`
- `bun test ./test ./src`
- `bun run test:website`
- `bun run check:package`
- [ ] **Step 2: Push branch `chore/upgrade-dependencies` to origin**
Run: `git push -u origin chore/upgrade-dependencies`
- [ ] **Step 3: Open Pull Request**
Run: `gh pr create --title "chore(deps): upgrade core dependencies (ink 8, react 19.3, chalk 6, astro 7)" ...`
- [ ] **Step 4: Watch PR CI checks and merge**
Run: `gh pr checks <PR_NUM> --watch` then `gh pr merge <PR_NUM> --squash --delete-branch --admin`
- [ ] **Step 5: Pull `main` to sync locally**
Run: `git checkout main && git pull origin main`
