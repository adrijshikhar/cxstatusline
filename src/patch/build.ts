import { existsSync, lstatSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Runner } from "../env";
import { resolveV8Env } from "./v8";

export interface BuildPlan {
  readonly tag: string;
  readonly sourceDir: string;
  readonly patchFile: string;
}

/** Both executables of one pair, plus the exact upstream commit they were built from. */
export interface BuildResult {
  readonly codex: string;
  readonly codexCodeModeHost: string;
  readonly upstreamCommit: string;
}

export class BuildError extends Error {
  override readonly name = "BuildError";
  constructor(readonly step: string, detail: string) {
    super(`${step}: ${detail.trim() || "failed"}`);
  }
}

const REPO = "https://github.com/openai/codex";
const SNAPSHOT = "codex-rs/tui/src/bottom_pane/snapshots/codex_tui__bottom_pane__footer__tests__cxstatusline_block_preserves_instruction_footer.snap";
const SNAPSHOT_CONTENT = ["---", "source: tui/src/bottom_pane/footer.rs", "expression: terminal.backend()", "---",
  ...["status-0", "status-1", "status-2", "esc esc to edit previous message"].map(s => `"  ${s.padEnd(78)}"`), ""].join("\n");

/** The two binaries one pair is made of, in the order `cargo build` is asked to produce them. */
const TARGETS = ["codex", "codex-code-mode-host"] as const;

const HEX40 = /^[0-9a-f]{40}$/;

export type Which = (cmd: string) => string | null;

function must(step: string, run: Runner, log: (l: string) => void, cmd: string, args: string[], cwd?: string, env?: NodeJS.ProcessEnv): void {
  log(`$ ${[cmd, ...args].join(" ")}`);
  const r = run(cmd, args, { cwd, env });
  for (const line of `${r.stdout}${r.stderr}`.split("\n").filter(Boolean)) log(line);
  if (r.status !== 0) throw new BuildError(step, r.stderr || r.stdout);
}

/**
 * The focused regression suite for the patch itself, run *before* the pair can be activated.
 * `just` is upstream's own entry point (it pins the toolchain and the harness flags); plain
 * `cargo test` is the fallback so a machine without `just` still gets the check rather than
 * silently skipping it. Which one ran is recorded in the log, because "the tests passed" is only
 * meaningful if you can tell what was run.
 */
function runFocusedTests(run: Runner, log: (l: string) => void, which: Which, crateDir: string, env?: NodeJS.ProcessEnv): void {
  if (which("just")) {
    log("running the focused Rust tests with just");
    must("just test", run, log, "just", ["test", "--release", "-p", "codex-tui", "cxstatusline", "--retries", "0"], crateDir, env);
    return;
  }
  log("just is not on PATH; running the focused Rust tests with cargo");
  must("cargo test", run, log, "cargo", ["test", "--release", "-p", "codex-tui", "cxstatusline"], crateDir, env);
}

/** `git -C <sourceDir> rev-parse HEAD`, refusing anything that is not a real commit id. */
function headCommit(plan: BuildPlan, run: Runner): string {
  const r = run("git", ["-C", plan.sourceDir, "rev-parse", "HEAD"]);
  const commit = r.stdout.trim();
  if (r.status !== 0 || !HEX40.test(commit)) {
    throw new BuildError("rev-parse", `${plan.sourceDir} did not report a commit for ${plan.tag}`);
  }
  return commit;
}

/**
 * Refresh the checkout and put it on `plan.tag`, adopting only our own orphaned snapshot fixture.
 * Never a broad `git clean`: the cached Cargo target directory and any file the owner left in the
 * source tree are not ours to delete.
 */
function prepareCheckout(plan: BuildPlan, run: Runner, log: (l: string) => void): void {
  const git = (step: string, ...args: string[]): void => must(step, run, log, "git", ["-C", plan.sourceDir, ...args]);
  if (existsSync(join(plan.sourceDir, ".git"))) {
    git("fetch", "fetch", "--tags", "--filter=blob:none", "origin");
    // Older builds applied without --index. Adopt only our exact orphan fixture so reset can
    // remove it; never clean unrelated untracked files or the cached Cargo target directory.
    const snapshot = join(plan.sourceDir, SNAPSHOT);
    const st = lstatSync(snapshot, { throwIfNoEntry: false });
    if (st) {
      const tracked = run("git", ["-C", plan.sourceDir, "ls-files", "--error-unmatch", "--", SNAPSHOT]);
      if (tracked.status !== 0) {
        if (!st.isFile() || readFileSync(snapshot, "utf8") !== SNAPSHOT_CONTENT) {
          throw new BuildError("snapshot", `conflicting untracked snapshot ${snapshot}; move it aside before retrying`);
        }
        git("stage snapshot", "add", "--", SNAPSHOT);
      }
    }
    git("reset", "reset", "--hard");
  } else {
    // Why not the `git()` helper: `-C <sourceDir>` cannot work before the directory exists.
    must("clone", run, log, "git", ["clone", "--filter=blob:none", REPO, plan.sourceDir]);
  }
  git("checkout", "checkout", "--detach", plan.tag);
}

/**
 * Clone or refresh the Codex source, check out `tag`, apply the patch, build both binaries of the
 * pair from that one checkout, and run the focused regression tests. Returns both paths and the
 * exact upstream commit; the caller stages and activates them.
 */
export function buildPatched(plan: BuildPlan, run: Runner, log: (line: string) => void, which: Which): BuildResult {
  const git = (step: string, ...args: string[]): void => must(step, run, log, "git", ["-C", plan.sourceDir, ...args]);
  prepareCheckout(plan, run, log);
  const upstreamCommit = headCommit(plan, run);
  git("apply --check", "apply", "--index", "--check", plan.patchFile);
  git("apply", "apply", "--index", plan.patchFile);
  const crateDir = join(plan.sourceDir, "codex-rs");
  const v8Env = resolveV8Env(plan.sourceDir, run, log);
  must("cargo build", run, log, "cargo",
    ["build", "--release", "-p", "codex-cli", "--bin", "codex", "-p", "codex-code-mode-host", "--bin", "codex-code-mode-host"],
    crateDir,
    v8Env);
  // Why verify: a cargo run that exits 0 without producing an artifact (wrong -p, a workspace
  // [profile] override moving the output) would otherwise surface as an ENOENT from copyFileSync
  // in the caller, with no step name to report.
  const [codex, codexCodeModeHost] = TARGETS.map((name) => {
    const bin = join(crateDir, "target", "release", name);
    if (!existsSync(bin) || statSync(bin).size === 0) {
      throw new BuildError("cargo build", `cargo exited 0 but ${bin} is missing or empty`);
    }
    return bin;
  }) as [string, string];
  runFocusedTests(run, log, which, crateDir, v8Env);
  return { codex, codexCodeModeHost, upstreamCommit };
}
