# Port CC to CX Skill & Upstream Parity (v2.2.30) Design Specification

- **Date**: 2026-09-19
- **Status**: Draft (Approved in Brainstorming)
- **Target Issue**: [#56 (Upstream Parity: ccstatusline release v2.2.30)](https://github.com/adrijshikhar/cxstatusline/issues/56)
- **Branch**: `feat/port-skill-and-upstream-v2.2.30`

---

## 1. Overview & Goals

`cxstatusline` is derived from `sirmalloc/ccstatusline` (designed for Claude Code CLI) and adapted for OpenAI Codex CLI. As `ccstatusline` continues to evolve, features, optimizations, and bugfixes need to be regularly ported while preserving Codex-specific telemetry, patch systems, and architecture.

This specification defines:
1. A permanent, reusable **Port Skill** in `.agents/skills/port-cc-to-cx/` containing deterministic triage rules, translation guides, and attribution requirements.
2. A CLI helper tool in `scripts/port-upstream.ts` (with helper scripts in `.agents/skills/port-cc-to-cx/scripts/`) to automate upstream commit fetching, triage analysis, diff inspection, and baseline updating.
3. The concrete implementation and porting of the upstream `v2.2.30` release commits to resolve Issue #56.

---

## 2. Constraints & Scope

1. **Codex Compatibility**: Only features applicable to OpenAI Codex CLI are ported. Claude-specific authentication, keychain access, or token refresh routines are out of scope.
2. **Behavioral Fidelity**: Copied widgets, UI layout, themes, separators, and options must match upstream behavior and names unless there is a conflict.
3. **Legal & Attribution**: Every derived file must be attributed in `NOTICE` with Matthew Breedlove's copyright notice and the specific upstream commit. `scripts/upstream-ccstatusline.json` must record the new baseline commit.
4. **Guardrail Compliance**: All changes are made on a feature branch (`feat/port-skill-and-upstream-v2.2.30`) and submitted via Pull Request with Conventional Commits title. Direct push to `main` is blocked.
5. **Single PR Delivery**: Both the skill/tooling and the ported `v2.2.30` changes will be verified together and delivered in a single PR.

---

## 3. Skill Architecture & Components

The skill lives in `.agents/skills/port-cc-to-cx/`:

```
.agents/skills/port-cc-to-cx/
├── SKILL.md                          # Primary agent workflow, triage checklist, and commands
├── references/
│   ├── translation-guide.md          # Code translation dictionary (types, imports, telemetry)
│   └── triage-matrix.md              # Commit categorization rules (Categories A, B, C, D)
└── scripts/
    ├── fetch-diff.sh                 # Fetches commit diffs via `gh api` or local checkout
    ├── triage.py                     # Categorizes commits and lists changed files
    └── update-baseline.sh            # Updates upstream-ccstatusline.json and NOTICE
```

### 3.1 `scripts/port-upstream.ts` CLI Helper

A TypeScript / Bun script providing CLI commands:
- `bun run scripts/port-upstream.ts check [--repo <repo>]`: Compares current `baseCommit` in `scripts/upstream-ccstatusline.json` against upstream `HEAD` or latest tag using `gh api`.
- `bun run scripts/port-upstream.ts diff <commit-or-range> [--cc-checkout <path>]`: Fetches patch/diff for a commit or range from GitHub API or a local clone.
- `bun run scripts/port-upstream.ts update-baseline <commit>`: Atomically updates `scripts/upstream-ccstatusline.json` with the new base commit hash.

### 3.2 Triage Matrix

Every upstream commit is assigned to one of four categories:
- **Category A (Direct Port)**: Generic widgets (git, jj, custom command, symbols, terminal width, layout, formatting). Requires syntax translation (imports, types) and direct unit test porting.
- **Category B (Adapt to Codex)**: Telemetry and usage calculation. Requires mapping Claude session structures to Codex equivalents.
- **Category C (Skip/Drop)**: Claude-specific features (keychain, OAuth tokens, Anthropic APIs, external third-party tools like claudenews). Documented as skipped.
- **Category D (Tooling/Dependencies)**: Upstream dev-dependency bumps. Evaluated independently against Bun/Node 22 and TypeScript 5 compatibility.

---

## 4. Porting Plan for Issue #56 (ccstatusline `v2.2.30`)

Baseline commit: `016be1fcf19453bd4362439b197e9cf841d7006a` (`v2.2.29`)  
Target commit: `05554cd087249167d570aed3c869915b6a18d4d2` (`v2.2.30`)

### 4.1 Commit Triage & Action Items

1. **`747b7f1` - `feat(widgets): give the remaining git and jj widgets symbol slots (#574)`**
   - **Category**: A (Direct Port)
   - **Target**: `src/widgets/git/*.ts`, `src/widgets/jj/*.ts`, `src/types/`.
   - **Action**: Add custom symbol slots to remaining git/jj widgets matching upstream options.

2. **`558c5bd` - `perf(terminal): reduce terminal width probing overhead (#501)`**
   - **Category**: A (Direct Port)
   - **Target**: `src/utils/terminal.ts`.
   - **Action**: Cache terminal width probing results to reduce repeated exec/ioctl overhead.

3. **`273d997` & `ef7f973` - `fix: add timeout to the cached git runner (#585, #559)`**
   - **Category**: A (Direct Port)
   - **Target**: `src/widgets/git/` or cached runner utilities.
   - **Action**: Enforce timeout bounds on git command execution to prevent hangs on huge repos.

4. **`f45823d` - `fix: default flex mode to full (#590)`**
   - **Category**: A (Direct Port)
   - **Target**: `src/utils/renderer.ts` / settings schemas.
   - **Action**: Update default flex mode to `full`.

5. **`06786da` - `Add llms.txt for LLM/agent-readable project summary (#527)`**
   - **Category**: A (Direct Port)
   - **Target**: `llms.txt`.
   - **Action**: Add project-level `llms.txt` summarizing cxstatusline for AI agents.

6. **`f370720` - `feat(usage): let the reset timers hide their no-data placeholders (#542)`**
   - **Category**: B (Adapt to Codex)
   - **Target**: `src/widgets/five-hour-reset-timer.ts` / reset timer widgets.
   - **Action**: Support hiding placeholder text when no reset time data is present using `hide` metadata.

7. **`1acae9a` - `refactor(usage): extract the usage-percent widgets onto a shared module (#545)`**
   - **Category**: B (Adapt to Codex)
   - **Target**: `src/widgets/` usage helpers.
   - **Action**: Extract shared usage-percent logic where applicable to Codex telemetry.

8. **`75175cd` - `feat(custom-command): cache output behind an opt-in TTL and honor the timeout (#539)`**
   - **Category**: Done (Already implemented in `src/widgets/CachedCommand.ts` and `test/widgets/cached-command.test.ts`).
   - **Action**: Verify parity against upstream implementation.

9. **`339691e` - `fix(usage): parse a model-scoped weekly limit at 0% with no resets_at as real zero usage (#534)`**
   - **Category**: B/C
   - **Action**: Inspect if relevant to Codex quota/usage parsing; adapt if applicable.

10. **`0551b06` & `282c5a3` - Claude keychain & OAuth token fingerprinting (`#573`, `#536`)**
    - **Category**: C (Skip)
    - **Reason**: Claude-specific authentication; not applicable to Codex CLI.

11. **`1c2f718` - `Add claudenews to Related Projects (#584)`**
    - **Category**: C (Skip)
    - **Reason**: Claude-specific project link.

12. **`2ae993d`, `d6c2a35`, `2a98563` - Dev dependency bumps (`#578`, `#579`, `#589`)**
    - **Category**: D (Tooling)
    - **Reason**: Keep cxstatusline's existing Bun/Node 22-tested dependencies.

13. **`05554cd` - `Version bump and docs update`**
    - **Category**: Metadata
    - **Action**: Update `scripts/upstream-ccstatusline.json` `baseCommit` to `05554cd087249167d570aed3c869915b6a18d4d2`.

---

## 5. Verification & Testing Strategy

1. **Unit Tests**:
   - Write/update tests in `test/widgets/` for all newly added or modified widget capabilities (e.g. git/jj symbols, reset timer placeholder hiding).
   - Verify 100% test passing: `bun test ./test ./src`.
2. **Type Checking**:
   - `bun run typecheck` (`tsc --noEmit`) to verify zero TypeScript errors.
3. **Build Verification**:
   - `bun run build` to verify clean bundle generation and dependency notice checks.
4. **Package Smoke Test**:
   - `bun run check:package` to verify npm package tarball integrity.
5. **Attribution Check**:
   - Verify `NOTICE` reflects all modified files derived from `ccstatusline`.

---

## 6. Delivery Artifacts

- `.agents/skills/port-cc-to-cx/SKILL.md`
- `.agents/skills/port-cc-to-cx/references/translation-guide.md`
- `.agents/skills/port-cc-to-cx/references/triage-matrix.md`
- `.agents/skills/port-cc-to-cx/scripts/fetch-diff.sh`
- `.agents/skills/port-cc-to-cx/scripts/triage.py`
- `.agents/skills/port-cc-to-cx/scripts/update-baseline.sh`
- `scripts/port-upstream.ts`
- Ported widget updates, terminal optimizations, reset timer options, and `llms.txt`
- Updated `NOTICE` and `scripts/upstream-ccstatusline.json`
- Pull Request closing [#56](https://github.com/adrijshikhar/cxstatusline/issues/56)
