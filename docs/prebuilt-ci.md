# Prebuilt release pipeline

The prebuilt release pipeline (`.github/workflows/prebuilt.yml`) builds, tests, packages,
verifies and publishes prebuilt Codex binaries for cxstatusline.
Its job graph is:

```
detect -> validate -> native (matrix) -> merge -> publish -> report(always)
```

Permissions are least-privilege per job: the workflow is `contents: read` at the top level,
`publish` alone adds `contents: write`, and `report` alone adds `issues: write`. No job that runs
build steps holds release-write or issue-write credentials.

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

## Pipeline architecture

Permissions are least-privilege per job: the workflow is `contents: read` at the top level,
`publish` alone adds `contents: write`, and `report` alone adds `issues: write`. No job that runs
build steps holds release-write or issue-write credentials.

- **Scope: arm64 and x64.** Hosted runners build both `darwin-arm64` (on `macos-15`) and
  `darwin-x64` (on `macos-15-intel`), producing two release archives per release. Self-hosted
  runs are pinned to `darwin-arm64` (Apple Silicon only; selecting `x64` on a self-hosted run
  fails fast in `detect`).
- **Repository identity guard.** `detect` and `publish` both carry
  `github.repository == 'adrijshikhar/cxstatusline'`. Guarding `detect` also stops `validate`,
  `native`, and `merge`, which need it. This pipeline keeps forks from running a release pipeline
  against their own repository.
- **Runner prerequisites.** The self-hosted runner must have `gh` on `PATH`, authenticated for this
  repository: `publish` and `report` each begin with a `command -v gh` preflight that fails the job
  with `::error::gh CLI is required on this runner` rather than letting the script fail later. It
  also needs `git`, `rustup`/`cargo` with the toolchain upstream pins, `bun` (installed by
  `setup-bun`), and `just`/`cargo-nextest` (installed with `brew` only when missing).
- **Self-hosted dispatch.** `self_hosted=true` moves jobs to
  `[self-hosted, macOS, ARM64]`; `false` uses `ubuntu-latest` / `macos-15` / `macos-15-intel`.
  Hosted macOS minutes on public repositories are unmetered. Steps work on
  both: `brew install` is skipped when `just`/`cargo-nextest` already exist, and only
  `RUNNER_TEMP`/`GITHUB_WORKSPACE`/`GITHUB_OUTPUT` are assumed.
- **`detect`** runs `bun scripts/prebuilt.ts detect`. With `codex_version=auto` it lists
  `openai/codex` releases, picks the highest **stable** `rust-vX.Y.Z` by semver comparison
  (not by publish order and not lexicographically - `0.153.0` beats `0.99.0`), drops drafts,
  prereleases and malformed tags, and then requires `patches/manifest.json` to cover that
  version explicitly. If upstream has moved past every supported patch, `detect` exits 3 and
  names both the uncovered upstream version and `patches/manifest.json`'s `candidate`. That
  field is informational only: it never widens `resolvePatch`, which stays exact-match.
  The job outputs `codex_version`, `cx_version`, `tag`, `upstream_tag`, `patch_file`,
  `patch_sha256`, `source_commit`, `source_tag`, `release_state`, `release_url`, `patches_from`
  and `should_build`.
  **Every exit-3 path emits those outputs before exiting**, so `report` files the issue against
  the identity that is actually known - an immutability block is titled
  `Prebuilt blocked: Codex <v>`, not `Prebuilt blocked: upstream detection` - and passes the
  single-line `blocked_reason` output into the issue body. Only a genuinely unresolved detection
  (no version at all) keeps the null title.
- **`patches/` is read from the frozen commit.** A scheduled run resolves an *older* `v<CX>`
  source commit while `detect` itself is checked out at the default branch, so
  `patches/manifest.json` and the patch bytes are read out of that commit
  (`git show <sha>:patches/...`, materialized under `RUNNER_TEMP`), never out of the working
  tree - otherwise the published `patchSha256` would be the digest of a patch the build never
  applied. That is why the `detect` job checks out with `fetch-depth: 0`. A manual dispatch keeps
  reading the working tree, which *is* `github.sha`. The `patches_from` output records which.
- **`validate`** installs frozen dependencies, typechecks, runs `bun test`, builds with
  `CXSTATUSLINE_RELEASE_BUILD=1` (which refuses a dirty or commit-less checkout) and asserts
  the bundle prints the detected `cx_version`.
