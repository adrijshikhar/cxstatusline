# Private prebuilt CI smoke

This first CI slice builds the patched `codex` and `codex-code-mode-host` from the
same supported upstream tag on native macOS 15 Apple Silicon and Intel runners.
It runs the focused CX Rust tests, checks Codex's exact version, companion `--help`,
Mach-O architecture and system-only dynamic linkage, then saves checksummed private
workflow artifacts for seven days. `smoke.json` records source commits, hashes,
OS, linkage and deployment information. Cargo.lock changes are retained as evidence.

The workflow runs by manual dispatch from GitHub Actions on main. It does not rebuild
native binaries on ordinary pushes. Nothing is merged into main automatically. Failed runs create/update one private
issue; a successful two-architecture run closes it. GitHub API/reporting outages remain
visible as failed workflow jobs, not a guarantee an issue could be created.

These are experimental build artifacts, **not installer-ready GitHub Releases**.
Do not replace your installed Codex with them as part of this test. The workflow has
no release-write permission, npm publication, cron, or installer activation.

Pending before distribution acceptance: dependency-license inventory, release manifest
and hostile-archive validation, private authenticated installer downloads, Code Mode
protocol smoke, clean macOS 14 baseline validation, and lifecycle/rollback tests.
Setting the deployment target to 14 does not prove macOS 14 compatibility; this run
records the actual build metadata and only establishes smoke behavior on its runner OS.

Local CI-helper checks:

```sh
bun test test/ci-prebuilt.test.ts
bun run typecheck
```

## Installer-side notes

Release asset names are fixed: `manifest.json`, `SHA256SUMS`, and one archive per
platform named `cxstatusline-codex-<codexVersion>-<platform>.tar.gz`. The installer
only reads `manifest.json` and the archive for its own platform.

Platform selection follows Node's own `process.arch`, not the physical CPU. An x64
Node running under Rosetta on Apple Silicon reports `x64` and therefore selects the
Intel asset - deliberately, because the pair has to match the runtime that executes it.

The archive must contain exactly five regular files as plain basenames: `codex`,
`codex-code-mode-host`, `LICENSE`, `NOTICE` and `THIRD_PARTY_NOTICES.md`. Anything
else - a leading `./` directory entry from `tar -C staging .`, a link, a device, a
duplicate or an extra file - is rejected on the entry header, before any byte is
written. Pack with explicit file arguments, never with `.`.
