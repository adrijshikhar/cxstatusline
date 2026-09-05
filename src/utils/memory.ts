
export interface MemoryDeps {
  platform(): NodeJS.Platform;
  totalmem(): number;
  freemem(): number;
  execFileSync: typeof import('node:child_process').execFileSync;
}

interface CacheEntry { used: number; total: number; at: number; }
const cache = new WeakMap<object, CacheEntry>();
const CACHE_MS = 10_000;

function fallback(deps: MemoryDeps): { used: number; total: number } {
  const total = Math.max(0, deps.totalmem());
  const used = Math.max(0, total - Math.max(0, deps.freemem()));
  return { used, total };
}

function parseVmStat(output: string): number | null {
  const pageSize = Number(output.match(/page size of (\\d+) bytes/i)?.[1]);
  const active = Number(output.match(/^Pages active:\\s+(\\d+)/m)?.[1]);
  const wired = Number(output.match(/^Pages wired down:\\s+(\\d+)/m)?.[1]);
  if (!Number.isFinite(pageSize) || pageSize <= 0 || !Number.isFinite(active) || !Number.isFinite(wired)) return null;
  return (active + wired) * pageSize;
}

export function readMemoryUsage(deps: MemoryDeps, nowMs: number): { used: number; total: number } {
  const hit = cache.get(deps);
  if (hit && nowMs - hit.at < CACHE_MS) return { used: hit.used, total: hit.total };
  const total = Math.max(0, deps.totalmem());
  if (deps.platform() !== 'darwin') return fallback(deps);
  try {
    const output = deps.execFileSync('vm_stat', [], { encoding: 'utf8', timeout: 5000 });
    const used = parseVmStat(String(output));
    if (used === null) return fallback(deps);
    const value = { used: Math.min(total, Math.max(0, used)), total };
    cache.set(deps, { ...value, at: nowMs });
    return value;
  } catch {
    return fallback(deps);
  }
}
