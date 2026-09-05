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
