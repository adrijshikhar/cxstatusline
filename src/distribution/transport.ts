import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { open } from "node:fs/promises";
import { dirname } from "node:path";
import type { Context } from "../context";

/** Where the public assets live. Only the prefix is configurable, and only for tests. */
const PUBLIC_BASE = "https://github.com/adrijshikhar/cxstatusline/releases/download";
const REPO = "adrijshikhar/cxstatusline";

const MAX_REDIRECTS = 5;
const REQUEST_TIMEOUT_MS = 60_000;
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
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface Downloaded {
  readonly sha256: string;
  readonly size: number;
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

/** Stream a response body to `dest`, hashing as it goes and refusing to exceed `maxBytes`. */
async function streamToFile(response: Response, dest: string, maxBytes: number, asset: string): Promise<Downloaded> {
  const declared = response.headers.get("content-length");
  const expected = declared === null ? null : Number(declared);
  if (expected !== null && (!Number.isSafeInteger(expected) || expected < 0 || expected > maxBytes)) {
    throw new Error(`${asset} is larger than the ${maxBytes}-byte limit`);
  }
  const body = response.body;
  if (body === null) throw new Error(`download of ${asset} produced no body`);

  const hash = createHash("sha256");
  let size = 0;
  const handle = await open(dest, "wx", 0o600);
  try {
    const reader = body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) throw new Error(`${asset} is larger than the ${maxBytes}-byte limit`);
      hash.update(value);
      await handle.write(value);
    }
  } finally {
    await handle.close();
  }
  if (expected !== null && size !== expected) {
    throw new Error(`download of ${asset} was truncated at ${size} of ${expected} bytes`);
  }
  return { sha256: hash.digest("hex"), size };
}

/** Public HTTPS download. Returns "not-found" for a 404 so the caller can try `gh`. */
async function httpDownload(
  start: string,
  asset: string,
  dest: string,
  maxBytes: number,
  opts: TransportOptions,
): Promise<Downloaded | "not-found"> {
  const request = opts.fetch ?? globalThis.fetch;
  const allowHttp = opts.baseUrl !== undefined;
  let url = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const response = await request(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { accept: "application/octet-stream" },
    });
    if (REDIRECT_STATUS.has(response.status)) {
      const location = response.headers.get("location");
      if (location === null) throw new Error(`download of ${asset} was redirected without a location`);
      url = nextUrl(url, location, allowHttp, asset);
      continue;
    }
    if (response.status === 404) return "not-found";
    if (!response.ok) throw new Error(`download of ${asset} failed with HTTP ${response.status}`);
    return await streamToFile(response, dest, maxBytes, asset);
  }
  throw new Error(`download of ${asset} exceeded ${MAX_REDIRECTS} redirects`);
}

async function hashFile(file: string, maxBytes: number, asset: string): Promise<Downloaded> {
  const hash = createHash("sha256");
  let size = 0;
  for await (const chunk of createReadStream(file)) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > maxBytes) throw new Error(`${asset} is larger than the ${maxBytes}-byte limit`);
    hash.update(buf);
  }
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
    throw new Error(`${asset} is not public for release ${tag} and GitHub CLI (gh) is not installed`);
  }
  const result = ctx.run("gh", ["release", "download", tag, "--repo", REPO, "--pattern", asset, "--dir", dirname(dest)]);
  if (result.status !== 0) {
    const detail = sanitize(result.stderr || result.stdout);
    if (/auth|logged in|log in|login|credential/i.test(detail)) {
      throw new Error(`gh is not logged in, so release ${tag} could not be read: ${detail}`);
    }
    throw new Error(`release ${tag} not found or access denied: ${detail}`);
  }
  if (!existsSync(dest)) throw new Error(`release ${tag} not found or access denied: gh downloaded no ${asset}`);
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
