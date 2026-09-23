import { existsSync, readFileSync } from "node:fs";
import { writeFileAtomic } from "../atomic";
import { sq } from "../sh";

export interface HookHandler {
  readonly type: "command";
  readonly command: string;
  readonly timeout?: number;
  readonly statusMessage?: string;
}
export interface MatcherGroup {
  readonly matcher?: string;
  readonly hooks: readonly HookHandler[];
}
export interface HooksFile {
  readonly description?: string;
  readonly hooks: Readonly<Record<string, readonly MatcherGroup[]>>;
}

export const HOOK_STATUS_MESSAGE = "cxstatusline: checking Codex version";
const HOOK_TIMEOUT_SEC = 10;

export const hookCommand = (cxBin: string): string => `${sq(cxBin)} hook`;

export function hookEntry(cxBin: string): MatcherGroup {
  return { hooks: [{ type: "command", command: hookCommand(cxBin), timeout: HOOK_TIMEOUT_SEC, statusMessage: HOOK_STATUS_MESSAGE }] };
}

export const isOurGroup = (g: MatcherGroup): boolean =>
  g.hooks.some((h) => h.statusMessage === HOOK_STATUS_MESSAGE || h.command.includes("cxstatusline"));

const sameJson = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * Append (or update) our SessionStart group, leaving every other group and event untouched.
 * Why an equal entry is returned unchanged: Codex's trust hash covers the normalized handler, so
 * rewriting an identical entry would flip it to `Modified` and Codex would skip it again.
 */
export function mergeHook(file: HooksFile | null, cxBin: string): { file: HooksFile; changed: boolean } {
  const base: HooksFile = file ?? { hooks: {} };
  const entry = hookEntry(cxBin);
  const groups = base.hooks.SessionStart ?? [];
  const idx = groups.findIndex(isOurGroup);
  if (idx !== -1 && sameJson(groups[idx], entry)) return { file: base, changed: false };
  const next = idx === -1 ? [...groups, entry] : groups.map((g, i) => (i === idx ? entry : g));
  return { file: { ...base, hooks: { ...base.hooks, SessionStart: next } }, changed: true };
}

export function removeHook(file: HooksFile): { file: HooksFile; changed: boolean } {
  const groups = file.hooks.SessionStart ?? [];
  const kept = groups.filter((g) => !isOurGroup(g));
  if (kept.length === groups.length) return { file, changed: false };
  const { SessionStart: _dropped, ...rest } = file.hooks;
  const hooks = kept.length === 0 ? rest : { ...rest, SessionStart: kept };
  return { file: { ...file, hooks }, changed: true };
}

function readHooksFile(path: string): HooksFile | null {
  if (!existsSync(path)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error(`${path}: hooks.json is not valid JSON; fix it by hand before installing the hook`);
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error(`${path}: hooks.json must be a JSON object`);
  const o = raw as { hooks?: unknown };
  if (o.hooks !== undefined && (typeof o.hooks !== "object" || o.hooks === null)) throw new Error(`${path}: "hooks" must be an object`);
  return { ...(raw as object), hooks: (o.hooks ?? {}) as HooksFile["hooks"] } as HooksFile;
}

export function installHook(hooksFile: string, cxBin: string): "added" | "unchanged" {
  const { file, changed } = mergeHook(readHooksFile(hooksFile), cxBin);
  if (!changed) return "unchanged";
  writeFileAtomic(hooksFile, `${JSON.stringify(file, null, 2)}\n`);
  return "added";
}

export function uninstallHook(hooksFile: string): "removed" | "absent" {
  const current = readHooksFile(hooksFile);
  if (!current) return "absent";
  const { file, changed } = removeHook(current);
  if (!changed) return "absent";
  writeFileAtomic(hooksFile, `${JSON.stringify(file, null, 2)}\n`);
  return "removed";
}
