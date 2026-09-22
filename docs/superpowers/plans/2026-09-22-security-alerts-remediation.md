# Security Alerts Remediation (Dependabot & Code Scanning) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remediate all 10 open Dependabot alerts (Astro vulnerabilities up to 7.2.8) and address all 10 open CodeQL Code Scanning alerts (Actions cache-poisoning alerts in `prebuilt.yml`).

**Architecture:** 
1. **Dependabot (Astro Upgrade & Dev Environment Hardening):**
   - Upgrade `astro` in `website/package.json` to `^7.3.3` to resolve all 10 vulnerabilities (including CVE-2026-41067 and critical AVIF RCE).
   - Create an ESM-compatible browser shim for `path` (e.g. `website/src/path-shim.ts`) so Vite's SSR and dev server in Astro 7 don't crash on CommonJS `path-browserify` (`module is not defined`).
   - Add `ASTRO_DEV_BACKGROUND: "0"` to `website/playwright.config.ts` so Playwright's `webServer` receives a synchronous foreground dev process instead of Astro 7's AI-agent background daemon.
   - Run end-to-end verifications (`tsc`, `bun test`, `bun run build`, and Playwright test suite).

2. **CodeQL Code Scanning (Actions Cache-Poisoning in `prebuilt.yml`):**
   - **Root Cause:** In `.github/workflows/prebuilt.yml`, `actions/checkout` checks out `ref: ${{ needs.detect.outputs.source_commit }}` on workflows triggered by `schedule` and `workflow_dispatch` (which run in the default branch scope with cache-write capabilities). CodeQL flags `actions/cache` as `actions/cache-poisoning/direct-cache` and all 9 subsequent `run:` steps as `actions/cache-poisoning/poisonable-step`.
   - **Remediation Strategy:** 
     - *Primary Code Fix:* Align with GitHub's security recommendation for release workflows ("Avoid using caching in workflows that handle sensitive operations like releases"). Removing `actions/cache` from `prebuilt.yml` removes the shared branch cache attack surface entirely, immediately resolving all 10 CodeQL alerts at the root.
     - *Alternative/Administrative Fix:* Dismiss the 10 alerts via GitHub API as **False Positive** matching the precedent set by repository owner for Alert #1 (`needs.detect.outputs.source_commit is resolved strictly from verified, owner-published stable releases of adrijshikhar/cxstatusline`).

**Tech Stack:** Astro 7, Vite 7/8, Bun, Playwright, GitHub Actions, CodeQL, GitHub API (`gh`).

---

## Global Constraints
- **Branch Protection & PR Policy:** Never push directly to `main`. Create branch `fix/security-remediations` off `main`.
- **Commit Format:** Conventional Commits (`fix(security): ...`, `fix(ci): ...`).
- **Test Integrity:** All root unit tests (`bun test ./test ./src`), website asset tests (`bun test website/test/gzip-assets.test.ts`), and browser tests (`bunx playwright test`) must pass cleanly.
- **Prebuilt Integrity:** Do not break the `detect -> validate -> native -> publish -> report` pipeline semantics in `.github/workflows/prebuilt.yml`.

---

### Task 1: Create ESM Path Shim and Upgrade Astro in Website

**Files:**
- Create: `website/src/path-shim.ts`
- Modify: `website/package.json`
- Modify: `website/astro.config.mjs`
- Modify: `website/playwright.config.ts`

**Interfaces:**
- Consumes: `path-browserify` package
- Produces: Clean ESM export for `path` shimming compatible with both Vite client bundling and Astro SSR runtime.

- [ ] **Step 1: Create `website/src/path-shim.ts`**

```typescript
import pathBrowserify from "path-browserify";

export const resolve = pathBrowserify.resolve;
export const normalize = pathBrowserify.normalize;
export const isAbsolute = pathBrowserify.isAbsolute;
export const join = pathBrowserify.join;
export const relative = pathBrowserify.relative;
export const dirname = pathBrowserify.dirname;
export const basename = pathBrowserify.basename;
export const extname = pathBrowserify.extname;
export const sep = pathBrowserify.sep;
export const delimiter = pathBrowserify.delimiter;
export const parse = pathBrowserify.parse;
export const format = pathBrowserify.format;
export const posix = pathBrowserify.posix;
export const win32 = pathBrowserify.win32;

export default pathBrowserify;
```

- [ ] **Step 2: Update `website/astro.config.mjs` alias to use `src/path-shim.ts`**

Replace:
```javascript
{ find: /^(node:)?path$/, replacement: local("./node_modules/path-browserify/index.js") },
```
With:
```javascript
{ find: /^(node:)?path$/, replacement: local("./src/path-shim.ts") },
```

- [ ] **Step 3: Update `website/playwright.config.ts` to disable background daemon**