- **`native`** runs as a matrix across the detected platforms (`needs.detect.outputs.matrix`).
  Each job clones the exact upstream tag, applies the exact patch with
  `git apply --index --check` before `git apply --index`, restores a Cargo build cache
  (`upstream/codex-rs/target`, `~/.cargo/registry`, `~/.cargo/git`) keyed on
  runner OS/arch, the upstream tag, the upstream `rust-toolchain.toml` hash, the `Cargo.lock`
  hash and the applied patch's sha256, prepares the Codex V8 archive for its target architecture,
  runs the focused patched Rust tests, builds the executable pair, then packages and verifies. The
  upstream checkout itself is still reset and re-cloned every run - only compiled artifacts and
  downloaded crates are cached.
  Packaging is deterministic: an explicit five-file list in fixed order (never `.`, which
  would add the `./` entry the installer rejects), `portable` tar headers with no uid/gid, a
  fixed archive mtime, modes forced to 0755/0644, and gzip whose header carries no timestamp.
  Identical staged inputs therefore produce identical archive bytes - which is *not* a claim
  that the Rust build itself is bit-reproducible.
  Each native job uploads `release-<tag>-<platform>` and `provenance-<tag>-<platform>`.
- **Verification** re-derives every published claim from the bytes on disk using the
  installer's own code: `validateManifest` from `src/distribution.ts` for the manifest,
  `extractArchive` from `src/distribution/archive.ts` for the archive, then `SHA256SUMS`
  agreement, per-file digests, Mach-O architecture, system-only linkage, `vtool` `minos` at or
  below 14.0, staged `codex --version` and the companion's `--listen` help.
- **The source commit is passed in, never inferred.** `package` requires
  `--source-commit "${{ needs.detect.outputs.source_commit }}"`. `GITHUB_SHA` is deliberately not
  consulted: on a scheduled run it stays at the default-branch head while `validate`/`native`/
  `publish` are checked out at the frozen source commit, so a manifest stamped from it would name a
  commit the build never used - and `publish` would then refuse its own artifact set forever.
- **Outputs.** Each native job uploads `release-<tag>-<platform>` (holding the platform archive,
  manifest and checksums) and `provenance-<tag>-<platform>`. The `merge` job unifies them.

### `merge`

`merge` (`needs: [detect, native]`) runs when `should_build == 'true'`. It downloads all
`release-<tag>-*` artifacts, merges the individual manifests using `mergeManifests` (which verifies
that upstream tag, commit, patch SHA, and source commit all agree across parts), copies every
archive, and writes a unified `manifest.json` and `SHA256SUMS`. It uploads the final
`release-<tag>` workflow artifact containing all archives and the unified manifest.

### `publish`

`publish` (`needs: [detect, merge]`) is the only job granted `contents: write`, and it runs only
when `detect` said there is something to build **and** the run was asked to publish - a cron run
always is, a manual dispatch only with `publish=true`. It is serialized per release tag
(`concurrency: prebuilt-publish-<tag>`, `cancel-in-progress: false`) so two runs can never race
the same release.

It downloads the merged `release-<tag>` artifact - the exact bytes verified across the matrix - and
runs. `bun install` is teed into `$RUNNER_TEMP/prebuilt-publish.log` like every other
failing-capable step, and a download-artifact failure appends a line naming the artifact that could
not be fetched, so the documented expired-artifact case reaches `report` as an excerpt instead of
"no error excerpt captured":

```
bun scripts/prebuilt.ts publish --tag <tag> --dir <artifact dir> --run-id <id> --run-url <url> \
  --source-commit <sha> --codex-version <v> --cx-version <v> --platforms <platforms> [--event <name>]
```

In order:

1. **Re-verify the set.** All archives present; `manifest.json` accepted by the installer's own
   `validateManifest` for each configured platform; each archive's sha256/size equal to the manifest's;
   `SHA256SUMS` agreeing with all archives and `manifest.json`'s own bytes.
2. **Re-check the release.** `detect`'s answer is 1-3 hours old by now, so the state is read again
   immediately before anything is uploaded.
3. **Create or resume a draft.** No release → `gh release create --draft --target <source commit>`
   with generated notes listing all architectures. An existing draft → its hidden provenance marker
   `<!-- cxstatusline-prebuilt-build run=<id> manifest_sha=<sha> -->` must record *this* build's
   manifest digest; if it does not, the run reports **blocked** and touches nothing.
4. **Upload only what is missing.** An asset already attached with the same size is skipped; a
   different size is blocked, never overwritten. `--clobber` appears nowhere in this pipeline.
