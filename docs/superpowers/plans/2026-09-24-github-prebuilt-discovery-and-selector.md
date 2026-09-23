# GitHub Prebuilt Discovery and Smart Version Selector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Derive available prebuilt Codex versions directly from GitHub Releases (`codex-v*`), integrate live prebuilt status into the interactive version selector for both `cxstatusline install` and `cxstatusline update`, and prevent the CLI from ever attempting to download a non-existent prebuilt release.

**Architecture:**
1. Add `fetchPublishedPrebuiltVersions` in `src/distribution/prebuilt.ts` querying `https://api.github.com/repos/adrijshikhar/cxstatusline/releases` with timeout and offline fallback, returning sorted Codex versions with published prebuilts.
2. Enhance `promptCodexVersion` in `src/ui/prompt-version.ts` to annotate versions with `[prebuilt available]` vs `[compile from source]`. If a user selects a version without a published prebuilt during a standard install, prompt them to confirm whether they want to compile from source rather than failing with an unhandled 404.
3. Update `installCommand` in `src/main.ts` to pass live prebuilt availability and default to the highest available published prebuilt version.
4. Update `updateCommand` / `runUpdate` in `src/patch/run.ts` and `src/main.ts` so that when upstream Codex has an update without published prebuilts, interactive sessions seamlessly launch the selector showing available prebuilts and options instead of crashing with an error code.
5. Update `doctor.ts` to surface the highest live prebuilt when the target candidate prebuilt is pending.

**Tech Stack:** TypeScript, Node/Bun fetch API, readline TTY interaction, Bun test suite.

---

## Global Constraints
- Strictly follow `AGENTS.md`: Never push directly to `main`; all work on `feat/github-prebuilt-discovery-and-selector`.
- Network calls must have short timeouts (maximum 5000ms via `AbortSignal.timeout(5000)`) and must fail-closed/offline gracefully without crashing or throwing unhandled rejections.
- Maintain 100% backward compatibility for non-interactive / CI invocations (`--yes`, `-y`, `--codex-version=<v>`).
- All existing tests (`bun test ./test ./src`) must pass.

---

### Task 1: GitHub Prebuilt Release Discovery Helper

**Files:**
- Modify: `src/distribution/prebuilt.ts`
- Create: `test/prebuilt-discovery.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export async function fetchPublishedPrebuiltVersions(
    fetchFn?: FetchLike,
    repo?: string,
  ): Promise<string[]>
  ```
  - Queries `https://api.github.com/repos/<repo>/releases?per_page=100`
  - Filters for releases with tag `codex-v<semver>` (ignoring drafts)
  - Sorts versions descending by semver
  - Returns empty array on network failure, timeout, or invalid JSON.

- [x] **Step 1: Write unit tests in `test/prebuilt-discovery.test.ts` covering success, filtering, sorting, and error fallback**
- [x] **Step 2: Run `bun test test/prebuilt-discovery.test.ts` to verify failures**
- [x] **Step 3: Implement `fetchPublishedPrebuiltVersions` in `src/distribution/prebuilt.ts`**
- [x] **Step 4: Run `bun test test/prebuilt-discovery.test.ts` to verify passes**
- [x] **Step 5: Commit changes**

---

### Task 2: Enhanced Interactive Version Selector with Prebuilt Annotations

**Files:**
- Modify: `src/ui/prompt-version.ts`
- Modify: `test/prompt-version.test.ts`

**Interfaces:**
- Updates `PromptVersionOptions`:
  ```ts
  export interface PromptVersionItem {
    readonly version: string;
    readonly hasPrebuilt: boolean;
  }
  export interface PromptVersionOptions {
    readonly items: readonly PromptVersionItem[];
    readonly defaultVersion?: string;
    readonly isTTY?: boolean;
    readonly say?: (line: string) => void;
    readonly ask?: (question: string) => Promise<string>;
    readonly confirmCompile?: (version: string) => Promise<boolean>;
  }
  export interface PromptVersionResult {
    readonly version: string;
    readonly compile: boolean;
  }
  ```
- Renders:
  ```text
  Select Codex version to install:
    1) 0.155.1  [prebuilt available] (recommended / default)
    2) 0.155.0  [prebuilt available]
    3) 0.156.1  [compile from source - prebuilt pending]
  ```