Add `ASTRO_DEV_BACKGROUND: "0"` into `webServer.env`:
```typescript
webServer: {
  command: "bun run dev -- --host 127.0.0.1 --port 4173",
  url: "http://127.0.0.1:4173/",
  reuseExistingServer: false,
  timeout: 30_000,
  env: { VITE_ENABLE_AGENTATION: "0", ASTRO_DEV_BACKGROUND: "0" },
},
```

- [ ] **Step 4: Update `website/package.json` with `astro@^7.3.3` and install dependencies**

Update dependency:
`"astro": "^7.3.3"`

Run:
`cd website && bun install`

- [ ] **Step 5: Run website verification commands**

Run:
1. `cd website && bun run build` (Must build static routes without error)
2. `bun test website/test/gzip-assets.test.ts` (Must stay within gzip limits)
3. `cd website && bunx playwright test` (Must pass all 10/10 browser tests)

- [ ] **Step 6: Commit changes**

```bash
git add website/src/path-shim.ts website/astro.config.mjs website/playwright.config.ts website/package.json website/bun.lock
git commit -m "fix(security): bump astro to 7.3.3 and resolve dependabot vulnerabilities"
```

---

### Task 2: Remediate CodeQL Cache-Poisoning Alerts in `prebuilt.yml`

**Files:**
- Modify: `.github/workflows/prebuilt.yml:202-218`

**Interfaces:**
- Removes: `actions/cache@v4` step in `native` job of `.github/workflows/prebuilt.yml`.
- Effect: Eliminates the branch cache poison vector flagged by CodeQL rules `actions/cache-poisoning/direct-cache` (Alert #24) and `actions/cache-poisoning/poisonable-step` (Alerts #12, #16, #25, #26, #27, #28, #29, #30, #31).

- [ ] **Step 1: Remove `actions/cache` from `.github/workflows/prebuilt.yml`**

Remove lines 202–218:
```yaml
      # Cache the Cargo build output and registry across runs. Keyed on everything that would
      # invalidate it: OS/arch, the exact upstream tag, the toolchain upstream pins, the resolved
      # dependency graph and the applied patch. The upstream checkout itself is still reset and
      # re-cloned every run (see `resetDirectory` in scripts/prebuilt.ts) - only compiled artifacts
      # and downloaded crates are reused.
      - uses: actions/cache@0057852bfaa89a56745cba8c7296529d2fc39830 # v4.3.0
        if: ${{ runner.os != 'macOS' || !startsWith(matrix.platform, 'linux-') }}
        with:
          path: |
            upstream/codex-rs/target
            ~/.cargo/registry
            ~/.cargo/git
          key: >-
            ${{ runner.os }}-${{ runner.arch }}-${{ steps.build.outputs.upstream_tag }}-
            ${{ hashFiles('upstream/**/rust-toolchain.toml') }}-
            ${{ hashFiles('upstream/codex-rs/Cargo.lock') }}-
            ${{ steps.build.outputs.patch_sha256 }}
```

- [ ] **Step 2: Verify actionlint and prebuilt validation tests**

Run:
`bun test test/prebuilt.test.ts`
`bun test test/distribution.test.ts`

- [ ] **Step 3: Commit workflow hardening**

```bash
git add .github/workflows/prebuilt.yml
git commit -m "fix(ci): remove actions/cache in prebuilt pipeline to eliminate cache poisoning"
```

---

### Task 3: (Alternative/Administrative) Dismiss False-Positive CodeQL Alerts

If repository owner prefers to retain `actions/cache` in `prebuilt.yml`:

- [ ] **Step 1: Execute batch dismissal via `gh api`**

Dismiss alerts 12, 16, 24, 25, 26, 27, 28, 29, 30, 31 with:
```bash
for alert in 12 16 24 25 26 27 28 29 30 31; do
  gh api --method PATCH repos/adrijshikhar/cxstatusline/code-scanning/alerts/$alert \
    -f state=dismissed \
    -f dismissed_reason="false positive" \
    -f dismissed_comment="False positive: needs.detect.outputs.source_commit is resolved strictly from verified, owner-published stable releases of adrijshikhar/cxstatusline. Pull requests cannot trigger this workflow."
done
```

---

### Task 4: End-to-End Verification & Pull Request Creation

**Files:**
- Create PR from `fix/security-remediations` to `main`

- [ ] **Step 1: Run full test suite**

Run:
`bun test ./test ./src`
`tsc --noEmit`
`cd website && bun run build && bun test test/gzip-assets.test.ts && bunx playwright test`

- [ ] **Step 2: Push branch and create Pull Request**

Push:
`git push -u origin fix/security-remediations`

Open PR using `gh pr create`:
`gh pr create --title "fix(security): resolve dependabot vulnerabilities and harden prebuilt workflow" --body "..."`

- [ ] **Step 3: Verify GitHub Security Tab**
- Confirm Dependabot alerts show closed once merged.
- Confirm CodeQL code scanning shows 0 alerts on `main`.
