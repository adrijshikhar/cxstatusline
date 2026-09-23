import { describe, expect, test } from "bun:test";
import { compareSemver, resolveLatestVersion, type FetchLike } from "../src/release-sync";

describe("compareSemver", () => {
  test("compares versions accurately", () => {
    expect(compareSemver("0.6.0", "0.5.1")).toBeGreaterThan(0);
    expect(compareSemver("0.5.1", "0.6.0")).toBeLessThan(0);
    expect(compareSemver("0.6.0", "0.6.0")).toBe(0);
  });
});

describe("resolveLatestVersion", () => {
  test("retains static version when npm is older (e.g. 0.5.1 vs static 0.6.0)", async () => {
    const mockFetch: FetchLike = async (url) => {
      if (String(url).includes("registry.npmjs.org")) {
        return new Response(JSON.stringify({ version: "0.5.1" }), { status: 200 });
      }
      return new Response(JSON.stringify({ version: "0.6.0" }), { status: 200 });
    };

    const result = await resolveLatestVersion("0.6.0", mockFetch);
    expect(result.version).toBe("0.6.0");
  });

  test("upgrades when npm returns a newer version", async () => {
    const mockFetch: FetchLike = async (url) => {
      if (String(url).includes("registry.npmjs.org")) {
        return new Response(JSON.stringify({ version: "0.7.0" }), { status: 200 });
      }
      return new Response(JSON.stringify({ version: "0.6.0" }), { status: 200 });
    };

    const result = await resolveLatestVersion("0.6.0", mockFetch);
    expect(result.version).toBe("0.7.0");
    expect(result.source).toBe("npm");
  });

  test("falls back to GitHub when npm is offline or failing", async () => {
    const mockFetch: FetchLike = async (url) => {
      if (String(url).includes("registry.npmjs.org")) {
        return new Response("Service Unavailable", { status: 503 });
      }
      if (String(url).includes("raw.githubusercontent.com")) {
        return new Response(JSON.stringify({ version: "0.6.0" }), { status: 200 });
      }
      return new Response("Not Found", { status: 404 });
    };

    const result = await resolveLatestVersion("0.5.1", mockFetch);
    expect(result.version).toBe("0.6.0");
    expect(result.source).toBe("github");
  });

  test("returns static version when all network checks fail", async () => {
    const mockFetch: FetchLike = async () => {
      throw new Error("Network offline");
    };

    const result = await resolveLatestVersion("0.6.0", mockFetch);
    expect(result.version).toBe("0.6.0");
    expect(result.source).toBe("static");
  });
});
