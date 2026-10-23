---
name: release-codex-prebuilt
description: Use when building, testing, verifying, or publishing prebuilt Codex binaries and release assets for cxstatusline
---

# Prebuilt Codex Binary Releases & Runner Orchestration

This skill guides agents and operators through building, testing, and releasing prebuilt binary assets for supported OpenAI Codex versions.

## Overview

`cxstatusline` ships standalone prebuilt packages (`codex-v<version>-<platform>.tar.gz`) containing patched Codex CLI and app-server binaries, bundled V8 runtimes, and license notices.

All prebuilt builds are subject to the **Mandatory Build Machine Policy**:
- **Owner's M5 Pro Only**: All Rust builds run on `192.168.1.65` using runner labels `[self-hosted, macOS, ARM64, m5-pro]`.
- **No Local Rust Compilation**: Never build Codex or Rust on developer laptops.
- **No GitHub-Hosted Runners**: Prebuilt workflows strictly block execution if dispatched to hosted runners.

The CLI tool `scripts/codex_prebuilt.py` automates runner health checks, workflow dispatch, and asset validation.

---

## When to Use

- After a support PR (e.g. `feat: support Codex <version>`) has been merged to `main`.
- To trigger scheduled or ad-hoc binary builds for a newly supported Codex candidate.
- To verify that published release assets on GitHub match required checksums and manifests.

When NOT to use:
- Generating patches or updating `patches/manifest.json` (use `support-codex-version` instead).
- Releasing the `cxstatusline` npm package itself (use `scripts/release-npm.ts`).

---

## Step-by-Step Workflow

### Step 1: Verify M5 Pro Runner Health
Before dispatching any workflow, check that the self-hosted M5 Pro runner is online and active:
```bash
python3 scripts/codex_prebuilt.py check-runner
```
* **If Online**: Output shows `Status: ONLINE` and `State: IDLE (ready)`.
* **If Offline**: Stop. Notify the user that the M5 Pro at `192.168.1.65` must be online and active before proceeding. Never change runner labels or attempt local builds.

### Step 2: Dispatch Prebuilt Release Workflow
Dispatch the `.github/workflows/prebuilt.yml` workflow on the M5 Pro runner:
```bash
# Dry-run build (build and test without publishing)
python3 scripts/codex_prebuilt.py dispatch --version <version>

# Production publish build (build, verify, and publish assets to GitHub release)
python3 scripts/codex_prebuilt.py dispatch --version <version> --publish
```
The tool validates that the target ref contains strict M5-only runner labels before triggering dispatch.

### Step 3: Monitor Execution
Watch the dispatched workflow run until completion:
```bash
python3 scripts/codex_prebuilt.py watch
```
The workflow executes:
1. `detect`: Resolves release inputs and manifest candidate.
2. `native`: Builds macOS natively (3 jobs) and Linux via Docker (4 jobs) on M5 Pro.
3. `merge`: Merges platform artifacts into a unified distribution manifest.
4. `publish`: Uploads tarballs, checksums, and manifest to GitHub release `codex-v<version>`.

### Step 4: Verify Release Assets
Validate published artifacts on GitHub:
```bash
python3 scripts/codex_prebuilt.py verify-release <version>
```
Confirms the presence of:
- `codex-v<version>-darwin-arm64.tar.gz`
- `codex-v<version>-linux-arm64.tar.gz`
- `manifest.json`
- `SHA256SUMS`

### Step 5: Close Coverage Gap Issues
If an open tracking issue exists (e.g. Issue #111 "Codex release coverage gaps"), comment with links to the verified prebuilt release and close or update the issue.

---

## Common Mistakes

| Mistake | Correction |
|---|---|
| Building Rust on current laptop | Strictly forbidden. All Codex/Rust compilation runs on M5 Pro. |
| Changing runner labels to `macos-latest` | Prohibited by policy. Wait until M5 Pro is online. |
| Overriding Docker compiler jobs | Preserved at 4 jobs to stay within Docker Desktop's 20GB limit. |
| Running `publish` on unmerged branch | Prebuilt releases should normally build from merged `main` or release tag. |
