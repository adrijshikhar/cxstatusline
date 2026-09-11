# Changelog

All notable changes to this project will be documented in this file.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## 0.1.1 — 2026-09-11

### Added
- Prebuilt native Codex distribution for macOS Apple Silicon (`darwin-arm64`) and Intel (`darwin-x64`).
- Immutable generation directory layout (`~/.local/libexec/cxstatusline/generations/<id>/`) with atomic symlink activation.
- Exact-version release manifest schema (`manifest.json`) and checksum validation (`SHA256SUMS`).
- Automated upstream detection and daily scheduled build pipeline in GitHub Actions.
- Rust dependency license audit via `cargo deny` and generated notices via `cargo about`.
- Standalone multi-platform merge and verification tools for release packaging.
- Automated npm and source-release publication pipeline with provenance in GitHub Actions.

### Changed
- `cxstatusline install` defaults to downloading verified prebuilt pairs; compilation is now explicit via `cxstatusline install --compile`.
- `cxstatusline update` downloads prebuilt releases matching updated Codex versions.
- `cxstatusline doctor` reports generation status, active source, release digest, and binary health.
- Prebuilt release archive standardized to exactly five files: `codex`, `codex-code-mode-host`, `LICENSE`, `NOTICE`, and `THIRD_PARTY_NOTICES.md`.

## 0.1.0

### Added
- Initial release: configurable one-to-three-row statusline for OpenAI Codex CLI.
- Interactive configuration TUI with live previews and Powerline theme support.
- Native widgets: model, context, Git branch/status, session duration, and usage timers.
- Presets import/export compatible with ccstatusline layouts.
- SessionStart hook integration for background update checks.
- Diagnostic commands (`cxstatusline doctor`, `cxstatusline revert`).
