<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/banner-dark.png">
  <img alt="cxstatusline" src="docs/banner-light.png" width="720">
</picture>

# cxstatusline

**⚡ Your Codex session, at a glance.**

*Model, context, Git, usage, and reset timers. Your terminal, your layout.*

[![CI](https://github.com/adrijshikhar/cxstatusline/actions/workflows/ci.yml/badge.svg)](https://github.com/adrijshikhar/cxstatusline/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/cxstatusline.svg)](https://www.npmjs.com/package/cxstatusline)
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

- **macOS 14 (Sonoma) or newer** (Apple Silicon or Intel) or **Linux** (x86_64 or aarch64).
- **Node.js 22+**.
- **Existing Codex CLI installation** kept in place (`~/.codex/`).
- **Git**.
- **Rust toolchain** (1.95.0+) is required only if building from source (`--compile`).

## 🚀 Install

Install globally with npm:

```sh
npm install -g cxstatusline
cxstatusline install
cxstatusline doctor
```

`cxstatusline install` downloads the verified prebuilt binary matching your Codex version, verifies checksums against `manifest.json`, and activates it.
- **Interactive selection**: Running `cxstatusline install` in a terminal prompts you to choose from available supported versions (defaulting to your detected or latest version).
- **Target a specific version**: `cxstatusline install --codex-version <version>` (e.g. `cxstatusline install --codex-version 0.154.0`).
- **Non-interactive / CI**: Pass `-y` or `--yes` to accept the default without prompting.

Start Codex, accept its cxstatusline hook trust prompt, and open a new session after installation. An already-running process does not switch binaries when installation finishes.

<details>
<summary>Install from git checkout</summary>

```sh
git clone https://github.com/adrijshikhar/cxstatusline.git
cd cxstatusline
bun install --frozen-lockfile
bun run link:local
export PATH="$HOME/.local/bin:$PATH"
cxstatusline install
cxstatusline doctor
```

</details>

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

For scripts, `cxstatusline render` reads a versioned JSON payload on stdin and prints ANSI rows;
it never opens the TUI.

## Widgets

36 widgets: model and thinking effort, Git branch and changes, context and token counts, token speed,
5-hour and weekly usage and reset, session clock and name, working directory, terminal width, memory, plus three
custom widgets that show your own text, symbol, or the output of a shell command.

Type IDs match ccstatusline's, so a ccstatusline preset imports without translation.

👉 The full catalog, and how Custom Command handles timeouts, colours and background caching, are in
the **[Usage guide](docs/usage.md)**.

## Update

```sh
cxstatusline update
```

`cxstatusline update` runs a pre-flight check: if upstream Codex has a new version but prebuilts have not yet been published, it warns and stops before touching your active installation.

Options:
- `cxstatusline update --compile`: updates upstream Codex and compiles the statusline from source for the new version.
- `cxstatusline update --force`: updates upstream Codex to stock immediately, even if prebuilt binaries are not yet published.

## Revert

```sh
cxstatusline revert
```

`cxstatusline revert` restores the stock launcher, removes CX-owned executables, generations, and the hook, and keeps settings and source. Generations are kept until revert; close Codex sessions first.

## 🔍 How it works
 
Codex CLI does not yet provide a native statusline extension hook ([openai/codex#17827](https://github.com/openai/codex/issues/17827)). `cxstatusline` bridges this with a lightweight additive Rust patch that captures session telemetry (model, context tokens, Git branch, rate limits) and invokes a local Node/TypeScript ANSI renderer.
 
Updates use an immutable **generation-based layout** (`~/.local/libexec/cxstatusline/generations/`) with atomic symlink swaps, ensuring your active terminal sessions are never interrupted.
 
👉 For a full architectural breakdown of how Codex is patched with Rust, check out the **[Architecture & Technical Deep Dive (wiki.md)](wiki.md)**.
 
## Supported versions

cxstatusline matches exact stable releases of OpenAI Codex.

### Latest Supported Version
| Codex Target | Prebuilt Release | Supported Architecture | Status |
|---|---|---|---|
| **0.155.0** | [`codex-v0.155.0`](https://github.com/adrijshikhar/cxstatusline/releases/tag/codex-v0.155.0) | Apple Silicon (`darwin-arm64`) | ✅ Verified Prebuilt |

<details>
<summary><b>Previous Supported Versions</b></summary>
<br>

| Codex Target | Prebuilt Release | Supported Architecture | Status |
|---|---|---|---|
| **0.154.0** | [`codex-v0.154.0`](https://github.com/adrijshikhar/cxstatusline/releases/tag/codex-v0.154.0) | Apple Silicon (`darwin-arm64`) | ✅ Verified Prebuilt |
| **0.153.4** | [`codex-v0.153.4`](https://github.com/adrijshikhar/cxstatusline/releases/tag/codex-v0.153.4) | Apple Silicon (`darwin-arm64`) | ✅ Verified Prebuilt |
| **0.153.0** | [`codex-v0.153.0`](https://github.com/adrijshikhar/cxstatusline/releases/tag/codex-v0.153.0) | Apple Silicon (`darwin-arm64`) | ✅ Verified Prebuilt |
| **0.152.1** | [`codex-v0.152.1`](https://github.com/adrijshikhar/cxstatusline/releases/tag/codex-v0.152.1) | Apple Silicon (`darwin-arm64`) | ✅ Verified Prebuilt |

To install a specific version:
```sh
cxstatusline install --codex-version 0.154.0
```
</details>

If your Codex version is not listed, cxstatusline fails closed: it will neither download an unverified prebuilt nor attempt source compilation. New versions require a tested patch file, an entry in `patches/manifest.json`, and a release workflow run.
 
## 🩺 Troubleshooting
 
- **No footer:** Run `cxstatusline doctor`, verify `which codex` points to `~/.local/bin/codex`, check your `PATH`, accept the hook prompt in Codex, and start a fresh session.
- **Unsupported version:** Wait for an explicitly supported patch. `--force` does not bypass version compatibility. Keep a working stock Codex installation.
- **Failed build:** Inspect `~/.local/state/cxstatusline/patch.log`, fix the prerequisite, then run `cxstatusline patch --force`. Redact personal paths, session identifiers, and secrets before sharing logs.
- **Missing companion / interrupted install:** Run `cxstatusline doctor`. Use `cxstatusline revert` to return to stock before reinstalling if unhealthy. Do not manually replace only one binary.
 
## 🙏 Acknowledgments
 
Huge shout-out to **[ccstatusline](https://github.com/sirmalloc/ccstatusline)** by [@sirmalloc](https://github.com/sirmalloc)! The interactive configurator TUI, widget architecture, Powerline themes, and overall statusline UX in `cxstatusline` are directly adapted and inspired by `ccstatusline`'s fantastic work for Claude Code.
 
## License
 
cxstatusline is [MIT licensed](LICENSE). See [SECURITY.md](SECURITY.md) for security boundaries and reporting. [NOTICE](NOTICE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) preserve upstream attribution. OpenAI Codex remains separately licensed under Apache-2.0.

---

📦 **npm:** [https://www.npmjs.com/package/cxstatusline](https://www.npmjs.com/package/cxstatusline)