5. **Download all assets back and re-verify** their sha256 against the manifest and `SHA256SUMS`.
   A mismatch fails the run and leaves the release a **draft**: nothing is published.
6. **`gh release edit --draft=false --latest=false`**, then the release URL to the step summary.

Repository visibility is never read or changed, and no draft is ever deleted automatically.

### Resume and restart semantics

- **Interrupted upload** (the runner died after one asset). Re-run. The draft's provenance marker
  matches, so the run uploads only the assets that are missing, from the same artifact. No rebuild,
  no new timestamps, no new workflow URL, no version bump.
- **Draft holding different bytes** (a conflicting build set, or an expired original artifact).
  **Blocked**, exit 3, nothing deleted. Two owner options, both deliberate and manual: delete the
  unpublished draft in the GitHub Releases UI and re-run, or bump the cxstatusline version so the
  build publishes under a new tag.
- **Already published, identical** (same `sourceCommit` and `patchSha256`). Success, skipped, with
  nothing uploaded. `detect` catches this first and skips the build entirely.
- **Already published, different.** **Blocked**, exit 3. Published releases
  are immutable: their assets are never replaced. Only a cxstatusline version bump - a new
  tag - can publish different bytes.

Retry URLs live in the run log and the tracking issue. Original build provenance is never
rewritten.

### `report`

`report` (`if: always()`, `needs: [detect, validate, native, merge, publish]`) is the only job granted
`issues: write`, and it holds no release credentials.

```
bun scripts/prebuilt.ts report --detect <result> --validate <result> --native <result> \
  [--merge <result>] --publish <result> --codex-version <v> --cx-version <v> --tag <tag> \
  --upstream-tag <tag> --patch-sha256 <sha> --source-commit <sha> --should-build <bool> \
  --publish-requested <bool> --release-url <url> --run-url <url> --repo <owner/name> \
  --event <name> --platforms <platforms> [--blocked-reason <text>] [--log-dir <dir>] [--error-file <path>]
```

- **Failing stage** is the first of `detect → validate → native → merge → publish` that did not succeed. A
  *deliberately* skipped job is not a failure: a skipped `publish` on a manual run without
  `publish=true`, and every skipped build job on a `should_build=false` run.
- **One issue per identity.** Title is `Prebuilt blocked: Codex <version>`, or
  `Prebuilt blocked: upstream detection` when the version never resolved. Issues are matched on
  the exact title **and** the body marker `<!-- cxstatusline-prebuilt -->`, from a single
  `gh api --paginate repos/<owner>/<repo>/issues?state=open&per_page=100` read - so a hand-written
  issue with the same title is never touched, and a second page can never hide the real one.
  A repeated failure edits that issue; it never opens a second.
- **Body** carries the CX and Codex versions, upstream identity when known, the failing stage,
  `darwin-arm64`, the source commit, the patch sha256, the trigger, all four job results, the run
  URL, `detect`'s `blocked_reason` when the run was blocked rather than broken, a bounded
  (≤ 20 line) sanitized excerpt of the failing stage's log, and the exact manual retry.
  Structured fields only: never a raw log, an environment dump, a token or a presigned URL.
- **Failure evidence.** Every failing-capable step in `detect`/`validate`/`native`/`publish` runs
  under `set -o pipefail` and tees its combined output into `$RUNNER_TEMP/prebuilt-<job>.log`,
  which each job uploads as `logs-<job>-<run_id>` with `if: always()` (one name per job, because
  v4 artifacts are immutable). `report` downloads them with
  `pattern: logs-*-<run_id>`/`merge-multiple: true` (`continue-on-error`, so an expired or missing
  artifact cannot stop the report) and passes `--log-dir`; the script picks
  `prebuilt-<failing stage>.log`, takes its last 20 lines and redacts them. `--error-file` still
  overrides that with an explicit file. When no log was captured the body says **"no error excerpt
  captured"** - the section is never silently omitted.
- **Closure.** A successful publish comments the release link on the version issue and closes it.
  A successful detection closes only the detection issue - it never closes a version build
  failure. A successful arm64 build that was not published comments "build succeeded, not
  published" and leaves the issue open.
- **Redaction** strips `ghp_`/`github_pat_`/`ghs_`-style tokens, whole `Authorization:` lines and
  the query string of any URL (that is where presigned signatures live) from every excerpt and
  every step summary.
