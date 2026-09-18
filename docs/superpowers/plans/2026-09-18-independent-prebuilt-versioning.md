# Independent Prebuilt Versioning Implementation Plan

Decouple the compiled Codex Rust binary releases (`codex-v<CODEX_VERSION>`) from the `cxstatusline` npm package versions (`v<CX_VERSION>`), eliminating unnecessary rebuilds and allowing any version of `cxstatusline` to consume the latest matching prebuilt binary.

---

## Architecture & Design Decisions

### 1. Release Tag Specification
- **New Prebuilt Tag Format**: `codex-v<CODEX_VERSION>` (e.g. `codex-v0.155.0`).
- **Source Release Tag Format**: `v<CX_VERSION>` (e.g. `v0.5.1`) — untouched.
- Prebuilt tags are uniquely keyed by the Codex version and never contain the CLI version.

### 2. Runtime Decoupling (`src/distribution.ts`, `src/distribution/prebuilt.ts`, `src/patch/*`)
- `releaseTag(codexVersion: string)` produces `codex-v${codexVersion}`.
- `ExpectedRelease` simplified to:
  ```ts
  export interface ExpectedRelease {
    readonly codexVersion: string;
    readonly platform: Platform;
  }
  ```
- `ReleaseManifest` drops `cxVersion` (or makes it optional provenance metadata).
- `validateManifest` validates:
  - `m.codexVersion === expected.codexVersion`
  - `m.artifacts` contains `expected.platform`
  - All file digests and schema invariants pass.
- `probePrebuiltExists(targetCodexVersion, fetchFn, baseUrl)` checks `codex-v${targetCodexVersion}`.

### 3. CI Pipeline Decoupling (`scripts/prebuilt/*`, `.github/workflows/prebuilt.yml`)
- `detect.ts`: `resolveDetection(manifest, codexVersion)` returns `tag: codex-v${codexVersion}`.
- `cli-detect.ts`: checks if `codex-v${codexVersion}` is already published. If published with identical `patchSha256` and assets, `should_build: false`.
- `package`, `verify`, `publish`: drop required `--cx-version` argument.
- `.github/workflows/prebuilt.yml`: update job parameters, inputs, and artifact naming to use `codex-v<CODEX_VERSION>`.
- `scripts/release-npm.ts`: checks that `codex-v${candidate}` exists before publishing npm package.

---

## File Changes & Responsibilities

