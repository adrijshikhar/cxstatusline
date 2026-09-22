# SEO & GEO Measurement, Verification, and Drift Monitoring Guide

This guide details the operational procedures for verifying site ownership, enabling privacy-preserving telemetry, running automated SEO drift regression tests, and tracking long-term SEO/GEO performance for the [cxstatusline landing page](https://cxstatusline.adrijshikhar.dev).

---

## 1. Search Engine Ownership Verification & Indexing Setup

Search engines require verified domain or site ownership before providing indexing statistics, query impressions, click data, and crawl diagnostic logs.

### 1.1 Google Search Console (GSC) Verification

The `cxstatusline` website supports automated HTML verification tag rendering via Astro configuration.

1. **Access Google Search Console**:
   - Navigate to [Google Search Console](https://search.google.com/search-console).
   - Click **Add Property**.
   - Select **URL prefix** and enter `https://cxstatusline.adrijshikhar.dev`.
2. **Retrieve Verification Token**:
   - Under verification methods, choose **HTML tag**.
   - Google will display a meta tag:
     ```html
     <meta name="google-site-verification" content="abcdef1234567890_EXAMPLE_TOKEN" />
     ```
   - Copy only the `content` attribute value (e.g. `abcdef1234567890_EXAMPLE_TOKEN`).
3. **Configure Cloudflare Pages Environment Variable**:
   - In Cloudflare Dashboard, go to **Workers & Pages** > **cxstatusline** > **Settings** > **Environment variables**.
   - Add variable:
     - **Variable name**: `PUBLIC_GOOGLE_SITE_VERIFICATION`
     - **Value**: `abcdef1234567890_EXAMPLE_TOKEN`
     - **Environment**: Production (and optionally Preview)
4. **Deploy and Verify**:
   - Trigger a new deployment in Cloudflare Pages.
   - The `<SEO />` component (`website/src/components/SEO.astro`) injects:
     ```html
     <meta name="google-site-verification" content="abcdef1234567890_EXAMPLE_TOKEN" />
     ```
   - Return to Google Search Console and click **Verify**.

> [!NOTE]
> If `PUBLIC_GOOGLE_SITE_VERIFICATION` is not set or empty, the `<SEO />` component omits the tag entirely. No empty placeholder tag is ever rendered in HTML.

---

### 1.2 Bing Webmaster Tools Verification

Bing powers search indexing for Bing, Microsoft Copilot, and Yahoo Search.

1. **Access Bing Webmaster Tools**:
   - Navigate to [Bing Webmaster Tools](https://www.bing.com/webmasters).
   - Sign in and choose **Add site manually** (or **Import from Google Search Console**).
   - Enter `https://cxstatusline.adrijshikhar.dev`.
2. **Retrieve Verification Token**:
   - Under verification methods, select **HTML Meta Tag**.
   - Bing provides a meta tag formatted as:
     ```html
     <meta name="msvalidate.01" content="1234567890ABCDEF1234567890ABCDEF" />
     ```
   - Copy the 32-character hexadecimal token.
3. **Configure Environment Variable**:
   - In Cloudflare Pages, add:
     - **Variable name**: `PUBLIC_BING_SITE_VERIFICATION`
     - **Value**: `1234567890ABCDEF1234567890ABCDEF`
4. **Deploy and Confirm**:
   - Once deployed, `<SEO />` renders `<meta name="msvalidate.01" content="..." />`.
   - Click **Verify** in Bing Webmaster Tools.

---

### 1.3 Sitemap Submission

The website uses `@astrojs/sitemap` to generate standard XML sitemaps automatically at build time.

- **Primary Sitemap Index**:
  ```text
  https://cxstatusline.adrijshikhar.dev/sitemap-index.xml
  ```
- **Child Sitemaps**:
  ```text
  https://cxstatusline.adrijshikhar.dev/sitemap-0.xml
  ```
- **Robots.txt Location**:
  ```text
  https://cxstatusline.adrijshikhar.dev/robots.txt
  ```

#### Submission Steps:
1. In **Google Search Console**, navigate to **Indexing** > **Sitemaps**.
2. Enter `sitemap-index.xml` in the **Add a new sitemap** input field and click **Submit**.
3. In **Bing Webmaster Tools**, navigate to **Sitemaps** > **Submit sitemap**.
4. Enter `https://cxstatusline.adrijshikhar.dev/sitemap-index.xml` and click **Submit**.
5. Verify that both search consoles report `Success` with valid URL counts discovered.

---

### 1.4 Structured Data & Schema Validation

The website includes embedded `application/ld+json` structured data covering `@graph` entities for `SoftwareApplication` and `WebSite`.

To verify schema compliance:
1. Run Google's [Rich Results Test](https://search.google.com/test/rich-results) against `https://cxstatusline.adrijshikhar.dev`.
2. Confirm zero errors and zero critical warnings.
3. Run the [Schema Markup Validator](https://validator.schema.org/) to inspect graph entities:
   - `SoftwareApplication`: Verifies `name`, `operatingSystem`, `applicationCategory`, `offers`, `author`, `codeRepository`, `downloadUrl`, and `softwareRequirements`.
   - `WebSite`: Verifies `name`, `url`, and `description`.

---

## 2. Privacy-Preserving Telemetry (Cloudflare Web Analytics)

To observe visitor traffic, Core Web Vitals, and referral sources without tracking cookies, consent banners, or GDPR liabilities, `cxstatusline` integrates Cloudflare Web Analytics.

### 2.1 Architectural Features
- **Zero Cookies**: Does not store identifiers in cookies, localStorage, or fingerprint devices.
- **Asynchronous & Deferred**: Loaded with `defer` right before `</body>`, guaranteeing 0ms blocking impact on terminal playground hydration and First Input Delay (FID) / Interaction to Next Paint (INP).
- **Conditional Loading**: Completely inert in local builds and unit tests unless `PUBLIC_CF_BEACON_TOKEN` is supplied.

### 2.2 Obtaining the Cloudflare Beacon Token
1. Log in to [Cloudflare Dashboard](https://dash.cloudflare.com).
2. In the navigation sidebar, click **Analytics & Logs** > **Web Analytics**.
3. Click **Add a site** (or select `cxstatusline.adrijshikhar.dev` if already listed).
4. Enter the hostname `cxstatusline.adrijshikhar.dev`.
5. Cloudflare will generate a JS beacon snippet containing a token:
   ```html
   <script defer src='https://static.cloudflareinsights.com/beacon.min.js' data-cf-beacon='{"token": "a1b2c3d4e5f67890abcdef1234567890"}'></script>
   ```
6. Copy only the hexadecimal string inside `"token": "..."`.

### 2.3 Setting the Environment Variable
In Cloudflare Pages:
- **Variable Name**: `PUBLIC_CF_BEACON_TOKEN`
- **Value**: `a1b2c3d4e5f67890abcdef1234567890`
- **Target Environments**: Production

In local development or testing (optional):
```bash
PUBLIC_CF_BEACON_TOKEN="a1b2c3d4e5f67890abcdef1234567890" bun run --cwd website dev
```

### 2.4 Monitoring Traffic and Core Web Vitals
In **Cloudflare Web Analytics**, track the following operational dashboards:
- **Visits and Pageviews**: Real human visits segmented by browser, operating system, and country.
- **Top Referrers**: Tracks discovery from GitHub (`github.com/adrijshikhar/cxstatusline`), X/Twitter, OpenAI developer forums, Reddit, and search engines.
- **Real-User Core Web Vitals (RUM)**:
  - **Largest Contentful Paint (LCP)**: Target `< 2.5s`
  - **Interaction to Next Paint (INP)**: Target `< 200ms`
  - **Cumulative Layout Shift (CLS)**: Target `< 0.1`

### 2.5 Observing AI Bot Crawls and Scrapers
In addition to human visitors, monitor AI bot crawl frequency via Cloudflare Security/Bot Analytics or server logs:
- `GPTBot` (OpenAI training and real-time SearchGPT citations)
- `OAI-SearchBot` (OpenAI search indexer)
- `PerplexityBot` (Perplexity search and discovery)
- `ClaudeBot` / `anthropic-ai` (Anthropic citations and training)
- `Google-Extended` / `Googlebot` (Google search and AI Overviews)

Confirm in `robots.txt` that `User-agent: * Allow: /` remains active so verified search crawlers can index content and `llms.txt`.

---

## 3. Automated SEO Drift Monitoring

SEO drift occurs when unintentional code modifications (e.g. template refactors, deleted meta tags, modified heading hierarchies, or broken structured data) degrade search engine signals across releases.

`cxstatusline` includes an automated drift monitoring CLI helper (`scripts/seo-drift.ts`) backed by the `claude-seo` runtime and local SQLite storage (`~/.cache/claude-seo/drift/baselines.db`).

### 3.1 CLI Commands

#### 1. Capture Baseline
Captures an authoritative snapshot of all SEO tags, headings, content hashes, and structured data:
```bash
# Capture local preview server baseline (default: http://127.0.0.1:4321)
bun run seo:drift:baseline

# Capture production URL baseline
bun run seo:drift:baseline https://cxstatusline.adrijshikhar.dev
```

#### 2. Run Comparison
Compares the current page state against the most recent stored baseline:
```bash
# Compare against local preview server (default: http://127.0.0.1:4321)
bun run seo:drift:compare

# Compare against production URL
bun run seo:drift:compare https://cxstatusline.adrijshikhar.dev
```

If drift is detected, the script outputs a structured diff and exits with code `1` if any `CRITICAL` regression is found, or `0` for clean / informative changes.

---

### 3.2 Drift Severity Definitions

The drift engine evaluates 17 comparison rules grouped into three severity tiers:

| Severity | Impact | Build Status | Trigger Conditions |
|---|---|---|---|
| **CRITICAL** | Immediate ranking drops or indexation loss | **Fails CI / Exits 1** | • Schema/JSON-LD removed completely<br>• Canonical tag removed or changed<br>• `noindex` directive added to robots meta<br>• H1 heading removed<br>• H1 heading altered significantly (>50% text change)<br>• Title tag removed completely<br>• HTTP status code error (4xx or 5xx) |
| **WARNING** | Moderate risk to CTR or search relevance | Exits 0 (Logged warning) | • Title text changed (words edited)<br>• Meta description changed<br>• Core Web Vitals regressed >20%<br>• Performance score dropped ≥10 points<br>• Open Graph tags removed<br>• Schema content modified (JSON-LD hash altered) |
| **INFO** | Normal content updates or improvements | Exits 0 (Logged notice) | • New Schema block added<br>• H2 heading structure altered<br>• Content HTML body hash changed |

---

### 3.3 CI and Pre-Release Workflow

Before submitting a PR or cutting a release:
1. Build and preview the website locally:
   ```bash
   cd website && bun run build && bun run preview
   ```
2. In a separate terminal, execute the drift comparison:
   ```bash
   bun run seo:drift:compare http://127.0.0.1:4321
   ```
3. If intent changes are intentional (e.g. updating widget count from 34 to 36 in title/description):
   ```bash
   bun run seo:drift:baseline http://127.0.0.1:4321
   ```
   This commits a new baseline snapshot into `~/.cache/claude-seo/drift/baselines.db`.

---

## 4. Performance, GEO Citations & ROI Measurement Formulas

To quantitatively assess the ROI of SEO optimizations and Generative Engine Optimization (GEO), maintainers track the following KPIs on a weekly and monthly cadence.

### 4.1 Organic Search Click-Through Rate (CTR)

Measures how effectively the page title and meta description compel developers to click through from search engine results pages (SERPs).

$$\text{Organic Search CTR (\%)} = \left( \frac{\text{Total Clicks}}{\text{Total Impressions}} \right) \times 100$$

- **Data Source**: Google Search Console > **Performance** > **Search results** > Date range: Last 28 days.
- **Target Benchmark**:
  - Branded / utility queries (`cxstatusline`, `OpenAI Codex statusline`): **15% – 35%**
  - General categorical queries (`Codex CLI footer`, `Codex status bar widgets`): **5% – 15%**
- **Action Threshold**: If CTR drops below 5% for high-impression keywords, test updated meta descriptions with clearer call-to-actions and widget count highlights.

---

### 4.2 AI Citation Rate (GEO - Generative Engine Optimization)

Measures the frequency with which conversational AI assistants (Perplexity, ChatGPT / SearchGPT, Claude, Google Gemini) recommend or cite `cxstatusline` when answering developer questions about Codex CLI statuslines.

$$\text{AI Citation Rate (\%)} = \left( \frac{\text{Citations in Responses}}{\text{Total Tested High-Intent Prompts}} \right) \times 100$$

#### Standard Evaluation Test Battery (20 Prompts)
Run the following test prompts monthly across Perplexity, ChatGPT (with Web Browsing), and Claude:
1. *"How can I customize the statusline or footer in OpenAI Codex CLI?"*
2. *"Is there a statusline tool for OpenAI Codex CLI similar to ccstatusline?"*
3. *"Best statusline and widgets for Codex CLI."*
4. *"How to display git branch and context window tokens in OpenAI Codex footer?"*
5. *"OpenAI Codex statusline powerline themes."*
6. *(15 additional variations covering tokens, widgets, themes, and configuration)*

- **Target Benchmark**:
  - Perplexity: **≥ 60%** citation rate with markdown links to `https://cxstatusline.adrijshikhar.dev`.
  - ChatGPT / SearchGPT: **≥ 40%** citation rate.
- **Action Threshold**: If citation rate falls below 30%, inspect `llms.txt` and ensure overview passages in `website/src/pages/index.astro` retain high factual density and definition statements.

---

### 4.3 High-Intent Keyword Rank Tracking

Tracks average position across primary intent search terms in Google Search Console:

$$\text{Average Rank Position} = \frac{\sum_{i=1}^{N} \text{Rank}_i \times \text{Impressions}_i}{\sum_{i=1}^{N} \text{Impressions}_i}$$

#### Monitored Keyword Targets:
| Keyword | Search Intent | Target Position |
|---|---|---|
| `cxstatusline` | Exact Brand | **Position 1** |
| `OpenAI Codex statusline` | Primary Category | **Top 3** |
| `Codex CLI statusline` | Product Feature | **Top 3** |
| `Codex CLI footer` | Feature Utility | **Top 5** |
| `Codex CLI widgets` | Exploration | **Top 5** |
| `ccstatusline for codex` | Competitor Migration | **Top 3** |

- **Data Source**: Google Search Console > **Performance** > **Queries** filter.
- **Cadence**: Tracked bi-weekly.

---

### 4.4 Referral Conversion Rate

Measures the percentage of landing page visitors who take an active adoption action (clicking through to the GitHub repository or copying the `bun add -g cxstatusline` installation command).

$$\text{Referral Conversion Rate (\%)} = \left( \frac{\text{Total Install / GitHub Clicks}}{\text{Total Unique Landing Page Visitors}} \right) \times 100$$

- **Data Sources**:
  - Numerator: GitHub Traffic Analytics (**Referring Sites** > `cxstatusline.adrijshikhar.dev` unique referrers) + In-app copy telemetry.
  - Denominator: Cloudflare Web Analytics (**Unique Visitors**).
- **Target Benchmark**: **15% – 30%** conversion rate.
- **Action Threshold**: If referral conversion falls below 12%, re-evaluate the above-the-fold CTA placement and interactive terminal demo responsiveness.

---

### 4.5 Weekly npm Install Growth Rate

Measures downstream community growth resulting from organic search and GEO discovery.

$$\text{Weekly Install Growth (\%)} = \left( \frac{\text{Installs}_{\text{Week } N} - \text{Installs}_{\text{Week } N-1}}{\text{Installs}_{\text{Week } N-1}} \right) \times 100$$

- **Data Source**: npm API:
  ```bash
  curl -s "https://api.npmjs.org/downloads/point/last-week/cxstatusline"
  ```
- **Target**: Sustained positive net weekly growth following search indexation.

---

### 4.6 KPI Summary Matrix

| Metric | Tool / Source | Formula / Definition | Target | Review Cadence |
|---|---|---|---|---|
| **Organic CTR** | Google Search Console | `(Clicks / Impressions) × 100` | 5% – 15% | Bi-weekly |
| **AI Citation Rate** | Perplexity / ChatGPT / Claude | `(Citations / 20 Test Prompts) × 100` | ≥ 50% | Monthly |
| **Top Keyword Position** | Google Search Console | Average rank across 6 core queries | Top 3 | Bi-weekly |
| **Referral Conversion** | Cloudflare Analytics & GitHub | `(GitHub Referrals / Unique Visitors) × 100` | 15% – 30% | Monthly |
| **SEO Drift Errors** | `scripts/seo-drift.ts` | Count of CRITICAL drift violations | **0** | Every PR / Release |
| **LCP (Real Users)** | Cloudflare Web Analytics | 75th percentile Largest Contentful Paint | < 2.5s | Weekly |

---

## 5. Maintenance Checklist

When performing updates to the website:

- [ ] Run `bun run test:website` to verify unit tests, sitemaps, robots.txt, and schema rendering.
- [ ] Run `bun run test:website:e2e` to ensure Playwright end-to-end tests pass.
- [ ] Run `bun run seo:drift:compare` against local build preview before merging.
- [ ] Verify `PUBLIC_GOOGLE_SITE_VERIFICATION`, `PUBLIC_BING_SITE_VERIFICATION`, and `PUBLIC_CF_BEACON_TOKEN` in Cloudflare Pages.
- [ ] Review Google Search Console sitemap indexing status once monthly.
