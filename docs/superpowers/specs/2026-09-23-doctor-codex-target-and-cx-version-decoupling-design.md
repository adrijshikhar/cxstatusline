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

### Requirement 3: Refine `last_attempt` Backoff Visibility
- In PR #74, `src/hook/run.ts` introduced `probeRemoteCandidate`, which probes GitHub on SessionStart and immediately clears the 24-hour backoff if a previously unavailable release has been published.
- In `src/commands/doctor.ts`, `lastAttemptLine` currently says:
  `(hook retries after 24h; run cxstatusline install to retry now)`
- Update this to accurately reflect the live probe behavior:
  `(hook retries when release publishes or after 24h; run cxstatusline install to retry now)`
- This prevents operator confusion when a release is published within the 24-hour window.

### Requirement 4: Preserve Local `drift` Semantics
- `drift` continues checking whether the active generation is in sync with the local upstream `@openai/codex` executable found on PATH according to the user's `state.policy`.
- This ensures a clean separation of concerns:
  - `codex_target`: tells the user what the newest supported/published Codex version is (manifest + GitHub).
  - `drift`: tells the user whether their local CLI wrapper and generation are synchronized with the local `@openai/codex` binary on their system.

### Requirement 5: Fast, Async Execution with Offline Guarantee
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

---

## 5. Complete Audit of Existing Doctor Diagnostics

Every diagnostic line currently reported by `cxstatusline doctor` across all 4 sections was visited, audited, and verified:

### Section 1: Core & Environment
- `renderer`: `${ctx.cxBin} (${VERSION})` — Verified. Identifies active CLI binary and version.
- `settings`: `${ctx.paths.settingsFile} present / absent` — Verified. Confirms user configuration status.
- `platform`: `${platform}` or unsupported — Verified. Validates host OS/architecture (`darwin-arm64`, `linux-x64`, etc.).
- `toolchain`: `optional for prebuilt; ...` or flags required tools for compiled builds — Verified. Correctly keeps Rust/cargo optional for prebuilts.

### Section 2: Codex Integration
- `upstream`: `${bin} ${version}` or lookup error — Verified. Inspects PATH to locate original Codex binary.
- `wrapper`: `ours` (ok: true) / symlink / foreign / absent — Verified. Protects against foreign binary hijack.
- `hook`: `installed (...)` / absent / unreadable — Verified. Reports hook status and advises on `/hooks` in Codex.
- `policy`: `${state.policy}` — Verified. Displays update policy (`every`, `stable-minors`, `manual`).
- `codex_target`: **NEW** — Compares active Codex version with `patches/manifest.json` candidate and probes live GitHub releases.
- `drift`: Local upstream vs active generation — Verified. Separated cleanly from `codex_target`.

### Section 3: Active Generation & Binaries
- `active`: `${record.provenance.source} ${record.codexVersion}` — Verified. Checks active generation link.
- `generation`: directory path / dangling / foreign — Verified. Checks directory containment and pointer validity.
- `cx_version`: **FIXED** — Decoupled from CLI version (no more false red `✖` on CLI update).
- `release`: Release tag + archive SHA256 prefix — Verified. Supports both decoupled (`codex-v0.155.1`) and legacy tags.
- `patch`: Patch SHA256 prefix — Verified.
- `source_commit`: Commit hash and dirty check — Verified. Flags uncommitted dirty builds.
- `upstream_commit`: Upstream commit SHA — Verified.
- `codex_digest`: Re-hashes `codex` binary against manifest SHA256 — Verified. Critical security check.
- `host_digest`: Re-hashes `codex-code-mode-host` against manifest SHA256 — Verified. Critical security check.
- `codex_version`: Runs `codex --version` inside generation dir — Verified. Functional smoke test.
- `legal`: Checks bundled `LICENSE` and `NOTICE` — Verified. Legal compliance.
- `bookkeeping`: Surfaced if `state.patched_from !== record.codexVersion` — Verified.
- `legacy`: Flags old flat layouts needing revert/install — Verified.

### Section 4: State & Locks
- `state`: Path to `state.json` + corruption alert — Verified.
- `patched_from`: `state.patched_from` — Verified.
- `last_attempt`: **IMPROVED** — Wording refined to indicate live GitHub probe bypasses 24h backoff when a release publishes.
- `lock`: `free`, `held by pid`, or `stale pidfile` — Verified. Concurrency safety.
- `command_cache`: Cached command count and oldest entry age — Verified. Performance telemetry.

