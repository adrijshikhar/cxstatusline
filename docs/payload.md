# Payload contract v1

`cxstatusline render` reads exactly one JSON object on stdin and prints exactly one line on stdout.
This is the only interface between Codex and the renderer. It is **frozen**: new keys may be added,
`payload_version` changes only on a breaking change, and the renderer ignores keys it does not know.

Every key except `payload_version` is optional. Absent and `null` mean the same thing: Codex does
not have that value right now. The renderer must still print a sane line.

Values are **typed, never pre-formatted**. Enum-valued fields carry Codex's own serde/strum
identifiers, not display text, so the renderer can style and translate them and so the payload
survives migration to upstream's native `status_line_command`.

| Key | Type | Source in Codex |
|---|---|---|
| `payload_version` | `1` | constant |
| `model.name` | string | `model_display_name()` |
| `model.reasoning` | string | `reasoning_display_name()` — `"default"` when unset |
| `git.branch` | string | async branch lookup |
| `git.changes` | `{additions, deletions}` | `GitBranchDiffStats` |
| `git.pr` | number | open PR for HEAD |
| `usage.context_used` | 0..1 | `status_line_context_used_percent()/100` |
| `usage.context_remaining` | 0..1 | `status_line_context_remaining_percent()/100` |
| `usage.used_tokens` | integer | `TokenUsage::blended_total()` |
| `usage.five_hour.used` | 0..1 | `RateLimitWindowDisplay.used_percent/100` (5h window) |
| `usage.five_hour.resets_at` | ISO-8601 UTC | `resets_at_unix` (added by the patch) |
| `usage.weekly.*` | as above | weekly window |
| `session.id` | string | `thread_id` |
| `session.cwd` | path | `status_line_cwd()` |
| `session.project_root` | path | `status_line_project_root_for_cwd()` |
| `session.hostname` | string | `os_host_name()` |
| `session.approval_mode` | `untrusted\|on-request\|granular\|never` | `config.permissions.approval_policy.value().to_string()` — the `AskForApproval` strum name |
| `session.permissions` | `read-only\|workspace-write\|danger-full-access\|external-sandbox` | `config.legacy_sandbox_policy().to_string()` — the `SandboxPolicy` strum name |
| `session.run_state` | `starting\|ready\|working\|thinking\|waiting` | `run_state_status_text()` lowercased |
| `session.codex_version` | string | `CODEX_CLI_VERSION` |

`approval_mode` and `permissions` are **identifiers, not sentences.** Codex's own
`approval_mode_display()` / `permissions_display()` return UI text (`"Ask for approval"`,
`"Workspace"`); the patch deliberately does not call them, because pre-formatted strings cannot be
restyled, cannot be matched on, and would be a breaking change to fix later.

Exit codes: `0` printed a line · `2` bad payload (message on stderr, nothing on stdout).

Golden fixture: `test/fixtures/payload-v1.json`.
