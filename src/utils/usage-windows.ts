import { FIVE_HOUR_WINDOW_MS, SEVEN_DAY_WINDOW_MS, type UsageWindowMetrics } from './usage-types';

function windowFromReset(resetAt: string | undefined, durationMs: number, nowMs: number): UsageWindowMetrics | null {
  if (!resetAt) return null;
  const resetAtMs = Date.parse(resetAt);
  if (!Number.isFinite(resetAtMs) || durationMs <= 0) return null;
  const elapsedMs = Math.max(0, Math.min(durationMs, nowMs - resetAtMs + durationMs));
  const elapsedPercent = elapsedMs / durationMs * 100;
  return { sessionDurationMs: durationMs, elapsedMs, remainingMs: durationMs - elapsedMs, elapsedPercent, remainingPercent: 100 - elapsedPercent };
}

export function getFiveHourUsageWindowFromResetAt(resetAt: string | undefined, nowMs = Date.now()): UsageWindowMetrics | null {
  return windowFromReset(resetAt, FIVE_HOUR_WINDOW_MS, nowMs);
}

export function getWeeklyUsageWindowFromResetAt(resetAt: string | undefined, nowMs = Date.now()): UsageWindowMetrics | null {
  return windowFromReset(resetAt, SEVEN_DAY_WINDOW_MS, nowMs);
}

export function formatUsageDuration(durationMs: number, compact = false, useDays = true): string {
  const safe = Math.max(0, durationMs);
  const totalHours = Math.floor(safe / 3600000);
  const minutes = Math.floor(safe % 3600000 / 60000);
  const days = useDays ? Math.floor(totalHours / 24) : 0;
  const hours = useDays ? totalHours % 24 : totalHours;
  const parts: string[] = [];
  if (days > 0) parts.push(String(days) + 'd');
  if (hours > 0) parts.push(String(hours) + (compact ? 'h' : 'hr'));
  if (minutes > 0) parts.push(String(minutes) + 'm');
  return parts.length ? parts.join(compact ? '' : ' ') : '0m';
}

const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function pad(n: number): string { return String(n).padStart(2, '0'); }

export function formatUsageResetAt(resetAt: string | undefined, compact = false, timezone?: string, localeOrHour12?: string | boolean, hour12Arg = false, weekday = false): string | null {
  if (!resetAt) return null;
  const parsed = Date.parse(resetAt);
  if (!Number.isFinite(parsed)) return null;
  const date = new Date(parsed);
  const locale = typeof localeOrHour12 === 'string' ? localeOrHour12 : undefined;
  const hour12 = typeof localeOrHour12 === 'boolean' ? localeOrHour12 : hour12Arg;
  try {
    const zone = timezone === 'local' ? undefined : (timezone || 'UTC');
    const options: Intl.DateTimeFormatOptions = { ...(zone === undefined ? {} : { timeZone: zone }), hour: '2-digit', minute: '2-digit', hour12, timeZoneName: compact ? undefined : 'short' };
    if (weekday) options.weekday = 'short';
    else { options.year = 'numeric'; options.month = '2-digit'; options.day = '2-digit'; }
    const parts = Object.fromEntries(new Intl.DateTimeFormat(locale ?? 'en-US', options).formatToParts(date).map(part => [part.type, part.value]));
    const hour = String(parts.hour ?? '').replace(/^0/, '');
    const time = hour + ':' + String(parts.minute ?? '') + (parts.dayPeriod ? ' ' + String(parts.dayPeriod).toUpperCase() : '');
    if (weekday) return compact ? String(parts.weekday ?? '') + ' ' + time : String(parts.weekday ?? '') + ' ' + time + ' ' + String(parts.timeZoneName ?? '').trim();
    if (compact) return String(parts.month ?? pad(date.getUTCMonth() + 1)) + '-' + String(parts.day ?? pad(date.getUTCDate())) + ' ' + time;
    return String(parts.year ?? date.getUTCFullYear()) + '-' + String(parts.month ?? pad(date.getUTCMonth() + 1)) + '-' + String(parts.day ?? pad(date.getUTCDate())) + ' ' + time + ' ' + String(parts.timeZoneName ?? 'UTC');
  } catch {
    const base = date.getUTCFullYear() + '-' + pad(date.getUTCMonth() + 1) + '-' + pad(date.getUTCDate()) + ' ' + pad(date.getUTCHours()) + ':' + pad(date.getUTCMinutes());
    return compact ? base.slice(5) + 'Z' : base + ' UTC';
  }
}

export function getUsageErrorMessage(error: string): string {
  const messages: Record<string, string> = { 'no-credentials': '[No credentials]', timeout: '[Timeout]', 'rate-limited': '[Rate limited]', 'api-error': '[API Error]', 'parse-error': '[Parse Error]' };
  return messages[error] ?? '[Error]';
}

export function makeUsageProgressBar(percent: number, width = 15): string {
  const filled = Math.round(Math.max(0, Math.min(100, percent)) / 100 * width);
  return '[' + '█'.repeat(filled) + '░'.repeat(width - filled) + ']';
}

export function resolveFiveHourUsageWindow(data: { fiveHourResetAt?: string | undefined }, nowMs = Date.now()): UsageWindowMetrics | null {
  return getFiveHourUsageWindowFromResetAt(data.fiveHourResetAt, nowMs);
}

export function resolveWeeklyUsageWindow(data: { weeklyResetAt?: string | undefined }, nowMs = Date.now()): UsageWindowMetrics | null {
  return getWeeklyUsageWindowFromResetAt(data.weeklyResetAt, nowMs);
}
