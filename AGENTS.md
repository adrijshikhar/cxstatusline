# Agent Guidelines & Workflow Rules

## Branch & Pull Request Policy

- **Never push directly to `main`**: Direct pushes to `main` are strictly blocked by both remote branch protection (`enforce_admins: true`) and local pre-push git hooks.
- **Always branch off `main`**: Create a descriptive branch for your work:
  - `fix/<issue-or-topic>` for bug fixes
  - `feat/<feature-name>` for new features
  - `chore/<task-name>` for maintenance, configurations, or CI adjustments
  - `ci/<task-name>` for GitHub Actions workflows
- **Always open a Pull Request**:
  - PR titles MUST follow Conventional Commits format (`fix: ...`, `feat: ...`, `chore: ...`, etc.) so release-please and release pipelines can parse changelogs properly.
  - Provide a clear summary and verify that local tests (`bun test ./test ./src`) pass before submitting.

## Mandatory Build Machine Policy

- All Codex/Rust prebuilt builds run on the owner's M5 Pro at `192.168.1.65`, using GitHub Actions runner labels `[self-hosted, macOS, ARM64, m5-pro]`.
- macOS builds run natively on that M5; Linux builds run through Docker on the same M5. Linux is not a reason to select a hosted Linux runner.
- Never use GitHub-hosted runners or the current laptop for Codex/Rust builds. Never change runner selection because the M5 is offline, asleep, unreachable, or busy. Wait and tell the user the M5 and its runner must be active.
- Before dispatching a prebuilt workflow, check the exact workflow ref and all resolved runner labels. Old tags may still expose hosted options: do not dispatch them. Use a ref with the M5-only guardrail.
- State that the M5 is required whenever these builds are pending. Do not tell the user it can sleep until all M5 work is finished.
- Run platform builds sequentially and preserve the existing compiler settings: 3 jobs for native macOS and 8 inside Docker. Do not tune these limits without an explicit user request. Keep existing verified outputs; do not restart expensive builds unnecessarily.
- A different build machine requires an explicit new user instruction. General permission to continue or release does not authorize a runner change.

- Preserve the existing rebuilder toolchain/setup. Do not add hosted-runner bootstrap actions, Python installers, or new environment dependencies without an explicit user request. Run the existing build/test flow on the M5; keep supplemental footer smoke checks separate from builder setup.
