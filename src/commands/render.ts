import type { Env } from "../env";
import { resolvePaths } from "../paths";
import { PayloadError, parsePayload } from "../payload";
import { getVisibleText } from "../utils/ansi";
import { renderStatusLines } from "../utils/renderer";
import { loadSettings } from "../utils/config";

export interface RenderResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}

export interface RenderDeps {
  readonly env: Env;
  readonly now: Date;
  readonly terminalWidth: number | null;
  readonly freeMemoryBytes: number;
  readonly memoryUsage?: { used: number; total: number };
}

const CONTROL = /[\u0000-\u001F\u007F-\u009F]/;
const SGR = /^\x1b\[[0-9;]*m/;

/** Keep renderer-owned SGR styling while removing every other control character from one row. */
function sanitizeRow(row: string): string {
  let safe = "";
  for (let index = 0; index < row.length;) {
    const sgr = row.slice(index).match(SGR)?.[0];
    if (sgr) {
      safe += sgr;
      index += sgr.length;
      continue;
    }
    const char = row[index]!;
    if (!CONTROL.test(char)) safe += char;
    index += 1;
  }
  return safe;
}

/** stdin payload -> one to three lines. Exit 2 on a bad payload with nothing on stdout. */
export async function runRender(stdin: string, deps: RenderDeps): Promise<RenderResult> {
  const warnings: string[] = [];
  const warn = (m: string): void => {
    warnings.push(`cxstatusline: ${m}\n`);
  };
  try {
    const payload = parsePayload(stdin);
    const loaded = await loadSettings(resolvePaths(deps.env).settingsFile);
    if (loaded.error) warn(`${loaded.error}; using defaults`);
    const rows = renderStatusLines(loaded.settings, {
      data: payload,
      now: deps.now,
      terminalWidth: deps.terminalWidth,
      freeMemoryBytes: deps.freeMemoryBytes,
      memoryUsage: deps.memoryUsage ?? { used: deps.freeMemoryBytes, total: deps.freeMemoryBytes },
      usageData: {
        weeklyUsage: payload.usage?.weekly?.used === undefined ? undefined : payload.usage.weekly.used * 100,
        weeklyResetAt: payload.usage?.weekly?.resets_at,
      },
      isPreview: false,
    }).map(sanitizeRow).filter((row) => getVisibleText(row).trim().length > 0);
    return { stdout: `${(rows.length ? rows : ["codex"]).join("\n")}\n`, stderr: warnings.join(""), code: 0 };
  } catch (e) {
    const message = e instanceof PayloadError ? e.message : `unexpected error: ${String(e)}`;
    return { stdout: "", stderr: `${warnings.join("")}cxstatusline: ${message}\n`, code: 2 };
  }
}
