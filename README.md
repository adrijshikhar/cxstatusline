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

- **macOS 14 (Sonoma) or newer** (Apple Silicon or Intel).
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

`install` downloads the verified prebuilt binary matching your exact Codex version and architecture, verifies checksums against `manifest.json`, and activates it.

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
Claude-only widgets without a Codex data source are not included; see the widget inventory in the
project notes for the full list and reasons.

For scripts, `cxstatusline render` reads a versioned JSON payload on stdin and prints ANSI rows;
it never opens the TUI.

## Custom widgets

Three widgets show your own content, with the same settings fields as ccstatusline so presets import unchanged:

| Widget | Field | Shows |
|---|---|---|
| Custom Text | `customText` | A fixed label such as `[PROD]` |
| Custom Symbol | `customSymbol` | One glyph or emoji such as `⚡` |
| Custom Command | `commandPath` | The first line a shell command prints |

### Custom Command execution and caching

Custom Command runs `commandPath` through your shell (`/bin/sh -c`) with Codex's environment, in
the session's working directory. It receives the Codex status payload as JSON on stdin plus `terminal_width`.
Only the first non-empty line is shown; stderr is discarded. Set `preserveColors` (key `p`) to keep
the command's own colour codes; other escape sequences and control characters are always removed. Configured
background colours apply in both render modes and survive resets within the command output. `maxWidth`
(key `w`) truncates with an ellipsis. The TUI preview never runs commands. Imported presets list their
commands before you confirm.

#### Synchronous execution (default)

When `refreshMs` is unset (or `0`), commands run synchronously on **every footer redraw** (up to five
times a second while Codex streams).

Codex kills the whole statusline renderer after one second and keeps the previous frame, so
cxstatusline caps each synchronous command at **300 ms by default, 600 ms maximum** (`timeout`, editor key
`t`), and all commands on a render share a 600 ms budget. Over budget shows `[Budget]`; a slow
command shows `[Timeout]`, a failing one `[Exit: N]` or `[Cmd not found]`. Commands terminated by
external signals before the deadline report `[Signal: <name>]` rather than `[Timeout]`. Keep synchronous
commands cheap and local: `git status -s | wc -l` and `date +%H:%M` are good fits; network calls are not.

#### Background caching (`refreshMs`)

For commands that take longer or should not run on every redraw, configure `refreshMs` (key `f`).

- **Background refresh:** When `refreshMs` is set, rendering reads the latest result from disk and never
  blocks the statusline or consumes renderer timeout budget. When an entry is due for an update,
  cxstatusline spawns a detached background process to refresh it; the refresh outlives the render.
- **Cold start:** On the very first render before the initial background run completes, the widget shows
  `[Loading]`.
- **Failures and timeouts:** A failing background command caches its exit code or error token; if a
  background refresh stays outstanding or fails beyond 30 seconds, the widget displays `[Error]`.
- **Cache location:** Cached documents live under `~/.cache/cxstatusline/commands/` (or
  `$XDG_CACHE_HOME/cxstatusline/commands/`). Deleting this cache directory at any time is completely
  safe; entries are re-created automatically.
- **Eviction:** Cache entries and temporary files expire and are automatically evicted after 7 days.
- **Session sharing constraint:** The cache key is derived from `(command, cwd)`, so every Codex
  session running in the same working directory shares one cache entry and one payload (the payload
  written by whichever session triggered the refresh). `refreshMs` is intended for commands whose
  output does not depend on specific session payload details.
- **Pipeline processes:** As with synchronous mode, `shell: true` terminates `/bin/sh` on timeout,
  so child processes spawned inside a shell pipeline can outlive the cap. Avoid long-running pipelines.

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
 
cxstatusline matches exact stable releases. Supported versions:
- **0.154.0**
- **0.153.4**
- **0.153.0**
- **0.152.1**
 
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