- **Reporter API failure** fails the job and writes a sanitized summary. It never claims an issue
  was created, updated or closed without the API having said so - but it does list the issue writes
  the API *did* acknowledge before the failure (a comment that landed before its `close` failed is
  a fact the owner needs), and says explicitly when there were none. The next run examines this one
  and reports again.

### Owner runbook

**Before the first dispatch.** On the self-hosted runner, check `gh --version` and
`gh auth status`: `publish` and `report` refuse to start without `gh` on `PATH`, and every GitHub
call they make goes through it. The workflow itself guards on repository identity
(`github.repository == 'adrijshikhar/cxstatusline'`).

**Build and publish now (the normal path).** Actions → *Prebuilt release* → *Run workflow*:

- `self_hosted` = **false** (hosted macOS minutes are free on the public repository) or **true** for the owner's Mac
- `platforms` = `arm64,x64` (default; must be `arm64` if `self_hosted=true`)
- `codex_version` = `auto`, or an exact supported version
- `publish` = **true**

That builds `github.sha` and publishes `cxstatusline-v<CX>-codex-v<CODEX>`.
With `publish=false` it builds and verifies only, and `report` says "build succeeded, not
published".

**Enable the cron.** The `17 3 * * *` schedule does nothing until an owner-published stable
`v<CX>` **source release** exists in this repository: scheduled runs resolve their CX input from
the highest such release and build the commit its tag points at, never whatever is on the default
branch. Publish a `v<CX>` release (not a draft, not a prerelease) to arm it. Until then a
scheduled run writes "no v<CX> source release published; nothing to build" and skips.

**When a run reports blocked.** Read the issue. An uncovered upstream version needs a new tested
patch. A published-but-different release needs a cxstatusline version bump. A conflicting draft
needs the draft deleted by hand, or a version bump. The pipeline never resolves any of these for
you, and never deletes a draft on its own.

**Releases are immutable.** Nothing in this pipeline changes repository visibility. Once
published, a release's assets are never replaced - differing bytes always mean a new CX version and
therefore a new tag.

### npm and source release procedure (`release-please.yml` & `publish.yml`)

The decoupled release architecture isolates pull request tracking from gated package publication:

1. **`release-please.yml`** (runs on push to `main` and `workflow_dispatch`):
   - Uses `googleapis/release-please-action@v5` with `release-please-config.json` and `.release-please-manifest.json`.
   - Tracks Conventional Commits and maintains an open Release PR.
   - When the Release PR is merged to `main`, creates the GitHub release and pushes Git tag `v*.*.*` via `RELEASE_PLEASE_TOKEN`.
   - Executes in ~15 seconds with no manual approval gates, ensuring merges on `main` are never blocked.
2. **`publish.yml`** (triggers strictly on tag push `v*.*.*` or manual `workflow_dispatch`):
   - Concurrency is scoped to the tag ref (`publish-${{ github.ref }}`), completely decoupling manual approval gates from `main`.
   - **`build-and-verify`** (on `macos-15`): Checks out the release tag, verifies types (`bun run typecheck`), executes the test suite (`bun test`), builds production artifacts (`CXSTATUSLINE_RELEASE_BUILD=1 bun run build`), checks packaging (`bun run check:package`), and records `SHA256SUMS`.
   - **`publish-npm`** (on `ubuntu-latest`, gated by `environment: npm` with owner required reviewer): Attaches the packed `.tgz` and checksums to the GitHub release, and publishes to the npm registry with `npm publish --provenance --access public` via OIDC Trusted Publishing.


### Known acceptance gap

There is no clean macOS 14 machine or VM available, so macOS 14 compatibility is evidenced only
by `MACOSX_DEPLOYMENT_TARGET=14.0` plus the `vtool -show-build` `minos` and `otool -L`
system-only-linkage checks. That is evidence of intent, not proof of behaviour on macOS 14, and
it is recorded as an open gap rather than papered over. Hiding build tools from `PATH` on a
macOS 15 runner would not close it either.

### Rust dependency-license audit

The two binaries (`codex`, `codex-code-mode-host`) are audited during the native job:
`cargo deny check licenses` runs against upstream's own policy (`codex-rs/deny.toml`), and
`cargo about generate` generates the Markdown inventory of crate licenses using `scripts/prebuilt/about.toml`
and `scripts/prebuilt/about.hbs`. These notices are appended directly below the repository notices in the
archive's `THIRD_PARTY_NOTICES.md` under `## Rust dependency licenses (generated)`.
A copy is also saved to `provenance/rust-notices.md` in the provenance workflow artifact.
