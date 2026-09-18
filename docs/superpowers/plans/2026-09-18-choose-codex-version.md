# Choose Codex Version on Install Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give users the choice to select and download any supported version of Codex (prebuilt or compiled) during `cxstatusline install`, via explicit CLI flag (`--codex-version <version>`) or interactive selection in terminal.

**Architecture:** 
1. Expose `supportedCodexVersions(manifest)` in `src/patch/manifest.ts` to enumerate all available versions in descending order.
2. Extend `installCommand` and `runInstall` to accept `--codex-version <version>` and `--yes` (`-y`).
3. Add interactive terminal prompt in `src/ui/prompt-version.ts` when running interactively without a specified version, allowing the user to select from available versions (defaulting to detected or latest).
4. Update `acquireLocked` in `src/patch/acquire.ts` so that when a target version is requested, it uses that version regardless of the machine's local stock Codex version, and allows prebuilt installation even when stock Codex is not pre-installed.

**Tech Stack:** TypeScript, Node/Bun standard libraries (TTY, readline), Vitest/Bun test suite.

---

## Global Constraints
- Only allow versions present in `patches/manifest.json`.
- Non-interactive runs (piped, CI, or with `--yes` / `-y`) must never block on user input and should default to detected upstream or candidate `0.155.0`.
- Maintain strict type safety across `main.ts`, `acquire.ts`, `run.ts`, and test files.

---

### Task 1: Supported Codex Versions Enumeration & Validation

**Files:**
- Modify: `src/patch/manifest.ts`
- Test: `test/manifest.test.ts`

**Interfaces:**
- Produces:
  - `supportedCodexVersions(manifest: PatchesManifest): string[]`
  - `isCodexVersionSupported(manifest: PatchesManifest, version: string): boolean`

- [ ] **Step 1: Write tests for `supportedCodexVersions` and `isCodexVersionSupported`**
- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Implement `supportedCodexVersions` and `isCodexVersionSupported` in `src/patch/manifest.ts`**
- [ ] **Step 4: Run tests to verify they pass**
- [ ] **Step 5: Commit changes**

---

### Task 2: Update Acquisition to Support Target Codex Version

**Files:**
- Modify: `src/patch/acquire.ts`
- Test: `test/acquire.test.ts`

**Interfaces:**
- Consumes: `supportedCodexVersions`, `isCodexVersionSupported` from `src/patch/manifest.ts`
- Modifies: `AcquisitionOptions` to accept optional `targetVersion?: string`
- Updates: `acquireLocked` to use `opts.targetVersion` if provided, validating against supported versions and allowing prebuilt installation even if no upstream binary was previously on disk.

- [ ] **Step 1: Write unit tests for targetVersion in acquisition (both matching and non-matching local upstream, and without local upstream)**
- [ ] **Step 2: Run tests to ensure they fail**
- [ ] **Step 3: Update `acquireLocked` in `src/patch/acquire.ts`**
- [ ] **Step 4: Run tests to ensure they pass**
- [ ] **Step 5: Commit changes**

---

### Task 3: Interactive Prompt & CLI Version Selection in Install Command

**Files:**
- Create: `src/ui/prompt-version.ts`
- Modify: `src/patch/run.ts`
- Modify: `src/main.ts`
- Test: `test/prompt-version.test.ts`
- Test: `test/main.test.ts`

**Interfaces:**
- Produces:
  - `promptCodexVersion(options: { supportedVersions: string[]; defaultVersion?: string; isTTY?: boolean; readLine?: () => Promise<string> }): Promise<string>`
- Updates:
  - `runInstall` options to accept `codexVersion?: string` and `interactive?: boolean`
  - `installCommand` to parse `--codex-version <v>`, `--codex-version=<v>`, `--yes`, `-y` and prompt if interactive and version not specified.

- [ ] **Step 1: Write tests for `promptCodexVersion` and CLI flag parsing**
- [ ] **Step 2: Run tests to ensure they fail**
- [ ] **Step 3: Implement `prompt-version.ts` and update `run.ts` & `main.ts`**
- [ ] **Step 4: Run all unit tests to ensure they pass**
- [ ] **Step 5: Commit changes**

---

### Task 4: Full Repository Verification & Documentation

**Files:**
- Modify: `README.md` (or relevant docs if installation flags are documented)
- Verify: Full test suite, package smoke check, and typecheck

- [ ] **Step 1: Run `bun run typecheck`**
- [ ] **Step 2: Run `bun run test`**
- [ ] **Step 3: Run `bun run check:package`**
- [ ] **Step 4: Commit changes and push branch**
