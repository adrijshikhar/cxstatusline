import { createHash } from "node:crypto";
import { createReadStream, existsSync, renameSync } from "node:fs";
import { open } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Context } from "../context";

/** Where the public assets live. Only the prefix is configurable, and only for tests. */
const PUBLIC_BASE = "https://github.com/adrijshikhar/cxstatusline/releases/download";
const REPO = "adrijshikhar/cxstatusline";

const MAX_REDIRECTS = 5;
export const CONNECT_TIMEOUT_MS = 30_000;
export const STREAM_IDLE_TIMEOUT_MS = 30_000;
export const MAX_TRANSFER_TIMEOUT_MS = 600_000;
export const MAX_RETRIES = 3;
/**
 * `gh release download` has to move a whole archive, so it gets far longer than an HTTP request -
 * but it still gets a bound. Without one, a stalled transfer hangs the install (and, through the
 * SessionStart hook, a background install) forever.
 */
const GH_TIMEOUT_MS = 600_000;
const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);

/** Asset size ceilings. Nothing in the release can raise them. */
export const MANIFEST_MAX_BYTES = 1024 * 1024;
export const ARCHIVE_MAX_BYTES = 1024 * 1024 * 1024;

/**
 * The only injection points. `baseUrl` lets tests point at a loopback `node:http` server - and is
 * the *sole* reason plain http is ever acceptable.
 */
export interface TransportOptions {
  /** Structural, not `typeof fetch`: a plain stub must satisfy it under every runtime's lib types. */
  readonly fetch?: FetchLike;
  readonly baseUrl?: string;
  readonly onProgress?: (loaded: number, total: number | null) => void;
  readonly onStatus?: (phase: string, message: string) => void;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface Downloaded {
  readonly sha256: string;
  readonly size: number;
}

/**
 * The release/asset genuinely does not exist for this repo (public 404, and `gh` also reports
 * not-found or access-denied). This is the ONLY error that may drive the hook's 24h backoff and
 * "no prebuilt pair is published yet" wording - every other failure below is a real problem that
 * a retry-tomorrow would only repeat.
 */
export class ReleaseUnavailableError extends Error {
  readonly kind = "release-unavailable" as const;
}

/** `gh` is not on PATH. A tooling problem, not "unavailable". */
export class GhMissingError extends Error {
  readonly kind = "gh-missing" as const;
}

/** `gh` is installed but not authenticated. A tooling problem, not "unavailable". */
export class GhAuthError extends Error {
  readonly kind = "gh-auth" as const;
}

/**
 * Untrusted text (a server body, gh's stderr) reaches a message only through here: first line,
 * no control characters, no query-bearing URLs, 200 characters at most.
 */
export function sanitize(text: string): string {
  const firstLine = text.split("\n", 1)[0] ?? "";
  return firstLine
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/https?:\/\/\S*\?\S*/g, "<url>")
    .trim()
    .slice(0, 200);
}

function assetUrl(base: string, tag: string, asset: string): string {
  return `${base}/${encodeURIComponent(tag)}/${encodeURIComponent(asset)}`;
}

/** A redirect may only move within the schemes we started with; http only under `baseUrl`. */
function nextUrl(current: string, location: string, allowHttp: boolean, asset: string): string {
  let resolved: URL;
  try {
    resolved = new URL(location, current);
  } catch {
    throw new Error(`download of ${asset} was redirected to an unusable location`);
  }
  const allowed = allowHttp ? ["https:", "http:"] : ["https:"];
  if (!allowed.includes(resolved.protocol)) {
    throw new Error(`download of ${asset} was redirected to a ${resolved.protocol} URL and was refused`);
  }
  return resolved.toString();
}

async function hashExistingFile(
  file: string,
  maxBytes: number,
  asset: string,
): Promise<{ hash: ReturnType<typeof createHash>; size: number }> {
  const hash = createHash("sha256");
  let size = 0;
  for await (const chunk of createReadStream(file)) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > maxBytes) throw new Error(`${asset} is larger than the ${maxBytes}-byte limit`);
    hash.update(buf);
  }
  return { hash, size };
}

