---
name: support-codex-version
description: Use when upstream OpenAI Codex releases a new version, when adding or updating patches for a Codex release, or when resolving coverage gaps in patches/manifest.json
---

# Supporting Upstream OpenAI Codex Releases

This skill guides agents through triaging, patching, and verifying support for new upstream OpenAI Codex releases in `cxstatusline`.

## Overview

`cxstatusline` integrates with upstream OpenAI Codex by applying surgical patches to `codex-rs/tui` that reserve terminal lines, draw statusline widgets, and handle background rate limit refreshes.

Each supported Codex version requires:
1. An explicit patch file in `patches/codex-<version>.patch`.
2. A manifest entry and candidate declaration in `patches/manifest.json`.
3. Synchronized unit tests in `test/manifest.test.ts` and `test/package.test.ts`.
4. Passing local verification gates.

The automated CLI tool `scripts/codex_port.py` handles the mechanical steps.

---

## When to Use

- A new upstream tag `rust-v<version>` is released by `openai/codex`.
- An automated coverage audit issue (e.g. Issue #111) reports an unsupported release gap.
- An existing patch produces conflicts against a newly released Codex minor or patch release.

When NOT to use:
- Porting features from `sirmalloc/ccstatusline` (use `port-cc-to-cx` instead).
- Compiling prebuilts or releasing binaries on GitHub (use `release-codex-prebuilt` instead).

---

## Version Support Policy

Per repository policy in `AGENTS.md`:
- **Baseline Releases**: The `.0` baseline release of every Codex minor line (e.g., `0.161.0`, `0.162.0`, `0.163.0`, `0.164.0`) MUST be supported.
- **Active Series Coverage**: In the newest/active minor series (currently `0.164.x`), ALL stable releases and latest patch releases MUST be supported.
- **Excluded Intermediate Patches**: Intermediate patch releases in older minor series (e.g. `0.162.1`, `0.161.1`) are intentionally omitted once a newer minor series is released.

---

## Step-by-Step Workflow

### Step 1: Audit Coverage & Gaps
Run the audit command to check upstream releases against policy:
```bash
python3 scripts/codex_port.py check
```
This inspects upstream `openai/codex` tags, classifies each release, and lists any open gaps.

### Step 2: Create a Feature Branch
Always branch off `main`:
```bash
git checkout main
git pull origin main
git checkout -b feat/support-codex-<version>
```
*Never push directly to `main`.*

### Step 3: Prepare & Test the Patch
Run the patch tool for the target version:
```bash
python3 scripts/codex_port.py patch <version>
```
* **Clean Case**: Automatically creates `patches/codex-<version>.patch`, updates `patches/manifest.json`, updates `test/manifest.test.ts`, and updates `test/package.test.ts`.
* **Conflicted Case**: Identifies conflicted hunks and leaves `/tmp/codex-<version>` with `.rej` files. Follow [references/conflict-resolution.md](references/conflict-resolution.md) to inspect upstream diffs and adjust hook insertions.

### Step 4: Run Verification Gates
Validate patch application and run all repository tests:
```bash
python3 scripts/codex_port.py verify <version>
```
This runs:
1. `git apply --check` against the upstream checkout.
2. `bun test ./test ./src`
3. `bun run typecheck`
4. `bun run build`
5. `bun run check:package`
6. `bun scripts/prebuilt.ts detect` (verifying `should_build=true`).

### Step 5: Submit Pull Request
1. Commit changes using Conventional Commits:
   ```bash
   git add patches/ test/ docs/
   git commit -m "feat: support Codex <version>"
   ```
2. Push branch and open PR:
   ```bash
   git push -u origin feat/support-codex-<version>
   gh pr create --title "feat: support Codex <version>" --body "..."
   ```

---

## Mandatory Build Machine Reminder

**CRITICAL**: Do NOT compile Rust or Codex binaries on the local machine or attempt to run prebuilt package builds locally. All Rust prebuilt builds MUST run on the owner's self-hosted M5 Pro runner (`[self-hosted, macOS, ARM64, m5-pro]`). See `release-codex-prebuilt` for binary release procedures.

---

## Common Mistakes

| Mistake | Correction |
|---|---|
| Pushing directly to `main` | Branch protection blocks this; always create `feat/support-codex-<version>`. |
| Compiling Rust locally on laptop | Forbidden by `AGENTS.md`. Local verification only touches TypeScript tests and `git apply --check`. |
| Forgetting `test/package.test.ts` | `scripts/codex_port.py patch` updates this automatically; verify with `bun run check:package`. |
| Modifying candidate backwards | Candidate must always reflect the newest supported release. |
