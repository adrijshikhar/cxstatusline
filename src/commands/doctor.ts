import { existsSync, lstatSync, readFileSync, readlinkSync } from "node:fs";
import type { Context } from "../context";
import { VERSION } from "../version-info";
import { describeLookup, readUpstreamVersion, resolveUpstream } from "../codex/upstream";
import { isOurGroup, type HooksFile } from "../hook/install";
import { lockHolder, pidAlive } from "../lock";
import { preflight, REQUIRED_TOOLCHAIN } from "../patch/preflight";
import { isOurWrapper } from "../patch/wrapper";
import { readState } from "../state";
import { behindWithinMinor, needsRepatch, parseSemver } from "../version";

export interface DoctorLine {
  readonly key: string;
  readonly value: string;
  readonly ok: boolean | null; // null = informational
}

const line = (key: string, value: string, ok: boolean | null = null): DoctorLine => ({ key, value, ok });

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

export function doctorReport(ctx: Context): DoctorLine[] {
  const { state, corrupt } = readState(ctx.paths.stateFile);
  const lookup = resolveUpstream(ctx.paths, ctx.env, isOurWrapper, state.upstream_bin);
  const upstreamBin = lookup.kind === "found" ? lookup.bin : null;
  const lookupNote = lookup.kind !== "found" ? describeLookup(lookup) : null;
  const upstream = upstreamBin ? readUpstreamVersion(upstreamBin, ctx.run) : null;
  const patched = state.patched_from ? parseSemver(state.patched_from) : null;
  const drift = (): DoctorLine => {
    if (!upstream || !patched) return line("drift", "n/a");
    if (needsRepatch(upstream, patched, state.policy)) return line("drift", `rebuild due: ${patched.raw} -> ${upstream.raw}`, false);
    if (behindWithinMinor(upstream, patched)) return line("drift", `behind within minor: ${patched.raw} < ${upstream.raw} (held by policy; \`patch --force\` to pick up)`);
    return line("drift", "none", true);
  };
  const pf = preflight({ which: ctx.which, run: ctx.run, freeBytes: ctx.freeBytes }, ctx.paths.shareDir);
  const patchedBinPresent = existsSync(ctx.paths.patchedBin);
  const codeModeHostPresent = existsSync(ctx.paths.patchedCodeModeHost);
  const companionOk = codeModeHostPresent ? true : state.patched_from === null ? null : false;
  return [
    line("renderer", `${ctx.cxBin} (${VERSION})`),
    line("settings", `${ctx.paths.settingsFile} ${existsSync(ctx.paths.settingsFile) ? "present" : "absent (written on first render)"}`),
    upstreamLine(ctx, upstreamBin, upstream?.raw ?? null, lookupNote),
    line("state", corrupt ? `${ctx.paths.stateFile} CORRUPT (recovered from ${ctx.paths.stateBackupFile} where possible)` : ctx.paths.stateFile, corrupt ? false : null),
    line("patched_from", state.patched_from ?? "never"),
    line("policy", state.policy),
    drift(),
    wrapperLine(ctx),
    line("patched_bin", patchedBinPresent ? ctx.paths.patchedBin : "absent", patchedBinPresent ? true : null),
    line("code_mode_host", codeModeHostPresent ? ctx.paths.patchedCodeModeHost : "absent", companionOk),
    hookLine(ctx),
    line("last_attempt", state.last_attempt ? `${state.last_attempt.ok ? "ok" : "FAILED"} ${state.last_attempt.version} at ${state.last_attempt.at}${state.last_attempt.reason ? `: ${state.last_attempt.reason}` : ""}` : "none", state.last_attempt ? state.last_attempt.ok : null),
    pf.ok ? line("toolchain", `git, cargo and Rust ${REQUIRED_TOOLCHAIN} present; disk ok`, true) : line("toolchain", `${pf.reason} - ${pf.fix}`, false),
    lockLine(ctx),
  ];
}

export function formatDoctor(lines: readonly DoctorLine[]): string {
  const mark = (ok: boolean | null): string => (ok === null ? " " : ok ? "✓" : "✗");
  const width = Math.max(...lines.map((l) => l.key.length));
  return `${lines.map((l) => `${mark(l.ok)} ${l.key.padEnd(width)}  ${l.value}`).join("\n")}\n`;
}
