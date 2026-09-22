# Website SEO & GEO Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish complete search engine discoverability, Open Graph social cards, dynamic sitemaps and robots directives, Schema.org JSON-LD structured data, and Generative Engine Optimization (GEO) for the cxstatusline Astro website, verified with the `claude-seo` runtime and Playwright E2E tests.

**Architecture:** Integrate official `@astrojs/sitemap` with dynamic `robots.txt.ts` using Astro's static site endpoint pattern; create a centralized `<SEO />` Astro component rendering validated metadata, absolute Open Graph/Twitter URLs, and dynamically-versioned Schema.org `SoftwareApplication` JSON-LD; craft a 1200×630 dark terminal social preview asset; tune on-page headings and mobile CSS while preserving terminal transcript aesthetics; and verify across static assertions, Playwright E2E, and `claude-seo` CLI tools.

**Tech Stack:** Astro 7.3, React 19, Tailwind CSS 4, `@astrojs/sitemap`, Bun, Playwright, `claude-seo` CLI runtime (Chromium + Python).

**Spec:** [`/Users/nemesis/Projects/my-projects/projects/cxstatusline/specs/2026-09-22-website-seo-and-geo-spec.md`](file:///Users/nemesis/Projects/my-projects/projects/cxstatusline/specs/2026-09-22-website-seo-and-geo-spec.md)

## Global Constraints

- **Never push directly to `main`**: All work is committed to `feat/website-seo-and-geo` and merged via Pull Request.
- **Default Base URL**: `https://cxstatusline.adrijshikhar.dev` with `process.env.SITE_URL` override support.
- **Strict Absolute URLs**: Open Graph (`og:image`) and Twitter Card (`twitter:image`) must be fully-qualified `https://` URLs.
- **Zero Sunsetted Schema Types**: Exclude deprecated `FAQPage` and `HowTo` rich result types; focus on `SoftwareApplication` and `WebSite`.
- **CSS & UI Integrity**: Preserve monospace terminal prompt aesthetics in `Hero.astro` (`max-width: 42ch` desktop, `max-width: 28ch` mobile); do not break existing `#install`, `#features`, `#faq`, or `#compatibility` anchor targets.
- **Test Integrity**: Full verification requires `bun test website/test/seo-artifacts.test.ts`, `bun run test:e2e` (both dev and prod modes), and `claude-seo` audits.

---

### Task 1: Add `@astrojs/sitemap`, Configure Base URL, and Build Discovery Endpoints

**Files:**
- Modify: `website/package.json`
- Modify: `website/astro.config.mjs`
- Create: `website/src/pages/robots.txt.ts`
- Create: `website/public/llms.txt`

**Interfaces:**
- Consumes: `process.env.SITE_URL ?? "https://cxstatusline.adrijshikhar.dev"`
- Produces: `dist/sitemap-index.xml`, `dist/sitemap-0.xml`, `dist/robots.txt`, and `dist/llms.txt`

- [x] **Step 1: Install `@astrojs/sitemap` integration**

Run:
```bash
cd website && bun add -d @astrojs/sitemap
```

- [x] **Step 2: Update `website/astro.config.mjs`**

Add `site` configuration and `sitemap()` integration:
```javascript
import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

const local = (path) => fileURLToPath(new URL(path, import.meta.url));
export default defineConfig({
  site: process.env.SITE_URL || "https://cxstatusline.adrijshikhar.dev",
  output: "static",
  integrations: [react(), sitemap()],
  devToolbar: { enabled: false },
  vite: {
    plugins: [tailwindcss()],
    resolve: {
      dedupe: ["react", "react-dom", "react-reconciler", "scheduler"],
      alias: [
        { find: /^ink$/, replacement: local("./node_modules/ink-web/dist/index.js") },
        { find: /^(node:)?fs\/promises$/, replacement: local("./src/fs-promises.ts") },
        { find: /^(node:)?fs$/, replacement: local("./src/fs.ts") },
        { find: /^(node:)?(os|child_process|crypto)$/, replacement: local("./src/node-shims.ts") },
        { find: /^(node:)?path$/, replacement: local("./src/path-shim.ts") },
      ],
    },
    define: {
      "process.env.CXSTATUSLINE_WEB": '"1"',
      "process.env": "{}",
      "process.argv": "[]",
      "process.platform": '"browser"',
      "process.pid": "0",
      "process.stdout": "{}",
      "process.on": "undefined",
      "process.execPath": '""',
    },
    build: { target: "esnext" },
  },
});
```

- [x] **Step 3: Create `website/src/pages/robots.txt.ts`**

Write `website/src/pages/robots.txt.ts`:
```typescript
import type { APIRoute } from "astro";

export const GET: APIRoute = ({ site }) => {
  const base = site ? site.toString().replace(/\/$/, "") : "https://cxstatusline.adrijshikhar.dev";
  const sitemapUrl = `${base}/sitemap-index.xml`;
  const robots = [
    "User-agent: *",
    "Allow: /",
    "",
    `Sitemap: ${sitemapUrl}`,
    "",
  ].join("\n");

  return new Response(robots, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
};
```

- [x] **Step 4: Copy root `llms.txt` to `website/public/llms.txt`**

Run:
```bash
cp llms.txt website/public/llms.txt
```

- [x] **Step 5: Verify static build generates sitemap and robots.txt**

Run:
```bash
cd website && bun run build
```
Verify that `website/dist/sitemap-index.xml` and `website/dist/robots.txt` exist and contain the sitemap URL.

- [x] **Step 6: Commit Task 1**

```bash
git add website/package.json website/bun.lock website/astro.config.mjs website/src/pages/robots.txt.ts website/public/llms.txt
git commit -m "feat(website): configure site URL, sitemap integration, dynamic robots.txt, and llms.txt"
```

---

### Task 2: Create Branded 1200×630 Open Graph Image Asset

**Files:**
- Create: `website/public/og-image.png`

**Interfaces:**
- Consumes: None
- Produces: `website/public/og-image.png` (1200×630 PNG)

- [x] **Step 1: Generate high-resolution 1200×630 terminal preview graphic**

Create a script or canvas renderer to output `website/public/og-image.png` with:
- Canvas dimensions: 1200 × 630 pixels.
- Background: `#080808` with subtle CRT scanline/dot pattern.
- Header: ASCII wordmark `cxstatusline` in green/white (`#38bdf8` / `#e2e8f0`).
- Title: *"OpenAI Codex statusline, customized."* (Font: 48px monospace/sans bold).
- Subtitle: *"Keep the whole session in sight • 34 Widgets • Powerline • macOS & Linux"* (Font: 24px monospace muted `#94a3b8`).
- Center visual: Terminal container rendering a realistic statusline with powerline glyphs:
  `[  main* ] [ +12 -4 ] [ 5h: [=====-] 82% ] [ gpt-5-codex ] [ 20:45 ]`
- Output: Save to `website/public/og-image.png`.

- [x] **Step 2: Verify file dimensions and size**

Run:
```bash
sips -g pixelWidth -g pixelHeight website/public/og-image.png
```
Expected: `pixelWidth: 1200`, `pixelHeight: 630`.

- [x] **Step 3: Commit Task 2**

```bash
git add website/public/og-image.png
git commit -m "feat(website): add 1200x630 dark terminal Open Graph preview asset"
```

---

### Task 3: Build the Centralized `<SEO />` Astro Component with JSON-LD

**Files:**
- Create: `website/src/components/SEO.astro`
- Modify: `website/src/layouts/BaseLayout.astro`

**Interfaces:**
- Consumes: `Astro.site`, `package.json#version`, optional component props
- Produces: Fully rendered `<title>`, `<meta>`, canonical `<link>`, Open Graph, Twitter cards, and `<script type="application/ld+json">`

- [x] **Step 1: Create `website/src/components/SEO.astro`**

```astro
---
import rootPkg from "../../../package.json";

interface Props {
  title?: string;
  description?: string;
  image?: string;
  canonical?: string;
  noindex?: boolean;
}

const {
  title = "cxstatusline | Customizable Statusline & Widgets for OpenAI Codex CLI",
  description = "Customizable statusline for OpenAI Codex CLI — 34 widgets, themes, powerline glyphs, and token trackers in your terminal footer. macOS & Linux.",
  image = "/og-image.png",
  canonical,
  noindex = false,
} = Astro.props;

const siteUrl = Astro.site ? Astro.site.toString().replace(/\/$/, "") : "https://cxstatusline.adrijshikhar.dev";
const canonicalURL = canonical ? new URL(canonical, siteUrl).href : new URL(Astro.url.pathname, siteUrl).href;
const ogImageURL = new URL(image, siteUrl).href;
const keywords = "OpenAI Codex, Codex CLI, statusline, powerline, terminal status bar, TUI footer, CLI widgets, token tracker, git status line";
const softwareVersion = rootPkg.version || "0.6.0";

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "SoftwareApplication",
      "name": "cxstatusline",
      "operatingSystem": "macOS, Linux",
      "applicationCategory": "DeveloperApplication",
      "description": description,
      "softwareVersion": softwareVersion,
      "license": "https://opensource.org/licenses/MIT",
      "codeRepository": "https://github.com/adrijshikhar/cxstatusline",
      "downloadUrl": "https://www.npmjs.com/package/cxstatusline",
      "softwareRequirements": "OpenAI Codex CLI, Node.js >= 18",
      "offers": {
        "@type": "Offer",
        "price": "0",
        "priceCurrency": "USD",
      },
      "author": {
        "@type": "Person",
        "name": "Adrij Shikhar",
        "url": "https://github.com/adrijshikhar",
      },
    },
    {
      "@type": "WebSite",
      "name": "cxstatusline",
      "url": siteUrl,
      "description": "Interactive playground and documentation for cxstatusline",
    },
  ],
};
---

<!-- Primary Meta Tags -->
<title>{title}</title>
<meta name="title" content={title} />
<meta name="description" content={description} />
<meta name="keywords" content={keywords} />
<meta name="robots" content={noindex ? "noindex, nofollow" : "index, follow"} />
<link rel="canonical" href={canonicalURL} />

<!-- Open Graph / Facebook -->
<meta property="og:type" content="website" />
<meta property="og:site_name" content="cxstatusline" />
<meta property="og:url" content={canonicalURL} />
<meta property="og:title" content={title} />
<meta property="og:description" content={description} />
<meta property="og:image" content={ogImageURL} />
<meta property="og:image:secure_url" content={ogImageURL} />
<meta property="og:image:type" content="image/png" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta property="og:image:alt" content="cxstatusline - Customizable statusline for OpenAI Codex CLI" />

<!-- Twitter / X -->
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:url" content={canonicalURL} />
<meta name="twitter:title" content={title} />
<meta name="twitter:description" content={description} />
<meta name="twitter:image" content={ogImageURL} />
<meta name="twitter:image:alt" content="cxstatusline - Customizable statusline for OpenAI Codex CLI" />

<!-- Schema.org JSON-LD -->
<script type="application/ld+json" is:inline set:html={JSON.stringify(jsonLd)} />
```

- [x] **Step 2: Update `website/src/layouts/BaseLayout.astro`**

Replace the existing hardcoded `<title>` and `<meta name="description">` tags with `<SEO />`:
```astro
---
import "../styles/global.css";
import DotField from "../components/DotField.astro";
import SEO from "../components/SEO.astro";

interface Props {
  title?: string;
  description?: string;
  image?: string;
  canonical?: string;
  noindex?: boolean;
}

const { title, description, image, canonical, noindex } = Astro.props;
---
<!doctype html>
<html lang="en">
<head>
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <SEO
      title={title}
      description={description}
      image={image}
      canonical={canonical}
      noindex={noindex}
    />
    <script is:inline>
      window.process ??= {
        env: { CXSTATUSLINE_WEB: "1" },
        platform: "browser",
        argv: [],
        stdout: {},
        pid: 0,
        on: () => {},
      };
    </script>
  </head>
<body>
<DotField />
<a class="skip-link" href="#main-content">Skip to content</a>
<slot />
<script>import "../main";</script>
</body>
</html>
```

- [x] **Step 3: Verify build emits metadata and JSON-LD**

Run:
```bash
cd website && bun run build
```
Verify that `website/dist/index.html` contains:
- `og:image` with `https://cxstatusline.adrijshikhar.dev/og-image.png`
- `<script type="application/ld+json">` with `SoftwareApplication`

- [x] **Step 4: Commit Task 3**

```bash
git add website/src/components/SEO.astro website/src/layouts/BaseLayout.astro
git commit -m "feat(website): add centralized SEO component with Open Graph and Schema.org JSON-LD"
```

---

### Task 4: Refine Headings, CSS Rules, and Accessible Passage Citability (GEO)

**Files:**
- Modify: `website/src/components/Hero.astro`
- Modify: `website/src/styles/global.css`
- Modify: `website/src/pages/index.astro`
- Modify: `website/src/components/Faq.tsx`

**Interfaces:**
- Consumes: Existing terminal transcript and Accordion styling
- Produces: Enhanced keyword presence, balanced mobile line wraps, clean AEO/GEO passage citability

- [x] **Step 1: Update `Hero.astro` heading**

In `website/src/components/Hero.astro`, update line 14:
```astro
      <h1 id="intro-title">OpenAI Codex statusline, customized.</h1>
```

- [x] **Step 2: Update mobile heading width in `website/src/styles/global.css`**

In `website/src/styles/global.css` line 125, update mobile `.intro h1`:
```css
  .intro h1 { max-width: 28ch; font-size: 19px; line-height: 1.35; }
```

- [x] **Step 3: Add accessible citation passage to `website/src/pages/index.astro`**

In `website/src/pages/index.astro`, insert before `<Features />`:
```astro
    <section class="sr-only" aria-label="About cxstatusline">
      <p>
        cxstatusline is an open-source statusline customization tool for OpenAI Codex CLI.
        It replaces the default fixed Codex footer with a multi-row, customizable terminal
        statusline featuring 34 widgets, powerline glyphs, Git branch and diff counters,
        five-hour and weekly usage progress bars, and truecolor theme support. It runs
        on macOS (Apple Silicon and Intel) and Linux (x86_64 and aarch64), integrating
        directly with official Codex releases.
      </p>
    </section>
```

- [x] **Step 4: Add high-intent developer FAQ entries in `website/src/components/Faq.tsx`**

Add questions to the `questions` array:
```typescript
const questions = [
  ["Does the browser change my local Codex?", "No. The playground stays in this browser; installing the CLI is a separate terminal action."],
  ["How does cxstatusline customize the OpenAI Codex CLI footer?", "cxstatusline patches the local Codex binary to render a customizable Node-based statusline footer before each prompt redraw, giving you 34 widgets, powerline glyphs, and themes."],
  ["Does cxstatusline support Linux as well as macOS?", "Yes. cxstatusline provides verified prebuilt binaries for macOS (darwin-arm64, darwin-x64) and Linux (linux-arm64, linux-x64)."],
  ["Can I run custom commands here?", "Custom commands work in the native editor. This browser playground does not execute them."],
  ["Where is my layout saved?", "In browser storage for this site, until you clear it. Download the JSON to keep a transferable copy."],
  ["Which versions are supported?", "See the maintained compatibility documentation on GitHub."],
  ["Is this an official OpenAI product?", "No. cxstatusline is an independent project."],
] as const;
```

- [x] **Step 5: Verify build compiles cleanly without styling defects**

Run:
```bash
cd website && bun run build
```

- [x] **Step 6: Commit Task 4**

```bash
git add website/src/components/Hero.astro website/src/styles/global.css website/src/pages/index.astro website/src/components/Faq.tsx
git commit -m "feat(website): refine H1 keyword alignment, mobile CSS width, GEO passage, and FAQ search intent"
```

---

### Task 5: Automated Verification Suite (Unit Tests & Playwright E2E)

**Files:**
- Create: `website/test/seo-artifacts.test.ts`
- Test: `website/test/` and `website/test:e2e`

**Interfaces:**
- Consumes: `website/dist/`
- Produces: Zero test failures across artifact checks and E2E browser suites

- [x] **Step 1: Write `website/test/seo-artifacts.test.ts`**

```typescript
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect, describe } from "bun:test";

const distDir = join(import.meta.dir, "../dist");

describe("SEO Artifacts and Discovery Verification", () => {
  test("sitemap-index.xml and sitemap-0.xml exist and are non-empty", () => {
    const sitemapIndex = join(distDir, "sitemap-index.xml");
    const sitemap0 = join(distDir, "sitemap-0.xml");
    expect(existsSync(sitemapIndex)).toBe(true);
    expect(existsSync(sitemap0)).toBe(true);

    const content = readFileSync(sitemapIndex, "utf-8");
    expect(content).toContain("<sitemapindex");
    expect(content).toContain("sitemap-0.xml");
  });

  test("robots.txt exists and dynamically points to sitemap", () => {
    const robotsPath = join(distDir, "robots.txt");
    expect(existsSync(robotsPath)).toBe(true);

    const content = readFileSync(robotsPath, "utf-8");
    expect(content).toContain("User-agent: *");
    expect(content).toContain("Allow: /");
    expect(content).toContain("Sitemap: https://cxstatusline.adrijshikhar.dev/sitemap-index.xml");
  });

  test("llms.txt is present and matches project summary", () => {
    const llmsPath = join(distDir, "llms.txt");
    expect(existsSync(llmsPath)).toBe(true);

    const content = readFileSync(llmsPath, "utf-8");
    expect(content).toContain("cxstatusline");
    expect(content).toContain("OpenAI Codex");
  });

  test("og-image.png exists and is greater than 10KB", () => {
    const ogPath = join(distDir, "og-image.png");
    expect(existsSync(ogPath)).toBe(true);
    const size = readFileSync(ogPath).byteLength;
    expect(size).toBeGreaterThan(10000);
  });

  test("index.html contains complete Open Graph, Twitter cards, and Schema.org JSON-LD", () => {
    const indexPath = join(distDir, "index.html");
    const html = readFileSync(indexPath, "utf-8");

    // Canonical
    expect(html).toContain('<link rel="canonical" href="https://cxstatusline.adrijshikhar.dev"');

    // Open Graph
    expect(html).toContain('<meta property="og:type" content="website"');
    expect(html).toContain('<meta property="og:image" content="https://cxstatusline.adrijshikhar.dev/og-image.png"');
    expect(html).toContain('<meta property="og:image:width" content="1200"');
    expect(html).toContain('<meta property="og:image:height" content="630"');

    // Twitter
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image"');
    expect(html).toContain('<meta name="twitter:image" content="https://cxstatusline.adrijshikhar.dev/og-image.png"');

    // Schema.org JSON-LD
    expect(html).toContain('<script type="application/ld+json"');
    expect(html).toContain('"@type":"SoftwareApplication"');
    expect(html).toContain('"name":"cxstatusline"');
    expect(html).toContain('"operatingSystem":"macOS, Linux"');
    expect(html).toContain('"@type":"WebSite"');

    // Refined H1
    expect(html).toContain("OpenAI Codex statusline, customized.");
  });
});
```

- [x] **Step 2: Run Bun test on SEO artifacts**

Run:
```bash
cd website && bun run build && bun test test/seo-artifacts.test.ts
```
Expected: PASS (5 passed, 0 failed).

- [x] **Step 3: Run full Playwright E2E regression suite**

Run:
```bash
cd website && bun run test:e2e
```
Expected: All dev and prod E2E tests pass cleanly with zero regressions on playground interactivity.

- [x] **Step 4: Commit Task 5**

```bash
git add website/test/seo-artifacts.test.ts
git commit -m "test(website): add automated SEO artifact, Open Graph, and JSON-LD assertions"
```

---

### Task 6: Audit & Quality Gate with `claude-seo`

**Files:** None (Execution & Verification)

- [x] **Step 1: Start preview server in background**

Run:
```bash
cd website && bun run preview --port 4321
```

- [x] **Step 2: Run `claude-seo` Page Audit**

Execute:
```bash
~/.claude/skills/seo/scripts/claude-seo run seo-page http://localhost:4321
```
Verify title length, meta description, heading structure, and core technical SEO score.

- [x] **Step 3: Run `claude-seo` Schema Audit**

Execute:
```bash
~/.claude/skills/seo/scripts/claude-seo run seo-schema http://localhost:4321
```
Verify that `SoftwareApplication` and `WebSite` JSON-LD schemas validate with zero errors and no deprecated types.

- [x] **Step 4: Run `claude-seo` GEO Citability Audit**

Execute:
```bash
~/.claude/skills/seo/scripts/claude-seo run seo-geo http://localhost:4321
```
Verify that answer passages, factual density, and question headers receive high citability scores.

- [x] **Step 5: Final review and PR preparation**

Ensure git working tree is clean and all tests pass.
Push branch `feat/website-seo-and-geo` and open Pull Request:
```bash
git push -u origin feat/website-seo-and-geo
gh pr create --title "feat(website): implement SEO, Open Graph, JSON-LD schema, and GEO citability" --body "..."
```
