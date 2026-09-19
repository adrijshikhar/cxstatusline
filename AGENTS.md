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
