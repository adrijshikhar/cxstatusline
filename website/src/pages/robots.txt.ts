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