| File | Change Summary |
| :--- | :--- |
| [`src/distribution.ts`](file:///Users/nemesis/Projects/my-projects/cxstatusline/src/distribution.ts) | Update `releaseTag(codexVersion)`, remove `cxVersion` from `ExpectedRelease` & `ReleaseManifest`, update `checkBusinessRules` & `validateManifest`. |
| [`src/distribution/prebuilt.ts`](file:///Users/nemesis/Projects/my-projects/cxstatusline/src/distribution/prebuilt.ts) | Use `releaseTag(expected.codexVersion)` in `preparePrebuilt`. |
| [`src/patch/acquire.ts`](file:///Users/nemesis/Projects/my-projects/cxstatusline/src/patch/acquire.ts) | Remove `cxVersion` from `expectedRelease` helper. |
| [`src/patch/run.ts`](file:///Users/nemesis/Projects/my-projects/cxstatusline/src/patch/run.ts) | Simplify `probePrebuiltExists` signature and implementation to check `releaseTag(targetCodexVersion)`. |
| [`scripts/prebuilt/detect.ts`](file:///Users/nemesis/Projects/my-projects/cxstatusline/scripts/prebuilt/detect.ts) | Remove `cxVersion` requirement from `resolveDetection`. |
| [`scripts/prebuilt/cli-detect.ts`](file:///Users/nemesis/Projects/my-projects/cxstatusline/scripts/prebuilt/cli-detect.ts) | Remove `cxVersion` from detection and release classification. |
| [`scripts/prebuilt/pack.ts`](file:///Users/nemesis/Projects/my-projects/cxstatusline/scripts/prebuilt/pack.ts) | Remove `cxVersion` from manifest assembly. |
| [`scripts/prebuilt/cli-build.ts`](file:///Users/nemesis/Projects/my-projects/cxstatusline/scripts/prebuilt/cli-build.ts) | Remove `--cx-version` flag requirement in `package` and `verify`. |
| [`scripts/prebuilt/cli-publish.ts`](file:///Users/nemesis/Projects/my-projects/cxstatusline/scripts/prebuilt/cli-publish.ts) | Remove `--cx-version` flag requirement in `publish`. |
| [`scripts/prebuilt.ts`](file:///Users/nemesis/Projects/my-projects/cxstatusline/scripts/prebuilt.ts) | Update USAGE text for prebuilt CLI. |
| [`scripts/release-npm.ts`](file:///Users/nemesis/Projects/my-projects/cxstatusline/scripts/release-npm.ts) | Update `releaseTag(input.candidate)` in `assertReleaseIdentity`. |
| [`.github/workflows/prebuilt.yml`](file:///Users/nemesis/Projects/my-projects/cxstatusline/.github/workflows/prebuilt.yml) | Remove `CX_VERSION` env vars and flags; tag is `codex-v<CODEX_VERSION>`. |
| [`test/distribution.test.ts`](file:///Users/nemesis/Projects/my-projects/cxstatusline/test/distribution.test.ts) | Update unit tests for independent `releaseTag` and `validateManifest`. |
| [`test/distribution-prebuilt.test.ts`](file:///Users/nemesis/Projects/my-projects/cxstatusline/test/distribution-prebuilt.test.ts) | Update prebuilt installation and staging tests. |
| [`test/release-fixture.ts`](file:///Users/nemesis/Projects/my-projects/cxstatusline/test/release-fixture.ts) | Update test fixture generator. |
| [`test/prebuilt*.test.ts`](file:///Users/nemesis/Projects/my-projects/cxstatusline/test/prebuilt.test.ts) | Update detect, build, and publish tests for new tag format. |
| [`test/run.test.ts`](file:///Users/nemesis/Projects/my-projects/cxstatusline/test/run.test.ts) | Update tests calling `probePrebuiltExists`. |

---

## Step-by-Step Implementation Tasks

### Task 1: Update Core Distribution Types & Validation (`src/distribution.ts`)
- **Step 1.1**: Update `test/distribution.test.ts` to expect `releaseTag("0.155.0") === "codex-v0.155.0"`, update `ExpectedRelease` fixtures without `cxVersion`, and remove the `cxVersion mismatched` mutation test.
- **Step 1.2**: Run `bun test test/distribution.test.ts` and confirm failure.
- **Step 1.3**: Update `src/distribution.ts`:
  - `releaseTag(codexVersion: string): string`
  - Remove `cxVersion` from `ExpectedRelease`
  - Update `ReleaseManifest` schema to make `cxVersion` optional or omitted
  - Remove `cxVersion` equality check from `checkBusinessRules`
- **Step 1.4**: Run `bun test test/distribution.test.ts` and confirm all tests pass.

### Task 2: Update Prebuilt Acquisition & Probing (`src/distribution/prebuilt.ts`, `src/patch/*`)
- **Step 2.1**: Update `src/distribution/prebuilt.ts` to call `releaseTag(expected.codexVersion)`.
- **Step 2.2**: Update `src/patch/acquire.ts` to omit `cxVersion` from `expectedRelease`.
- **Step 2.3**: Update `src/patch/run.ts` `probePrebuiltExists(targetCodexVersion: string, fetchFn: FetchLike, baseUrl?: string)` and callers.
- **Step 2.4**: Update `test/distribution-prebuilt.test.ts` and `test/run.test.ts`.
- **Step 2.5**: Run `bun test test/distribution-prebuilt.test.ts test/run.test.ts` and confirm all tests pass.

### Task 3: Update Prebuilt CLI & Packaging Scripts (`scripts/prebuilt/*`)
- **Step 3.1**: Update `scripts/prebuilt/detect.ts`: `resolveDetection(manifest, codexVersion)` returns `tag: releaseTag(codexVersion)`.
- **Step 3.2**: Update `scripts/prebuilt/pack.ts`: remove `cxVersion` from `assembleManifest`.
- **Step 3.3**: Update `scripts/prebuilt/cli-detect.ts`, `scripts/prebuilt/cli-build.ts`, `scripts/prebuilt/cli-publish.ts`: make `--cx-version` flag optional/unused.
- **Step 3.4**: Update `scripts/release-npm.ts`: update `assertReleaseIdentity` to check `releaseTag(input.candidate)` (`codex-v${input.candidate}`).
- **Step 3.5**: Update `test/prebuilt*.test.ts` and `test/release-npm.test.ts`.
- **Step 3.6**: Run `bun test test/prebuilt*.test.ts test/release-npm.test.ts` and confirm all tests pass.

### Task 4: Update GitHub Actions Workflow (`.github/workflows/prebuilt.yml`)
- **Step 4.1**: Remove `CX_VERSION` env and `--cx-version` CLI flag calls from `package`, `verify`, `publish`, and `report`.
- **Step 4.2**: Verify workflow syntax and run `bun test ./test ./src` to ensure 100% test suite pass across all 68 files.

### Task 5: Verification, Commit & Prebuilt Dispatch
- **Step 5.1**: Run full repository verification:
  - `bun run typecheck`
  - `bun test ./test ./src`
  - `CXSTATUSLINE_RELEASE_BUILD=1 bun run build`
  - `bun run check:package`
- **Step 5.2**: Commit changes and create PR.
- **Step 5.3**: Merge PR and dispatch `prebuilt.yml` to generate `codex-v0.155.0` on `m5-pro`.
