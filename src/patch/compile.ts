import { chmodSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { Context } from "../context";
import { digestOf } from "../digest";
import { platformFor, type PreparedPair } from "../distribution";
import { SOURCE_COMMIT, SOURCE_DIRTY, VERSION } from "../version-info";
import type { SemVer } from "../version";
import { buildPatched } from "./build";
import { packageFiles } from "./generation";
import { assemblePackage, findPython, rustcHostTarget } from "./package-assemble";

/** Where the compiled package is staged before activation: same filesystem as the generations. */
const STAGING_PREFIX = "compiled-";

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
 * Build the patched pair from source, then have upstream's own packager turn it into a package
 * directory staged for activation. The caller owns `pair.directory` until `activatePair` moves it
 * into the generations tree - exactly the contract `preparePrebuilt` uses.
 */
export function prepareCompiled(
  ctx: Context,
  upstream: SemVer,
  ref: { file: string; tag: string; patchVersion?: number },
  onStatus?: (phase: string, message: string) => void,
): PreparedPair {
  const patchFile = join(ctx.patchesDir, ref.file);
  const patchSha256 = digestOf(patchFile).sha256;
  const built = buildPatched(
    { tag: ref.tag, sourceDir: ctx.paths.sourceDir, patchFile },
    ctx.run,
    ctx.log,
    ctx.which,
    onStatus,
  );
  onStatus?.("stage", "Assembling the Codex package with upstream's packager...");
  const python = findPython(ctx.which, ctx.run);
  if (python === null) throw new Error("Python >= 3.10 is required to assemble the Codex package (brew install python / apt install python3)");
  const cargo = ctx.which("cargo");
  if (cargo === null) throw new Error("cargo is not on PATH");
  mkdirSync(ctx.paths.libexecDir, { recursive: true });
  const directory = mkdtempSync(join(ctx.paths.libexecDir, STAGING_PREFIX));
  chmodSync(directory, 0o700);
  // The packager caches its downloads under TMPDIR; a private directory, never a shared /tmp.
  const tmpDir = mkdtempSync(join(ctx.paths.libexecDir, "download-"));
  chmodSync(tmpDir, 0o700);
  let target: string;
  try {
    target = rustcHostTarget(ctx.run);
    assemblePackage({
      upstream: ctx.paths.sourceDir,
      target,
      codexVersion: upstream.raw,
      codex: built.codex,
      codeModeHost: built.codexCodeModeHost,
      packageDir: directory,
      python,
      cargo,
      bwrapBin: process.platform === "linux" ? ctx.which("bwrap") : null,
      tmpDir,
      force: false,
    }, ctx.run, ctx.log);
  } catch (e) {
    rmSync(directory, { recursive: true, force: true });
    throw e;
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
  const files = packageFiles(directory);
  onStatus?.("stage-done", "Codex package assembled and verified");
  return {
    directory,
    codexVersion: upstream.raw,
    provenance: {
      source: "compiled",
      cxVersion: VERSION,
      platform: platformLabel(),
      target,
      patchVersion: ref.patchVersion,
      patchSha256,
      upstreamCommit: built.upstreamCommit,
      // Stamped into this bundle at build time; null/false for a run straight from source.
      sourceCommit: SOURCE_COMMIT,
      sourceDirty: SOURCE_DIRTY,
      installedAt: ctx.now().toISOString(),
      files,
    },
  };
}
