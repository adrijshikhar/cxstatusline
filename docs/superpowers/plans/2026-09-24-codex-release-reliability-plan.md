# Codex Release Reliability Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. Luna is the user-selected implementation agent. Steps use checkbox syntax for tracking. User explicitly authorized writing these artifacts and then starting Luna; do not add another approval gate for implementation.

**Goal:** Eliminate hidden upstream gaps and safely deliver replacement Codex builds under existing tags.

**Architecture:** Extend the existing compatibility manifest, watcher, release pipeline and generation installer. Add one small pure coverage module and a checked audit CLI; keep all compatibility ownership in the existing manifest. Publish complete verified release sets with an explicit backup/restore path, while clients continue using atomic local generations.

**Tech Stack:** TypeScript, Bun tests, GitHub Actions/gh, Git, Rust/Cargo, existing terminal smoke tooling. No new runtime dependency is expected.

**Spec:** [Codex release reliability](../specs/2026-09-24-codex-release-reliability-spec.md).

## Global Constraints

- Keep `codex-v<version>` tags; no patch-version suffixes.
- No overlapping ownership, automatic backports, or reassignment of previously supported Codex versions.
- Support floor comes from the earliest manifest minimum, currently 0.152.1.
- New prebuilt baseline: darwin-arm64 and linux-arm64; replacements preserve all already-published platforms.
- PR #102 and its branch belong to another agent. Do not modify them.
- Never push main, merge PRs, publish/delete production releases or globally install binaries during implementation.
- Do not reset the user's `~/.local/share/cxstatusline/codex` checkout.
- Run `bun test ./test ./src` before submitting a PR.

## Workspace and dependencies

Worktree: `/Users/nemesis/Projects/my-projects/cxstatusline/.worktrees/upstream-release-coverage`.
Branch: `fix/upstream-release-coverage`, created from origin/main then fast-forwarded through #100/#103 at `63610c2167131c5cd4784800fe5f7d9a0d6bc3aa`.
Open a stacked PR against `feat/patch-versions` while #103 is open; explain the #100/#103 dependencies. If dependencies merge, fetch and rebase/retarget without rewriting another agent's branch. Root will review the returned diff. Keep all work within this worktree and temporary test directories.

## Review Focus

1. Failure on page two of a release listing must prevent a healthy coverage result (Task 2).
2. Backfilling an older release must not lower candidate or select the newest patch revision (Tasks 1/3).
3. Same-size replacement archives with new hashes must not be skipped (Task 4).
4. An already-published extra platform must not disappear or retain an old revision (Task 4).
5. A client racing manifest/archive replacement must keep its prior active generation (Task 5).

## File ownership map

- `src/patch/manifest.ts`: compatibility validation and lookup; retain format-1 reading.
- `scripts/upstream-watch.ts`: applicability proposal and checked PR/conflict issue operations.
- `scripts/prebuilt/detect.ts`: pure stable-release filtering and ordering reused by audit.
- New `scripts/upstream-coverage.ts`: pure coverage classification plus paginated reads, kept small; split CLI only if it materially clarifies ownership.
- `scripts/prebuilt/gh.ts`, `report.ts`: existing checked GitHub operations/redaction/issue patterns to reuse.
- `scripts/prebuilt/{release,publish,cli-detect,cli-publish}.ts`: published state, backup, replacement, restore and detection.
- `src/distribution/{prebuilt,transport}.ts`, `src/patch/run.ts`: existing download/verification/update behavior; change only where regression tests find a gap.
- `.github/workflows/{upstream-watch,prebuilt}.yml`, new `.github/workflows/upstream-watch-health.yml`: schedules, artifacts, gates and watchdog.
- `patches/*.patch`, `test/patch-applies.test.ts`, terminal smoke runner: Rust integration and evidence.
- README and docs: compatibility policy, monitoring setup, replacement recovery and actual validation evidence.

## Task 1: Make watcher writes revision-aware and checked

**Files:** `scripts/upstream-watch.ts`, `test/upstream-watch.test.ts`; reuse `src/patch/manifest.ts` and `scripts/prebuilt/gh.ts`.

**Interfaces:** Preserve `runUpstreamWatch(options): Promise<WatchResult>` for one explicitly chosen proposal. Extend `updateManifestContent(content, newVersion, patchFile, patchVersion?)`; require the fourth argument for format 2. Historical gaps are audited, not automatically assigned a revision.

- [ ] Add regression tests that fail before changing code:

