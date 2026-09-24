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

  test("reads all release pages and discards partial results when a later page fails", async () => {
    const pages: number[] = [];
    const mockFetch = async (url: string) => {
      const page = Number(new URL(url).searchParams.get("page"));
      pages.push(page);
      if (page === 1) return new Response(JSON.stringify(Array.from({ length: 100 }, (_, i) => ({ tag_name: `codex-v0.${200 - i}.0`, draft: false }))));
      return new Response(JSON.stringify([{ tag_name: "codex-v0.99.0", draft: false }]));
    };
    const versions = await fetchPublishedPrebuiltVersions(mockFetch as any);
    expect(pages).toEqual([1, 2]);
    expect(versions.at(-1)).toBe("0.99.0");

    const failing = async (url: string) => new URL(url).searchParams.get("page") === "1"
      ? new Response(JSON.stringify(Array.from({ length: 100 }, () => ({ tag_name: "codex-v0.155.1", draft: false }))))
      : new Response("unavailable", { status: 503 });
    expect(await fetchPublishedPrebuiltVersions(failing as any)).toEqual([]);
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

    const versions = await fetchPublishedPrebuiltVersions(mockFetch as any);
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
