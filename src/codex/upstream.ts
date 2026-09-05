import { accessSync, constants, lstatSync, readlinkSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { Env, Runner } from "../env";
import type { Paths } from "../paths";
import type { LauncherRestore } from "../state";
import { parseCodexVersionOutput, type SemVer } from "../version";

export interface UpstreamResolution {
  readonly bin: string;
  readonly launcher_restore: LauncherRestore;
}

/**
 * Why this is a discriminated union and not `UpstreamResolution | null`:
 * "there is a real binary at ~/.local/bin/codex that we did not write, and we refuse to overwrite
 * it" and "there is no Codex anywhere" need different operator messages (spec L195, L208-212).
 * `doctor` and `runPatch` both report them separately.
 */
export type UpstreamLookup =
  | ({ readonly kind: "found" } & UpstreamResolution)
  | { readonly kind: "foreign"; readonly path: string }
  | { readonly kind: "not-found" };

function isExecutable(p: string): boolean {
  try {
    accessSync(p, constants.X_OK);
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

function isManaged(p: string, paths: Paths, isOurWrapper: (p: string) => boolean): boolean {
  if (resolve(p) === resolve(paths.patchedBin) || isOurWrapper(p)) return true;
  try { return realpathSync(p) === realpathSync(paths.patchedBin); } catch { return false; }
}

/** What currently sits at the wrapper path, if anything we did not put there. */
function inspectLauncher(paths: Paths, isOurWrapper: (p: string) => boolean): UpstreamLookup | null {
  let st;
  try {
    st = lstatSync(paths.wrapperPath);
  } catch {
    return null; // nothing there - fall through to the PATH walk
  }
  if (st.isSymbolicLink()) {
    const raw = readlinkSync(paths.wrapperPath);
    const target = isAbsolute(raw) ? raw : resolve(dirname(paths.wrapperPath), raw);
    // Why isOurWrapper(target) and not (wrapperPath): a symlink pointing at our own wrapper
    // script is still us, and following it would record our wrapper as "upstream".
    if (isManaged(target, paths, isOurWrapper)) return null;
    return { kind: "found", bin: target, launcher_restore: { kind: "symlink", target } };
  }
  if (isOurWrapper(paths.wrapperPath)) return null;
  return { kind: "foreign", path: paths.wrapperPath }; // a real file we did not write
}

function walkPath(paths: Paths, env: Env, isOurWrapper: (p: string) => boolean): string | null {
  for (const dir of (env.PATH ?? "").split(":").filter(Boolean)) {
    // Why the skip: ~/.local/bin holds our wrapper. Resolving Codex to it would make the hook
    // compare the patched binary against itself and never detect drift.
    if (resolve(dir) === resolve(paths.binDir)) continue;
    const candidate = join(dir, "codex");
    if (isExecutable(candidate) && !isManaged(candidate, paths, isOurWrapper)) return candidate;
  }
  return null;
}

/** Find the upstream Codex binary without ever resolving to our own wrapper. */
export function resolveUpstream(paths: Paths, env: Env, isOurWrapper: (p: string) => boolean, savedBin?: string | null): UpstreamLookup {
  const launcher = inspectLauncher(paths, isOurWrapper);
  if (launcher) return launcher;
  const current = walkPath(paths, env, isOurWrapper);
  const bin = current ?? (savedBin && isExecutable(savedBin) && !isManaged(savedBin, paths, isOurWrapper) ? savedBin : null);
  return bin ? { kind: "found", bin, launcher_restore: { kind: "none" } } : { kind: "not-found" };
}

/** Human-readable reason for a non-`found` lookup, for `systemMessage`s and `doctor`. */
export function describeLookup(l: UpstreamLookup): string {
  switch (l.kind) {
    case "found":
      return l.bin;
    case "foreign":
      return `${l.path} is a real file we did not write; refusing to overwrite it`;
    case "not-found":
      return "no upstream Codex found (nothing named codex on PATH outside ~/.local/bin, and the launcher there is not a symlink)";
  }
}

export function readUpstreamVersion(bin: string, run: Runner): SemVer | null {
  const r = run(bin, ["--version"]);
  if (r.status !== 0) return null;
  return parseCodexVersionOutput(r.stdout);
}

/**
 * Decide which `launcher_restore` to keep when re-resolving upstream.
 * Why: a fresh observation of upstream's own symlink is authoritative and must replace a stale
 * recorded target, but `{kind:"none"}` (found via the PATH walk) must never erase a recorded
 * symlink - that field is all `revert` has to put the launcher back. Shared by `upstreamFor`
 * (src/patch/run.ts) and `locateUpstream` (src/hook/run.ts).
 */
export function preserveLauncherRestore(
  recorded: LauncherRestore | null,
  found: LauncherRestore,
): LauncherRestore {
  return found.kind === "symlink" ? found : recorded ?? found;
}
