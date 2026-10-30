# Agent Guidelines & Workflow Rules

## Branch & Pull Request Policy

- **Never push directly to `main`**: Direct pushes to `main` are strictly blocked by both remote branch protection (`enforce_admins: true`) and local pre-push git hooks.
- **Always use Git Worktrees for Development**: All feature, bugfix, and chore development must occur within an isolated git worktree created in `.worktrees/<branch-name>` off `main`. Never perform code edits directly in the primary checkout.
  ```bash
  git worktree add .worktrees/<branch-name> -b <branch-name> main
  cd .worktrees/<branch-name> && bun install --frozen-lockfile
  ```
- **Always branch off `main`**: Create a descriptive branch for your work:
  - `fix/<issue-or-topic>` for bug fixes
  - `feat/<feature-name>` for new features
  - `chore/<task-name>` for maintenance, configurations, or CI adjustments
  - `ci/<task-name>` for GitHub Actions workflows
- **Always open a Pull Request**:
  - PR titles MUST follow Conventional Commits format (`fix: ...`, `feat: ...`, `chore: ...`, etc.) so release-please and release pipelines can parse changelogs properly.
  - Provide a clear summary and verify that local tests (`bun test ./test ./src`) pass before submitting.

## Mandatory Build Machine Policy

- All Codex/Rust prebuilt builds run on the owner's M5 Pro, using GitHub Actions runner labels `[self-hosted, macOS, ARM64, m5-pro]`.
- macOS builds run natively on that M5; Linux builds run through Docker on the same M5. Linux is not a reason to select a hosted Linux runner.
- Never use GitHub-hosted runners or the current laptop for Codex/Rust builds. Never change runner selection because the M5 is offline, asleep, unreachable, or busy. Wait and tell the user the M5 and its runner must be active.
- Before dispatching a prebuilt workflow, check the exact workflow ref and all resolved runner labels. Old tags may still expose hosted options: do not dispatch them. Use a ref with the M5-only guardrail.
- State that the M5 is required whenever these builds are pending. Do not tell the user it can sleep until all M5 work is finished.
- Run platform builds sequentially and preserve the existing compiler settings: 3 jobs for native macOS and 4 inside Docker (tuned from 8 to stay within Docker Desktop's 20GB memory limit). Do not tune these limits without an explicit user request. Keep existing verified outputs; do not restart expensive builds unnecessarily.
- A different build machine requires an explicit new user instruction. General permission to continue or release does not authorize a runner change.

- Preserve the existing rebuilder toolchain/setup. Do not add hosted-runner bootstrap actions, Python installers, or new environment dependencies without an explicit user request. Run the existing build/test flow on the M5; keep supplemental footer smoke checks separate from builder setup.

## Codex Version Support Policy

- **Supported Baseline Versions**: Support the baseline `.0` release of each Codex minor line (e.g., `0.161.0`, `0.162.0`, `0.163.0`, `0.164.0`).
- **Active Series Coverage**: In the newest/active minor series (currently `0.166.x`), support all stable releases including the latest patch release.
- **Skipping Intermediate Patch Releases**: Intermediate patch releases in older minor series (such as `0.162.1` or `0.161.1`) are intentionally skipped and not ported once a newer minor series is released.
