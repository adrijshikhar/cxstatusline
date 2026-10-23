# M5 Pro Runner Policy and Environment Reference

This reference details the infrastructure requirements and tuning parameters for building prebuilt OpenAI Codex releases.

---

## Machine Identity & Labels

* **Host**: Owner's Apple Silicon M5 Pro at `192.168.1.65`.
* **Runner Labels**: `[self-hosted, macOS, ARM64, m5-pro]`.
* **Architecture**: `aarch64-apple-darwin` (native) and `aarch64-unknown-linux-gnu` (Docker container).
* **Hard Rule**: Never use GitHub-hosted runners (`macos-latest`, `ubuntu-latest`) or the developer's laptop for Codex/Rust builds.

---

## Compiler Concurrency & Memory Settings

The build script and GitHub workflow use tuned compiler concurrency settings:
1. **macOS Native Build**:
   - `CARGO_BUILD_JOBS=3`
   - Runs directly on macOS with native V8 static library links.
2. **Linux Docker Build**:
   - `CARGO_BUILD_JOBS=4`
   - Tuned specifically from 8 to 4 jobs to stay strictly within Docker Desktop's 20GB memory limit.
   - Do NOT increase or tune these limits without explicit owner instruction.

---

## Sequential Execution

Platform builds run **sequentially** on the M5 Pro runner (macOS first, then Linux inside Docker). This avoids resource contention and preserves thermal headroom on the host.

---

## Verification & Smoke Gate

Every prebuilt build exercises:
1. `cargo test -p codex-tui --lib cxstatusline` (12 focused Rust layout tests).
2. `scripts/test-footer-smoke.py`:
   - Runs the built Codex binary in a PTY with fake credentials and loopback API.
   - Verifies 3-row footer rendering, typing, cursor positioning, and window resize using `pyte` and `wcwidth`.
