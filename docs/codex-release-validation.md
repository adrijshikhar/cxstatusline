# Codex release validation evidence

Compatibility ownership remains in `patches/manifest.json`. A release is not added to that
manifest until its exact upstream tag passes patch application, focused Rust layout tests, a
native Codex build/version probe, and the footer runtime smoke gate. A blocked build remains an
explicit coverage gap.

## Intermediate upstream releases

| Upstream tag | Patch / revision | Patch applies | Rust layout tests | Native build, version probe, footer smoke |
| --- | --- | --- | --- | --- |
| `rust-v0.153.1` | `codex-0.153.4.patch` / v1 | Pass | 9 passed | Pass (direct + AIM) |
| `rust-v0.153.2` | `codex-0.153.4.patch` / v1 | Pass | Not required by revised policy | Not run |
| `rust-v0.153.3` | `codex-0.153.4.patch` / v1 | Pass | Not required by revised policy | Not run |
| `rust-v0.156.0` | `codex-0.156.1.patch` / v2 | Pass | 12 passed | Pass (direct + AIM) |
| `rust-v0.156.1` (corrected) | `codex-0.156.1.patch` / v2 | Pass | 12 passed | Pass (direct + AIM) |

All four tags were checked out into separate detached worktrees under `/tmp/cx-coverage-<version>`.
The exact neighboring patch was applied with `git apply --index`; the same patch also passed
`git apply --check` before mutation. These worktrees are isolated from the user's Codex checkout.

