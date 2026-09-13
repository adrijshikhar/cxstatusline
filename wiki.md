# Architecture & Technical Deep Dive

`cxstatusline` brings rich, customizable statuslines to the [OpenAI Codex CLI](https://github.com/openai/codex). Because Codex is built with Rust and does not yet have a native statusline extension API, `cxstatusline` bridges the gap using an additive Rust patch and a TypeScript/Node ANSI rendering engine.

This document details the internal architecture, how Codex is patched with Rust support, the generation management lifecycle, and how background updates work.

---

## 1. The Challenge: Extending Codex TUI

OpenAI's Codex CLI is written natively in Rust, utilizing a terminal user interface (`codex-tui`) driven by `ratatui` / `crossterm`. Unlike tools that provide arbitrary shell hooks or JavaScript plugins, Codex currently has no built-in mechanism or external hook to render custom statuslines or inject widgets into its terminal footer (tracked in [openai/codex#17827](https://github.com/openai/codex/issues/17827)).

To deliver an interactive, multi-widget statusline without requiring users to maintain a full custom fork of Codex, `cxstatusline` uses a dual-engine architecture:

```
┌────────────────────────────────────────────────────────┐
│                   OpenAI Codex (Rust)                  │
│                                                        │
│  ┌──────────────────────────────────────────────────┐  │
│  │                    codex-tui                     │  │
│  │                                                  │  │
│  │  Additive Rust Hook:                             │  │
│  │  Extracts session state (model, context, tokens, │  │
│  │  git status, rate limits, reset timers)          │  │
│  └─────────────────────────┬────────────────────────┘  │
└────────────────────────────┼───────────────────────────┘
                             │ JSON Payload via stdio
                             ▼
┌────────────────────────────────────────────────────────┐
│              cxstatusline Renderer (Node/TS)           │
│                                                        │
│  - Reads ~/.config/cxstatusline/settings.json          │
│  - Evaluates widgets, themes, colors, Powerline glyphs │
│  - Formats multi-row ANSI strings                      │
└────────────────────────────┬───────────────────────────┘
                             │ Formatted ANSI rows
                             ▼
┌────────────────────────────────────────────────────────┐
│               Terminal Footer / Status Bar             │
└────────────────────────────────────────────────────────┘
```

---

## 2. The Additive Rust Patch

Each supported Codex version has a verified patch located under `patches/` (e.g., `patches/codex-0.154.0.patch`).

### What the patch modifies:
1. **`codex-tui` Drawing Loop**: Hooks into the bottom layout area of the terminal UI to allocate rows (1 to 3 rows) for the custom statusline.
2. **Session Telemetry Extraction**: Captures live runtime metrics from Codex's internal session context:
   - **Model**: Active model name and reasoning effort.
   - **Context Window**: Total tokens, prompt tokens, completion tokens, and percentage of context used.
   - **Rate Limits & Timers**: Upstream usage limits and cooldown/reset timestamps.
   - **Git & Worktree**: Current branch, dirty state, and staged file status.
   - **Session Info**: Elapsed duration and cost estimates (when available).
3. **Renderer Invocation**: Serializes this metadata into a versioned JSON payload and passes it via stdin to `cxstatusline render`. The output ANSI strings are cached and blitted directly to the terminal frame.

### Non-invasive security and stability guarantees:
- **Zero Networking Changes**: The patch does not touch networking, authentication, API keys, or prompt payloads.
- **Zero AI Logic Changes**: Sampling parameters, tools, sandbox permissions, and agent decision loops remain 100% untouched stock Codex code.
- **Fail-Safe Fallback**: If the statusline renderer process times out, crashes, or returns invalid data, the patch quietly falls back to the standard Codex display without disrupting the interactive session.

---

## 3. Synchronized Dual Binaries

Codex relies on two tightly coupled binaries:
- `codex`: The primary interactive CLI and TUI.
- `codex-code-mode-host`: The auxiliary execution host managing child processes and code evaluation.

Both binaries are compiled from the exact same Git tree and Rust toolchain. To prevent subtle IPC incompatibilities between different compilation builds, `cxstatusline` always builds, verifies, and packages both binaries together in lockstep.

---

## 4. Generations & Atomic Activation

To ensure zero-downtime updates and protect long-running sessions, `cxstatusline` uses a Nix-inspired **generations** directory model:

```
~/.local/libexec/cxstatusline/
├── current -> generations/2026-09-12T07-28-38Z-arm64/
└── generations/
    ├── 2026-09-11T13-06-05Z-arm64/
    │   ├── codex
    │   └── codex-code-mode-host
    └── 2026-09-12T07-28-38Z-arm64/
        ├── codex
        └── codex-code-mode-host
```

1. **Immutable Installations**: When installing a new prebuilt or compiled binary, it is unpacked into a new timestamped generation directory.
2. **Atomic Symlink Flip**: The symlink `~/.local/libexec/cxstatusline/current` is updated via an atomic filesystem rename (`renameat2` / symlink swap).
3. **Execution Isolation**: The wrapper script at `~/.local/bin/codex` resolves `current` at startup. Existing, open Codex sessions remain pinned to their active binary generation, preventing crashes or companion host mismatches if an update runs in the background.
4. **Clean Rollback**: Running `cxstatusline revert` cleans up generations and restores the stock Codex binary instantly.

---

## 5. SessionStart Hook & Background Prebuilt Updates

Codex supports lifecycle hooks defined in `~/.codex/hooks.json`. `cxstatusline` registers a lightweight `SessionStart` hook:

- When a new Codex session begins, the hook inspects the installed Codex version against the active `cxstatusline` generation.
- If upstream Codex has been upgraded, a detached background process checks whether a verified prebuilt matching the new Codex version is available.
- If available, the background task stages the new generation and swaps the symlink seamlessly—so your next session automatically runs the updated statusline without any manual intervention.
- If a prebuilt is not yet available, `cxstatusline update` warns and stops, preventing accidental breakage until prebuilt binaries are published.