/** Stream a response body to `dest`, hashing as it goes and refusing to exceed `maxBytes`. */
async function streamToFile(
  response: Response,
  dest: string,
  maxBytes: number,
  asset: string,
  isPartial: boolean,
  existingSize: number,
  existingHash: ReturnType<typeof createHash> | null,
  onProgress?: (loaded: number, total: number | null) => void,
  resetIdleTimer?: () => void,
): Promise<Downloaded> {
  const body = response.body;
  if (body === null) throw new Error(`download of ${asset} produced no body`);

  let expectedTotal: number | null = null;
  if (isPartial) {
    const rangeHeader = response.headers.get("content-range");
    const match = rangeHeader?.match(/\/(\d+)$/);
    if (match && match[1]) {
      expectedTotal = Number(match[1]);
    } else {
      const declaredPart = response.headers.get("content-length");
      if (declaredPart !== null && Number.isSafeInteger(Number(declaredPart))) {
        expectedTotal = existingSize + Number(declaredPart);
      }
    }
  } else {
    const declared = response.headers.get("content-length");
    expectedTotal = declared === null ? null : Number(declared);
  }

  if (expectedTotal !== null && (!Number.isSafeInteger(expectedTotal) || expectedTotal < 0 || expectedTotal > maxBytes)) {
    throw new Error(`${asset} is larger than the ${maxBytes}-byte limit`);
  }

  const hash = isPartial && existingHash ? existingHash : createHash("sha256");
  let size = isPartial ? existingSize : 0;
  const mode = isPartial ? "a" : "w";
  const handle = await open(dest, mode, 0o600);
  try {
    const reader = body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      resetIdleTimer?.();
      size += value.length;
      if (size > maxBytes) throw new Error(`${asset} is larger than the ${maxBytes}-byte limit`);
      hash.update(value);
      await handle.write(value);
      onProgress?.(size, expectedTotal);
    }
  } finally {
    await handle.close();
  }
  if (expectedTotal !== null && size !== expectedTotal) {
    throw new Error(`download of ${asset} was truncated at ${size} of ${expectedTotal} bytes`);
  }
  return { sha256: hash.digest("hex"), size };
}

function isRetryableError(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  if (e.name === "AssertionError" || e.constructor?.name === "AssertionError") return false;
  const msg = e.message;
  if (
    msg.includes("limit") ||
    msg.includes("redirected to a") ||
    msg.includes("exceeded") ||
    msg.includes("truncated") ||
    msg.includes("HTTP ")
  ) {
    return false;
  }
  return true;
}

async function singleHttpDownload(
  start: string,
  asset: string,
  dest: string,
  maxBytes: number,
  opts: TransportOptions,
): Promise<Downloaded | "not-found" | "retry-from-zero"> {
  const request = opts.fetch ?? globalThis.fetch;
  const allowHttp = opts.baseUrl !== undefined;
  let url = start;

  let existingBytes = 0;
  let existingHash: ReturnType<typeof createHash> | null = null;
  if (existsSync(dest)) {
    try {
      const stat = await open(dest, "r").then(async (h) => {
        const s = await h.stat();
        await h.close();
        return s;
      });
      if (stat.size > 0 && stat.size < maxBytes) {
        const hashed = await hashExistingFile(dest, maxBytes, asset);
        existingBytes = hashed.size;
        existingHash = hashed.hash;
      }
    } catch {
      existingBytes = 0;
      existingHash = null;
    }
  }

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const controller = new AbortController();
    let idleTimer: ReturnType<typeof setTimeout> | undefined;

    const resetIdleTimer = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        controller.abort(new Error(`download of ${asset} stalled: no data received for 30s`));
      }, STREAM_IDLE_TIMEOUT_MS);
    };

    const maxTransferTimer = setTimeout(() => {
      controller.abort(new Error(`download of ${asset} exceeded the maximum transfer timeout of 10m`));
    }, MAX_TRANSFER_TIMEOUT_MS);

    const clearTimers = () => {
      if (idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = undefined;
      }
      clearTimeout(maxTransferTimer);
    };

    idleTimer = setTimeout(() => {
      controller.abort(new Error(`download of ${asset} timed out connecting`));
    }, CONNECT_TIMEOUT_MS);

    const headers: Record<string, string> = { accept: "application/octet-stream" };
    if (existingBytes > 0) {
      headers["range"] = `bytes=${existingBytes}-`;
    }

    let response: Response;
    try {
      response = await request(url, {
        redirect: "manual",
        signal: controller.signal,
        headers,
      });
    } catch (e) {
      clearTimers();
      throw e;
    }

    if (REDIRECT_STATUS.has(response.status)) {
      clearTimers();
      const location = response.headers.get("location");
      if (location === null) throw new Error(`download of ${asset} was redirected without a location`);
      url = nextUrl(url, location, allowHttp, asset);
      continue;
    }
    if (response.status === 404) {
      clearTimers();
      return "not-found";
    }
    if (response.status === 416) {
      clearTimers();
      try {
        const h = await open(dest, "w", 0o600);
        await h.close();
      } catch {}
      return "retry-from-zero";
    }
    if (!response.ok && response.status !== 206) {
      clearTimers();
      throw new Error(`download of ${asset} failed with HTTP ${response.status}`);
    }

    const isPartial = response.status === 206;
    try {
      resetIdleTimer();
      const result = await streamToFile(
        response,
        dest,
        maxBytes,
        asset,
        isPartial,
        existingBytes,
        existingHash,
        opts.onProgress,
        resetIdleTimer,
      );
      return result;
    } finally {
      clearTimers();
    }
  }
  throw new Error(`download of ${asset} exceeded ${MAX_REDIRECTS} redirects`);
}

