/**
 * `assemble`: run upstream's own packager (`scripts/build_codex_package.py`) on the two binaries
 * `cargo build` just produced, into the staging directory `package` will add the legal files to.
 * A thin adapter: the command itself lives in `src/patch/package-assemble.ts`, shared with
 * `cxstatusline install --compile`.
 */
import { spawnSync } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { join, resolve } from "node:path";
import type { Runner } from "../../src/env";
import { codexTarget } from "../../src/distribution";
import { assemblePackage, findPython } from "../../src/patch/package-assemble";
import { emit, releasePlatform, required, resetDirectory, runnerTmp } from "./env";
import { STAGING_TOP_LEVEL } from "./pack";

const run: Runner = (cmd, args, opts) => {
  const r = spawnSync(cmd, args, { cwd: opts?.cwd, env: opts?.env ?? process.env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
};

function which(cmd: string): string | null {
  for (const dir of (process.env.PATH ?? "").split(":").filter(Boolean)) {
    const p = join(dir, cmd);
    try {
      accessSync(p, constants.X_OK);
      return p;
    } catch {
      /* next */
    }
  }
  return null;
}

export async function runAssemble(flags: Record<string, string>): Promise<void> {
  const upstream = resolve(required(flags, "upstream"));
  const codexVersion = required(flags, "codex-version");
  const platform = releasePlatform(flags);
  const out = resolve(required(flags, "out"));
  const python = flags["python"] && flags["python"] !== "true" ? flags["python"] : findPython(which, run);
  if (python === null) throw new Error("no Python >= 3.10 on PATH; upstream's packager needs one (brew install python)");
  const cargo = which("cargo");
  if (cargo === null) throw new Error("cargo is not on PATH");
  const release = join(upstream, "codex-rs", "target", "release");
  // A reused self-hosted workspace: only ever delete a directory that looks like our staging.
  resetDirectory(out, (entries) => entries.every((e) => STAGING_TOP_LEVEL.includes(e)));
  assemblePackage({
    upstream,
    target: codexTarget(platform),
    codexVersion,
    codex: join(release, "codex"),
    codeModeHost: join(release, "codex-code-mode-host"),
    packageDir: out,
    python,
    cargo,
    bwrapBin: null,
    tmpDir: runnerTmp("codex-package-cache"),
    force: true,
  }, run, (line) => process.stderr.write(`${line}\n`));
  emit({ package_dir: out, target: codexTarget(platform), python });
}
