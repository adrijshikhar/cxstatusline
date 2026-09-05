# Security

## Supported scope

Fixes target the latest cxstatusline release and exact Codex versions listed in
`patches/manifest.json` (currently 0.152.1 and 0.153.0). Other Codex versions are not
implicitly compatible. Maintainer response is best effort; this is not an OpenAI service.

## Data and execution

- The renderer consumes Codex's JSON payload and local settings, emits one to three ANSI rows,
  and probes local memory/terminal information. It does not implement a separate authenticated
  usage API client. Directory, session, Git and usage information can appear on screen.
- Patched Codex retains normal Codex networking, including native account-limit refresh and
  relevant Git/PR probes. Installing CX does not make Codex offline.
- Source installation fetches OpenAI's Codex repository and uses Cargo to download/build
  dependencies. Registries and dependency sources, not only GitHub, may be contacted.
  Build tools execute dependency build scripts.
- The SessionStart hook reads state and can launch a detached source build on drift.
  It does not edit Codex's trust store; Codex asks the user to approve the hook.
- `CXSTATUSLINE_COMMAND` selects executable code: use a trusted local renderer. Rust splits
  the command into program/arguments rather than invoking a shell. Payload control characters
  are filtered before rendering; renderer-owned ANSI styling is retained.

## Files and recovery

| Purpose | Default path |
| --- | --- |
| Settings | `~/.config/cxstatusline/settings.json` |
| State, backup, lock, build log | `~/.local/state/cxstatusline/` |
| Managed source | `~/.local/share/cxstatusline/codex/` |
| Patched Codex and companion | `~/.local/libexec/cxstatusline/` |
| Wrapper and renderer link | `~/.local/bin/` |
| Hook configuration | `$CODEX_HOME/hooks.json` or `~/.codex/hooks.json` |

XDG variables can relocate config/state/source directories. No administrator privileges are
required; do not run with sudo. Files use account permissions and umask, not CX encryption.
Settings and logs may contain personal paths and diagnostics; protect/redact them accordingly.

The installer stages executables and uses per-file renames with rollback on caught errors.
The pair is **not a crash-atomic transaction** in the current installer. Interruption between
renames may need recovery. Keep stock Codex available and use doctor/revert. Foreign regular
launcher files are refused, not overwritten. Revert retains settings and source; it is not
a secure data-erasure operation.

Private CI artifacts are experimental, not installer-ready releases. Checksums establish
integrity relative to their source, not independent publisher identity. Do not assume Apple
signing or notarization. Prebuilt installation needs separate acceptance before launch.

## Reporting a vulnerability

Use **Report a vulnerability** in this repository's GitHub Security tab when available.
Private-reporting availability has not yet been verified for public launch. If unavailable,
open an issue asking the maintainer to arrange a private channel, with **no vulnerability
details, exploit, credentials or sensitive logs** in that public request.

Once a private channel is established, include CX/Codex versions, OS/architecture, a minimal
reproduction, impact and redacted doctor output. Never attach tokens or unredacted session logs.
