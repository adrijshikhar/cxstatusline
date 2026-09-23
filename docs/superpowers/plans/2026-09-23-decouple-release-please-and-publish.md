# Decouple Release Please and Publish Workflows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decouple release-please changelog/tag generation from release publication/distribution workflows across `cxstatusline` and the central `projects/templates/release` templates (Node and Go) to eliminate workflow concurrency deadlocks on `main`.

**Architecture:** Split the monolithic `.github/workflows/release.yml` into `.github/workflows/release-please.yml` (triggered on `push` to `main`, completing in ~15s without approvals) and `.github/workflows/publish.yml` (triggered strictly on `push: tags: ['v*.*.*']` and `workflow_dispatch`). Concurrency for publication is scoped to the tag ref (`publish-${{ github.ref }}`), guaranteeing that gated manual approvals (`environment: npm`, `environment: homebrew`, `environment: release`) never freeze `main`.

**Tech Stack:** GitHub Actions, Bun, Go, Google Release Please v5, GoReleaser v2, npm OIDC Trusted Publishing, Homebrew Tap.

**Spec:**
- [docs/prebuilt-ci.md](file:///Users/nemesis/Projects/my-projects/cxstatusline/docs/prebuilt-ci.md#L261-L278)
- [projects/templates/release/README.md](file:///Users/nemesis/Projects/my-projects/projects/templates/release/README.md)

## Global Constraints

- In `cxstatusline`: Never push directly to `main` — develop on `ci/decouple-release-workflows` and submit via Pull Request with Conventional Commits.
- In `projects`: Modify templates and documentation cleanly and maintain consistent formatting.
- All existing release assets, provenance statements, signing/attestation, and smoke tests must remain strictly preserved.
- Local tests (`bun test ./test ./src`) and typechecks (`bun run typecheck`) must pass with 0 errors.

---

### Task 1: Create Dedicated `release-please.yml` in `cxstatusline`

**Files:**
- Create: `.github/workflows/release-please.yml`

**Interfaces:**
- Consumes: `secrets.RELEASE_PLEASE_TOKEN`, `release-please-config.json`, `.release-please-manifest.json`
- Produces: GitHub Release PR updates on merge to `main`, and pushes Git tag `v*.*.*` via `RELEASE_PLEASE_TOKEN` when release PR is merged.

- [ ] **Step 1: Write `.github/workflows/release-please.yml`**

Create `.github/workflows/release-please.yml`:

```yaml
name: Release Please

on:
  push:
    branches:
      - main
  workflow_dispatch:

permissions:
  contents: write
  pull-requests: write

concurrency:
  group: release-please-${{ github.ref }}
  cancel-in-progress: false

jobs:
  release-please:
    name: Release Please (PR & Tag)
    runs-on: ubuntu-latest
    if: github.repository == 'adrijshikhar/cxstatusline'
    steps:
      - uses: googleapis/release-please-action@v5.0.0
        id: release
        with:
          token: ${{ secrets.RELEASE_PLEASE_TOKEN }}
          config-file: release-please-config.json
          manifest-file: .release-please-manifest.json
```

- [ ] **Step 2: Validate YAML syntax of `release-please.yml`**

Run:
```bash
bun -e 'import { parse } from "yaml"; import { readFileSync } from "node:fs"; parse(readFileSync(".github/workflows/release-please.yml", "utf8")); console.log("YAML syntax valid");'
```
Expected: `YAML syntax valid`

---

### Task 2: Create Dedicated `publish.yml` and Remove `release.yml` in `cxstatusline`

**Files:**
- Create: `.github/workflows/publish.yml`
- Delete: `.github/workflows/release.yml`

**Interfaces:**
- Consumes: Git tag `v*.*.*` event (`github.ref`), `environment: npm`
- Produces: Built npm tarball, `SHA256SUMS`, GitHub Release asset upload, and npm publication.

- [ ] **Step 1: Write `.github/workflows/publish.yml`**

Create `.github/workflows/publish.yml`:

```yaml
name: Publish Release & npm

on:
  push:
    tags:
      - "v*.*.*"
  workflow_dispatch:
    inputs:
      tag:
        description: 'Optional tag to publish if triggering manually (e.g. v0.7.1)'
        required: false

permissions:
  contents: write
  pull-requests: write

concurrency:
  group: publish-${{ github.ref }}
  cancel-in-progress: false

jobs:
  build-and-verify:
    name: Build & Verify Release
    runs-on: macos-15
    if: github.repository == 'adrijshikhar/cxstatusline'
    outputs:
      tag_name: ${{ steps.tag.outputs.tag }}
    steps:
      - name: Determine Target Git Ref
        id: target
        run: |
          if [ -n "${{ github.event.inputs.tag }}" ]; then
            echo "ref=${{ github.event.inputs.tag }}" >> "$GITHUB_OUTPUT"
          else
            echo "ref=${{ github.ref_name }}" >> "$GITHUB_OUTPUT"
          fi

      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          ref: ${{ steps.target.outputs.ref }}
          fetch-depth: 0

      - uses: oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2
        with:
          bun-version: "1.4.0"

      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with:
          node-version: "22"

      - name: Resolve Release Tag
        id: tag
        run: |
          if [ -n "${{ github.event.inputs.tag }}" ]; then
            echo "tag=${{ github.event.inputs.tag }}" >> "$GITHUB_OUTPUT"
          else
            echo "tag=v$(node -p 'require("./package.json").version')" >> "$GITHUB_OUTPUT"
          fi

      - run: bun install --frozen-lockfile
      - run: bun run typecheck && bun test ./test ./src
      - run: CXSTATUSLINE_RELEASE_BUILD=1 bun run build
      - run: bun run check:package
      - run: npm pack --ignore-scripts --pack-destination "$RUNNER_TEMP"
      - run: cd "$RUNNER_TEMP" && shasum -a 256 cxstatusline-*.tgz > SHA256SUMS

      - name: Save Release Tarball
        uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1
        with:
          name: release-tarball
          path: |
            ${{ runner.temp }}/cxstatusline-*.tgz
            ${{ runner.temp }}/SHA256SUMS
          if-no-files-found: error

  publish-npm:
    name: Publish to npm
    runs-on: ubuntu-latest
    needs: build-and-verify
    environment: npm
    permissions:
      contents: write
      id-token: write
    steps:
      - name: Download Release Tarball
        uses: actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c # v8.0.1
        with:
          name: release-tarball
          path: release-tarball

      - name: Resolve Tarball Path
        id: tarball
        run: |
          TARBALL=$(ls -d "$PWD"/release-tarball/cxstatusline-*.tgz)
          echo "path=$TARBALL" >> "$GITHUB_OUTPUT"

      - name: Attach tarball to GitHub Release
        env:
          GH_TOKEN: ${{ github.token }}
          REPO: ${{ github.repository }}
          TAG: ${{ needs.build-and-verify.outputs.tag_name }}
        run: |
          gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1 || gh release create "$TAG" --repo "$REPO" --title "cxstatusline $TAG" --notes "Source release; the packed CLI and its checksum are attached." --verify-tag
          gh release upload "$TAG" --repo "$REPO" "${{ steps.tarball.outputs.path }}" release-tarball/SHA256SUMS --clobber

      - name: Upgrade npm for native OIDC Trusted Publishing
        run: npm install -g npm@latest

      - name: Publish to npm (OIDC Trusted Publishing)
        run: npm publish "${{ steps.tarball.outputs.path }}" --provenance --access public
```

- [ ] **Step 2: Delete redundant `.github/workflows/release.yml`**

Run:
```bash
rm .github/workflows/release.yml
```

- [ ] **Step 3: Validate YAML syntax of `publish.yml`**

Run:
```bash
bun -e 'import { parse } from "yaml"; import { readFileSync } from "node:fs"; parse(readFileSync(".github/workflows/publish.yml", "utf8")); console.log("YAML syntax valid");'
```
Expected: `YAML syntax valid`

---

### Task 3: Update `cxstatusline` Documentation and Verify Local Build

**Files:**
- Modify: `docs/prebuilt-ci.md:261-278`

- [ ] **Step 1: Update `docs/prebuilt-ci.md`**

Replace unified `release.yml` documentation with decoupled `release-please.yml` and `publish.yml`.

- [ ] **Step 2: Run verification**

Run:
```bash
bun run typecheck && bun test ./test ./src && bun run check:package
```
Expected: 0 type errors, all tests pass, package check clean.

- [ ] **Step 3: Commit and open Pull Request for `cxstatusline`**

```bash
git checkout -b ci/decouple-release-workflows
git add .github/workflows/release-please.yml .github/workflows/publish.yml docs/prebuilt-ci.md
git rm .github/workflows/release.yml
git commit -m "ci: decouple release-please and npm publish workflows"
git push -u origin ci/decouple-release-workflows
gh pr create --title "ci: decouple release-please and npm publish workflows" --body "..."
```

---

### Task 4: Update Node Template in `projects/templates/release/node`

**Files:**
- Create: `/Users/nemesis/Projects/my-projects/projects/templates/release/node/workflows/release-please.yml`
- Create: `/Users/nemesis/Projects/my-projects/projects/templates/release/node/workflows/publish.yml`
- Delete: `/Users/nemesis/Projects/my-projects/projects/templates/release/node/workflows/release.yml`
- Modify: `/Users/nemesis/Projects/my-projects/projects/templates/release/node/README.md`

- [ ] **Step 1: Create `release-please.yml` template**

Create `/Users/nemesis/Projects/my-projects/projects/templates/release/node/workflows/release-please.yml` matching the standalone release-please pattern with `<OWNER>/<REPO>` placeholder.

- [ ] **Step 2: Create `publish.yml` template**

Create `/Users/nemesis/Projects/my-projects/projects/templates/release/node/workflows/publish.yml` listening on `push.tags: ["v*.*.*"]` with `concurrency: group: publish-${{ github.ref }}` and `environment: npm`.

- [ ] **Step 3: Remove old `release.yml` template**

```bash
rm /Users/nemesis/Projects/my-projects/projects/templates/release/node/workflows/release.yml
```

- [ ] **Step 4: Update `projects/templates/release/node/README.md`**

Update installation instructions to copy both `release-please.yml` and `publish.yml`.

---

### Task 5: Update Go Template in `projects/templates/release/go`

**Files:**
- Create: `/Users/nemesis/Projects/my-projects/projects/templates/release/go/workflows/release-please.yml`
- Create: `/Users/nemesis/Projects/my-projects/projects/templates/release/go/workflows/publish.yml`
- Delete: `/Users/nemesis/Projects/my-projects/projects/templates/release/go/workflows/release.yml`
- Modify: `/Users/nemesis/Projects/my-projects/projects/templates/release/go/README.md`

- [ ] **Step 1: Create `release-please.yml` template**

Create `/Users/nemesis/Projects/my-projects/projects/templates/release/go/workflows/release-please.yml` triggering only on `push.branches: [main]` to track release PR and tag creation.

- [ ] **Step 2: Create `publish.yml` template**

Create `/Users/nemesis/Projects/my-projects/projects/templates/release/go/workflows/publish.yml`:
- Trigger: `push.tags: ["v*.*.*"]` and `workflow_dispatch`.
- Concurrency: `publish-${{ github.ref }}`.
- Jobs: `test-and-verify`, `goreleaser`, `verify-asset`, `publish-homebrew` (gated by `environment: homebrew`).

- [ ] **Step 3: Remove old `release.yml` template**

```bash
rm /Users/nemesis/Projects/my-projects/projects/templates/release/go/workflows/release.yml
```

- [ ] **Step 4: Update `projects/templates/release/go/README.md`**

Update setup instructions to copy both `release-please.yml` and `publish.yml`.

---

### Task 6: Update Central Template Documentation in `projects/templates/release/README.md`

**Files:**
- Modify: `/Users/nemesis/Projects/my-projects/projects/templates/release/README.md`

- [ ] **Step 1: Update Architecture Diagram and Explanations**

Update the mermaid diagram and "Architecture Overview" to show the decoupled 2-workflow model:
- `Workflow 1: release-please.yml` (on push to `main`): Updates PR and creates `vX.Y.Z` tag via token.
- `Workflow 2: publish.yml` (on push of `vX.Y.Z` tag): Pre-release test gate -> build -> verify -> gated maintainer approval.
Add explanation of the Concurrency Lock Gotcha and why workflow separation is required.

- [ ] **Step 2: Validate all template YAMLs and commit `projects` repository**

Run YAML validation on all created templates:
```bash
bun -e '
import { parse } from "yaml";
import { readFileSync } from "node:fs";
for (const p of [
  "/Users/nemesis/Projects/my-projects/projects/templates/release/node/workflows/release-please.yml",
  "/Users/nemesis/Projects/my-projects/projects/templates/release/node/workflows/publish.yml",
  "/Users/nemesis/Projects/my-projects/projects/templates/release/go/workflows/release-please.yml",
  "/Users/nemesis/Projects/my-projects/projects/templates/release/go/workflows/publish.yml",
]) {
  parse(readFileSync(p, "utf8"));
  console.log("Valid:", p);
}
'
```
Commit changes in `projects`:
```bash
git -C /Users/nemesis/Projects/my-projects/projects add templates/
git -C /Users/nemesis/Projects/my-projects/projects commit -m "feat(templates): decouple release-please and publish workflows to avoid concurrency deadlock"
```
