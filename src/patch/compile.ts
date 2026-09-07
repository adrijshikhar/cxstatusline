import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import type { Context } from "../context";
import { platformFor, type FileDigest, type PreparedPair } from "../distribution";
import { SOURCE_COMMIT, SOURCE_DIRTY, VERSION } from "../version-info";
import type { SemVer } from "../version";
import { buildPatched, type BuildResult } from "./build";
import { GENERATION_EXECUTABLES } from "./generation";

/** Where the compiled pair is staged before activation: same filesystem as the generations. */
const STAGING_PREFIX = "compiled-";

function digestOf(file: string): FileDigest {
  return { sha256: createHash("sha256").update(readFileSync(file)).digest("hex"), size: statSync(file).size };
}

/**
 * The platform label recorded in the provenance.
 * `platformFor` is the published-artifact vocabulary and only knows the platforms we ship for; a
 * source build elsewhere still gets a truthful label rather than a crash or an invented one.
 */
function platformLabel(): string {
  try {
    return platformFor(process.platform, process.arch);
  } catch {
    return `${process.platform}-${process.arch}`;
  }
}

/**
 * Copy the two freshly built executables into a private staging directory under `libexecDir`.
 * Why a copy and not the cargo target paths directly: `activatePair` validates and re-hashes a
 * self-contained directory, and the next `cargo build` in that checkout would overwrite the
 * originals underneath us.
 */
function stage(ctx: Context, built: BuildResult): { directory: string; executables: Record<"codex" | "codex-code-mode-host", FileDigest> } {
  mkdirSync(ctx.paths.libexecDir, { recursive: true });
  const directory = mkdtempSync(join(ctx.paths.libexecDir, STAGING_PREFIX));
  chmodSync(directory, 0o700);
  const sources: Record<(typeof GENERATION_EXECUTABLES)[number], string> = {
    codex: built.codex,
    "codex-code-mode-host": built.codexCodeModeHost,
  };
  const executables: Partial<Record<"codex" | "codex-code-mode-host", FileDigest>> = {};
  // A failed copy or chmod would otherwise leave a half-populated `compiled-*` directory under
  // `libexecDir` that nothing ever removes, and that `revert` then has to explain. Mirrors
  // `stageArchive` in src/distribution/prebuilt.ts.
  try {
    for (const name of GENERATION_EXECUTABLES) {
      const target = join(directory, name);
      copyFileSync(sources[name], target);
      chmodSync(target, 0o755);
      executables[name] = digestOf(target);
    }
  } catch (e) {
    rmSync(directory, { recursive: true, force: true });
    throw e;
  }
  return {
    directory,
    executables: {
      codex: executables.codex as FileDigest,
      "codex-code-mode-host": executables["codex-code-mode-host"] as FileDigest,
    },
  };
}

/**
 * Build the patched pair from source and stage it for activation.
 * The caller owns `pair.directory` and must remove it once `activatePair` has returned - exactly
 * the contract `preparePrebuilt` uses, so both sources converge on one activation path.
 */
export function prepareCompiled(ctx: Context, upstream: SemVer, ref: { file: string; tag: string }): PreparedPair {
  const patchFile = join(ctx.patchesDir, ref.file);
  const patchSha256 = digestOf(patchFile).sha256;
  const built = buildPatched(
    { tag: ref.tag, sourceDir: ctx.paths.sourceDir, patchFile },
    ctx.run,
    ctx.log,
    ctx.which,
  );
  const staged = stage(ctx, built);
  return {
    directory: staged.directory,
    codexVersion: upstream.raw,
    provenance: {
      source: "compiled",
      cxVersion: VERSION,
      platform: platformLabel(),
      patchSha256,
      upstreamCommit: built.upstreamCommit,
      // Stamped into this bundle at build time; null/false for a run straight from source.
      sourceCommit: SOURCE_COMMIT,
      sourceDirty: SOURCE_DIRTY,
      installedAt: ctx.now().toISOString(),
      executables: staged.executables,
    },
  };
}