```ts
const before = JSON.stringify({ version: 2, tag_prefix: "rust-v", candidate: "0.156.1", patches: [
  { min: "0.153.4", max: "0.153.4", file: "codex-0.153.4.patch", patchVersion: 1 },
  { min: "0.156.1", max: "0.156.1", file: "codex-0.156.1.patch", patchVersion: 2 },
] });
const after = JSON.parse(updateManifestContent(before, "0.153.3", "codex-0.153.3.patch", 1));
expect(after.candidate).toBe("0.156.1");
expect(after.patches.map((p: { patchVersion: number }) => p.patchVersion)).toEqual([1, 2, 1]);
expect(() => updateManifestContent(before, "0.157.0", "codex-0.157.0.patch")).toThrow();
```

- [ ] Add failure-injection cases for issue/PR lookup and creation, branch creation, commit and push. Assert thrown errors and no subsequent write. Test existing issue matching by exact title/body marker, not fuzzy nonempty output.
- [ ] Run `bun test test/upstream-watch.test.ts` and record the expected failures.
- [ ] Preserve metadata by serializing parsed entries rather than reconstructing only min/max/file. Compare semvers before changing candidate. Validate the resulting manifest. Use checked Git mutations and `ghText`/`ghJson`, explicit repository, redacted errors and `--body-file` temporary files for external writes. Ensure branch creation succeeds before writing tracked files.
- [ ] For auto-proposals beyond the current candidate, carry the highest supported patch's explicit revision into the proposal. For an older uncovered version, report review needed instead of guessing/backporting. Preserve the current candidate's fixture assertions when backfilling.
- [ ] Make PR copy say “patch applies cleanly; compilation/runtime validation required”. Run focused tests and typecheck, then commit `fix: preserve patch ownership in upstream automation`.

## Task 2: Audit every released version and its prebuilt

**Files:** new `scripts/upstream-coverage.ts`, new `test/upstream-coverage.test.ts`, `scripts/prebuilt/detect.ts`, existing `src/distribution.ts` validation and `scripts/prebuilt/gh.ts`.

**Interfaces:**

```ts
export type CoverageStatus = "unsupported" | "missing-prebuilt" | "invalid-prebuilt" | "ready";
export interface CoverageRow { version: string; status: CoverageStatus; detail: string; patchVersion?: number }
// Consume existing Manifest, ReleaseManifest and Platform types; do not duplicate them.
// Keep pure classification separate from network/issue writes.
```

- [ ] Write a fixture listing 0.153.1/.2/.3, 0.156.0 and covered 0.156.1, plus duplicates, draft, prerelease and non-Codex tags. Assert all four unsupported rows remain visible when latest is covered. Exclude versions below manifest floor and never synthesize 0.154.1.
- [ ] Test a second page containing a missing version and a third-page error. The former must be included; the latter must throw before any issue edit/close or “healthy” result. Test semantic sorting (0.99 versus 0.100) and duplicate pages.
- [ ] Test supported/no release, draft-only release, stable-tag GitHub prerelease, missing companion/archive/checksums/manifest, stale patch digest, wrong revision, malformed release metadata and matching legacy digest.
- [ ] Run `bun test test/upstream-coverage.test.ts` to prove failures.
- [ ] Extract a stable-version list helper from `selectStableVersion` while preserving existing highest-version callers. Implement paginated reads to exhaustion using existing GitHub primitives. Hash the selected local patch and validate downloaded metadata with `validateManifest`; compare required asset names/sizes against the GitHub listing. Do not download large archives in the daily audit.
- [ ] Implement the pure table classifier, deriving the floor from the manifest and shared platform baseline. Export a machine-readable JSON report with checked timestamp, floor, rows and gap count; serialize only after the full read succeeds.
- [ ] Run focused audit/detection tests and commit `feat: audit all supported-horizon Codex releases`.

## Task 3: Wire complete reporting and watchdog

**Files:** `scripts/upstream-coverage.ts`, `scripts/upstream-watch.ts`, `.github/workflows/upstream-watch.yml`, new `.github/workflows/upstream-watch-health.yml`, `.github/workflows/prebuilt.yml`, new or existing watcher tests, README.

**Interfaces:** Coverage CLI supports read-only `--dry-run`, JSON output path and normal issue upsert; one stable title `Codex release coverage gaps` and marker `<!-- cxstatusline-codex-coverage -->`. Existing version-specific watcher proposals remain a separate operation.

