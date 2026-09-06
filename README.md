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

## Status and requirements

v0.1.0 is the initial release baseline after private laptop soak. Source installation works; prebuilt binaries are
under private CI testing and are **not yet available through the installer**. There is no
public npm installation command to use yet.

Initial support is macOS. Apple Silicon has local acceptance evidence; Intel native CI is being
validated. Linux and Windows are not release-validated. Current supported Codex versions are
**0.152.1 and 0.153.0 exactly**; newer versions fail closed until explicitly supported.

Source installation requires Node.js 22+, Bun 1.4+, Git, macOS Command Line Tools, a working
stock Codex installation, rustup and at least 20 GiB free build space. Keep stock Codex installed.
Powerline glyphs need a compatible terminal font; plain separators work without one.

## 🚀 Install from source

Install Command Line Tools with `xcode-select --install` if needed, and rustup from
[rustup.rs](https://rustup.rs/) if it is not installed. Then:

```sh
rustup toolchain install 1.95.0 --component clippy --component rustfmt --component rust-src
git clone https://github.com/adrijshikhar/cxstatusline.git
cd cxstatusline
bun install --frozen-lockfile
bun run link:local
export PATH="$HOME/.local/bin:$PATH"
cxstatusline install
cxstatusline doctor
```

While the repo is private, cloning requires repository access. Persist the PATH entry in your
shell configuration. `link:local` builds and links the renderer from this checkout; keep the
checkout in place. The first Codex source build can take tens of minutes.

Start Codex, accept its cxstatusline hook trust prompt, and open a new session after installation.
An already-running process does not switch binaries when installation finishes.

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

## Update or revert

```sh
codex update
cxstatusline doctor
```

The wrapper runs Codex's updater, then attempts a source rebuild. The SessionStart hook can
also start background rebuilds on version drift according to the update policy. It does not
hot-swap your running session or guess patches for unsupported versions.

```sh
cxstatusline revert
```

Revert restores the saved stock launcher where recorded, removes CX-owned executables and the
hook, and keeps settings and source. It refuses while a build holds the lock. Close patched
sessions before reverting. If no saved launcher exists, the command explains what remains to
restore; it never overwrites an unrelated executable.

Each install lands as one immutable generation under
`~/.local/libexec/cxstatusline/generations/`, and `~/.local/libexec/cxstatusline/current` is the
symlink that decides which one a fresh `codex` runs. Older generations are kept on purpose - a
Codex session started earlier is still executing out of one - so they accumulate (roughly the
size of the Codex binary pair each) until you run `cxstatusline revert`, which is the only thing
that removes them. Close your patched sessions first. Revert only deletes directories it can
prove are cxstatusline generations; anything else under that path is left in place.

If you installed cxstatusline before generations existed (a flat
`~/.local/libexec/cxstatusline/codex` pair), run `cxstatusline revert` once and reinstall - there
is no in-place migration.

## 🩺 Troubleshooting

- No footer: run `cxstatusline doctor`, check `which codex` and PATH, accept the hook prompt,
  and start a new session.
- Unsupported version: wait for an explicitly supported patch. `--force` does not bypass
  compatibility. Keep a working stock Codex installation.
- Failed build: inspect `~/.local/state/cxstatusline/patch.log`, fix the prerequisite, then run
  `cxstatusline patch --force`. Redact paths, session identifiers and secrets before sharing logs.
- Missing companion/interrupted install: run doctor; use revert to return to stock before
  reinstalling if unhealthy. Do not manually replace only one binary.

## Contributing and license

See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).

Inspired by [ccstatusline](https://github.com/sirmalloc/ccstatusline) for Claude Code.
Its renderer and configuration UI are adapted here for Codex. Thanks to its creators and contributors!

cxstatusline is [MIT licensed](LICENSE). [NOTICE](NOTICE) and
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) preserve upstream attribution.
The build includes dependency license texts in `dist/THIRD_PARTY_LICENSES.txt`.
OpenAI Codex remains separately licensed under Apache-2.0.

<details>
<summary>Changelog</summary>

### 0.1.0

Initial baseline: configurable one-to-three-row Codex statusline, interactive editor,
colors and Powerline themes, preset import/export, source installation, update hooks,
diagnostics and revert. Prebuilt distribution is still under private testing.

</details>