- If a user selects `0.156.1` and `compile` was not already requested:
  Asks: `No prebuilt binary is published for Codex 0.156.1 yet. Would you like to compile from source instead? [y/N]`
  - If Yes -> returns `{ version: "0.156.1", compile: true }`
  - If No -> reprompts the user or cancels.

- [x] **Step 1: Write unit tests in `test/prompt-version.test.ts` testing item annotations and source compilation confirmation**
- [x] **Step 2: Run `bun test test/prompt-version.test.ts` to verify failures**
- [x] **Step 3: Implement the updated selector in `src/ui/prompt-version.ts`**
- [x] **Step 4: Run `bun test test/prompt-version.test.ts` to verify passes**
- [x] **Step 5: Commit changes**

---

### Task 3: Integrate Live Discovery into `cxstatusline install`

**Files:**
- Modify: `src/main.ts`
- Test: `test/main-install.test.ts`

**Interfaces:**
- Consumes: `fetchPublishedPrebuiltVersions` from `src/distribution/prebuilt.ts` and `promptCodexVersion` from `src/ui/prompt-version.ts`.
- In `installCommand`:
  - Fetches published prebuilts when running in interactive TTY mode without an explicit `--codex-version`.
  - Determines default version:
    - If detected upstream Codex has a prebuilt, use it.
    - Otherwise, use the highest available published prebuilt version (e.g. `0.155.1`), avoiding pending versions.
  - If user confirms compilation on a pending version, sets `compile = true`.

- [x] **Step 1: Write integration tests in `test/main-install.test.ts` verifying prebuilt discovery, default selection, and compile fallback**
- [x] **Step 2: Run `bun test test/main-install.test.ts` to verify failure**
- [x] **Step 3: Implement integration in `src/main.ts`**
- [x] **Step 4: Run `bun test test/main-install.test.ts` to verify passes**
- [x] **Step 5: Commit changes**

---

### Task 4: Interactive Prebuilt Fallback Selector in `cxstatusline update`

**Files:**
- Modify: `src/patch/run.ts`
- Modify: `src/main.ts`
- Modify: `test/patch-run.test.ts`

**Interfaces:**
- In `runUpdate`:
  - When upstream Codex update is available (e.g. `0.156.1`) and `probePrebuiltExists(latest)` is `false`:
  - If running interactively (TTY) and without `--force` / `--compile`:
    - Query published prebuilts.
    - If a newer prebuilt than active is available (e.g. `0.155.1` > `0.154.0`):
      - Launch the selector with options to install the available prebuilt, compile from source, update stock, or cancel.
      - If user picks the available prebuilt, run acquisition for that target version immediately.
  - If non-interactive: print the detailed options including the available prebuilt command and exit 1.

- [x] **Step 1: Write unit tests in `test/patch-run.test.ts` verifying interactive update selector launch and non-interactive output**
- [x] **Step 2: Run `bun test test/patch-run.test.ts` to verify failure**
- [x] **Step 3: Implement interactive update fallback in `src/patch/run.ts` and `src/main.ts`**
- [x] **Step 4: Run `bun test test/patch-run.test.ts` to verify passes**
- [x] **Step 5: Commit changes**

---

### Task 5: Enhance `doctor.ts` Guidance for Pending Targets

**Files:**
- Modify: `src/commands/doctor.ts`
- Modify: `test/doctor.test.ts`

**Interfaces:**
- In `codex_target`:
  - When target candidate prebuilt is pending, check if an intermediate version has a live prebuilt on GitHub.
  - Display:
    `codex_target: 0.156.1 supported (active: 0.154.0; prebuilt pending; 0.155.1 prebuilt available on GitHub)`

- [x] **Step 1: Write test in `test/doctor.test.ts` asserting intermediate prebuilt availability line**
- [x] **Step 2: Implement doctor formatting update in `src/commands/doctor.ts`**
- [x] **Step 3: Run `bun test test/doctor.test.ts` to verify passes**
- [x] **Step 4: Commit changes**

---

### Task 6: End-to-End Verification & Pull Request

**Files:**
- Documentation: `docs/usage.md`
- Pull Request

- [x] **Step 1: Run full test suite: `bun test ./test ./src`**
- [x] **Step 2: Run typecheck: `bun run typecheck`**
- [x] **Step 3: Run package check: `bun run check:package`**
- [x] **Step 4: Push branch `feat/github-prebuilt-discovery-and-selector` to `origin`**
- [x] **Step 5: Open Pull Request via `gh pr create` with Conventional Commits title**
