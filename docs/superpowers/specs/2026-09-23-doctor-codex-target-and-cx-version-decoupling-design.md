# Doctor Command Revisit: Codex Target Visibility & cx_version Decoupling Spec

## 1. Overview & Context

`cxstatusline doctor` provides end-to-end diagnostics for the user's environment, Codex integration, active binary generations, state, and file locks.

Following the decoupling of prebuilt binary releases from `cxstatusline` package releases in PR #53, prebuilt binaries are tagged strictly as `codex-v<CODEX_VERSION>` (e.g. `codex-v0.155.1`). However, two critical diagnostic gaps remained in `doctor`:
1. **False-Alarm Failure on `cx_version`**: `doctor` continues to evaluate `record.provenance.cxVersion === VERSION`. When a user runs a newer CLI version (e.g. `0.6.0`) against an active generation installed previously (e.g. `0.2.0`), `doctor` emits a red `✖` bullet and counts it as an issue (`1 issue detected`), even though the generation is completely valid, verified, and operational.
2. **Missing Visibility into Supported/Available Codex Updates**: `doctor` only checks for `drift` against the locally installed `@openai/codex` binary on PATH. If local upstream is still on `0.154.0` and the active generation is on `0.154.0`, `doctor` reports `drift: none`, giving the user zero indication that `cxstatusline` supports a newer Codex version (`0.155.1`) with published prebuilts ready to install.

This specification modernizes `cxstatusline doctor` by decoupling `cx_version` into informational metadata and introducing a dedicated `codex_target` diagnostic line with live GitHub release verification.

---

## 2. Requirements & Behavior

### Requirement 1: Decouple `cx_version` in Active Generation
- In `src/commands/doctor-generation.ts`, `cxVersionLine(record)` must NOT return `ok: false` merely because `record.provenance.cxVersion !== VERSION`.
- When matching `VERSION`:
  - Value: `VERSION`
  - Status: `ok: true` (green bullet `✔`).
- When different from `VERSION`:
  - Value: `${record.provenance.cxVersion} (cli: ${VERSION})`
  - Status: `ok: null` (informational dim bullet `○`).
- When no generation exists:
  - Value: `n/a (no active generation)`
  - Status: `ok: null`.
- Impact: A difference between CLI version and generation `cxVersion` does not turn red and does not count as a system failure.

### Requirement 2: Add `codex_target` to Codex Integration Section
- In `src/commands/doctor-format.ts`, add `"codex_target"` to `SECTIONS` under `Codex Integration`:
  `keys: ["upstream", "wrapper", "hook", "policy", "codex_target", "drift"]`.
- `codex_target` compares the active generation's Codex version (`effectivePatchedFrom = status.record?.codexVersion ?? state.patched_from`) against the newest supported Codex version in `patches/manifest.json` (`manifest.candidate ?? supportedCodexVersions(manifest)[0]`).
- Live GitHub Probe:
  - Executes a fast live HTTP probe via `probeRemoteCandidate` with a strict **2-second timeout** (`AbortSignal.timeout(2000)`).
  - Probe targets `https://github.com/adrijshikhar/cxstatusline/releases/download/codex-v<target>/manifest.json`.
- Status and Display Matrix:
  1. **Active Generation Matches Target**:
     - Remote probe confirms prebuilt live on GitHub (HTTP 200/302):
       `✔ codex_target     <target> (up to date; verified on GitHub)` (`ok: true`)
     - Remote probe offline or skipped:
       `✔ codex_target     <target> (up to date)` (`ok: true`)
  2. **Active Generation Behind Target**:
     - Remote probe confirms prebuilt live on GitHub (HTTP 200/302):
       `○ codex_target     <target> available (active: <active>; prebuilt live on GitHub; run cxstatusline install to update)` (`ok: null`)
     - Remote probe reports 404 (prebuilt not yet published):
       `○ codex_target     <target> supported (active: <active>; prebuilt pending; run cxstatusline install --compile)` (`ok: null`)
     - Remote probe times out, offline, or network error:
       `○ codex_target     <target> supported (active: <active>; run cxstatusline install to update)` (`ok: null`)
  3. **No Active Generation Installed**:
     - Value: `<target> supported (run cxstatusline install)`
     - Status: `ok: null`.

### Requirement 3: Preserve Local `drift` Semantics
- `drift` continues checking whether the active generation is in sync with the local upstream `@openai/codex` executable found on PATH according to the user's `state.policy`.
- This ensures a clean separation of concerns:
  - `codex_target`: tells the user what the newest supported/published Codex version is.
  - `drift`: tells the user whether their local CLI wrapper and generation are synchronized with the local `@openai/codex` binary on their system.

### Requirement 4: Fast, Async Execution with Offline Guarantee
- `doctorReport` becomes `async` and accepts optional dependency overrides (`opts?: { probe?: boolean; probeFn?: typeof probeRemoteCandidate }`).
- CLI dispatch (`main.ts`) calls `await doctorReport(...)`.
- The live probe has a 2-second hard timeout and catches all rejections, guaranteeing that offline users never experience delays, crashes, or stack traces.

---

## 3. Architecture & File Changes

1. **`src/commands/doctor-generation.ts`**:
   - Update `cxVersionLine`:
     ```typescript
     function cxVersionLine(record: InstallationRecord | null): DoctorLine {
       if (!record) return line("cx_version", NO_GENERATION, null);
       const match = record.provenance.cxVersion === VERSION;
       if (match) return line("cx_version", VERSION, true);
       return line("cx_version", `${record.provenance.cxVersion} (cli: ${VERSION})`, null);
     }
     ```
2. **`src/commands/doctor.ts`**:
   - Make `doctorReport` async: `export async function doctorReport(ctx: Context, opts?: DoctorOptions): Promise<DoctorLine[]>`.
   - Implement `codexTargetLine(ctx, activeCodexVersion, probeFn, opts)` to evaluate `manifest.candidate`, probe GitHub, and format the line.
   - Inject `codexTargetLine` into the returned `DoctorLine[]` array.
3. **`src/commands/doctor-format.ts`**:
   - Add `"codex_target"` to `SECTIONS[1].keys` between `"policy"` and `"drift"`.
4. **`src/main.ts`**:
   - Update `cmd === "doctor"` handler to `await doctorReport(...)`.
5. **`test/doctor.test.ts`**:
   - Update tests to await `doctorReport`.
   - Add unit tests verifying:
     - `cx_version` returns `ok: null` when CLI and generation versions differ.
     - `codex_target` returns `ok: true` when up to date.
     - `codex_target` returns `ok: null` with clear guidance when a newer Codex version is available.
     - `codex_target` handles positive probe (200/302), negative probe (404), and timeout fallback without errors.

---

## 4. Verification Plan

1. **Unit Tests**:
   - Run `bun test test/doctor.test.ts` asserting all existing and new doctor assertions pass.
2. **Full Repository Test Suite**:
   - Run `bun test ./test ./src` and verify all tests pass.
3. **Typecheck**:
   - Run `bun run typecheck` (`tsc --noEmit`) to verify 0 typing errors.
4. **Manual Verification**:
   - Run `bun run dist/cxstatusline.js doctor` and verify formatted output against real environment.
