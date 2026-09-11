<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/banner-dark.png">
  <img alt="cxstatusline" src="docs/banner-light.png" width="720">
</picture>

# cxstatusline

**⚡ Your Codex session, at a glance.**

*Model, context, Git, usage, and reset timers. Your terminal, your layout.*

[![CI](https://github.com/adrijshikhar/cxstatusline/actions/workflows/ci.yml/badge.svg)](https://github.com/adrijshikhar/cxstatusline/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Node.js 22+](https://img.shields.io/badge/node-%E2%89%A522-green)](https://nodejs.org/)

![cxstatusline configurator: adding a widget and changing colors with live sample-data previews](docs/demo.gif)

</div>

## ✨ Features

A configurable, one-to-three-row statusline for [OpenAI Codex CLI](https://github.com/openai/codex),
with an interactive configuration TUI, colors, Powerline themes and preset import/export.
See model, context, Git, session duration, usage percentages and reset times without leaving Codex.
Available data depends on your session and account.

Independent project; not an official OpenAI product.

<details>
<summary>See the footer inside Codex</summary>

![cxstatusline footer inside Codex](docs/statusline.png)

</details>

## Requirements

- **macOS 14 (Sonoma) or newer** on Apple Silicon (`darwin-arm64`) or Intel (`darwin-x64`). Clean-macOS-14 acceptance is unproven and evidenced only by build metadata (`MACOSX_DEPLOYMENT_TARGET=14.0`, `vtool` `minos`, and system-only `otool -L` linkage).
- **Node.js 22+**.
- **Stock Codex CLI install** kept in place (`~/.codex/` and original launcher).
- **Git**.
- **Bun 1.4+** is required only for building/linking from a git checkout.
- **Rust toolchain** (1.95.0+) is required only for `cxstatusline install --compile`.

## 🚀 Install

Prebuilt binary installation is the recommended default. From a local clone of the repository:

```sh
git clone https://github.com/adrijshikhar/cxstatusline.git
cd cxstatusline
bun install --frozen-lockfile
bun run link:local
export PATH="$HOME/.local/bin:$PATH"
cxstatusline install
cxstatusline doctor
```

`install` downloads the release matching your exact Codex version and CPU, verifies every byte against `manifest.json`, and activates it. Nothing is signed or notarized; see [Security and trust](#security-and-trust).

Start Codex, accept its cxstatusline hook trust prompt, and open a new session after installation. An already-running process does not switch binaries when installation finishes.

*(Note: global `npm install -g cxstatusline` arrives with the public npm release.)*

<details>
<summary>Build from source instead</summary>

If you prefer to compile the patched Codex binaries locally from source:

```sh
rustup toolchain install 1.95.0 --component clippy --component rustfmt --component rust-src
git clone https://github.com/adrijshikhar/cxstatusline.git
cd cxstatusline
bun install --frozen-lockfile
bun run link:local
export PATH="$HOME/.local/bin:$PATH"
cxstatusline install --compile
cxstatusline doctor
```

`install --compile` clones the exact upstream tag for your Codex version into `~/.local/share/cxstatusline/codex/`, applies the tested patch, builds both `codex` and `codex-code-mode-host`, verifies them, and activates them. Local compilation requires at least 20 GiB of free disk space and takes tens of minutes on a cold build.

</details>

## 🎛️ Configure

```sh
cxstatusline
```

The bare command opens the configuration TUI in an interactive terminal. Choose widgets, colors
and themes, preview, then save explicitly or press Ctrl+S. Settings live at
`~/.config/cxstatusline/settings.json` (or your XDG config location).
Custom command/weather widgets and unsupported Claude-only widgets are not included.

For scripts, `cxstatusline render` reads a versioned JSON payload on stdin and prints ANSI rows;
it never opens the TUI.

## Update

```sh
codex update
# or
cxstatusline update
```

`codex update` (or `cxstatusline update`) runs Codex's upstream updater, then downloads the matching prebuilt; never compiles.

If no verified prebuilt release exists for the new version, cxstatusline fails closed: the working pair is left in place and the command says so. The SessionStart hook retries daily according to update policy.

## Revert

```sh
cxstatusline revert
```

`cxstatusline revert` restores the stock launcher, removes CX-owned executables, generations, and the hook, and keeps settings and source. Generations are kept until revert; close Codex sessions first.

## How it works

**Renderer and settings:** The statusline is powered by a Node CLI renderer that receives session metadata from Codex, formats ANSI rows according to your `settings.json`, and writes the footer.

**The additive Rust patch:** Because the Codex CLI does not yet provide an external statusline hook ([openai/codex#17827](https://github.com/openai/codex/issues/17827)), cxstatusline applies a minimal additive patch to `codex-tui` and builds synchronized binaries (`codex` and companion `codex-code-mode-host`). The patch invokes the local renderer without altering Codex's networking or command evaluation.

**Generations and atomic activation:** Each verified pair installs into an immutable generation directory under `~/.local/libexec/cxstatusline/generations/<id>/`. An atomic rename switches the `~/.local/libexec/cxstatusline/current` symlink. The wrapper in `~/.local/bin/codex` resolves `current` once before execution, ensuring running sessions and their companion host stay locked to the same generation. Previous generations accumulate until explicit `cxstatusline revert`.

**SessionStart hook and update policy:** A hook registered in Codex's `hooks.json` checks for upstream version drift on session start. When drift is detected, a detached child process downloads the matching prebuilt release without interrupting your active terminal session.

## Supported versions

cxstatusline matches exact stable releases. Supported versions in `patches/manifest.json`:
- **0.152.1**
- **0.153.0**
- **0.153.4** (candidate)

If your Codex version is not listed, cxstatusline fails closed: it will neither download an unverified prebuilt nor attempt source compilation. New versions require a tested patch file, an entry in `patches/manifest.json`, and a release workflow run.

## 🩺 Troubleshooting

- **No footer:** Run `cxstatusline doctor`, verify `which codex` points to `~/.local/bin/codex`, check your `PATH`, accept the hook prompt in Codex, and start a fresh session.
- **Unsupported version:** Wait for an explicitly supported patch. `--force` does not bypass version compatibility. Keep a working stock Codex installation.
- **Failed build:** Inspect `~/.local/state/cxstatusline/patch.log`, fix the prerequisite, then run `cxstatusline patch --force`. Redact personal paths, session identifiers, and secrets before sharing logs.
- **Missing companion / interrupted install:** Run `cxstatusline doctor`. Use `cxstatusline revert` to return to stock before reinstalling if unhealthy. Do not manually replace only one binary.

## Security and trust

- **Unsigned and unnotarized:** cxstatusline binaries are not signed or notarized by Apple; macOS Gatekeeper warnings are expected. Do not disable Gatekeeper globally; clear the quarantine attribute for these two files only, or build from source with `install --compile`.
- **Integrity vs. identity:** Checksums and manifests prove integrity relative to the GitHub release, not publisher identity.
- **Archive contents:** Each prebuilt release archive contains exactly five files: `codex`, `codex-code-mode-host`, upstream `LICENSE` (Apache-2.0), upstream `NOTICE`, and `THIRD_PARTY_NOTICES.md` (combining cxstatusline notices and generated Rust dependency notices). No extra directories, files, or telemetry.
- **Security policy:** See [SECURITY.md](SECURITY.md) for full trust boundaries, file layout, and vulnerability reporting.

## Contributing and license

See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), and [CHANGELOG.md](CHANGELOG.md).

Inspired by [ccstatusline](https://github.com/sirmalloc/ccstatusline) for Claude Code. Its renderer and configuration UI are adapted here for Codex. Thanks to its creators and contributors!

cxstatusline is [MIT licensed](LICENSE). [NOTICE](NOTICE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) preserve upstream attribution. The build includes dependency license texts in `dist/THIRD_PARTY_LICENSES.txt`. OpenAI Codex remains separately licensed under Apache-2.0.
