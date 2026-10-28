/**
 * Resilient discovery of upstream Codex releases.
 *
 * Implements a 3-layer cascade:
 * 1. Direct HTTP fetch (per_page=30, up to 3 retries with exponential backoff on 5xx/429).
 * 2. `gh api` CLI fallback if direct fetch fails.
 * 3. Native `git ls-remote --tags` fallback if both REST endpoints fail.
 */
import { spawnSync } from "node:child_process";

export interface UpstreamReleaseEntry {
  readonly tag_name: string;
  readonly draft?: boolean;
  readonly prerelease?: boolean;
}

export interface FetchUpstreamOptions {
  readonly perPage?: number;           // Defaults to 30
  readonly maxRetries?: number;        // Defaults to 3
  readonly retryDelayMs?: number;      // Defaults to 1000
  readonly gitUrl?: string;            // Defaults to "https://github.com/openai/codex.git"
}

export interface UpstreamRunners {
  readonly fetchFn?: typeof fetch;
  readonly ghRunner?: (args: string[]) => { status: number; stdout: string; stderr: string };
  readonly execRunner?: (cmd: string, args: string[]) => { status: number; stdout: string; stderr: string };
  readonly sleepFn?: (ms: number) => Promise<void>;
}

export class UpstreamDiscoveryError extends Error {
  override readonly name = "UpstreamDiscoveryError";
  readonly errors: readonly Error[];

  constructor(message: string, errors: readonly Error[]) {
    super(message);
    this.errors = errors;
  }
}

const DEFAULT_PER_PAGE = 30;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY_MS = 1000;
const DEFAULT_GIT_URL = "https://github.com/openai/codex.git";
const FETCH_TIMEOUT_MS = 30_000;

export async function fetchUpstreamReleases(
  token?: string,
  options?: FetchUpstreamOptions,
  runners?: UpstreamRunners
): Promise<UpstreamReleaseEntry[]> {
  const perPage = options?.perPage ?? DEFAULT_PER_PAGE;
  const maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES;
  const retryDelayMs = options?.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  const gitUrl = options?.gitUrl ?? DEFAULT_GIT_URL;

  const effectiveToken = token ?? process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
  const sleep = runners?.sleepFn ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const fetchFn = runners?.fetchFn ?? globalThis.fetch;

  const defaultExecRunner = (cmd: string, args: string[]) => {
    const env = effectiveToken ? { ...process.env, GH_TOKEN: effectiveToken } : process.env;
    const r = spawnSync(cmd, args, { encoding: "utf8", env });
    if (r.error) {
      return { status: 1, stdout: "", stderr: r.error.message };
    }
    return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
  };

  const exec = runners?.execRunner ?? defaultExecRunner;
  const gh = runners?.ghRunner ?? ((args: string[]) => exec("gh", args));

  // --- Layer 1: Direct HTTP fetch ---
  const url = `https://api.github.com/repos/openai/codex/releases?per_page=${perPage}`;
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "user-agent": "cxstatusline-prebuilt",
  };
  if (effectiveToken) {
    headers.authorization = `Bearer ${effectiveToken}`;
  }

  let layer1Error: Error | undefined;
  for (let retry = 0; retry <= maxRetries; retry++) {
    try {
      const res = await fetchFn(url, {
        headers: {
          ...headers,
          connection: "close",
        },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });

      if (res.ok) {
        const data = await res.json();
        if (!Array.isArray(data)) {
          throw new Error("upstream release response is not a JSON array");
        }
        return data as UpstreamReleaseEntry[];
      }

      if (res.status >= 500 || res.status === 429) {
        layer1Error = new Error(`upstream HTTP ${res.status}: ${res.statusText || "Request failed"}`);
        if (retry < maxRetries) {
          const delay = retryDelayMs * (2 ** retry);
          await sleep(delay);
          continue;
        }
      } else {
        // Non-retryable 4xx error (e.g. 404, 403, 401)
        layer1Error = new Error(`upstream HTTP ${res.status}: ${res.statusText || "Non-retryable client error"}`);
        break;
      }
    } catch (err) {
      layer1Error = err instanceof Error ? err : new Error(String(err));
      if (retry < maxRetries) {
        const delay = retryDelayMs * (2 ** retry);
        await sleep(delay);
        continue;
      }
    }
  }

  // --- Layer 2: `gh api` CLI fallback ---
  let layer2Error: Error | undefined;
  try {
    const ghResult = gh(["api", `repos/openai/codex/releases?per_page=${perPage}`]);
    if (ghResult.status !== 0) {
      layer2Error = new Error(
        `gh api failed (exit ${ghResult.status}): ${ghResult.stderr.trim() || ghResult.stdout.trim() || "unknown error"}`
      );
    } else {
      const data = JSON.parse(ghResult.stdout);
      if (!Array.isArray(data)) {
        layer2Error = new Error("gh api output is not a JSON array");
      } else {
        return data as UpstreamReleaseEntry[];
      }
    }
  } catch (err) {
    layer2Error = err instanceof Error ? err : new Error(String(err));
  }

  // --- Layer 3: Native `git ls-remote --tags` fallback ---
  let layer3Error: Error | undefined;
  try {
    const gitResult = exec("git", ["ls-remote", "--tags", gitUrl, "rust-v*"]);
    if (gitResult.status !== 0) {
      layer3Error = new Error(
        `git ls-remote failed (exit ${gitResult.status}): ${gitResult.stderr.trim() || gitResult.stdout.trim() || "unknown error"}`
      );
    } else {
      const entries: UpstreamReleaseEntry[] = [];
      const seen = new Set<string>();
      for (const rawLine of gitResult.stdout.split("\n")) {
        const line = rawLine.trim();
        if (!line || line.endsWith("^{}")) continue;
        const parts = line.split(/\s+/);
        if (parts.length < 2) continue;
        const ref = parts[1];
        if (!ref || !ref.startsWith("refs/tags/")) continue;
        const tag = ref.slice("refs/tags/".length);
        if (!tag || seen.has(tag)) continue;
        seen.add(tag);
        entries.push({
          tag_name: tag,
          draft: false,
          prerelease: tag.includes("-alpha") || tag.includes("-beta") || tag.includes("-rc"),
        });
      }

      if (entries.length === 0) {
        layer3Error = new Error("git ls-remote returned no tags matching rust-v*");
      } else {
        return entries;
      }
    }
  } catch (err) {
    layer3Error = err instanceof Error ? err : new Error(String(err));
  }

  // --- All 3 layers failed ---
  const errors: readonly [Error, Error, Error] = [
    layer1Error ?? new Error("Layer 1 (fetch) failed"),
    layer2Error ?? new Error("Layer 2 (gh api) failed"),
    layer3Error ?? new Error("Layer 3 (git ls-remote) failed"),
  ];
  const message = [
    "Failed to discover upstream releases across all 3 layers:",
    `  1. Direct fetch: ${errors[0].message}`,
    `  2. gh api CLI: ${errors[1].message}`,
    `  3. git ls-remote: ${errors[2].message}`,
  ].join("\n");

  throw new UpstreamDiscoveryError(message, errors);
}
