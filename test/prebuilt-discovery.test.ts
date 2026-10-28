import { describe, expect, test } from "bun:test";
import { fetchPublishedPrebuiltVersions } from "../src/distribution/prebuilt";

describe("fetchPublishedPrebuiltVersions", () => {
  test("extracts, parses, and sorts codex-v releases descending by semver", async () => {
    const mockReleases = [
      { tag_name: "v0.7.0", draft: false },
      { tag_name: "codex-v0.155.0", draft: false },
      { tag_name: "codex-v0.155.1", draft: false },
      { tag_name: "codex-v0.155.2", draft: false, prerelease: true },
      { tag_name: "codex-v0.154.0", draft: false },
      { tag_name: "codex-v0.156.0-draft", draft: true },
      { tag_name: "codex-vinvalid", draft: false },
      { tag_name: "codex-v0.153.4", draft: false },
    ];

    const mockFetch = async () => {
      return new Response(JSON.stringify(mockReleases), { status: 200 });
    };

    const versions = await fetchPublishedPrebuiltVersions(mockFetch as any);
    expect(versions).toEqual(["0.155.2", "0.155.1", "0.155.0", "0.154.0", "0.153.4"]);
  });

  test("reads all release pages using per_page=30 and discards partial results when a later page fails", async () => {
    const urls: string[] = [];
    const mockFetch = async (url: string) => {
      urls.push(url);
      const page = Number(new URL(url).searchParams.get("page"));
      if (page === 1) return new Response(JSON.stringify(Array.from({ length: 30 }, (_, i) => ({ tag_name: `codex-v0.${200 - i}.0`, draft: false }))));
      return new Response(JSON.stringify([{ tag_name: "codex-v0.99.0", draft: false }]));
    };
    const versions = await fetchPublishedPrebuiltVersions(mockFetch as any);
    expect(urls[0]).toContain("per_page=30");
    expect(urls.length).toBe(2);
    expect(versions.at(-1)).toBe("0.99.0");

    const failing = async (url: string) => new URL(url).searchParams.get("page") === "1"
      ? new Response(JSON.stringify(Array.from({ length: 30 }, () => ({ tag_name: "codex-v0.155.1", draft: false }))))
      : new Response("unavailable", { status: 503 });
    expect(await fetchPublishedPrebuiltVersions(failing as any, undefined, { retryDelayMs: 0 })).toEqual([]);
  });

  test("retries transient 5xx responses and succeeds", async () => {
    let attempts = 0;
    const mockFetch = async () => {
      attempts += 1;
      if (attempts < 3) return new Response("504 Gateway Timeout", { status: 504 });
      return new Response(JSON.stringify([{ tag_name: "codex-v0.165.0", draft: false }]));
    };
    const versions = await fetchPublishedPrebuiltVersions(mockFetch as any, undefined, { retryDelayMs: 0 });
    expect(attempts).toBe(3);
    expect(versions).toEqual(["0.165.0"]);
  });

  test("returns empty array when API returns non-200", async () => {
    const mockFetch = async () => {
      return new Response("Not found", { status: 404 });
    };

    const versions = await fetchPublishedPrebuiltVersions(mockFetch as any);
    expect(versions).toEqual([]);
  });

  test("returns empty array on network failure or abort", async () => {
    const mockFetch = async () => {
      throw new Error("Network timeout");
    };

    const versions = await fetchPublishedPrebuiltVersions(mockFetch as any, undefined, { retryDelayMs: 0 });
    expect(versions).toEqual([]);
  });

  test("returns empty array when json is not an array", async () => {
    const mockFetch = async () => {
      return new Response(JSON.stringify({ message: "rate limited" }), { status: 200 });
    };

    const versions = await fetchPublishedPrebuiltVersions(mockFetch as any);
    expect(versions).toEqual([]);
  });
});
