import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { beforeAll, describe, expect, test } from "bun:test";

const distDir = join(import.meta.dir, "../dist");

describe("SEO Artifacts and Discovery Verification", () => {
  beforeAll(() => {
    if (!existsSync(join(distDir, "index.html"))) {
      execSync("bun run build", { cwd: join(import.meta.dir, ".."), stdio: "ignore" });
    }
  });
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
    expect(html).toContain('<link rel="canonical" href="https://cxstatusline.adrijshikhar.dev/"');

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

    // Visible GEO Overview passage
    expect(html).toContain("cxstatusline is an open-source statusline customization tool for OpenAI Codex CLI.");
  });

  test("SEO component conditionally renders search console verification tags", () => {
    const indexPath = join(distDir, "index.html");
    const html = readFileSync(indexPath, "utf-8");
    expect(html).not.toContain('name="google-site-verification"');
    expect(html).not.toContain('name="msvalidate.01"');
  });

  test("Cloudflare beacon is omitted when token is unset", () => {
    const indexPath = join(distDir, "index.html");
    const html = readFileSync(indexPath, "utf-8");
    expect(html).not.toContain("static.cloudflareinsights.com/beacon.min.js");
  });

  test("renders verification tags and Cloudflare beacon when environment variables are set", () => {
    const tempOutDir = join(import.meta.dir, "../dist-env-test");
    try {
      execSync("bunx astro build --outDir dist-env-test", {
        cwd: join(import.meta.dir, ".."),
        env: {
          ...process.env,
          PUBLIC_GOOGLE_SITE_VERIFICATION: "test-google-token-123",
          PUBLIC_BING_SITE_VERIFICATION: "test-bing-token-456",
          PUBLIC_CF_BEACON_TOKEN: "test-cf-token-789",
        },
        stdio: "ignore",
      });

      const indexPath = join(tempOutDir, "index.html");
      expect(existsSync(indexPath)).toBe(true);
      const html = readFileSync(indexPath, "utf-8");
      expect(html).toContain('<meta name="google-site-verification" content="test-google-token-123"');
      expect(html).toContain('<meta name="msvalidate.01" content="test-bing-token-456"');
      expect(html).toContain('src="https://static.cloudflareinsights.com/beacon.min.js"');
      expect(html).toContain("test-cf-token-789");
    } finally {
      rmSync(tempOutDir, { recursive: true, force: true });
    }
  });
});