The tags resolve rusty_v8 `150.4.0`. Its arm64 macOS release archive, source bindings, and
checksums are now available and verified with the repository's setup script. Reproducible local
command (Python 3.12 is required by upstream's `tomllib` use):

```sh
mkdir -p "$RUNNER_TEMP"
GITHUB_ENV="$RUNNER_TEMP/github-env" RUNNER_TEMP="$RUNNER_TEMP" \
  bash scripts/setup-ci-v8.sh /tmp/cx-coverage-0.153.1 aarch64-apple-darwin
```

The successful run reported checksum verification for both
`librusty_v8_ptrcomp_sandbox_release_aarch64-apple-darwin.a.gz` and
`src_binding_ptrcomp_sandbox_release_aarch64-apple-darwin.rs`. This resolves the earlier 404
blocker for the tested target; it does not imply the Linux arm64 archive was built or verified.

## Footer gate

`scripts/test-footer-smoke.py` launches an explicit Codex executable in a PTY with an isolated
temporary `CODEX_HOME`, a deterministic three-row renderer, a loopback-only API base URL, and no
inherited API credentials. It checks the executable version, idle state, draft typing and cursor,
slash-menu open/close, renderer refresh, and narrow/wide terminal resize. It never submits a model
prompt. Warning and response state transitions are covered by the focused Rust composer tests.

The screen assertions use `pyte==0.8.2` and `wcwidth==0.2.13` in a temporary CI virtualenv. This
dev-only pair is needed because Codex emits cursor-addressed terminal output; plain-text matching
cannot determine whether footer rows overlap or where input focus landed.

## Remote execution

Heavy Rust builds run only on the authorized M5 Pro at `192.168.1.65`, beneath
`/Users/nemesis/cx-validation/reliability`, with `CARGO_BUILD_JOBS=2` and sequential
versions. Neither machine's installed Codex nor the user's patched checkout is modified.
The temporary `/tmp` worktrees above establish patch application only.

The smoke gate requires an explicit `--patch-version`. V1 historically renders the slash
popup in place of its footer; its gate checks that the menu opens and all three footer rows
return after Escape. V2 reserves a separate footer region and must preserve all three rows
while the popup is open as well. Both revisions require idle, typing, refresh, resize, and
cursor checks. This preserves historical behavior without backporting v2 to v1.

Initial 0.156.0 and 0.156.1 release builds failed in `codex-chatgpt` with Rust 1.95.0:

```text
error: queries overflow the depth limit!
help: consider increasing the recursion limit by adding a
#![recursion_limit = "256"] attribute to your crate (`codex_chatgpt`)
note: query depth increased by 130 when computing layout of
{async fn body of connectors::list_connectors()}
```

The failed builds used the exact upstream toolchain. The same failure reproduces on the clean
`rust-v0.156.1` tag with no footer patch. The nested async connector future requires query depth
130, exceeding Rust's default 128. Adding `#![recursion_limit = "256"]` to
`codex-rs/chatgpt/src/lib.rs` makes `cargo build --release -p codex-chatgpt` pass (78 seconds
with cached dependencies). Removing the attribute and testing `cargo rustc --release -p
codex-chatgpt -- -C debuginfo=0` still fails with the same diagnostic. The fix is a compiler
query-depth setting, not a runtime stack or memory setting.

The one-line attribute is included only in patch v2. The final patch passes application checks
on both 0.156.0 and 0.156.1; full executable/test/PTY validation is running. Logs are
`logs/recursion-baseline.log`, `logs/recursion-fixed.log`, and
`logs/recursion-debug-zero.log` under the remote validation root. To avoid Cargo lock contention,
the final crate experiment used an APFS-cloned target cache with one compiler job while one
existing test compiler was temporarily paused; it was resumed afterward.

AIM session check: 0.153.1 passed the revision-1 PTY assertions on the M5 Pro using
AIM 0.8.1 copied to the validation directory (the installed AIM 0.3.0 lacks the Codex
adapter). A temporary wrapper puts the validation binary first on PATH and launches
`aim run codex smoke` with isolated AIM/profile storage, fake auth, and the smoke
renderer. Idle, draft typing, menu close, refresh, 36×18/120×32 resize, and cursor
placement passed. Evidence: `logs/0.153.1-aim-smoke.log` in the remote validation root.
This proves the session check, not completion of the still-running Rust test gate.

## Completed compatibility evidence

`0.153.1`: upstream commit `985641272869835d01d025ed2a218fbbce35fa9f`, unchanged v1
patch SHA-256 `e7a6b28bcc06ea0cd56913235803c7406fcb0b070e6256e9e08b3dbe21d6d3f6`.
The synchronized release executable pair built successfully; the version probe returned
`codex-cli 0.153.1`. All 9 focused `cxstatusline` Rust tests passed (4,102 unrelated tests
filtered out). Direct and AIM PTY smoke checks passed. Verified binaries and provenance are
retained in `verified/0.153.1/` under the remote root. This establishes macOS ARM64
compatibility; Linux builds and production publication remain release-pipeline gates.

The corrected 0.156.1 executable pair completed its full release build in 33m14s; the
version probe returned `codex-cli 0.156.1`. The isolated AIM 0.8.1 session passed all v2
assertions, including three visible rows while the slash menu was open. Logs:
`logs/0.156.1-retry.log` and `logs/0.156.1-early-aim-smoke.log`. The focused Rust tests
subsequently passed, as recorded below.

## Final v2 validation and release scope

Both 0.156.0 and 0.156.1 passed release executable builds, 12 focused Rust tests,
and direct plus AIM PTY smoke checks on the M5 Pro. The other 5,409 Rust tests were
filtered out, not reported as passed. Validated patch SHA-256:
`a0f6ef8c53c51ede94418c1e43c00ad4e8da903206ab8535e77c1e5cb8abbd84`.
Upstream commits: 0.156.0 `fe74a774532af67b5a4a3dec03ce9469e17f89af`;
0.156.1 `b412ff32c417f855c2b2d1581b77058eed87c84b`.

The approved coverage policy requires every stable release in the latest major.minor
series and only .0 baselines in older series above the support floor. Existing assets
and tested compatibility entries remain. The 0.153.2 build was stopped and 0.153.3
was not started; neither version is claimed supported. Production platform CI and
publication are separate from these macOS ARM64 validation results.
