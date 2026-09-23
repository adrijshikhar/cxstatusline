# Hook Direct Version Comparison & Live Probe Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Simplify and harden the cxstatusline hook by directly comparing the active installed generation against the newest released prebuilt version, with a fast live GitHub check (5s timeout, silent fallback) and default policy `"every"`.

**Architecture:** 
1. In `src/hook/run.ts`, resolve `effectivePatchedFrom` from active generation metadata (`installation.json`), falling back to `state.patched_from`.
2. Introduce a fast live GitHub probe (`probeRemoteCandidate` with 5s timeout & silent fallback) to detect new prebuilts as soon as they publish, bypassing stale 24h backoffs.
3. Switch `DEFAULT_STATE.policy` to `"every"` so patch releases (e.g. `0.155.0 -> 0.155.1`) directly update without requiring manual `--force`.
4. Harden `isOurGroup` in `src/hook/install.ts` with command string fallback (`h.command.includes("cxstatusline")`).
5. Add `cxstatusline policy` CLI command (`get`/`set`) for user inspection.

**Tech Stack:** TypeScript, Bun test runner, Node.js process & network APIs, Zod, shell wrapper scripts.

---

## Global Constraints

- **Never push directly to `main`**: All work on feature branch `feat/hook-direct-version-sync`.
- **Zero Startup Latency**: The SessionStart hook must never exceed Codex's 10s budget. Live probes use `AbortSignal.timeout(5000)` and fail silently to local evaluation. Heavy downloads and installs remain strictly asynchronous and detached.
- **Fail Closed & Silent**: Network errors, timeouts, or DNS failures during hook execution must never output raw errors to Codex TUI or exit non-zero.
- **Full Test Coverage**: All test suites must pass 100%.

---

## Tasks

### Task 1: Switch Default Policy to `"every"`
**Files:**
- Modify: `src/state.ts:33-40`
- Test: `test/state.test.ts`, `test/version.test.ts`, `test/hook-run.test.ts`

- [ ] **Step 1: Update test expectations for default policy in `test/state.test.ts`**
- [ ] **Step 2: Change `DEFAULT_STATE.policy` to `"every"` in `src/state.ts`**
- [ ] **Step 3: Update `test/hook-run.test.ts` patch release test (asserts acquisition instead of silent hold)**
- [ ] **Step 4: Run `bun test test/state.test.ts test/version.test.ts test/hook-run.test.ts`**
- [ ] **Step 5: Commit**
  `git commit -am "feat(state): set default update policy to every"`

---

### Task 2: Resolve Active Generation Metadata in `src/hook/run.ts`
**Files:**
- Modify: `src/hook/run.ts`
- Test: `test/hook-run.test.ts`

- [ ] **Step 1: Write unit test in `test/hook-run.test.ts`**
  Verify that when `state.patched_from` is null or desynced, `runHook` reads the active generation's `installation.json` to determine the installed version.
- [ ] **Step 2: Update `runHook` to compute `effectivePatchedFrom = readInstallation(ctx.paths)?.codexVersion ?? state.patched_from`**
- [ ] **Step 3: Run `bun test test/hook-run.test.ts` and verify all tests pass**
- [ ] **Step 4: Commit**
  `git commit -am "fix(hook): use active generation installation.json for drift detection"`

---

### Task 3: Implement Live GitHub Probe with 5-Second Timeout & Silent Fallback
**Files:**
- Modify: `src/hook/run.ts`, `src/patch/run.ts`
- Test: `test/hook-run.test.ts`

- [ ] **Step 1: Write unit tests in `test/hook-run.test.ts`**
  - Test live probe returns remote candidate within 5s timeout.
  - Test live probe timeout/network error fails silently and falls back to local candidate.
  - Test live probe bypasses 24h backoff when a new prebuilt is confirmed available.
- [ ] **Step 2: Implement `probeRemoteCandidate` and integrate into `runHook`**
- [ ] **Step 3: Run `bun test test/hook-run.test.ts` and verify**
- [ ] **Step 4: Commit**
  `git commit -am "feat(hook): add live GitHub release probe with silent timeout fallback"`

---

### Task 4: Harden Hook Group Matcher in `src/hook/install.ts`
**Files:**
- Modify: `src/hook/install.ts:25-32`
- Test: `test/hook-install.test.ts`

- [ ] **Step 1: Write test in `test/hook-install.test.ts` for command string fallback**
- [ ] **Step 2: Update `isOurGroup` in `src/hook/install.ts`**
- [ ] **Step 3: Run `bun test test/hook-install.test.ts`**
- [ ] **Step 4: Commit**
  `git commit -am "fix(hook): identify existing hook entry by command string fallback"`

---

### Task 5: Add `cxstatusline policy` CLI Command
**Files:**
- Create: `src/commands/policy.ts`
- Modify: `src/main.ts`
- Test: `test/policy.test.ts`

- [ ] **Step 1: Write tests in `test/policy.test.ts` for `policy` (get) and `policy set <p>`**
- [ ] **Step 2: Implement `src/commands/policy.ts` and wire into `src/main.ts` router and USAGE**
- [ ] **Step 3: Run `bun test test/policy.test.ts`**
- [ ] **Step 4: Commit**
  `git commit -am "feat(cli): add policy command to inspect and configure update behavior"`

---

### Task 6: Full Verification, Documentation & Pull Request
**Files:**
- Modify: `docs/usage.md`

- [ ] **Step 1: Update `docs/usage.md` with direct version comparison and `policy` CLI command**
- [ ] **Step 2: Run all test suites**
  - `bun test ./test ./src`
  - `bun run typecheck`
  - `bun run test:website`
- [ ] **Step 3: Push branch and open Pull Request**
