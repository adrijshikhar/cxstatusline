/**
 * Upstream's own packager, `scripts/build_codex_package.py`, run with our two patched binaries.
 * This is the single place that command is spelled out: `--compile` on a user's machine and the
 * release builders (`scripts/prebuilt.ts assemble`) both call `assemblePackage`.
 *
 * What the script does (`scripts/codex_package/*.py` in every supported tag): fetches the pinned
 * ripgrep and the patched zsh from GitHub releases, verifying size and sha256 against the DotSlash
 * manifests committed in the checkout; on Linux builds `bwrap` from the vendored bubblewrap source
 * unless `--bwrap-bin` is given; writes `codex-package.json`; validates the tree it wrote.
 */
import { join } from "node:path";
import type { Runner } from "../env";

/** Interpreters tried in order; the script needs 3.10+ (`Path | None` annotations). */
export const PYTHON_CANDIDATES = ["python3.13", "python3.12", "python3.11", "python3.10", "python3"] as const;
export const PYTHON_VERSION_CHECK = "import sys; sys.exit(sys.version_info < (3, 10))";

export interface AssembleInput {
  /** The patched upstream checkout (`CODEX_REPO_ROOT`; holds `scripts/build_codex_package.py`). */
  readonly upstream: string;
  /** Rust target triple recorded in `codex-package.json`; must equal the running binary's own. */
  readonly target: string;
  readonly codexVersion: string;
  /** Absolute paths of the two patched executables. */
  readonly codex: string;
  readonly codeModeHost: string;
  /** Output directory. Must be empty unless `force`, which wipes it first. */
  readonly packageDir: string;
  readonly python: string;
  readonly cargo: string;
  /** A system bubblewrap to bundle instead of building one (Linux only; Codex prefers it at runtime anyway). */
  readonly bwrapBin?: string | null;
  /** Where the script caches its downloads. Never world-writable `/tmp` on a shared host. */
  readonly tmpDir: string;
  readonly force: boolean;
}

/** The exact argv, for logs and tests. */
export function assembleArgs(input: AssembleInput): string[] {
  const args = [
    join(input.upstream, "scripts", "build_codex_package.py"),
    "--variant", "codex",
    "--target", input.target,
    "--package-version", input.codexVersion,
    "--entrypoint-bin", input.codex,
    "--code-mode-host-bin", input.codeModeHost,
    "--cargo", input.cargo,
    "--cargo-profile", "release",
    "--package-dir", input.packageDir,
  ];
  if (input.bwrapBin) args.push("--bwrap-bin", input.bwrapBin);
  if (input.force) args.push("--force");
  return args;
}

/**
 * The environment the script runs with: only what it needs. Never `CARGO_TARGET_DIR` (it would
 * move the bwrap build away from where the script looks) or `PYTHONPATH` (a stray module could
 * shadow `codex_package`).
 */
export function assembleEnv(input: AssembleInput, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const keep = ["PATH", "HOME", "CARGO_HOME", "RUSTUP_HOME", "HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY", "https_proxy", "http_proxy", "no_proxy", "SSL_CERT_FILE", "RUSTC_WRAPPER", "SCCACHE_DIR"];
  const env: NodeJS.ProcessEnv = {};
  for (const key of keep) if (base[key] !== undefined) env[key] = base[key];
  env.CODEX_REPO_ROOT = input.upstream;
  env.TMPDIR = input.tmpDir;
  return env;
}

export function assemblePackage(input: AssembleInput, run: Runner, log: (line: string) => void): void {
  const args = assembleArgs(input);
  log(`$ ${[input.python, ...args].join(" ")}`);
  const r = run(input.python, args, { cwd: input.upstream, env: assembleEnv(input) });
  for (const line of `${r.stdout}${r.stderr}`.split("\n").filter(Boolean)) log(line);
  if (r.status !== 0) {
    throw new Error(`build_codex_package.py failed (exit ${String(r.status)}): ${(r.stderr || r.stdout).trim().split("\n").slice(-12).join("\n")}`);
  }
}

/** The first interpreter on PATH that is Python >= 3.10, or null. */
export function findPython(which: (cmd: string) => string | null, run: Runner): string | null {
  for (const candidate of PYTHON_CANDIDATES) {
    const bin = which(candidate);
    if (bin === null) continue;
    if (run(bin, ["-c", PYTHON_VERSION_CHECK]).status === 0) return bin;
  }
  return null;
}

/** The triple `rustc` was built for: what the binaries it produces report to upstream's daemon. */
export function rustcHostTarget(run: Runner): string {
  const r = run("rustc", ["-vV"]);
  const host = /^host:\s*(\S+)\s*$/m.exec(r.stdout)?.[1];
  if (r.status !== 0 || !host) throw new Error(`rustc -vV did not report a host target: ${(r.stderr || r.stdout).trim().slice(0, 200)}`);
  return host;
}
