/**
 * Where `patches/` is read from.
 *
 * A scheduled run resolves an *older* source commit than the one `detect` is checked out at, so
 * reading `patches/manifest.json` and the patch bytes from the working tree would hash whatever is
 * on the default branch and publish that digest as the provenance of a build of the frozen commit.
 * `commitPatches` reads both out of the frozen commit instead; `workingTreePatches` is for a manual
 * dispatch, whose checkout *is* `github.sha`.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { patchesDir, root } from "./env";

const HEX40 = /^[0-9a-f]{40}$/;
/** Manifest-supplied names only ever address a file inside `patches/`; no path, no traversal. */
const PATCH_NAME = /^[A-Za-z0-9][A-Za-z0-9@._+-]{0,120}$/;
const MAX_PATCH_BYTES = 64 * 1024 * 1024;

/** A resolved `patches/` directory: where `loadManifest` reads from, and how a patch is fetched. */
export interface PatchTree {
  /** Directory holding the `manifest.json` this run must use. */
  readonly manifestDir: string;
  /** Human-readable provenance, for error messages and the step summary. */
  readonly describe: string;
  /** Absolute path to the exact bytes of `patches/<file>` for this tree. */
  patchPath(file: string): string;
}

function requireName(file: string): string {
  if (!PATCH_NAME.test(file)) throw new Error(`unusable patch file name ${JSON.stringify(file)}`);
  return file;
}

export function workingTreePatches(dir: string = patchesDir()): PatchTree {
  return {
    manifestDir: dir,
    describe: "the checked-out working tree",
    patchPath(file) {
      const path = join(dir, requireName(file));
      if (!existsSync(path)) {
        throw new Error(`patches/${file} is referenced by the manifest but missing from the checkout`);
      }
      return path;
    },
  };
}

/** Raw bytes of `<commit>:patches/<name>`. No encoding: the digest must be of the stored bytes. */
function showBytes(repoDir: string, commit: string, name: string): Buffer {
  try {
    return execFileSync("git", ["-C", repoDir, "show", `${commit}:patches/${name}`], {
      maxBuffer: MAX_PATCH_BYTES,
      timeout: 120_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) {
    throw new Error(`could not read patches/${name} at ${commit}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function requirePresent(repoDir: string, commit: string): void {
  try {
    execFileSync("git", ["-C", repoDir, "cat-file", "-e", `${commit}^{commit}`], {
      timeout: 60_000,
      stdio: "ignore",
    });
  } catch {
    throw new Error(
      `commit ${commit} is not present in this checkout, so its patches cannot be read; `
        + "the detect job checks out with fetch-depth: 0 for exactly this reason",
    );
  }
}

/**
 * The `patches/` tree as it stood at `commit`, materialized under `dest` so `loadManifest` and
 * `sha256File` can read it like any other directory. Nothing from the working tree is consulted.
 */
export function commitPatches(commit: string, dest: string, repoDir: string = root): PatchTree {
  if (!HEX40.test(commit)) throw new Error(`source commit ${JSON.stringify(commit)} is not a 40-hex commit`);
  requirePresent(repoDir, commit);
  mkdirSync(dest, { recursive: true });
  writeFileSync(join(dest, "manifest.json"), showBytes(repoDir, commit, "manifest.json"));
  return {
    manifestDir: dest,
    describe: `commit ${commit}`,
    patchPath(file) {
      const name = requireName(file);
      const path = join(dest, name);
      writeFileSync(path, showBytes(repoDir, commit, name));
      return path;
    },
  };
}
