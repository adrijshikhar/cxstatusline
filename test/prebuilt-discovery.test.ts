import { describe, expect, test } from "bun:test";
import { fetchPublishedPrebuiltVersions } from "../src/distribution/prebuilt";

describe("fetchPublishedPrebuiltVersions", () => {
  test("extracts, parses, and sorts codex-v releases descending by semver", async () => {
    const mockReleases = [
      { tag_name: "v0.7.0", draft: false },
      { tag_name: "codex-v0.155.0", draft: false },
      { tag_name: "codex-v0.155.1", draft: false },
      { tag_name: "codex-v0.154.0", draft: false },
      { tag_name: "codex-v0.156.0-draft", draft: true },
      { tag_name: "codex-vinvalid", draft: false },
      { tag_name: "codex-v0.153.4", draft: false },
    ];

    const mockFetch = async () => {
      return new Response(JSON.stringify(mockReleases), { status: 200 });
    };

    const versions = await fetchPublishedPrebuiltVersions(mockFetch as any);
    expect(versions).toEqual(["0.155.1", "0.155.0", "0.154.0", "0.153.4"]);
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
