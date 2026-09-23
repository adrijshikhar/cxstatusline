# Changelog

All notable changes to this project will be documented in this file.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.8.0](https://github.com/adrijshikhar/cxstatusline/compare/v0.7.0...v0.8.0) (2026-09-23)


### Features

* **cli:** live GitHub prebuilt discovery, smart version selector, and update fallback ([#91](https://github.com/adrijshikhar/cxstatusline/issues/91)) ([bdb48b6](https://github.com/adrijshikhar/cxstatusline/commit/bdb48b657fcbe8658cedbcf4ca8e072efb1325fa))
* support Codex 0.156.1 ([#86](https://github.com/adrijshikhar/cxstatusline/issues/86)) ([51e2098](https://github.com/adrijshikhar/cxstatusline/commit/51e2098b7f9b8d3f4643cd0efeb819de49cc1138))


### Bug Fixes

* **patch:** resolve test signature and struct fields for codex 0.156.1 ([#90](https://github.com/adrijshikhar/cxstatusline/issues/90)) ([c3fe5ba](https://github.com/adrijshikhar/cxstatusline/commit/c3fe5ba81a812346da5c969b65029271f2bb9b1f))
* **prebuilt:** strip credsStore in temporary DOCKER_CONFIG for headless builds ([#88](https://github.com/adrijshikhar/cxstatusline/issues/88)) ([ac005c8](https://github.com/adrijshikhar/cxstatusline/commit/ac005c8b6eae355f7535955fefe4983c38981c5f))
* **widgets:** align widget hideable states, decorative collapsing, and Codex session branding with upstream ([#84](https://github.com/adrijshikhar/cxstatusline/issues/84)) ([5b02aec](https://github.com/adrijshikhar/cxstatusline/commit/5b02aec30ba7871af63f5ff8d15bddefc64d95a8))

## [0.7.0](https://github.com/adrijshikhar/cxstatusline/compare/v0.6.0...v0.7.0) (2026-09-23)


### Features

* **ci:** support multi-platform darwin-arm64 and linux-arm64 builds on self-hosted runner ([1a70319](https://github.com/adrijshikhar/cxstatusline/commit/1a70319e1f0f27ff1f4ca01944aff933f5dfff0b))
* direct version sync, live GitHub probe, and update policy configuration ([#74](https://github.com/adrijshikhar/cxstatusline/issues/74)) ([6b4092b](https://github.com/adrijshikhar/cxstatusline/commit/6b4092bf59bdabe033ab051432aaca6a8ad87eea))
* **docker:** add local Docker build script and Dockerfile for Linux prebuilts ([8f37feb](https://github.com/adrijshikhar/cxstatusline/commit/8f37febf9231b39bfcb8108a21f33c35a9ba8057))
* **docker:** set CARGO_BUILD_JOBS to 8 for 20GB memory limit ([0ec65cd](https://github.com/adrijshikhar/cxstatusline/commit/0ec65cd89ad077d61e09c4c6a8d8098110a019e8))
* support Codex 0.155.1 ([#71](https://github.com/adrijshikhar/cxstatusline/issues/71)) ([018bb21](https://github.com/adrijshikhar/cxstatusline/commit/018bb214ac7dfb5fc19f114a33ee825ec493147d))
* **upstream:** add port-cc-to-cx skill and port ccstatusline v2.2.30 ([#66](https://github.com/adrijshikhar/cxstatusline/issues/66)) ([042bcf5](https://github.com/adrijshikhar/cxstatusline/commit/042bcf594fd99ff084fcd52a8b08ddfd5ca8505f))
* **website:** add search console verification, Cloudflare analytics, and SEO drift monitoring ([#73](https://github.com/adrijshikhar/cxstatusline/issues/73)) ([0476eb5](https://github.com/adrijshikhar/cxstatusline/commit/0476eb5d83eae688f6acddef9beb99a5bb7abd7a))
* **website:** implement SEO, Open Graph, JSON-LD schema, and GEO citability ([#72](https://github.com/adrijshikhar/cxstatusline/issues/72)) ([c7db496](https://github.com/adrijshikhar/cxstatusline/commit/c7db49689ce7d1a9dc51be5e4d1e66af41a21398))


### Bug Fixes

* **ci:** ensure cargo-about is installed with cli feature on Linux runners ([f93a255](https://github.com/adrijshikhar/cxstatusline/commit/f93a255487ab6763a2c65a92b0cdca10d85f025e))
* **ci:** handle non-publishing dry runs gracefully and suppress issue creation ([df1f7a5](https://github.com/adrijshikhar/cxstatusline/commit/df1f7a5a5763fc4f258584b8fb99440c1339c4f5))
* **ci:** wrap step if expressions in valid YAML syntax ([5fd734e](https://github.com/adrijshikhar/cxstatusline/commit/5fd734eaafc8a3fa07af9a0c96422eb0fd135bee))
* **distribution:** allow local-docker run url in release manifest validation ([ee4e738](https://github.com/adrijshikhar/cxstatusline/commit/ee4e7387f32c7cc669ca763b3e7eea75861d428a))
* **docker:** ensure full system PATH in build-prebuilt-docker.sh ([cb98069](https://github.com/adrijshikhar/cxstatusline/commit/cb98069459fcd3dd5708f0944bffbdba7d22d6bd))
* **docker:** limit CARGO_BUILD_JOBS=4 to avoid container OOM ([cb8db8f](https://github.com/adrijshikhar/cxstatusline/commit/cb8db8f6adda3e8a3b840d5ae4e79f902371ca86))
* **doctor:** decouple cx_version, add codex_target diagnostic, and refine backoff messaging ([#80](https://github.com/adrijshikhar/cxstatusline/issues/80)) ([0806390](https://github.com/adrijshikhar/cxstatusline/commit/080639075a81ce13d4d58dbd6312a9820a61397e))
* **prebuilt:** allow appending missing platform assets to published releases ([3cd67af](https://github.com/adrijshikhar/cxstatusline/commit/3cd67afa51cb9519b6739f848ceb3b254c232dfc))
* **prebuilt:** deduplicate release notes title heading and update platforms on partial publish ([#82](https://github.com/adrijshikhar/cxstatusline/issues/82)) ([f8df26e](https://github.com/adrijshikhar/cxstatusline/commit/f8df26e79c4d962abe4fc09341a0dbee1f56c765))
* **prebuilt:** default WORKFLOW_URL in docker build when outside GHA ([9ad098e](https://github.com/adrijshikhar/cxstatusline/commit/9ad098e7057311f6f3d934c8673da3136806e216))
* **prebuilt:** import rmSync in release.ts ([c937e9c](https://github.com/adrijshikhar/cxstatusline/commit/c937e9cff3720974bed9cc340e4adc5951510292))
* resumable prebuilt downloads, stream idle timeout, and terminal progress cursor handling ([#78](https://github.com/adrijshikhar/cxstatusline/issues/78)) ([6e5f7c9](https://github.com/adrijshikhar/cxstatusline/commit/6e5f7c940467db5c11a2320f76079891d8860182))
* **security:** resolve dependabot vulnerabilities and harden prebuilt workflow ([#69](https://github.com/adrijshikhar/cxstatusline/issues/69)) ([e87edb4](https://github.com/adrijshikhar/cxstatusline/commit/e87edb4282b9d9547ffd439f4abc94dabac42beb))
* **verify:** check dynamic section and NEEDED in readelf -d output for ELF verification ([42e0ca3](https://github.com/adrijshikhar/cxstatusline/commit/42e0ca330c8f3320abf528c703939d698d7f9a5b))
* **website:** guard process in terminal utils and test production preview in playwright ([#70](https://github.com/adrijshikhar/cxstatusline/issues/70)) ([f5c5d4e](https://github.com/adrijshikhar/cxstatusline/commit/f5c5d4e623ac1b17a403c9d70e7a5da1585e71dd))
* **widgets:** port full speed widget architecture, window editor, and metrics from upstream ccstatusline ([#81](https://github.com/adrijshikhar/cxstatusline/issues/81)) ([cf914ac](https://github.com/adrijshikhar/cxstatusline/commit/cf914ac0fbdae49263cf921ab4f6cc313e0c5b31))

## [0.6.0](https://github.com/adrijshikhar/cxstatusline/compare/v0.5.1...v0.6.0) (2026-09-18)


### Features

* **distribution:** add Linux support ([#31](https://github.com/adrijshikhar/cxstatusline/issues/31)) ([#60](https://github.com/adrijshikhar/cxstatusline/issues/60)) ([a6089fb](https://github.com/adrijshikhar/cxstatusline/commit/a6089fb14a4a0090b382cb7ea6fc5b8d98d5c108))
* **distribution:** independent prebuilt versioning ([#53](https://github.com/adrijshikhar/cxstatusline/issues/53)) ([52db4de](https://github.com/adrijshikhar/cxstatusline/commit/52db4de94bf2fff3214b3df2ed2f6257064a2399))
* **install:** allow selecting Codex version via CLI flag and interactive prompt ([#57](https://github.com/adrijshikhar/cxstatusline/issues/57)) ([dbc47d5](https://github.com/adrijshikhar/cxstatusline/commit/dbc47d5a6c56e2fa6e7d4fa7b179bf292f0cbbdc))
* **website:** landing page simplification and playground refinements ([#58](https://github.com/adrijshikhar/cxstatusline/issues/58)) ([57ca195](https://github.com/adrijshikhar/cxstatusline/commit/57ca195439a2103e61863c1f8f54207eb7899375))
* **widgets:** add five-hour usage and reset timer widgets ([#59](https://github.com/adrijshikhar/cxstatusline/issues/59)) ([a8a6bc6](https://github.com/adrijshikhar/cxstatusline/commit/a8a6bc6b0e413aeb7a44912dd52c417745449981))

## [0.5.1](https://github.com/adrijshikhar/cxstatusline/compare/v0.5.0...v0.5.1) (2026-09-18)


### Bug Fixes

* **prebuilt:** default REQUESTED_PLATFORMS to arm64 when self_hosted is true ([#49](https://github.com/adrijshikhar/cxstatusline/issues/49)) ([6d16711](https://github.com/adrijshikhar/cxstatusline/commit/6d16711584ff5c9786d600798a69ca59098a3901))
* **prebuilt:** scope validate step test to ./test ./src ([#52](https://github.com/adrijshikhar/cxstatusline/issues/52)) ([f2e6a8d](https://github.com/adrijshikhar/cxstatusline/commit/f2e6a8d9a060489794389137fd7f89a1d02bf152))

## [0.5.0](https://github.com/adrijshikhar/cxstatusline/compare/v0.4.1...v0.5.0) (2026-09-18)


### Features

* support Codex 0.155.0 ([#44](https://github.com/adrijshikhar/cxstatusline/issues/44)) ([08b4928](https://github.com/adrijshikhar/cxstatusline/commit/08b4928b4eb90a69398f533cd6f822b59c9614f3))
* **upstream-watch:** include changelog and highlighted relevant changes in issues and PRs ([#46](https://github.com/adrijshikhar/cxstatusline/issues/46)) ([c476a32](https://github.com/adrijshikhar/cxstatusline/commit/c476a3214e99f193c5ee68390f9f2f06fbf7fabe))

## [0.4.1](https://github.com/adrijshikhar/cxstatusline/compare/v0.4.0...v0.4.1) (2026-09-15)


### Bug Fixes

* calculate live working tree diff in git-changes widget ([#26](https://github.com/adrijshikhar/cxstatusline/issues/26)) ([cc3b56b](https://github.com/adrijshikhar/cxstatusline/commit/cc3b56bf74885b3d6c8aeef64d25da36ddae15e5))

## [0.4.0](https://github.com/adrijshikhar/cxstatusline/compare/v0.3.0...v0.4.0) (2026-09-14)


### Features

* add user-defined widgets (custom text, symbol, command) ([06796b7](https://github.com/adrijshikhar/cxstatusline/commit/06796b7ea4573ed22ccb0193081b9f263c717b63))
* cache custom command output and refresh it in the background ([#17](https://github.com/adrijshikhar/cxstatusline/issues/17)) ([46f7841](https://github.com/adrijshikhar/cxstatusline/commit/46f78417e7c84d4044c0d954359b94d2594ae785))
* upstream parity catch-up to ccstatusline v2.2.29 ([#21](https://github.com/adrijshikhar/cxstatusline/issues/21)) ([a1a4f56](https://github.com/adrijshikhar/cxstatusline/commit/a1a4f563aaefee638ea15fc6a9cf5415575fa3b2))


### Bug Fixes

* **tui:** keep widget edits when navigating back ([#18](https://github.com/adrijshikhar/cxstatusline/issues/18)) ([a663f6a](https://github.com/adrijshikhar/cxstatusline/commit/a663f6af78dd031a1eb0608070a4dcdb1b8bbb00))

## [0.3.0](https://github.com/adrijshikhar/cxstatusline/compare/v0.2.0...v0.3.0) (2026-09-12)


### Features

* **cli:** bring premium TUI look to install and doctor commands ([#7](https://github.com/adrijshikhar/cxstatusline/issues/7)) ([9cb7a9f](https://github.com/adrijshikhar/cxstatusline/commit/9cb7a9f2584f5f793c573312dfe03bbf8d07ab50))
* **ui:** add live progress bar for prebuilt downloads and compile stages ([9398583](https://github.com/adrijshikhar/cxstatusline/commit/9398583d73a5ce97ff0f87e68c701a3e02bf536d))


### Bug Fixes

* **doctor:** clarify cx_version diagnostic label as cli vs generation ([#9](https://github.com/adrijshikhar/cxstatusline/issues/9)) ([c1aa110](https://github.com/adrijshikhar/cxstatusline/commit/c1aa1101e965224ca4f845d0b19a95d90e09ab8b))
* **doctor:** condense multiline compiler traces to single line summary ([#8](https://github.com/adrijshikhar/cxstatusline/issues/8)) ([b8e4fd1](https://github.com/adrijshikhar/cxstatusline/commit/b8e4fd160157f790004ca37f9d2391b8e27ecd02))
* **patch:** add recursion limit and local settings fix for codex 0.154.0 ([b2fa290](https://github.com/adrijshikhar/cxstatusline/commit/b2fa290d2249834d2eeda2bd4cfa5489f843fa47))
* **prebuilt:** allow appending missing assets to existing release ([7d899f5](https://github.com/adrijshikhar/cxstatusline/commit/7d899f5fa093ed4b709248da6ca108464c31ad16))
* **version:** read version from package.json instead of hardcoded fallback ([4d395bd](https://github.com/adrijshikhar/cxstatusline/commit/4d395bd75b4a2ab5c66aeecf3cf8472b8d57769c))

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