/** Public HTTPS download. Returns "not-found" for a 404 so the caller can try `gh`. */
async function httpDownload(
  start: string,
  asset: string,
  dest: string,
  maxBytes: number,
  opts: TransportOptions,
): Promise<Downloaded | "not-found"> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delayMs = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
      await new Promise((r) => setTimeout(r, delayMs));
    }
    try {
      const res = await singleHttpDownload(start, asset, dest, maxBytes, opts);
      if (res === "retry-from-zero") {
        const retryRes = await singleHttpDownload(start, asset, dest, maxBytes, opts);
        if (retryRes !== "retry-from-zero") return retryRes;
        continue;
      }
      return res;
    } catch (e) {
      lastError = e;
      if (!isRetryableError(e)) {
        throw e;
      }
    }
  }
  throw lastError;
}

async function hashFile(file: string, maxBytes: number, asset: string): Promise<Downloaded> {
  const { hash, size } = await hashExistingFile(file, maxBytes, asset);
  return { sha256: hash.digest("hex"), size };
}

/**
 * Authenticated fallback for a release that is not public. `gh` owns the credentials: no token
 * environment variable is ever read here, and the failure modes are reported apart, because a
 * public 404 alone never proves a release is private.
 */
async function ghDownload(
  ctx: Context,
  tag: string,
  asset: string,
  dest: string,
  maxBytes: number,
): Promise<Downloaded> {
  if (ctx.which("gh") === null) {
    throw new GhMissingError(`${asset} is not public for release ${tag} and GitHub CLI (gh) is not installed`);
  }
  const targetDir = dirname(dest);
  const result = ctx.run(
    "gh",
    ["release", "download", tag, "--repo", REPO, "--pattern", asset, "--dir", targetDir],
    { timeoutMs: GH_TIMEOUT_MS },
  );
  if (result.status !== 0) {
    const detail = sanitize(result.stderr || result.stdout);
    if (/auth|logged in|log in|login|credential/i.test(detail)) {
      throw new GhAuthError(`gh is not logged in, so release ${tag} could not be read: ${detail}`);
    }
    throw new ReleaseUnavailableError(`release ${tag} not found or access denied: ${detail}`);
  }
  const downloadedFile = join(targetDir, asset);
  if (!existsSync(downloadedFile) && !existsSync(dest)) {
    throw new ReleaseUnavailableError(`release ${tag} not found or access denied: gh downloaded no ${asset}`);
  }
  if (existsSync(downloadedFile) && downloadedFile !== dest) {
    renameSync(downloadedFile, dest);
  }
  return await hashFile(dest, maxBytes, asset);
}

/**
 * Fetch one release asset to `dest`, public path first and `gh` only on a 404.
 * Returns the streamed digest and byte count; the URL itself is never persisted or reported.
 */
export async function downloadAsset(
  ctx: Context,
  tag: string,
  asset: string,
  dest: string,
  maxBytes: number,
  opts: TransportOptions = {},
): Promise<Downloaded> {
  const url = assetUrl(opts.baseUrl ?? PUBLIC_BASE, tag, asset);
  const downloaded = await httpDownload(url, asset, dest, maxBytes, opts);
  if (downloaded !== "not-found") return downloaded;
  return await ghDownload(ctx, tag, asset, dest, maxBytes);
}
