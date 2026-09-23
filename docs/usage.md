# Usage guide

Reference for configuring cxstatusline: every widget you can place on the statusline, and the full
behaviour of the custom widgets. For install and a quick tour see the [README](../README.md); for how
Codex is patched see the [Architecture & Technical Deep Dive](../wiki.md).

Configure everything interactively by running `cxstatusline` with no arguments. Settings live at
`~/.config/cxstatusline/settings.json` (or your XDG config location).

## Widget catalog

36 widgets across one to three rows. Type IDs match ccstatusline's, so a ccstatusline preset imports
without translation; widgets it has that Codex cannot support are reported and skipped on import.
### Core

| Type | Name | Shows |
|---|---|---|
| `model` | Model | Displays the current Codex model name |
| `thinking-effort` | Thinking Effort | Displays the current thinking effort level |
| `claude-session-id` | Claude Session ID | Shows the current Codex session ID |
| `version` | Version | Shows Codex CLI version number |
| `sandbox-status` | Sandbox Status | Shows whether Codex sandbox mode is enabled |

### Git

| Type | Name | Shows |
|---|---|---|
| `git-branch` | Git Branch | Shows the current git branch name |
| `git-changes` | Git Changes | Shows git changes count (+insertions, -deletions) |
| `git-review` | Git PR/MR | Shows the pull request number supplied by Codex |
| `git-root-dir` | Git Root Dir | Shows the git repository root directory name |

### Context

| Type | Name | Shows |
|---|---|---|
| `context-bar` | Context Bar | Shows context usage as a progress bar |
| `context-length` | Context Length | Shows the current context window size in tokens |
| `context-window` | Context Window | Shows the total context window size for the current model |
| `context-percentage` | Context % | Shows percentage of context window used or remaining |
| `context-percentage-usable` | Context % (usable) | Shows percentage of usable context window used or remaining |

### Tokens

| Type | Name | Shows |
|---|---|---|
| `tokens-input` | Tokens Input | Shows input token count for the current session |
| `tokens-output` | Tokens Output | Shows output token count for the current session |
| `tokens-cached` | Tokens Cached | Shows cached token count for the current session |
| `tokens-total` | Tokens Total | Shows total token count for the current session |

### Cache

| Type | Name | Shows |
|---|---|---|
| `cache-hit-rate` | Cache Hit Rate | Shows prompt cache hit rate (cache reads vs cache writes) |

### Token Speed

| Type | Name | Shows |
|---|---|---|
| `input-speed` | Input Speed | Shows session-average input token speed (tokens/sec). |
| `output-speed` | Output Speed | Shows session-average output token speed (tokens/sec). |
| `total-speed` | Total Speed | Shows total session-average token speed (tokens/sec). |

### Usage

| Type | Name | Shows |
|---|---|---|
| `five-hour-usage` | 5h Usage | Shows 5-hour API usage percentage |
| `five-hour-reset-timer` | 5h Reset Timer | Shows time remaining until 5-hour usage reset |
| `weekly-usage` | Weekly Usage | Shows weekly API usage percentage |
| `weekly-reset-timer` | Weekly Reset Timer | Shows time remaining until weekly usage reset |

### Session

| Type | Name | Shows |
|---|---|---|
| `session-clock` | Session Clock | Shows elapsed time since current session started |
| `session-name` | Session Name | Shows the current Codex thread title |

### Environment

| Type | Name | Shows |
|---|---|---|
| `current-working-dir` | Current Working Dir | Shows the current working directory |
| `terminal-width` | Terminal Width | Shows current terminal width in columns |
| `free-memory` | Memory Usage | Shows system memory usage (used/total) |

### Custom

| Type | Name | Shows |
|---|---|---|
| `custom-text` | Custom Text | Displays user-defined custom text |
| `custom-symbol` | Custom Symbol | Displays a custom symbol or emoji (single character) |
| `custom-command` | Custom Command | Executes a custom shell command and displays output |

### Layout

| Type | Name | Shows |
|---|---|---|
| `separator` | Separator | Layout separator |
| `flex-separator` | Flex Separator | Layout separator |

Two naming notes: `claude-session-id` keeps its upstream ID so presets import unchanged, but it shows
the **Codex** session ID. `separator` and `flex-separator` are layout, not data — a flex separator
expands to push the widgets on either side apart.

