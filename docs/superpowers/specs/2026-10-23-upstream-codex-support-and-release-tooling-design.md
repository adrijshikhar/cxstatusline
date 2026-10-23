# Upstream Codex Version Support and Prebuilt Release Tooling Design

Status: Approved by user on 2026-10-23.

## Purpose

Provide robust, reproducible automation and agent skills for managing upstream OpenAI Codex version releases and prebuilt binary artifacts for `cxstatusline`.

This design establishes:
1. **`scripts/codex_port.py`**: A native Python CLI tool that automates upstream release discovery, version policy enforcement, patch dry-runs, clean patch extraction, manifest updates, test fixture synchronization, and verification.
2. **`scripts/codex_prebuilt.py`**: A native Python CLI tool that enforces the Mandatory Build Machine Policy ([AGENTS.md](file:///Users/nemesis/Projects/my-projects/cxstatusline/AGENTS.md)), checks self-hosted M5 Pro runner health, validates workflow dispatch ref guardrails, and verifies published release assets.
3. **Agent Skills & References**: Two modular agent skills in `.agents/skills/`:
   - `support-codex-version`: Guides agents and developers through version triage, patch adaptation, conflict resolution, and PR creation.
   - `release-codex-prebuilt`: Guides agents and developers through M5 Pro prebuilt builds, Docker constraints, and release publication verification.
4. **Immediate Application**: Executes the complete workflow to ship support for OpenAI Codex `0.164.0` (`rust-v0.164.0`).

---

## Accepted Decisions

- **Python Standard Library Only**: All Python scripts use Python 3.10+ standard library (`argparse`, `json`, `subprocess`, `urllib.request`, `re`, `pathlib`, `sys`). No virtual environment or external pip dependencies are required to run them.
- **Repository Location & Symlinks**: Primary scripts live in `scripts/` (`scripts/codex_port.py` and `scripts/codex_prebuilt.py`) with symlinks placed in the respective `.agents/skills/*/scripts/` folders.
- **Strict Mandatory Build Machine Policy**: All Codex/Rust prebuilt compilation must run on the owner's M5 Pro at `192.168.1.65` using runner labels `[self-hosted, macOS, ARM64, m5-pro]`. Local laptops and GitHub-hosted runners are strictly forbidden for Codex/Rust builds.
- **Codex Version Support Policy**:
  - Baseline `.0` release of every Codex minor series is supported (e.g. `0.161.0`, `0.162.0`, `0.163.0`, `0.164.0`).
  - Active series (`0.164.x`): all stable releases and patch releases are supported.
  - Intermediate patch releases in older minor series are skipped.
- **Conflict Handling**: Clean patches are generated automatically with exact hunk offsets; conflicted patches produce an actionable diagnostic report and leave an isolated `/tmp/` worktree staged for resolution.

---

## Component Architecture

```
cxstatusline/
├── scripts/
│   ├── codex_port.py                      # Upstream auditing, patching, and local test verification
│   └── codex_prebuilt.py                  # M5 runner health, prebuilt dispatch, and release verification
└── .agents/
    └── skills/
        ├── support-codex-version/
        │   ├── SKILL.md                   # Skill instructions for version support
        │   ├── scripts/
        │   │   └── codex_port.py -> ../../../../scripts/codex_port.py
        │   └── references/
        │       ├── patch-architecture.md  # Detailed reference for codex-rs/tui patched surfaces
        │       └── conflict-resolution.md # Troubleshooting guide for upstream TUI refactors
        └── release-codex-prebuilt/
            ├── SKILL.md                   # Skill instructions for prebuilt releases
            ├── scripts/
            │   └── codex_prebuilt.py -> ../../../../scripts/codex_prebuilt.py
            └── references/
                └── m5-runner-policy.md    # Documentation of M5 Pro runner & Docker constraints
```

---

## Detailed Specifications

### 1. `scripts/codex_port.py`

#### Commands & Interfaces
```bash
# Check upstream releases against version coverage policy
python3 scripts/codex_port.py check [--repo openai/codex] [--json]

# Prepare & test patch for a specific version
python3 scripts/codex_port.py patch <version> [--source-patch <path>] [--worktree <dir>]

# Run full local verification suite for that version
python3 scripts/codex_port.py verify <version>
```

#### Detailed Behaviors

1. **`check`**:
   - Fetches upstream releases using `gh api repos/openai/codex/releases` or fallback to `urllib.request` against GitHub REST API with optional `GH_TOKEN` / `GITHUB_TOKEN`.
   - Filters tags to non-draft, non-prerelease tags matching `rust-v<X.Y.Z>`.
   - Categorizes releases:
     - Baseline `.0` releases above support floor (`0.152.1`).
     - Active series releases (the newest minor series).
     - Skipped intermediate releases in older minor series.
   - Cross-references with `patches/manifest.json`.
   - Outputs a structured coverage report highlighting open gaps.

2. **`patch <version>`**:
   - Clones or updates upstream repository tag `rust-v<version>` shallowly into `/tmp/codex-<version>`.
   - Locates the highest existing patch prior to `<version>` (e.g. `patches/codex-0.163.0.patch`).
   - Runs `git apply --check` against the upstream worktree.
   - **On clean apply**:
     - Runs `git apply --index`.
     - Generates `patches/codex-<version>.patch` via `git diff --cached` (retaining exact commit hashes and hunk offsets).
     - Updates `patches/manifest.json`:
       - Sets `"candidate": "<version>"`.
       - Appends entry `{ "min": "<version>", "max": "<version>", "file": "codex-<version>.patch", "patchVersion": 2 }`.
     - Updates `test/manifest.test.ts`:
       - Sets `expect(shipped.candidate).toBe("<version>")`.
       - Sets `resolvePatch` expectation to `"codex-<version>.patch"`.
     - Updates `test/package.test.ts`:
       - Appends `"patches/codex-<version>.patch"` to `PACKAGE_FILES` array.
     - Prints success summary with git status.
   - **On conflict**:
     - Identifies failed files and hunks.
     - Queries git log of upstream between previous tag and target tag for commits touching `codex-rs/tui`.
     - Leaves `/tmp/codex-<version>` in a readable state with reject files.
     - Emits actionable diagnostics pointing to `references/conflict-resolution.md`.

3. **`verify <version>`**:
   - Validates `git apply --check` of `patches/codex-<version>.patch` against upstream tag.
   - Runs `bun test ./test ./src`.
   - Runs `bun run typecheck`.
   - Runs `bun run build`.
   - Runs `bun run check:package`.
   - Runs `bun scripts/prebuilt.ts detect` to ensure the candidate is resolved and `should_build=true`.

---

### 2. `scripts/codex_prebuilt.py`

#### Commands & Interfaces
```bash
# Verify M5 Pro self-hosted runner availability
python3 scripts/codex_prebuilt.py check-runner [--repo adrijshikhar/cxstatusline]

# Dispatch prebuilt release workflow on M5 Pro
python3 scripts/codex_prebuilt.py dispatch --version <version> [--ref <branch-or-tag>] [--publish] [--platforms P]

# Watch running prebuilt workflow execution
python3 scripts/codex_prebuilt.py watch [--run-id <id>]

# Verify published prebuilt release assets and checksums
python3 scripts/codex_prebuilt.py verify-release <version> [--repo adrijshikhar/cxstatusline]
```

#### Detailed Behaviors

1. **`check-runner`**:
   - Queries GitHub Actions runners via `gh api repos/adrijshikhar/cxstatusline/actions/runners`.
   - Looks up the runner with labels `[self-hosted, macOS, ARM64, m5-pro]`.
   - Confirms `status == "online"` and reports active status.
   - Exits with non-zero exit code if runner is offline or absent, preventing accidental dispatches.

2. **`dispatch`**:
   - Validates semantic version syntax.
   - Inspects `.github/workflows/prebuilt.yml` at the specified git ref to ensure runner labels are strictly `[self-hosted, macOS, ARM64, m5-pro]`.
   - Verifies the M5 runner is online via `check-runner`.
   - Dispatches `.github/workflows/prebuilt.yml` using `gh workflow run`.
   - Displays the URL for the queued workflow run.

3. **`watch`**:
   - Polls the active workflow run via `gh run view`.
   - Displays real-time job and step progression (`detect`, `native`, `merge`, `publish`).
   - Reports final conclusion and links to logs.

4. **`verify-release <version>`**:
   - Checks release `codex-v<version>` on GitHub.
   - Confirms all 4 assets exist:
     - `codex-v<version>-darwin-arm64.tar.gz`
     - `codex-v<version>-linux-arm64.tar.gz`
     - `manifest.json`
     - `SHA256SUMS`
   - Downloads `SHA256SUMS` and validates sha256 digests against published archives.

---

### 3. Agent Skills & References

#### `.agents/skills/support-codex-version/`
- **`SKILL.md`**: Step-by-step playbook for version support using `codex_port.py`, branch naming (`feat/support-codex-<version>`), PR conventions, and local verification.
- **`references/patch-architecture.md`**: Maps all patched Rust files in `codex-rs/tui`:
  - `chatwidget.rs`: `cxstatusline_pre_draw_tick()` hook insertion in `render()`.
  - `bottom_pane/chat_composer.rs`: Footer layout dimensions and reservations.
  - `bottom_pane/footer.rs`: 3-row footer drawing and shortcut overlay preservation.
  - `app/background_requests.rs`, `app/event_dispatch.rs`: Rate limit request bypass and timeout handling.
  - `bottom_pane/snapshots/`: UI snapshots for 3 visible statusline rows.
- **`references/conflict-resolution.md`**: Diagnosis guide for upstream TUI changes (hunk offsets, hook movement, snapshot updates).

#### `.agents/skills/release-codex-prebuilt/`
- **`SKILL.md`**: Playbook for executing and monitoring prebuilt releases on M5 Pro runner.
- **`references/m5-runner-policy.md`**:
  - Strict host policy (`192.168.1.65`, `[self-hosted, macOS, ARM64, m5-pro]`).
  - Compiler job concurrency: 3 native macOS jobs, 4 Docker jobs (staying within Docker Desktop 20GB memory limit).
  - PTY smoke test harness description (`scripts/test-footer-smoke.py`).

---

## Execution Plan for Codex `0.164.0`

1. Scaffold scripts:
   - Create `scripts/codex_port.py`
   - Create `scripts/codex_prebuilt.py`
   - Make executable (`chmod +x`)
2. Scaffold skills and symlinks:
   - Create `.agents/skills/support-codex-version/` with `SKILL.md`, references, and symlink.
   - Create `.agents/skills/release-codex-prebuilt/` with `SKILL.md`, references, and symlink.
3. Validate scripts:
   - Run `python3 scripts/codex_port.py check` to confirm `0.164.0` is identified as open coverage gap.
   - Test symlink execution.
4. Execute Codex `0.164.0` support:
   - Run `python3 scripts/codex_port.py patch 0.164.0`
   - Run `python3 scripts/codex_port.py verify 0.164.0`
5. Submit PR:
   - Verify all local checks pass.
   - Open Pull Request titled `feat: support Codex 0.164.0`.
