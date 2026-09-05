export function compactTokens(n: number): string {
  if (n < 1_000) return String(Math.round(n));
  if (n < 1_000_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/** 0..1 -> "42%". Anything under half a percent still shows 1% so it is never invisible. */
export function percent(fraction: number): string {
  const p = Math.round(fraction * 100);
  return `${fraction > 0 && p === 0 ? 1 : p}%`;
}

export function formatDuration(ms: number): string {
  if (ms <= 0) return "now";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${Math.max(minutes, 1)}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function shortenPath(p: string, home: string): string {
  if (home && (p === home || p.startsWith(`${home}/`))) return `~${p.slice(home.length)}`;
  return p;
}
