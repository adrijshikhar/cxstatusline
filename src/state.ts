import { existsSync, readFileSync } from "node:fs";
import { writeFileAtomic } from "./atomic";
import { POLICIES, type Policy } from "./version";

/**
 * The `Attempt.reason` a prebuilt acquisition records when no release exists for the version yet.
 * A distinct token, not prose: the hook has to recognise it to bound its retries, and prose would
 * make that a substring guess.
 */
export const RELEASE_UNAVAILABLE = "release-unavailable";

/** How long the hook waits before trying an unavailable release again. Explicit installs ignore it. */
export const RELEASE_RETRY_AFTER_MS = 24 * 60 * 60 * 1000;

export interface Attempt {
  readonly at: string; // ISO
  readonly ok: boolean;
  readonly version: string;
  readonly reason?: string;
}

export type LauncherRestore = { readonly kind: "symlink"; readonly target: string } | { readonly kind: "none" };

export interface State {
  readonly version: 1;
  readonly policy: Policy;
  readonly patched_from: string | null;
  readonly upstream_bin: string | null;
  readonly launcher_restore: LauncherRestore | null;
  readonly last_attempt: Attempt | null;
}

export const DEFAULT_STATE: State = {
  version: 1,
  policy: "every",
  patched_from: null,
  upstream_bin: null,
  launcher_restore: null,
  last_attempt: null,
};

/** Every writer appends this to the state path to get the backup path. */
export const BACKUP_SUFFIX = ".bak";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const strOrNull = (v: unknown): string | null | undefined =>
  v === null || typeof v === "string" ? v : undefined;

function restore(v: unknown): LauncherRestore | null | undefined {
  if (v === null) return null;
  if (!isObj(v)) return undefined;
  if (v.kind === "none") return { kind: "none" };
  if (v.kind === "symlink" && typeof v.target === "string") return { kind: "symlink", target: v.target };
  return undefined;
}

function attempt(v: unknown): Attempt | null | undefined {
  if (v === null) return null;
  if (!isObj(v) || typeof v.at !== "string" || typeof v.ok !== "boolean" || typeof v.version !== "string") return undefined;
  return typeof v.reason === "string" ? { at: v.at, ok: v.ok, version: v.version, reason: v.reason } : { at: v.at, ok: v.ok, version: v.version };
}

function validate(raw: unknown): State | null {
  if (!isObj(raw) || raw.version !== 1) return null;
  const policy = (POLICIES as readonly string[]).includes(String(raw.policy)) ? (raw.policy as Policy) : undefined;
  const patched_from = strOrNull(raw.patched_from);
  const upstream_bin = strOrNull(raw.upstream_bin);
  const launcher_restore = restore(raw.launcher_restore);
  const last_attempt = attempt(raw.last_attempt);
  if (policy === undefined || patched_from === undefined || upstream_bin === undefined
    || launcher_restore === undefined || last_attempt === undefined) return null;
  return { version: 1, policy, patched_from, upstream_bin, launcher_restore, last_attempt };
}

function readValidated(file: string): State | null {
  if (!existsSync(file)) return null;
  try {
    return validate(JSON.parse(readFileSync(file, "utf8")));
  } catch {
    return null;
  }
}

/**
 * Read `state.json`, falling back to `state.json.bak` when the primary file is missing keys,
 * unparsable, or the wrong shape.
 * Why the backup exists: `upstream_bin` and `launcher_restore` are the only record of where the
 * real Codex lives and how to put its launcher back. Once our wrapper occupies
 * `~/.local/bin/codex`, `resolveUpstream` refuses it and the PATH walk skips `~/.local/bin`, so
 * losing those two fields makes `revert` permanently unable to restore upstream (spec L358).
 */
export function readState(file: string): { state: State; corrupt: boolean } {
  if (!existsSync(file) && !existsSync(`${file}${BACKUP_SUFFIX}`)) {
    return { state: DEFAULT_STATE, corrupt: false };
  }
  const primary = readValidated(file);
  if (primary) return { state: primary, corrupt: false };
  const backup = readValidated(`${file}${BACKUP_SUFFIX}`);
  return backup ? { state: backup, corrupt: true } : { state: DEFAULT_STATE, corrupt: true };
}

/** Write the state and refresh its backup. Both writes are atomic (temp sibling + rename). */
export function writeState(file: string, state: State): void {
  const text = `${JSON.stringify(state, null, 2)}\n`;
  writeFileAtomic(file, text);
  writeFileAtomic(`${file}${BACKUP_SUFFIX}`, text);
}