- [ ] Add tests for first issue creation, repeat update, full-audit success closing, existing unmarked same-title issue not being hijacked, failed lookup/write producing failure, and dry-run producing no writes.
- [ ] Invoke complete audit regardless of the latest-version watcher outcome. Upload JSON and write Actions summary on completed audits; fail if reporting fails. A coverage gap may be a tracked nonzero result with a clear summary, never a false “all covered”. Use one issue to avoid daily duplicates. Do not actually file production issues during tests.
- [ ] Replace hardcoded Codex choices in the prebuilt workflow with a string input validated by `resolveDetection`; preserve `auto` behavior. Remove obsolete watcher choice-list mutation if no callers remain, with tests updated to the new ownership.
- [ ] Implement watchdog pure check with a fixed 36-hour threshold over successful `schedule` runs only. Test 35 hours, exactly 36 hours, 37 hours, no runs, recent manual success and API failure. Add a separate daily workflow using read-only Actions permission and `::error::` plus failed exit; do not use GitHub issues as its notification path.
- [ ] Document how to enable Actions notifications and the GitHub-wide outage limitation. Run audit/watcher/workflow tests and commit `fix: surface skipped releases and watcher failures`.

## Task 4: Replace published same-tag releases safely

**Files:** `scripts/prebuilt/{release,publish,cli-detect,cli-publish}.ts`, `.github/workflows/prebuilt.yml`, `test/{prebuilt-publish,prebuilt-detect-cli,prebuilt-gh-fixture}.ts`; add focused backup tests/helpers only where necessary.

**Interfaces:** Preserve `releaseTag(version)`. Changed publication identity yields `should_build=true`. Add explicit backup/restore CLI stages to the existing prebuilt command dispatcher, using a caller-supplied backup directory and the same checked `GhRunner`. The backup contains prior release metadata, assets, checksums and a snapshot of release identity. Do not encode backup behavior as a second publication implementation.

- [ ] Write a publish fixture for old and new build sets at the same Codex version. Include equal-size/different-hash archives, an existing x64 platform, a concurrent identity change, upload failure, verification failure and restoration failure.
- [ ] Assertions: no mutation before replacement verification and complete verified backup; changed identity builds in detect; identical bytes no-op; no loss of existing platforms; no merge across differing source/patch identity; every restored/published asset passes checksum verification; new manifest uploads last; successful restoration reports original failure, not successful new publication.
- [ ] Run focused tests to demonstrate current immutability failure and unsafe size-only assumptions.
- [ ] Extend detect to build the union of requested and published platforms for a replacement, or fail before mutation if the requested runner cannot build them. Preserve original tag refs. Remove obsolete “npm bump gets a new tag” instructions.
- [ ] Implement backup before publication; workflow uploads it with `retention-days: 90` before invoking replacement. The publisher rechecks the original identity after backup and immediately before mutation. Reuse verified archive/manifest/checksum helpers.
- [ ] Delete/recreate only the release object if necessary, as a draft under the existing tag. Upload a complete new set, checksum file and manifest last; redownload and verify; then publish. Never mark replacement atomic. On failure after mutation, restore the complete backup and report verification/recovery outcomes. A mismatched unrelated draft must not be silently overwritten.
- [ ] Ensure `prebuilt-publish-${tag}` concurrency remains and document temporary unavailability. Dry-run never modifies external release state.
- [ ] Run publish/detect/report/merge tests and commit `fix: safely replace rebuilt Codex releases under existing tags`.

## Task 5: Prove same-version installation and failure safety

**Files:** `test/distribution-prebuilt.test.ts`, `test/run.test.ts`, `test/prebuilt-discovery.test.ts`, `test/doctor.test.ts`; modify `src/distribution/prebuilt.ts`, `src/patch/run.ts`, `src/commands/doctor.ts` only if a test exposes a gap.

**Interfaces:** Existing `preparePrebuilt`, `runUpdate`, generation activation and `doctorReport` remain the public seams. Retain legacy reading.

- [ ] Extend the existing loopback release fixture to switch between old and new complete release sets with the same Codex version. Activate old set, serve new patch hash/executable digests, call update, and assert the new generation/revision and executable bytes.
- [ ] Inject a truncated archive, 404, old manifest/new archive, new manifest/old archive and wrong digest. Assert active generation path and its bytes remain unchanged. Test unchanged verified content as a no-op and newer installed Codex as non-downgradable.
- [ ] Test release discovery pagination and stable-tag prerelease inclusion if the current discovery implementation omits them; preserve its existing consumer-facing failure contract unless a caller explicitly needs a diagnostic error.
- [ ] Check doctor returns actual installed revision/hash and `unknown (legacy)` for legacy metadata, without inferring current ownership.
- [ ] Run `bun test test/distribution-prebuilt.test.ts test/run.test.ts test/prebuilt-discovery.test.ts test/doctor.test.ts`. Make only required source fixes, then commit `test: cover rebuilt same-version installs and interrupted replacement`.

## Task 6: Make footer behavior an explicit release gate

