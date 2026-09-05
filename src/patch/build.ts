import { existsSync, lstatSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Runner } from "../env";

export interface BuildPlan {
  readonly tag: string;
  readonly sourceDir: string;
  readonly patchFile: string;
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

function must(step: string, run: Runner, log: (l: string) => void, cmd: string, args: string[], cwd?: string): void {
  log(`$ ${[cmd, ...args].join(" ")}`);
  const r = run(cmd, args, cwd ? { cwd } : undefined);
  for (const line of `${r.stdout}${r.stderr}`.split("\n").filter(Boolean)) log(line);
  if (r.status !== 0) throw new BuildError(step, r.stderr || r.stdout);
}

/** Clone or refresh the Codex source, check out `tag`, apply the patch, build. Returns the binary. */
export function buildPatched(plan: BuildPlan, run: Runner, log: (line: string) => void): string {
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
  git("apply --check", "apply", "--index", "--check", plan.patchFile);
  git("apply", "apply", "--index", plan.patchFile);
  const crateDir = join(plan.sourceDir, "codex-rs");
  must("cargo build", run, log, "cargo", ["build", "--release", "-p", "codex-cli", "--bin", "codex"], crateDir);
  const bin = join(crateDir, "target", "release", "codex");
  // Why verify: a cargo run that exits 0 without producing the artifact (wrong -p, a workspace
  // [profile] override moving the output) would otherwise surface as an ENOENT from copyFileSync
  // in the caller, with no step name to report.
  if (!existsSync(bin) || statSync(bin).size === 0) {
    throw new BuildError("cargo build", `cargo exited 0 but ${bin} is missing or empty`);
  }
  return bin;
}
