import { existsSync, lstatSync, readFileSync, readlinkSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Context } from "../context";
import { VERSION } from "../version-info";
import { describeLookup, readUpstreamVersion, resolveUpstream } from "../codex/upstream";
import { isOurGroup, type HooksFile } from "../hook/install";
import { lockHolder, pidAlive } from "../lock";
import { isOurWrapper } from "../patch/wrapper";
import { RELEASE_UNAVAILABLE, readState, type State } from "../state";
import { behindWithinMinor, needsRepatch, parseSemver } from "../version";
import { formatDuration } from "../utils/format";
import { bookkeepingLine, classifyGeneration, generationDetailLines, legacyLine, toolchainLine } from "./doctor-generation";

export interface DoctorLine {
  readonly key: string;
  readonly value: string;
  readonly ok: boolean | null; // null = informational
}

export const line = (key: string, value: string, ok: boolean | null = null): DoctorLine => ({ key, value, ok });

function wrapperLine(ctx: Context): DoctorLine {
  const p = ctx.paths.wrapperPath;
  let st;
  try {
    st = lstatSync(p);
  } catch {
    return line("wrapper", "absent");
  }
  if (st.isSymbolicLink()) return line("wrapper", `upstream symlink -> ${readlinkSync(p)}`);
  return isOurWrapper(p) ? line("wrapper", "ours", true) : line("wrapper", "foreign file! not ours, not a symlink", false);
}

/**
 * Spec L328 asks `doctor` to report `hook: untrusted`.
 * Trust lives in Codex's own `config.toml` as a hash over the normalized handler, computed by
 * Codex; we deliberately never write it (spec L261-262) and cannot recompute it without pinning
 * ourselves to Codex's internal hashing. So the honest report is "installed" plus where trust is
 * decided. Ruling recorded in the plan's Self-review notes.
 */
function hookLine(ctx: Context): DoctorLine {
  if (!existsSync(ctx.paths.hooksFile)) return line("hook", "absent");
  try {
    const f = JSON.parse(readFileSync(ctx.paths.hooksFile, "utf8")) as HooksFile;
    const ours = (f.hooks?.SessionStart ?? []).find(isOurGroup);
    if (!ours) return line("hook", "absent");
    return line("hook", `installed (${ours.hooks[0]?.command}); trust is decided in Codex's startup hooks review - if the footer never appears, check \`/hooks\` inside Codex`, true);
  } catch {
    return line("hook", "hooks.json unreadable", false);
  }
}

function upstreamLine(ctx: Context, bin: string | null, version: string | null, lookupNote: string | null): DoctorLine {
  if (bin && version) return line("upstream", `${bin} ${version}`, true);
  if (bin) return line("upstream", `${bin} (version unreadable)`, false);
  return line("upstream", lookupNote ?? "not found", false);
}

function lockLine(ctx: Context): DoctorLine {
  const holder = lockHolder(ctx.paths.lockFile);
  if (holder === null) return line("lock", "free");
  return pidAlive(holder)
    ? line("lock", `held by pid ${holder} (a patch is running)`)
    : line("lock", `stale pidfile for dead pid ${holder}; the next patch will steal it`);
}

/**
 * Backoff visibility (spec: the hook silently retries an unavailable release, at most once a day).
 * A plain `install` bypasses the window, so its message names the escape hatch explicitly.
 */
function lastAttemptLine(state: State): DoctorLine {
  const a = state.last_attempt;
  if (!a) return line("last_attempt", "none", null);
  if (a.ok) return line("last_attempt", `ok ${a.version} at ${a.at}`, true);
  const reasonPart = a.reason ? `: ${a.reason}` : "";
  const backoff = a.reason === RELEASE_UNAVAILABLE ? " (hook retries after 24h; run cxstatusline install to retry now)" : "";
  return line("last_attempt", `failed ${a.version} at ${a.at}${reasonPart}${backoff}`, false);
}

function commandCacheLine(ctx: Context): DoctorLine {
  const dir = ctx.paths.commandCacheDir;
  try {
    const entries = readdirSync(dir).filter((f) => f.endsWith(".json"));
    if (entries.length === 0) {
      return line("command_cache", "0 entries");
    }
    const now = ctx.now().getTime();
    let oldestMtime = Infinity;
    for (const f of entries) {
      try {
        const st = lstatSync(join(dir, f));
        if (st.mtimeMs < oldestMtime) oldestMtime = st.mtimeMs;
      } catch {
        // Ignore unreadable entries
      }
    }
    const ageMs = oldestMtime < Infinity ? Math.max(0, now - oldestMtime) : 0;
    const count = `${entries.length} ${entries.length === 1 ? "entry" : "entries"}`;
    return line("command_cache", `${count} (oldest: ${formatDuration(ageMs)})`);
  } catch {
    return line("command_cache", "0 entries");
  }
}

export function doctorReport(ctx: Context): DoctorLine[] {
  const { state, corrupt } = readState(ctx.paths.stateFile);
  const lookup = resolveUpstream(ctx.paths, ctx.env, isOurWrapper, state.upstream_bin);
  const upstreamBin = lookup.kind === "found" ? lookup.bin : null;
  const lookupNote = lookup.kind !== "found" ? describeLookup(lookup) : null;
  const upstream = upstreamBin ? readUpstreamVersion(upstreamBin, ctx.run) : null;

  // Read-only: reflects what is actually installed, not merely last-attempt bookkeeping.
  const status = classifyGeneration(ctx.paths);
  const source = status.record?.provenance.source ?? "none";

  // Metadata wins over state.json's `patched_from` for drift (src/patch/generation.ts);
  // `bookkeepingLine` below surfaces it separately when the two disagree.
  const effectivePatchedFrom = status.record?.codexVersion ?? state.patched_from;
  const patched = effectivePatchedFrom ? parseSemver(effectivePatchedFrom) : null;
  const drift = (): DoctorLine => {
    if (!upstream || !patched) return line("drift", "n/a");
    if (needsRepatch(upstream, patched, state.policy)) return line("drift", `install due: ${patched.raw} -> ${upstream.raw}`, false);
    if (behindWithinMinor(upstream, patched)) return line("drift", `behind within minor: ${patched.raw} < ${upstream.raw} (held by policy; \`patch --force\` to pick up)`);
    return line("drift", "none", true);
  };

  const lines: (DoctorLine | null)[] = [
    line("renderer", `${ctx.cxBin} (${VERSION})`),
    line("settings", `${ctx.paths.settingsFile} ${existsSync(ctx.paths.settingsFile) ? "present" : "absent (written on first render)"}`),
    upstreamLine(ctx, upstreamBin, upstream?.raw ?? null, lookupNote),
    line("state", corrupt ? `${ctx.paths.stateFile} CORRUPT (recovered from ${ctx.paths.stateBackupFile} where possible)` : ctx.paths.stateFile, corrupt ? false : null),
    line("patched_from", state.patched_from ?? "never"),
    line("policy", state.policy),
    drift(),
    bookkeepingLine(state, status.record),
    wrapperLine(ctx),
    status.activeLine,
    status.generationLine,
    ...generationDetailLines(ctx, status),
    legacyLine(ctx.paths, status.record),
    hookLine(ctx),
    lastAttemptLine(state),
    toolchainLine(ctx, source),
    lockLine(ctx),
    commandCacheLine(ctx),
  ];
  return lines.filter((l): l is DoctorLine => l !== null);
}

import { formatDoctorPretty } from "./doctor-format";

export function formatDoctor(lines: readonly DoctorLine[]): string {
  return formatDoctorPretty(lines);
}
