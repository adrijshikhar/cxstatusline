import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { downloadAsset, type FetchLike, type TransportOptions } from "../src/distribution/transport";
import type { Context } from "../src/context";
import { resolvePaths } from "../src/paths";

function testCtx(prefix = "cx-transport-test-"): { ctx: Context; root: string } {
  const root = join(tmpdir(), `${prefix}${Math.random().toString(36).slice(2)}`);
  mkdirSync(root, { recursive: true });
  const paths = resolvePaths({ HOME: root });
  const ctx: Context = {
    env: { HOME: root },
    paths,
    run: () => ({ status: 0, stdout: "", stderr: "" }),
    which: () => null,
    freeBytes: () => 10 * 1024 * 1024 * 1024,
    cxBin: join(paths.binDir, "cxstatusline"),
    patchesDir: join(root, "patches"),
    now: () => new Date(),
    log: () => {},
    say: () => {},
  };
  return { ctx, root };
}

describe("downloadAsset transport resilience", () => {
  test("downloads a full file when no existing partial file exists (HTTP 200)", async () => {
    const { ctx, root } = testCtx();
    const dest = join(root, "archive.tar.gz");
    const content = Buffer.from("hello cxstatusline world! full archive content here.");
    const expectedSha = createHash("sha256").update(content).digest("hex");

    const stubFetch: FetchLike = async () =>
      new Response(content, {
        status: 200,
        headers: { "content-length": String(content.length) },
      });

    const result = await downloadAsset(ctx, "v0.155.1", "archive.tar.gz", dest, 1024 * 1024, {
      fetch: stubFetch,
      baseUrl: "https://example.com/releases",
    });

    expect(result.size).toBe(content.length);
    expect(result.sha256).toBe(expectedSha);
    expect(readFileSync(dest)).toEqual(content);
    rmSync(root, { recursive: true, force: true });
  });

  test("resumes from existing bytes when server returns HTTP 206 Partial Content", async () => {
    const { ctx, root } = testCtx();
    const dest = join(root, "archive.tar.gz");
    const fullContent = Buffer.from("ABCDEFGHIJ" + "KLMNOPQRST" + "UVWXYZ1234");
    const part1 = fullContent.subarray(0, 10); // First 10 bytes already on disk
    const part2 = fullContent.subarray(10); // Remaining 20 bytes from server

    // Write partial bytes to dest
    writeFileSync(dest, part1);
    expect(statSync(dest).size).toBe(10);

    let requestedRange: string | null = null;
    const stubFetch: FetchLike = async (_url, init) => {
      const headers = new Headers(init?.headers);
      requestedRange = headers.get("range");
      return new Response(part2, {
        status: 206,
        headers: {
          "content-range": `bytes 10-${fullContent.length - 1}/${fullContent.length}`,
          "content-length": String(part2.length),
        },
      });
    };

    const progressReports: number[] = [];
    const result = await downloadAsset(ctx, "v0.155.1", "archive.tar.gz", dest, 1024 * 1024, {
      fetch: stubFetch,
      baseUrl: "https://example.com/releases",
      onProgress: (loaded) => progressReports.push(loaded),
    });

    // Sent range header requesting remaining bytes
    expect<string | null>(requestedRange).toBe("bytes=10-");
    // Completed full file
    expect(result.size).toBe(fullContent.length);
    expect(result.sha256).toBe(createHash("sha256").update(fullContent).digest("hex"));
    expect(readFileSync(dest)).toEqual(fullContent);
    // Progress updated with cumulative total
    expect(progressReports.some((p) => p === fullContent.length)).toBe(true);

    rmSync(root, { recursive: true, force: true });
  });

  test("resets and downloads from 0 if server returns HTTP 200 instead of 206 for Range", async () => {
    const { ctx, root } = testCtx();
    const dest = join(root, "archive.tar.gz");
    const fullContent = Buffer.from("NEW-FULL-CONTENT-FROM-SERVER");

    // Write stale partial bytes
    writeFileSync(dest, Buffer.from("OLD-CORRUPT-BYTES"));

    const stubFetch: FetchLike = async () =>
      new Response(fullContent, {
        status: 200,
        headers: { "content-length": String(fullContent.length) },
      });

    const result = await downloadAsset(ctx, "v0.155.1", "archive.tar.gz", dest, 1024 * 1024, {
      fetch: stubFetch,
      baseUrl: "https://example.com/releases",
    });

    expect(result.size).toBe(fullContent.length);
    expect(result.sha256).toBe(createHash("sha256").update(fullContent).digest("hex"));
    expect(readFileSync(dest)).toEqual(fullContent);

    rmSync(root, { recursive: true, force: true });
  });

  test("resets and retries from 0 if server returns HTTP 416 Range Not Satisfiable", async () => {
    const { ctx, root } = testCtx();
    const dest = join(root, "archive.tar.gz");
    const fullContent = Buffer.from("CONTENT-AFTER-416");

    // Write invalid partial bytes larger than file
    writeFileSync(dest, Buffer.from("EXCESSIVE-BYTES-CAUSING-416"));

    let callCount = 0;
    const stubFetch: FetchLike = async (_url, init) => {
      callCount++;
      const headers = new Headers(init?.headers);
      if (headers.has("range") && callCount === 1) {
        return new Response("Range Not Satisfiable", { status: 416 });
      }
      return new Response(fullContent, {
        status: 200,
        headers: { "content-length": String(fullContent.length) },
      });
    };

    const result = await downloadAsset(ctx, "v0.155.1", "archive.tar.gz", dest, 1024 * 1024, {
      fetch: stubFetch,
      baseUrl: "https://example.com/releases",
    });

    expect(callCount).toBe(2);
    expect(result.size).toBe(fullContent.length);
    expect(result.sha256).toBe(createHash("sha256").update(fullContent).digest("hex"));
    expect(readFileSync(dest)).toEqual(fullContent);

    rmSync(root, { recursive: true, force: true });
  });

  test("retries and resumes on transient network error during stream", async () => {
    const { ctx, root } = testCtx();
    const dest = join(root, "archive.tar.gz");
    const part1 = Buffer.from("FIRST-CHUNK-RECEIVED-THEN-CRASH;");
    const part2 = Buffer.from("SECOND-CHUNK-RESUMED-CLEANLY.");
    const fullContent = Buffer.concat([part1, part2]);

    let attempt = 0;
    const stubFetch: FetchLike = async (_url, init) => {
      attempt++;
      const headers = new Headers(init?.headers);
      if (attempt === 1) {
        let sent = false;
        return new Response(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              if (!sent) {
                sent = true;
                controller.enqueue(part1);
              } else {
                controller.error(new Error("Connection reset by peer"));
              }
            },
          }),
          { status: 200, headers: { "content-length": String(fullContent.length) } },
        );
      }

      // Attempt 2: server gets Range request for part2
      expect(headers.get("range")).toBe(`bytes=${part1.length}-`);
      return new Response(part2, {
        status: 206,
        headers: {
          "content-range": `bytes ${part1.length}-${fullContent.length - 1}/${fullContent.length}`,
          "content-length": String(part2.length),
        },
      });
    };

    const result = await downloadAsset(ctx, "v0.155.1", "archive.tar.gz", dest, 1024 * 1024, {
      fetch: stubFetch,
      baseUrl: "https://example.com/releases",
    });

    expect(attempt).toBe(2);
    expect(result.size).toBe(fullContent.length);
    expect(result.sha256).toBe(createHash("sha256").update(fullContent).digest("hex"));
    expect(readFileSync(dest)).toEqual(fullContent);

    rmSync(root, { recursive: true, force: true });
  });
});
