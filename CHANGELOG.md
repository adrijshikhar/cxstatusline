# Changelog

All notable changes to this project will be documented in this file.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.2.0](https://github.com/adrijshikhar/cxstatusline/compare/v0.1.1...v0.2.0) (2026-09-11)


### Features

* add exact prebuilt release validation (distribution.ts) ([8d57ca9](https://github.com/adrijshikhar/cxstatusline/commit/8d57ca93b4e399470d23dc909e5183575099bcab))
* audit Rust dependency licenses and ship generated notices in the archive ([97da0da](https://github.com/adrijshikhar/cxstatusline/commit/97da0dafe0b9fd2f3b2bf8f917a291cea837b7e2))
* bound the staged codex version probe with a timeout ([1cc222f](https://github.com/adrijshikhar/cxstatusline/commit/1cc222fe6c4e27a1c5ccb85d815c6f0388ce376a))
* build darwin-x64 on hosted runners and publish multi-archive releases ([7265084](https://github.com/adrijshikhar/cxstatusline/commit/72650843cf523975e2ac88e4ce59f6f7b1d72c98))
* build, package and verify the arm64 prebuilt release artifact ([fcd617c](https://github.com/adrijshikhar/cxstatusline/commit/fcd617cb1014ffc90f3f42c56703cebff624166d))
* download and stage an untrusted prebuilt archive safely ([e379d45](https://github.com/adrijshikhar/cxstatusline/commit/e379d454ca4b1026bb68422cb26b8777be7cfe3d))
* initial cxstatusline 0.1.0 ([b339608](https://github.com/adrijshikhar/cxstatusline/commit/b339608c83ce9207ecf3c4120caff2217dc8aab2))
* make one generation the unit of activation ([1b1e2c7](https://github.com/adrijshikhar/cxstatusline/commit/1b1e2c7972afdc9dbe0ad23d42ef224c259b2c70))
* make prebuilt download the default install and compilation explicit ([d17471e](https://github.com/adrijshikhar/cxstatusline/commit/d17471e04397b1b2af6e65de45828ef35161aa2e))
* name the newest supported Codex candidate in the patch manifest ([2a11b1c](https://github.com/adrijshikhar/cxstatusline/commit/2a11b1ccb5dbcb44f994cfcc9ca6e86815539635))
* polish README and add a repeatable terminal demo ([0459063](https://github.com/adrijshikhar/cxstatusline/commit/04590632e460935c759df495708f03cb82fa6b32))
* publish the prebuilt release atomically and report failures ([735f325](https://github.com/adrijshikhar/cxstatusline/commit/735f3251eb9a72631ea67a5d6b0f9e82e7f7214e))
* report actual installation health in doctor ([cdf2d85](https://github.com/adrijshikhar/cxstatusline/commit/cdf2d85f94a0d6f9ed40272d6f0650ff43e1550d))
* support Codex 0.153.4 ([f237f61](https://github.com/adrijshikhar/cxstatusline/commit/f237f612b34ca5cc8188f80ce3c50286c5f88381))
* support Codex 0.154.0 ([#6](https://github.com/adrijshikhar/cxstatusline/issues/6)) ([387e923](https://github.com/adrijshikhar/cxstatusline/commit/387e9236a2dfebe4f8ea5a6c0e522180ea58ec4f))
* warn and stop before updating codex if prebuilt binaries are unavailable ([72c5f00](https://github.com/adrijshikhar/cxstatusline/commit/72c5f00cada425dd684cea43fa35944fccaa0f58))


### Bug Fixes

* file blocked-detect issues correctly, capture failure logs, hash patches from the frozen commit ([fe49f7d](https://github.com/adrijshikhar/cxstatusline/commit/fe49f7daf6101ae5fc19d8e5c22ec901c3703768))
* guard doctor digest reads and share generation containment check ([1a399a1](https://github.com/adrijshikhar/cxstatusline/commit/1a399a179e5b24b09188e8d9ed450332fad4208e))
* **patch:** configure verified OpenAI Codex V8 dependencies before local cargo build ([1dcc2e2](https://github.com/adrijshikhar/cxstatusline/commit/1dcc2e2e8e6a024a7af5b1592f7a11750b2e55e9))
* persist upstream_bin on activation, validate installation.json fully, make ensureWrapper generation-aware ([884d06b](https://github.com/adrijshikhar/cxstatusline/commit/884d06bcfee95a3c9c3fed573a46dbeb82085efd))
* record the real prebuilt failure reason; reserve release-unavailable for not-found ([e6e2511](https://github.com/adrijshikhar/cxstatusline/commit/e6e251120df7b938a762614a09cb48565f2698d0))
* refuse to reset an upstream or staging directory we did not create ([97bd7fb](https://github.com/adrijshikhar/cxstatusline/commit/97bd7fb965eb9124e8db56ae75930181e466e973))
* report the issue writes that completed before a reporter API failure ([313efbb](https://github.com/adrijshikhar/cxstatusline/commit/313efbba65ab3d5fc710044897f8e07c47706a1c))
* stamp the frozen source commit into the release manifest ([8785a26](https://github.com/adrijshikhar/cxstatusline/commit/8785a264b7c199269506f0e75aa2ddedd361c393))
* stream prebuilt packaging, narrow detect exit codes, add build caches ([aa68439](https://github.com/adrijshikhar/cxstatusline/commit/aa68439f83a1cd38df0cfca6cc7cf44d51c2c3d2))
* verify the selected artifact, clean staging debris, bound the gh download ([9ca8b33](https://github.com/adrijshikhar/cxstatusline/commit/9ca8b33343e7422869f7d5902801d39a8918ef98))

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