**Files:** `patches/codex-0.156.1.patch` only if coverage is missing, `scripts/prebuilt/cli-build.ts`, `.github/workflows/prebuilt.yml`, an appropriate new `scripts/test-footer-smoke.*` harness and tests, validation evidence document.

**Interfaces:** A deterministic renderer prints three uniquely identifiable rows. Smoke runner accepts an explicit Codex executable, uses an isolated temporary config/environment and fails if row visibility or cursor/input behavior is wrong. Reuse existing terminal tooling if installed; do not add a dependency without identifying the gap it fills.

- [ ] Inspect `/tmp/cx-aim-smoke.py`, `/tmp/cx-aim-warnings-smoke.py` and corrected `/tmp/cx-footer-1561` before reusing. They are evidence/prototypes, not a stable checked-in dependency.
- [ ] Persist a repeatable footer/layout regression gate. Exercise idle, warnings, draft typing, slash-menu open/close, refresh, response transition and narrow/wide terminal resize. Never declare a response tested without driving that transition. Keep ordinary CI independent of live model credentials; use Rust tests for transitions that cannot be driven deterministically through the CLI.
- [ ] Run focused corrected Rust footer/composer tests. Add meaningful missing cases in the patch and prove the original broken layout fails them where practical. Do not regenerate unrelated upstream snapshots.
- [ ] Wire focused Rust tests into prebuilt validation before publication. Record the terminal smoke scope separately from unit tests; CI gating must be executable, not just prose.
- [ ] Use AIM for a local session check if configuration remains available, preserving global installation and the user's source checkout. Record exact commands, results and limits.
- [ ] Commit `test: gate prebuilt releases on multiline footer behavior` after the runnable gate passes; report any toolchain blocker without weakening the gate.

## Task 7: Validate the four missing releases without speculative support

**Files:** `patches/manifest.json`, version-specific patch files if validation passes, test fixtures using the manifest, README, new `docs/codex-release-validation.md` evidence table.

**Interfaces:** Compatibility entries stay exact. Candidate stays 0.156.1 while older gaps are filled. v1 owns tested 0.153.1–0.153.3; v2 owns tested 0.156.0. Do not change historical ownership.

- [ ] Use dedicated upstream worktrees for each missing tag. Neighboring v1 patches apply to 0.153.1–0.153.3; corrected v2 applies to 0.156.0. Recheck exact patch digests and run apply tests without changing the existing user's checkout.
- [ ] Compile and run version probes, focused Rust layout tests and applicable terminal smoke checks for each. Known possible blocker: upstream rusty_v8 150.4.0 macOS ARM archive returned 404 earlier. Capture an actual failing command if still blocked; do not repeatedly retry unchanged prerequisites.
- [ ] Add only versions that pass the required gates. If validation is blocked, keep the audit gap, save exact reproducible commands and evidence, and mark this task partial rather than silently shipping support. Prefer available Linux CI validation when it can genuinely resolve a local platform dependency; do not publish while testing.
- [ ] Regenerate/update manifest-derived fixtures and documentation. Run coverage dry-run to show the remaining real gaps and commit `feat: support validated intermediate Codex releases` only for validated additions; otherwise commit truthful validation documentation.

## Task 8: Review, submit, and record rollout

**Files:** README, spec/plan checkboxes and evidence document, PR body.

- [ ] Run `bun test ./test ./src`, `bun run typecheck`, `bun run build`, `git diff --check`. Record actual counts and any skipped/blocked integration tests. No success based only on a prior baseline.
- [ ] Self-review against every R1–R6 requirement. Fix uncovered trust-boundary errors, cross-generation platform mixing, unchecked commands and stale immutability wording. Keep this task's acceptance criteria unchanged.
- [ ] Push only `fix/upstream-release-coverage`. Open a Conventional Commit PR against `feat/patch-versions` while #103 remains open, with concise behavior/validation/limitations and dependency links. Do not modify #102.
- [ ] Update plan checkboxes accurately. Report changed files, commit/PR, test results, unresolved blockers and exact next rollout step to the root agent. Root independently reviews the diff and focused evidence.
- [ ] Document rollout order: integrate #100/#103 and this PR; release updated npm installer before schema-2 prebuilts; run coverage audit; build validated gaps; prepare backup/replacement of 0.156.1/v2; perform production publishing only as a separately requested rollout. Do not claim any release was published by this development task.

## Plan self-review

R1 maps to Task 1; R2 to Task 2; R3 to Task 3; R4 to Task 4; R5 to Task 5; R6 to Tasks 6–7. Task 8 owns repository checks, PR and truthful rollout status. All five review-focus conditions have assigned regression checks. Runtime dependency failures remain explicit coverage gaps, not compatibility claims. No implementation step requires modifying the picker branch or the user's installed binary.
