# Codex patch ownership and release reliability

Status: implementation authorized by the user on 2026-09-24; implementation delegated to Luna.

## Purpose

Every stable upstream Codex release within our support horizon must be accounted for: either explicitly supported by one Rust patch version and shipped, or visible as a tracked gap. A latest-version-only success must never conceal older gaps. Rebuilt binaries must reach existing users even when the Codex version and release tag do not change.

## Accepted decisions

- Rust patch versions are independent of Codex versions and the cxstatusline npm version.
- Each patch version owns an explicit list of tested Codex releases. Keep the existing flat manifest with `patchVersion` on exact entries; do not add a second registry. Keep legacy range parsing for compatibility, but do not widen shipped ranges to untested releases.
- No overlapping ownership, automatic backports, or reassignment of previously supported Codex versions. Use the existing patch version until a newer upstream integration requires the next version.
- Preserve `codex-v<version>` tags. The user explicitly permits replacement of published assets and, when needed, deletion/recreation of the release. Do not introduce patch-version tag suffixes or require a package bump to change a prebuilt.
- Verify the entire new build before any destructive publication step. Local installation activation remains atomic; GitHub multi-asset replacement is not atomic and must not be described as such.
- PR #102 and its branch belong to another agent. Do not modify them.
- Current work produces reviewed code, tests, documentation and PRs. Production publication, merging, and global installation are rollout steps, not side effects of developing or testing this change.

## Evidence and starting point

Branch `feat/patch-versions`, commit `63610c2167131c5cd4784800fe5f7d9a0d6bc3aa`, includes #100 and #103. Baseline: 981 tests passed, one optional upstream-checkout test skipped; typecheck and bundle build passed.

Current ownership: v1 = 0.152.1, 0.153.0, 0.153.4, 0.154.0, 0.155.0, 0.155.1; v2 = 0.156.1. Support floor is the earliest manifest minimum, currently 0.152.1. Audit every stable release in the latest major.minor series and only .0 baselines in older series at or above that floor, including releases newer than the candidate. Preserve existing published assets and tested compatibility entries. Do not invent intermediate semver versions that upstream never released.

Confirmed gaps: 0.153.1, 0.153.2, 0.153.3 and 0.156.0. `git apply --cached --check` succeeds with the neighboring v1 patch for the three 0.153 releases and the corrected v2 patch for 0.156.0. This is applicability evidence only, not completed build/runtime validation.

Confirmed failures:

1. `scripts/upstream-watch.ts` and prebuilt auto detection call `selectStableVersion`, which selects only the maximum. Once it is supported, the watcher returns before checking gaps.
2. The watcher fetches only one page of upstream releases.
3. The watcher ignores unsuccessful Git writes and GitHub issue/PR creation. A simulated failed issue creation returned `issue_created`.
4. `updateManifestContent` strips every `patchVersion` field. It also unconditionally changes `candidate`, so filling an older gap can move the candidate backward.
5. Published-release policy rejects changed inputs even though the tag is now Codex-only; its suggested npm version bump cannot resolve the conflict.
6. Patch application does not exercise footer layout. The original 0.156.1 patch clipped rows when a warning caused an early height return.

