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

## Prebuilt release workflow (`.github/workflows/prebuilt.yml`)

`Prebuilt release` is the release pipeline, separate from the smoke workflow above, which
stays in place as the proven build baseline. Its job graph is
`detect -> validate -> native`, and it currently ends by saving one workflow artifact.

- **Scope: arm64 only.** The native matrix has exactly one entry, `darwin-arm64` /
  `aarch64-apple-darwin`. Nothing is cross-compiled and no universal binary is produced, so a
  release manifest carries exactly one artifact (the installer schema permits one or two).
  Intel support needs an Intel runner and its own dispatch; do not infer it from an arm64 run.
- **Self-hosted dispatch.** `self_hosted=true` moves every job to
  `[self-hosted, macOS, ARM64]`; `false` uses `ubuntu-latest` / `macos-15`. Hosted macOS
  minutes are billing-blocked, so the owner dispatches with `self_hosted=true`. Steps work on
  both: `brew install` is skipped when `just`/`cargo-nextest` already exist, and only
  `RUNNER_TEMP`/`GITHUB_WORKSPACE`/`GITHUB_OUTPUT` are assumed.
- **`detect`** runs `bun scripts/prebuilt.ts detect`. With `codex_version=auto` it lists
  `openai/codex` releases, picks the highest **stable** `rust-vX.Y.Z` by semver comparison
  (not by publish order and not lexicographically - `0.153.0` beats `0.99.0`), drops drafts,
  prereleases and malformed tags, and then requires `patches/manifest.json` to cover that
  version explicitly. If upstream has moved past every supported patch, `detect` exits 3 and
  names both the uncovered upstream version and `patches/manifest.json`'s `candidate`. That
  field is informational only: it never widens `resolvePatch`, which stays exact-match.
  The job outputs `codex_version`, `cx_version`, `tag`, `upstream_tag` and `patch_file`.
- **`validate`** installs frozen dependencies, typechecks, runs `bun test`, builds with
  `CXSTATUSLINE_RELEASE_BUILD=1` (which refuses a dirty or commit-less checkout) and asserts
  the bundle prints the detected `cx_version`.
- **`native`** clones the exact upstream tag, applies the exact patch with
  `git apply --index --check` before `git apply --index`, prepares the Codex V8 archive, runs
  the focused patched Rust tests, builds the executable pair, then packages and verifies.
  Packaging is deterministic: an explicit five-file list in fixed order (never `.`, which
  would add the `./` entry the installer rejects), `portable` tar headers with no uid/gid, a
  fixed archive mtime, modes forced to 0755/0644, and gzip whose header carries no timestamp.
  Identical staged inputs therefore produce identical archive bytes - which is *not* a claim
  that the Rust build itself is bit-reproducible.
- **Verification** re-derives every published claim from the bytes on disk using the
  installer's own code: `validateManifest` from `src/distribution.ts` for the manifest,
  `extractArchive` from `src/distribution/archive.ts` for the archive, then `SHA256SUMS`
  agreement, per-file digests, Mach-O architecture, system-only linkage, `vtool` `minos` at or
  below 14.0, staged `codex --version` and the companion's `--listen` help.
- **Outputs.** `release-<tag>` holds exactly the three release assets (archive,
  `manifest.json`, `SHA256SUMS`) for 7 days; `provenance-<tag>` holds the `Cargo.lock` diff
  and digest, runner OS/CPU, `rustc --version` and the raw `vtool`/`otool` output. Workflow
  artifacts are private to the run - they are not a release.

### Not yet wired

The `publish` dispatch input is defined but no job consumes it yet, and there is no `schedule`
trigger. When the cron is added it will do nothing until an owner-published `v<CX>` **source**
release exists, because scheduled runs resolve their CX input from that release rather than from
whatever is on `main`. Nothing in this workflow creates a tag or a release today.

### Known acceptance gap

There is no clean macOS 14 machine or VM available, so macOS 14 compatibility is evidenced only
by `MACOSX_DEPLOYMENT_TARGET=14.0` plus the `vtool -show-build` `minos` and `otool -L`
system-only-linkage checks. That is evidence of intent, not proof of behaviour on macOS 14, and
it is recorded as an open gap rather than papered over. Hiding build tools from `PATH` on a
macOS 15 runner would not close it either.
