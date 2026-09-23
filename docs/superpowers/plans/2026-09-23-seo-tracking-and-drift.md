# SEO Tracking, Verification, and Drift Monitoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish search engine ownership verification (Google & Bing), privacy-preserving telemetry (Cloudflare Web Analytics), and an automated SEO drift monitoring baseline (`claude-seo seo-drift`) with full test coverage and documentation.

**Architecture:** Extend `<SEO />` and `BaseLayout.astro` with conditional meta tags for search console ownership and a deferred Cloudflare beacon; implement a TypeScript CLI helper `scripts/seo-drift.ts` wrapping `claude-seo` drift scripts to capture and compare baselines in CI/pre-commit; and author `docs/seo-monitoring.md` documenting verification and ROI calculation formulas.

**Tech Stack:** Astro 7.3, TypeScript, Bun, `claude-seo` runtime (Python 3.14 + SQLite), Playwright.

**Spec:** [`/Users/nemesis/Projects/my-projects/projects/cxstatusline/specs/2026-09-23-seo-tracking-and-drift-spec.md`](file:///Users/nemesis/Projects/my-projects/projects/cxstatusline/specs/2026-09-23-seo-tracking-and-drift-spec.md)

## Global Constraints

- **Never push directly to `main`**: All work committed to `feat/seo-tracking-and-drift` and merged via PR.
- **Zero Empty Tags**: Search console verification tags and analytics beacons MUST NOT render when tokens are empty or undefined.
- **Strict Hydration & Performance**: The analytics beacon MUST load with `defer` and have zero blocking impact on terminal playground hydration.
- **Baseline Portability**: Drift monitoring commands MUST support local preview server URLs (`http://127.0.0.1:4321`) without requiring public DNS.
- **Test Integrity**: All existing tests (816 root tests, Playwright E2E suite, website unit tests) must pass with zero regressions.

---

### Task 1: Add Search Engine Site Verification Support to `<SEO />` and `BaseLayout.astro`

**Files:**
- Modify: `website/src/components/SEO.astro`
- Modify: `website/src/layouts/BaseLayout.astro`
- Test: `website/test/seo-artifacts.test.ts`

**Interfaces:**
- Consumes: `googleSiteVerification?: string`, `bingSiteVerification?: string` (or `process.env.PUBLIC_GOOGLE_SITE_VERIFICATION`, `process.env.PUBLIC_BING_SITE_VERIFICATION`)
- Produces: `<meta name="google-site-verification" content="...">`, `<meta name="msvalidate.01" content="...">` when values exist.

- [ ] **Step 1: Write test asserting search verification meta tags in `website/test/seo-artifacts.test.ts`**

Add test checking conditional verification tag behavior:
```typescript
test("SEO component conditionally renders search console verification tags", () => {
  const indexPath = join(distDir, "index.html");
  const html = readFileSync(indexPath, "utf-8");
  // Default build without env vars should omit empty verification tags
  expect(html).not.toContain('name="google-site-verification" content=""');
  expect(html).not.toContain('name="msvalidate.01" content=""');
});
```

- [ ] **Step 2: Update `website/src/components/SEO.astro`**

Add verification props and environment variable fallbacks:
```astro
---
interface Props {
  title?: string;
  description?: string;
  image?: string;
  canonical?: string;
  noindex?: boolean;
  googleSiteVerification?: string;
  bingSiteVerification?: string;
}

const {
  title = "cxstatusline | Customizable Statusline & Widgets for OpenAI Codex CLI",
  description = "Customizable statusline for OpenAI Codex CLI — 34 widgets, themes, powerline glyphs, and token trackers in your terminal footer. macOS & Linux.",
  image = "/og-image.png",
  canonical,
  noindex = false,
  googleSiteVerification = process.env.PUBLIC_GOOGLE_SITE_VERIFICATION,
  bingSiteVerification = process.env.PUBLIC_BING_SITE_VERIFICATION,
} = Astro.props;
...
---
...
{googleSiteVerification && <meta name="google-site-verification" content={googleSiteVerification} />}
{bingSiteVerification && <meta name="msvalidate.01" content={bingSiteVerification} />}
```

- [ ] **Step 3: Update `website/src/layouts/BaseLayout.astro`**

Pass verification props through to `<SEO />`:
```astro
---
interface Props {
  title?: string;
  description?: string;
  image?: string;
  canonical?: string;
  noindex?: boolean;
  googleSiteVerification?: string;
  bingSiteVerification?: string;
}

const { title, description, image, canonical, noindex, googleSiteVerification, bingSiteVerification } = Astro.props;
---
<head>
  <SEO
    title={title}
    description={description}
    image={image}
    canonical={canonical}
    noindex={noindex}
    googleSiteVerification={googleSiteVerification}
    bingSiteVerification={bingSiteVerification}
  />
...
```

- [ ] **Step 4: Run tests and verify build**

```bash
bun run test:website
```

- [ ] **Step 5: Commit Task 1**

```bash
git add website/src/components/SEO.astro website/src/layouts/BaseLayout.astro website/test/seo-artifacts.test.ts
git commit -m "feat(website): add Google and Bing search console verification support"
```

---

### Task 2: Add Cloudflare Web Analytics Beacon to `BaseLayout.astro`

**Files:**
- Modify: `website/src/layouts/BaseLayout.astro`
- Test: `website/test/seo-artifacts.test.ts`

**Interfaces:**
- Consumes: `cfBeaconToken?: string` (or `process.env.PUBLIC_CF_BEACON_TOKEN`)
- Produces: `<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token": "..."}'></script>` before `</body>`

- [ ] **Step 1: Write test in `website/test/seo-artifacts.test.ts`**

Add assertion verifying absence of placeholder beacon when token is not configured:
```typescript
test("Cloudflare beacon is omitted when token is unset", () => {
  const indexPath = join(distDir, "index.html");
  const html = readFileSync(indexPath, "utf-8");
  expect(html).not.toContain("static.cloudflareinsights.com/beacon.min.js");
});
```

- [ ] **Step 2: Update `website/src/layouts/BaseLayout.astro`**

Add `cfBeaconToken` prop with environment variable fallback:
```astro
---
interface Props {
  ...
  cfBeaconToken?: string;
}

const {
  ...
  cfBeaconToken = process.env.PUBLIC_CF_BEACON_TOKEN,
} = Astro.props;
---
...
    {cfBeaconToken && (
      <script
        is:inline
        defer
        src="https://static.cloudflareinsights.com/beacon.min.js"
        data-cf-beacon={JSON.stringify({ token: cfBeaconToken })}
      />
    )}
  </body>
</html>
```

- [ ] **Step 3: Run website tests**

```bash
bun run test:website
```

- [ ] **Step 4: Commit Task 2**

```bash
git add website/src/layouts/BaseLayout.astro website/test/seo-artifacts.test.ts
git commit -m "feat(website): add Cloudflare Web Analytics beacon integration"
```

---

### Task 3: Build Automated SEO Drift CLI Helper (`scripts/seo-drift.ts`)

**Files:**
- Create: `scripts/seo-drift.ts`
- Modify: `package.json`
- Test: `test/seo-drift.test.ts`

**Interfaces:**
- Consumes: `claude-seo` runtime at `~/.aim/profiles/bot/.agents/skills/seo/scripts/claude-seo`
- Produces: CLI commands `bun run seo:drift:baseline` and `bun run seo:drift:compare`

- [ ] **Step 1: Create test `test/seo-drift.test.ts`**

Write test verifying CLI argument parsing and baseline invocation:
```typescript
import { test, expect, describe } from "bun:test";
import { spawnSync } from "node:child_process";

describe("SEO Drift Helper CLI", () => {
  test("--help prints usage instructions", () => {
    const proc = spawnSync("bun", ["run", "scripts/seo-drift.ts", "--help"], { encoding: "utf-8" });
    expect(proc.status).toBe(0);
    expect(proc.stdout).toContain("Usage: seo-drift <baseline|compare>");
  });
});
```

- [ ] **Step 2: Implement `scripts/seo-drift.ts`**

Create the CLI script:
```typescript
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const claudeSeoPath = join(
  homedir(),
  ".aim/profiles/bot/.agents/skills/seo/scripts/claude-seo"
);

function runDrift(command: "baseline" | "compare", url: string = "http://127.0.0.1:4321") {
  if (!existsSync(claudeSeoPath)) {
    console.error(`Claude SEO runner not found at: ${claudeSeoPath}`);
    process.exit(1);
  }

  const script = command === "baseline" ? "drift_baseline.py" : "drift_compare.py";
  const args = ["run", script, "--skip-cwv", url];

  console.log(`Running: ${claudeSeoPath} ${args.join(" ")}`);
  const res = spawnSync(claudeSeoPath, args, { stdio: "inherit" });
  process.exit(res.status ?? 0);
}

const action = process.argv[2];
const targetUrl = process.argv[3] || "http://127.0.0.1:4321";

if (action === "baseline" || action === "compare") {
  runDrift(action, targetUrl);
} else {
  console.log("Usage: seo-drift <baseline|compare> [url]");
  process.exit(action === "--help" || action === "-h" ? 0 : 1);
}
```

- [ ] **Step 3: Update `package.json`**

Add scripts:
```json
    "seo:drift:baseline": "bun run scripts/seo-drift.ts baseline",
    "seo:drift:compare": "bun run scripts/seo-drift.ts compare",
```

- [ ] **Step 4: Run unit tests**

```bash
bun test test/seo-drift.test.ts
```

- [ ] **Step 5: Commit Task 3**

```bash
git add scripts/seo-drift.ts package.json test/seo-drift.test.ts
git commit -m "feat(seo): add automated SEO drift monitoring CLI helper"
```

---

### Task 4: Add SEO & GEO Measurement and Verification Guide (`docs/seo-monitoring.md`)

**Files:**
- Create: `docs/seo-monitoring.md`

- [ ] **Step 1: Write `docs/seo-monitoring.md`**

Document:
1. Google Search Console setup (ownership verification via `PUBLIC_GOOGLE_SITE_VERIFICATION` + sitemap submission).
2. Cloudflare Web Analytics configuration (`PUBLIC_CF_BEACON_TOKEN`).
3. Running SEO Drift detection locally and in CI.
4. Exact metric calculation formulas (Organic CTR, AI Citation Share, Referral Conversions).

- [ ] **Step 2: Commit Task 4**

```bash
git add docs/seo-monitoring.md
git commit -m "docs: add SEO tracking, verification, and drift monitoring guide"
```

---

### Task 5: End-to-End Regression & Verification

**Files:**
- Run all test suites
- Capture initial drift baseline

- [ ] **Step 1: Run full test suites**

```bash
bun test ./test ./src
bun run test:website
bun run test:website:e2e
bun run typecheck
cd website && bunx tsc --noEmit
```

- [ ] **Step 2: Verify package smoke check**

```bash
bun run check:package
```

- [ ] **Step 3: Open Pull Request on GitHub**

```bash
git push -u origin feat/seo-tracking-and-drift
gh pr create --title "feat(website): add search console verification, Cloudflare analytics, and SEO drift monitoring" --body "..."
```
