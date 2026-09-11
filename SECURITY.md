# Security

## Supported scope

Fixes target the latest cxstatusline release and exact Codex versions listed in
`patches/manifest.json` (currently 0.152.1, 0.153.0, and 0.153.4). Other Codex versions are not
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
- The SessionStart hook reads state and can launch a detached prebuilt download on drift.
  It does not edit Codex's trust store; Codex asks the user to approve the hook.
- `CXSTATUSLINE_COMMAND` selects executable code: use a trusted local renderer. Rust splits
  the command into program/arguments rather than invoking a shell. Payload control characters
  are filtered before rendering; renderer-owned ANSI styling is retained.

## Download trust boundary

- Prebuilt pairs are downloaded over HTTPS from GitHub Releases at an exact tag
  (`cxstatusline-v<CX>-codex-v<CODEX>`). There is no `latest` resolution or floating tag fallback.
- Downloads are validated with streaming SHA-256 and strict bounded limits: manifest maximum 1 MiB,
  archive maximum 1 GiB, extracted files capped at 2 GiB total, and legal text entries at 16 MiB total.
- The archive validator enforces a strict five-file allowlist of regular files: `codex`,
  `codex-code-mode-host`, `LICENSE`, `NOTICE`, and `THIRD_PARTY_NOTICES.md`. Any unexpected entry,
  directory, hardlink, symlink, device, path traversal, or non-executable binary mode is rejected
  before extraction.
- An extracted pair must pass a bounded `codex --version` probe matching the expected release
  version before it is eligible for activation.

## Files and recovery

| Purpose | Default path |
| --- | --- |
| Settings | `~/.config/cxstatusline/settings.json` |
| State, backup, lock, patch log | `~/.local/state/cxstatusline/` |
| Managed source (compile only) | `~/.local/share/cxstatusline/codex/` |
| Managed generations | `~/.local/libexec/cxstatusline/generations/<id>/` |
| Active generation symlink | `~/.local/libexec/cxstatusline/current` |
| Generation metadata | `~/.local/libexec/cxstatusline/generations/<id>/installation.json` |
| Wrapper and renderer link | `~/.local/bin/` |
| Hook configuration | `$CODEX_HOME/hooks.json` or `~/.codex/hooks.json` |

XDG variables can relocate config/state/source directories. No administrator privileges are
required; do not run with sudo. Files use account permissions and umask, not CX encryption.
Settings and logs may contain personal paths and diagnostics; protect/redact them accordingly.

Activation provides process-interruption safety: each pair is staged into an immutable generation
directory, and activation consists of a single atomic `rename` of the `current` symlink. The wrapper
resolves this symlink once before exec, ensuring running sessions and companion host invocations
never cross generations. Any interruption during download or staging leaves the prior generation or
stock launcher active. Interruption guarantees process-safety, not power-loss durability without fsync.
Prior generations are kept until explicit `cxstatusline revert`. Revert restores stock first,
removes only validated cxstatusline generations, and preserves settings and source.

Checksums establish integrity relative to the GitHub release, not independent publisher identity.
Do not assume Apple signing or notarization.

## Reporting a vulnerability

Please report vulnerabilities privately using the **[Report a vulnerability](https://github.com/adrijshikhar/cxstatusline/security/advisories/new)** button in this repository's GitHub Security Advisories tab.

Include CX and Codex versions, OS/architecture, a minimal reproduction, impact assessment, and redacted `cxstatusline doctor` output. Never attach tokens, API keys, or unredacted session logs.