Evidence: watcher runs 35706947030 (0.155.1), 35839505009 (issue #77 for 0.156.1), 35977269394 (`already_covered (0.156.1)`); issue #101 separately reports prebuilt validation failures.

## Required behavior

### R1. Patch metadata survives every writer

All manifest writers preserve revision fields and unrelated metadata. New entries require an explicit selected patch version for format 2. Candidate stays the semantic maximum of existing candidate and added version. Existing covered entries are idempotent; conflicting ownership fails visibly. Do not auto-assign v2 to historical v1 releases by selecting the final array entry. Historical gaps can be reported for review without automatically writing support entries. Newly generated support PRs describe `git apply` as applicability only and require build/runtime validation before merge.

### R2. Complete coverage audit

Use paginated GitHub release listings. Filter upstream to non-draft, non-prerelease exact `rust-v<X.Y.Z>` releases. Deduplicate and sort semantically. Enumerate to exhaustion (do not stop on older versions because GitHub lists by publication time). A failed later page invalidates the audit: never report complete coverage from partial data.

For each upstream version at/above the manifest floor, report one of:

- `unsupported`: no compatibility entry;
- `missing-prebuilt`: supported, but no published matching release with required assets;
- `invalid-prebuilt`: release metadata/assets are missing, invalid, or disagree with selected revision/patch hash;
- `ready`: compatible manifest and published metadata/assets agree.

A published GitHub prerelease with an exact stable `codex-v<X.Y.Z>` tag counts as a prebuilt; existing releases use this flag. Draft releases never count. Audit the release manifest and asset names/sizes; archive hashing belongs to publish/install verification, not the daily audit. Legacy schema-1 release metadata may count only when its patch digest matches the explicitly selected patch bytes; do not label its installed revision as known. Report an outdated/mismatched digest as a gap.

For a new prebuilt, required platforms are darwin-arm64 and linux-arm64 (the current active release baseline). Existing releases must retain all already-published platforms during replacement; their union with explicitly requested targets determines the replacement build matrix. No silent x64 removal. Share the platform baseline in existing build configuration/helper ownership rather than copy it across scripts.

Audit has one stable repository-scoped tracking issue with a body marker and a sorted version/status table. Upsert it idempotently. Close only after a complete successful audit finds no gaps. API failures must leave existing issue state intact and make Actions fail. An open support PR is useful context, never proof of ready coverage. Keep conflict issues for actionable patch diagnostics; avoid creating duplicate gap issues per daily run.

Keep latest-version prebuilt scheduling initially; the complete audit and manual manifest-validated version input make older missing builds actionable. A bulk build scheduler is not required.

### R3. Reliable automation and observability

Reuse `ghText`/`ghJson` for checked GitHub commands and a checked wrapper for Git mutations. Failed lookup is not an empty result. Do not report issue/PR creation without successful output. Redact failures and preserve the failing step in Actions output. Use explicit repository selection for external operations.

Manifest is the only supported-version source: replace hardcoded workflow choices with a string input validated by the manifest, or derive the choices through an existing generator if one exists. Do not maintain a new duplicate version list.

Run the coverage audit on the daily watcher schedule even when the latest release is supported, has a PR, or has a conflict. Emit a machine-readable artifact and readable Actions summary. Add a small separate watchdog workflow checking the most recent successful scheduled watcher run; older than 36 hours or no successful run is a failure. Dry-run/manual runs do not refresh that heartbeat. Watchdog failures use Actions annotations/job status, not issue creation, so issue-write failures cannot suppress them. Document enabling GitHub Actions email/web notifications. An outage affecting all GitHub scheduling cannot be detected from within GitHub; document this limit rather than claiming an external monitor was configured.

### R4. Safe same-tag replacement

A changed patch/source identity means rebuild, not an immutable-release error. A dry run may build and verify without publication. Identical valid published builds remain no-ops. Exact tag format and validation stay unchanged.

Serialize publish operations by Codex release tag. Before touching a published set, validate the replacement and download/check the complete old set into a backup directory. Persist the backup as a workflow artifact before mutation, with 90-day retention and a documented restore command. If backup fails, do not mutate. Preserve the existing Git tag; deletion of the release object need not delete the tag.

Prefer replacing the release as a complete draft set rather than merging different generations. Retain all previously published platforms. Upload new archives and checksums, with the new manifest last; redownload and hash all assets; expose the release only after verification. Resume only a draft whose recorded manifest hash matches this build. Failed post-mutation publication must attempt restoration of the verified backup; if restoration fails, fail loudly and retain the backup artifact/instructions. Do not mix retained old-platform bytes with a new patch/source identity. Never skip a changed asset merely because its byte size matches.

Every GitHub call is checked. Run-level locking is supplemented by re-reading published identity immediately before mutation; abort if another actor changed the source set after backup. A release replacement can briefly be unavailable. Installers must fail safely during that window.

### R5. Updates and diagnostics

`update` continues to check the selected release even when the installed Codex version matches. Compare validated revision/hash and executable digests, never version string alone. Do not downgrade a newer installed Codex. Interrupted download, 404 during replacement, mixed old/new assets, checksum mismatch or malformed metadata must leave the active generation unchanged.

Keep old release/installation metadata readable. `doctor` displays actual installed Codex version, Rust patch version (or unknown legacy), patch SHA and source identity. Never infer a binary's revision solely from the current compatibility table.

### R6. Behavioral validation and gap rollout

Use the existing patched Rust footer tests and an automated terminal smoke harness with a deterministic three-line renderer. Exercise idle, warnings, typing, slash menu open/close, refresh, response completion and terminal resizing. Assert all three rows and input/cursor behavior, not just patch applicability or absence of a crash. Avoid depending on live model output for ordinary CI; an AIM run can remain a local integration check with explicit evidence.

CI builds from the exact selected upstream tag and patch, runs focused Rust footer/layout tests, and executes version-specific smoke checks before publication. Do not accept broad unrelated upstream snapshot churn as evidence for the footer fix. Preserve the user's existing source checkout at `~/.local/share/cxstatusline/codex`; use dedicated worktrees. Existing corrected source/binary and AIM smoke scripts are under `/tmp/cx-footer-1561` and `/tmp/cx-aim-*-smoke*`; inspect before reuse.

Ship validated 0.156.0 and 0.156.1 with v2. Retain the validated 0.153.1 v1 mapping; do not backfill obsolete 0.153.2/0.153.3. If a toolchain/artifact dependency blocks validation, leave the version in the audit's unsupported table, record the concrete blocker, and provide reproducible CI/manual commands. Never broaden support or claim completion based solely on clean application. Rebuild 0.156.1/v2 as a later production rollout using the new replacement path.

## Non-goals

No new tag naming scheme, package registry, database, SaaS monitoring service, universal cross-version Rust diff, implicit backports, or automatic merge of support PRs. Do not publish/delete production releases while testing. Do not modify picker PR #102. Do not reset the user's patched Codex checkout.

## Acceptance

- Complete paginated audit identifies missing latest-series releases and older .0 baselines, excludes obsolete historical patch gaps, handles series rollover, and never invents unreleased versions.
- Watcher manifest mutation round-trips through `loadManifest` with every revision preserved.
- Failure injection proves no success is claimed after a failed Git/GitHub call.
- Replacement tests prove complete backup precedes mutation, no size-only skip, no platform loss, manifest-last upload, post-upload verification and rollback/error handling.
- A loopback integration test installs old bytes, serves new same-version bytes, updates successfully, then rejects a mixed/interrupted set without changing the active generation.
- Footer behavior is exercised by focused Rust and terminal tests; unvalidated gaps remain explicit.
- `bun test ./test ./src`, `bun run typecheck`, `bun run build` and `git diff --check` pass. Any optional or blocked integration check is recorded accurately.
- Conventional Commit PR(s), no main push, no production publishing during implementation.

Approved rollout: merge dependencies and this change, ship the metadata-compatible npm installer, then publish 0.156.0 and safely replace 0.156.1 after production platform gates pass.