Every widget supports foreground and background colour, bold and dim. Most support a raw-value mode
that drops the label, and several carry their own options, reachable as single-key shortcuts while the
widget is selected in the configurator.

## Custom widgets

Three widgets show your own content, with the same settings fields as ccstatusline so presets import
unchanged:

| Widget | Field | Shows |
|---|---|---|
| Custom Text | `customText` | A fixed label such as `[PROD]` |
| Custom Symbol | `customSymbol` | One glyph or emoji such as `⚡` |
| Custom Command | `commandPath` | The first line a shell command prints |

## Custom Command execution and caching

Custom Command runs `commandPath` through your shell (`/bin/sh -c`) with Codex's environment, in
the session's working directory. It receives the Codex status payload as JSON on stdin plus `terminal_width`.
Only the first non-empty line is shown; stderr is discarded. Set `preserveColors` (key `p`) to keep
the command's own colour codes; other escape sequences and control characters are always removed. Configured
background colours apply in both render modes and survive resets within the command output. `maxWidth`
(key `w`) truncates with an ellipsis. The TUI preview never runs commands. Imported presets list their
commands before you confirm.

### Synchronous execution (default)

When `refreshMs` is absent from the widget, commands run synchronously on **every footer redraw** (up
to five times a second while Codex streams). Setting `refreshMs` to `0` does not mean synchronous: any
value present selects background caching, and values below 1000 are raised to a 1 second interval.
Remove the field to go back to synchronous execution.

Codex kills the whole statusline renderer after one second and keeps the previous frame, so
cxstatusline caps each synchronous command at **300 ms by default, 600 ms maximum** (`timeout`, editor key
`t`), and all commands on a render share a 600 ms budget. Over budget shows `[Budget]`; a slow
command shows `[Timeout]`, a failing one `[Exit: N]` or `[Cmd not found]`. Commands terminated by
external signals before the deadline report `[Signal: <name>]` rather than `[Timeout]`. Keep synchronous
commands cheap and local: `git status -s | wc -l` and `date +%H:%M` are good fits; network calls are not.

### Background caching (`refreshMs`)

For commands that take longer or should not run on every redraw, configure `refreshMs` (key `f`).

- **Background refresh:** When `refreshMs` is set, rendering reads the latest result from disk and never
  blocks the statusline or consumes renderer timeout budget. When an entry is due for an update,
  cxstatusline spawns a detached background process to refresh it; the refresh outlives the render.
- **Cold start:** On the very first render before the initial background run completes, the widget shows
  `[Loading]`.
- **Failures and timeouts:** A failing background command caches its exit code or error token; if a
  background refresh stays outstanding or fails beyond 60 seconds, the widget settles on `[Error]` and
  keeps showing `[Error]` across subsequent renders until a refresh succeeds.
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

## Update Policy & Automatic Updates

cxstatusline installs a `SessionStart` hook into `~/.codex/hooks.json` to keep your patched Codex synchronized with upstream releases.

### Inspecting and Setting Policy

Use `cxstatusline policy` to view or change how updates are handled:

```bash
# View the current update policy
cxstatusline policy

# Set the update policy
cxstatusline policy set every          # Default: update on every new release
cxstatusline policy set stable-minors   # Hold patch releases, update on minor bumps
cxstatusline policy set manual          # Never update automatically via hook
```

| Policy | Behavior |
|---|---|
| `every` (default) | Immediately triggers a background prebuilt acquisition on any Codex version bump (e.g. `0.155.0` → `0.155.1`). |
| `stable-minors` | Updates only across minor releases (e.g. `0.154.x` → `0.155.x`), holding patch updates unless forced. |
| `manual` | Disables automated background updates from the `SessionStart` hook. Updates must be triggered manually via `cxstatusline update` or `cxstatusline install`. |

### How the SessionStart Hook Works

1. **Direct Generation Comparison**: The hook reads `installation.json` from the active generation directory on disk to determine what is currently running, rather than relying solely on bookkeeping state.
2. **Live GitHub Probe**: When Codex moves to a new version whose prebuilt was previously pending in CI (`release-unavailable`), the hook makes a fast live probe to GitHub (with a 5-second timeout and silent fallback) to see if prebuilts have published. If published, it immediately clears the 24-hour backoff timer and begins background acquisition.
3. **Fail-Closed & Silent**: Network errors, timeouts, or unhandled exceptions never interrupt Codex startup or print raw stack traces. The hook returns in milliseconds and all downloads and builds run detached in the background.

