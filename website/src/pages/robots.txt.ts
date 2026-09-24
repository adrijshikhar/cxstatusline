import type { APIRoute } from "astro";

export const GET: APIRoute = ({ site }) => {
  const base = site ? site.toString().replace(/\/$/, "") : "https://cxstatusline.adrijshikhar.dev";
  const sitemapIndexUrl = `${base}/sitemap-index.xml`;
  const sitemapChildUrl = `${base}/sitemap-0.xml`;
  const robots = [
    "User-agent: *",
    "Allow: /",
    "",
    "User-agent: OAI-SearchBot",
    "Allow: /",
    "",
    "User-agent: Claude-SearchBot",
    "Allow: /",
    "",
    "User-agent: PerplexityBot",
    "Allow: /",
    "",
    `Sitemap: ${sitemapIndexUrl}`,
    `Sitemap: ${sitemapChildUrl}`,
    "",
  ].join("\n");

  return new Response(robots, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
};
