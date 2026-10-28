import { describe, expect, test } from "bun:test";
import { selectStableVersion } from "../scripts/prebuilt/detect";
import {
  fetchUpstreamReleases,
  UpstreamDiscoveryError,
  type UpstreamReleaseEntry,
  type UpstreamRunners,
} from "../scripts/prebuilt/upstream";

describe("fetchUpstreamReleases", () => {
  describe("Layer 1: direct HTTP fetch", () => {
    test("succeeds on first attempt with 200 OK and parses releases", async () => {
      const mockReleases: UpstreamReleaseEntry[] = [
        { tag_name: "rust-v0.165.0", draft: false, prerelease: false },
        { tag_name: "rust-v0.164.0", draft: false, prerelease: false },
      ];

      let requestedUrl = "";
      let authHeader = "";
      const runners: UpstreamRunners = {
        fetchFn: (async (url: string | URL | Request, init?: RequestInit) => {
          requestedUrl = String(url);
          authHeader = (init?.headers as Record<string, string>)?.authorization ?? "";
          return new Response(JSON.stringify(mockReleases), { status: 200 });
        }) as unknown as typeof fetch,
        ghRunner: () => {
          throw new Error("ghRunner should not be called on Layer 1 success");
        },
        execRunner: () => {
          throw new Error("execRunner should not be called on Layer 1 success");
        },
      };

      const result = await fetchUpstreamReleases("test-token-123", { perPage: 30 }, runners);

      expect(result).toEqual(mockReleases);
      expect(requestedUrl).toBe("https://api.github.com/repos/openai/codex/releases?per_page=30");
      expect(authHeader).toBe("Bearer test-token-123");
    });

    test("retries on 504 Gateway Timeout with backoff delays of 1000ms, 2000ms, 3000ms (4 attempts total)", async () => {
      let attempts = 0;
      const delays: number[] = [];

      const runners: UpstreamRunners = {
        fetchFn: (async () => {
          attempts++;
          if (attempts <= 3) {
            return new Response("Gateway Timeout", { status: 504, statusText: "Gateway Timeout" });
          }
          return new Response(JSON.stringify([{ tag_name: "rust-v0.165.0" }]), { status: 200 });
        }) as unknown as typeof fetch,
        sleepFn: async (ms) => {
          delays.push(ms);
        },
      };

      const result = await fetchUpstreamReleases(undefined, { maxRetries: 3, retryDelayMs: 1000 }, runners);

      expect(attempts).toBe(4);
      expect(delays).toEqual([1000, 2000, 3000]);
      expect(result).toEqual([{ tag_name: "rust-v0.165.0" }]);
    });

    test("retries on 500 and 429 status codes", async () => {
      let attempts = 0;
      const delays: number[] = [];

      const runners: UpstreamRunners = {
        fetchFn: (async () => {
          attempts++;
          if (attempts === 1) {
            return new Response("Internal Server Error", { status: 500, statusText: "Internal Server Error" });
          }
          if (attempts === 2) {
            return new Response("Too Many Requests", { status: 429, statusText: "Too Many Requests" });
          }
          return new Response(JSON.stringify([{ tag_name: "rust-v0.165.0" }]), { status: 200 });
        }) as unknown as typeof fetch,
        sleepFn: async (ms) => {
          delays.push(ms);
        },
      };

      const result = await fetchUpstreamReleases(undefined, { maxRetries: 3, retryDelayMs: 500 }, runners);

      expect(attempts).toBe(3);
      expect(delays).toEqual([500, 1000]);
      expect(result).toEqual([{ tag_name: "rust-v0.165.0" }]);
    });

    test("retries on network exception (e.g. connection reset)", async () => {
      let attempts = 0;
      const delays: number[] = [];

      const runners: UpstreamRunners = {
        fetchFn: (async () => {
          attempts++;
          if (attempts === 1) {
            throw new TypeError("fetch failed: socket hang up");
          }
          return new Response(JSON.stringify([{ tag_name: "rust-v0.165.0" }]), { status: 200 });
        }) as unknown as typeof fetch,
        sleepFn: async (ms) => {
          delays.push(ms);
        },
      };

      const result = await fetchUpstreamReleases(undefined, { maxRetries: 2, retryDelayMs: 200 }, runners);

      expect(attempts).toBe(2);
      expect(delays).toEqual([200]);
      expect(result).toEqual([{ tag_name: "rust-v0.165.0" }]);
    });

    test("falls back immediately to Layer 2 on non-retryable 4xx client errors without retrying", async () => {
      let fetchAttempts = 0;
      let sleepCalled = false;
      let ghCalledWith: string[] = [];

      const runners: UpstreamRunners = {
        fetchFn: (async () => {
          fetchAttempts++;
          return new Response("Not Found", { status: 404, statusText: "Not Found" });
        }) as unknown as typeof fetch,
        sleepFn: async () => {
          sleepCalled = true;
        },
        ghRunner: (args) => {
          ghCalledWith = args;
          return {
            status: 0,
            stdout: JSON.stringify([{ tag_name: "rust-v0.164.0", draft: false, prerelease: false }]),
            stderr: "",
          };
        },
      };

      const result = await fetchUpstreamReleases(undefined, { maxRetries: 3, perPage: 30 }, runners);

      expect(fetchAttempts).toBe(1);
      expect(sleepCalled).toBe(false);
      expect(ghCalledWith).toEqual(["api", "repos/openai/codex/releases?per_page=30"]);
      expect(result).toEqual([{ tag_name: "rust-v0.164.0", draft: false, prerelease: false }]);
    });
  });

  describe("Layer 2: gh api CLI fallback", () => {
    test("falls back to gh api when Layer 1 exhausts all retries", async () => {
      let fetchAttempts = 0;
      let ghCalledWith: string[] = [];
      const delays: number[] = [];

      const runners: UpstreamRunners = {
        fetchFn: (async () => {
          fetchAttempts++;
          return new Response("Gateway Timeout", { status: 504, statusText: "Gateway Timeout" });
        }) as unknown as typeof fetch,
        sleepFn: async (ms) => {
          delays.push(ms);
        },
        ghRunner: (args) => {
          ghCalledWith = args;
          return {
            status: 0,
            stdout: JSON.stringify([
              { tag_name: "rust-v0.165.0", draft: false, prerelease: false },
            ]),
            stderr: "",
          };
        },
        execRunner: () => {
          throw new Error("execRunner should not be called when Layer 2 succeeds");
        },
      };

      const result = await fetchUpstreamReleases(undefined, { maxRetries: 3, retryDelayMs: 1000, perPage: 30 }, runners);

      expect(fetchAttempts).toBe(4); // 1 initial + 3 retries
      expect(delays).toEqual([1000, 2000, 3000]);
      expect(ghCalledWith).toEqual(["api", "repos/openai/codex/releases?per_page=30"]);
      expect(result).toEqual([{ tag_name: "rust-v0.165.0", draft: false, prerelease: false }]);
    });

    test("respects custom perPage option across Layer 1 and Layer 2", async () => {
      let requestedUrl = "";
      let ghArgs: string[] = [];

      const runners: UpstreamRunners = {
        fetchFn: (async (url: string | URL | Request) => {
          requestedUrl = String(url);
          return new Response("Bad Request", { status: 400, statusText: "Bad Request" });
        }) as unknown as typeof fetch,
        ghRunner: (args) => {
          ghArgs = args;
          return {
            status: 0,
            stdout: JSON.stringify([{ tag_name: "rust-v0.165.0" }]),
            stderr: "",
          };
        },
      };

      await fetchUpstreamReleases(undefined, { perPage: 25 }, runners);

      expect(requestedUrl).toBe("https://api.github.com/repos/openai/codex/releases?per_page=25");
      expect(ghArgs).toEqual(["api", "repos/openai/codex/releases?per_page=25"]);
    });
  });

  describe("Layer 3: git ls-remote fallback", () => {
    test("falls back to git ls-remote when Layer 1 and Layer 2 fail", async () => {
      let execCmd = "";
      let execArgs: string[] = [];

      const runners: UpstreamRunners = {
        fetchFn: (async () => {
          throw new Error("network down");
        }) as unknown as typeof fetch,
        sleepFn: async () => {},
        ghRunner: () => ({
          status: 1,
          stdout: "",
          stderr: "gh: command not found",
        }),
        execRunner: (cmd, args) => {
          execCmd = cmd;
          execArgs = args;
          const gitOutput = [
            "d14a028c2a3a2bc9476102bb288234c41559843d\trefs/tags/rust-v0.165.0",
            "d14a028c2a3a2bc9476102bb288234c41559843d\trefs/tags/rust-v0.165.0^{}",
          ].join("\n");
          return { status: 0, stdout: gitOutput, stderr: "" };
        },
      };

      const result = await fetchUpstreamReleases(undefined, { maxRetries: 0 }, runners);

      expect(execCmd).toBe("git");
      expect(execArgs).toEqual(["ls-remote", "--tags", "https://github.com/openai/codex.git", "rust-v*"]);
      expect(result).toEqual([
        { tag_name: "rust-v0.165.0", draft: false, prerelease: false },
      ]);
    });

    test("respects custom gitUrl option", async () => {
      let execArgs: string[] = [];

      const runners: UpstreamRunners = {
        fetchFn: (async () => {
          throw new Error("fetch failed");
        }) as unknown as typeof fetch,
        sleepFn: async () => {},
        ghRunner: () => ({ status: 1, stdout: "", stderr: "failed" }),
        execRunner: (_cmd, args) => {
          execArgs = args;
          return {
            status: 0,
            stdout: "hash123\trefs/tags/rust-v0.165.0\n",
            stderr: "",
          };
        },
      };

      await fetchUpstreamReleases(
        undefined,
        { maxRetries: 0, gitUrl: "https://github.com/my-fork/codex.git" },
        runners
      );

      expect(execArgs).toEqual(["ls-remote", "--tags", "https://github.com/my-fork/codex.git", "rust-v*"]);
    });

    test("correctly parses Git ref output, ignores dereferences (^{}), and detects prereleases", async () => {
      const gitOutput = [
        "hash1\trefs/tags/rust-v0.164.0",
        "hash1\trefs/tags/rust-v0.164.0^{}",
        "hash2\trefs/tags/rust-v0.165.0-alpha.1",
        "hash2\trefs/tags/rust-v0.165.0-alpha.1^{}",
        "hash3\trefs/tags/rust-v0.165.0-beta.2",
        "hash4\trefs/tags/rust-v0.165.0-rc.1",
        "hash5\trefs/tags/rust-v0.165.0",
        "hash5\trefs/tags/rust-v0.165.0^{}",
        "hash6\trefs/tags/other-tag",
      ].join("\n");

      const runners: UpstreamRunners = {
        fetchFn: (async () => {
          throw new Error("network error");
        }) as unknown as typeof fetch,
        sleepFn: async () => {},
        ghRunner: () => ({ status: 1, stdout: "", stderr: "error" }),
        execRunner: () => ({ status: 0, stdout: gitOutput, stderr: "" }),
      };

      const result = await fetchUpstreamReleases(undefined, { maxRetries: 0 }, runners);

      expect(result).toEqual([
        { tag_name: "rust-v0.164.0", draft: false, prerelease: false },
        { tag_name: "rust-v0.165.0-alpha.1", draft: false, prerelease: true },
        { tag_name: "rust-v0.165.0-beta.2", draft: false, prerelease: true },
        { tag_name: "rust-v0.165.0-rc.1", draft: false, prerelease: true },
        { tag_name: "rust-v0.165.0", draft: false, prerelease: false },
        { tag_name: "other-tag", draft: false, prerelease: false },
      ]);
    });
  });

  describe("Error aggregation and diagnostics", () => {
    test("throws UpstreamDiscoveryError with diagnostic messages when all 3 layers fail", async () => {
      const runners: UpstreamRunners = {
        fetchFn: (async () => {
          return new Response("Gateway Timeout", { status: 504, statusText: "Gateway Timeout" });
        }) as unknown as typeof fetch,
        sleepFn: async () => {},
        ghRunner: () => ({
          status: 1,
          stdout: "",
          stderr: "gh: command not found",
        }),
        execRunner: () => ({
          status: 128,
          stdout: "",
          stderr: "fatal: could not read Username for 'https://github.com'",
        }),
      };

      let caughtError: unknown;
      try {
        await fetchUpstreamReleases(undefined, { maxRetries: 1, retryDelayMs: 10 }, runners);
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).toBeInstanceOf(UpstreamDiscoveryError);
      const discoveryErr = caughtError as UpstreamDiscoveryError;
      expect(discoveryErr.message).toContain("Failed to discover upstream releases across all 3 layers");
      expect(discoveryErr.message).toContain("HTTP 504");
      expect(discoveryErr.message).toContain("gh: command not found");
      expect(discoveryErr.message).toContain("fatal: could not read Username");
      expect(discoveryErr.errors).toHaveLength(3);
    });
    test("redacts sensitive tokens in subprocess stderr output", async () => {
      const runners: UpstreamRunners = {
        fetchFn: (async () => {
          throw new Error("fetch down");
        }) as unknown as typeof fetch,
        sleepFn: async () => {},
        ghRunner: () => ({ status: 1, stdout: "", stderr: "error with token ghp_1234567890abcdef12345678" }),
        execRunner: () => ({ status: 1, stdout: "", stderr: "error with token ghp_0987654321fedcba09876543" }),
      };

      try {
        await fetchUpstreamReleases(undefined, { maxRetries: 0 }, runners);
        expect.unreachable("should have thrown UpstreamDiscoveryError");
      } catch (err) {
        expect(err).toBeInstanceOf(UpstreamDiscoveryError);
        const e = err as UpstreamDiscoveryError;
        expect(e.message).not.toContain("ghp_1234567890abcdef12345678");
        expect(e.message).not.toContain("ghp_0987654321fedcba09876543");
        expect(e.message).toContain("[redacted-token]");
      }
    });
  });

  describe("Integration with selectStableVersion", () => {
    test("synthesized Layer 3 entries work cleanly with selectStableVersion()", async () => {
      const gitOutput = [
        "hash1\trefs/tags/rust-v0.164.0",
        "hash1\trefs/tags/rust-v0.164.0^{}",
        "hash2\trefs/tags/rust-v0.165.0-alpha.1",
        "hash3\trefs/tags/rust-v0.165.0-rc.1",
        "hash4\trefs/tags/rust-v0.165.0",
        "hash4\trefs/tags/rust-v0.165.0^{}",
        "hash5\trefs/tags/other-v1.0.0",
      ].join("\n");

      const runners: UpstreamRunners = {
        fetchFn: (async () => {
          throw new Error("fetch down");
        }) as unknown as typeof fetch,
        sleepFn: async () => {},
        ghRunner: () => ({ status: 1, stdout: "", stderr: "gh down" }),
        execRunner: () => ({ status: 0, stdout: gitOutput, stderr: "" }),
      };

      const entries = await fetchUpstreamReleases(undefined, { maxRetries: 0 }, runners);
      const chosen = selectStableVersion(entries);

      expect(chosen).toBe("0.165.0");
    });

    test("Layer 1 entries work cleanly with selectStableVersion()", async () => {
      const rawApiReleases = [
        { tag_name: "rust-v0.164.0", draft: false, prerelease: false },
        { tag_name: "rust-v0.165.0-rc.1", draft: false, prerelease: true },
        { tag_name: "rust-v0.165.0", draft: false, prerelease: false },
        { tag_name: "rust-v0.166.0-draft", draft: true, prerelease: false },
      ];

      const runners: UpstreamRunners = {
        fetchFn: (async () => {
          return new Response(JSON.stringify(rawApiReleases), { status: 200 });
        }) as unknown as typeof fetch,
      };

      const entries = await fetchUpstreamReleases(undefined, undefined, runners);
      const chosen = selectStableVersion(entries);

      expect(chosen).toBe("0.165.0");
    });
  });
});
