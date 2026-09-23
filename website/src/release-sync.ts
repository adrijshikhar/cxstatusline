export interface ResolvedRelease {
  version: string;
  source: "npm" | "github" | "static";
}

export function compareSemver(left: string, right: string): number {
  const [lMaj = 0, lMin = 0, lPat = 0] = left.split(".").map(Number);
  const [rMaj = 0, rMin = 0, rPat = 0] = right.split(".").map(Number);
  return lMaj - rMaj || lMin - rMin || lPat - rPat;
}

export async function resolveLatestVersion(
  staticVersion: string,
  fetchFn: typeof fetch = fetch,
): Promise<ResolvedRelease> {
  let highest = { version: staticVersion, source: "static" as const };

  const checkSource = async (
    url: string,
    sourceName: "npm" | "github",
    parseFn: (data: unknown) => string | null,
  ): Promise<void> => {
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 4_000);
    try {
      const res = await fetchFn(url, { signal: abort.signal });
      if (!res.ok) return;
      const data = await res.json();
      const ver = parseFn(data);
      if (ver && compareSemver(ver, highest.version) > 0) {
        highest = { version: ver, source: sourceName };
      }
    } catch {
      // Ignore network failures and timeouts; fallbacks will apply
    } finally {
      clearTimeout(timeout);
    }
  };

  await Promise.allSettled([
    checkSource("https://registry.npmjs.org/cxstatusline/latest", "npm", (data) =>
      typeof data === "object" && data !== null && "version" in data && typeof (data as { version?: unknown }).version === "string"
        ? (data as { version: string }).version
        : null,
    ),
    checkSource(
      "https://raw.githubusercontent.com/adrijshikhar/cxstatusline/main/package.json",
      "github",
      (data) =>
        typeof data === "object" && data !== null && "version" in data && typeof (data as { version?: unknown }).version === "string"
          ? (data as { version: string }).version
          : null,
    ),
  ]);

  return highest;
}
