import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Runner } from "../env";

export function defaultV8Target(): string {
  const isArm = process.arch === "arm64";
  if (process.platform === "darwin") return isArm ? "aarch64-apple-darwin" : "x86_64-apple-darwin";
  if (process.platform === "linux") return isArm ? "aarch64-unknown-linux-gnu" : "x86_64-unknown-linux-gnu";
  return isArm ? "aarch64-pc-windows-msvc" : "x86_64-pc-windows-msvc";
}

const PYTHON_RESOLVE_SCRIPT = [
  "import json, os, sys",
  "repo = sys.argv[1]",
  "target = sys.argv[2]",
  "os.environ['CODEX_REPO_ROOT'] = repo",
  "sys.path.insert(0, repo)",
  "from scripts.codex_package.targets import TARGET_SPECS",
  "from scripts.codex_package.v8 import resolve_codex_v8_cargo_env",
  "spec = TARGET_SPECS.get(target)",
  "if spec:",
  "    print(json.dumps(resolve_codex_v8_cargo_env(spec)))",
  "else:",
  "    print('{}')",
].join("\n");

/**
 * Ensures OpenAI's verified V8 sandbox archive and bindings are downloaded and available
 * before invoking Cargo. Upstream Codex enables `v8/v8_enable_sandbox`, which has no
 * official denoland prebuilts and otherwise fails with a 404 from crates.io build.rs.
 */
export function resolveV8Env(sourceDir: string, run: Runner, log: (line: string) => void): Record<string, string> {
  if (process.env.RUSTY_V8_ARCHIVE && process.env.RUSTY_V8_SRC_BINDING_PATH) {
    return {
      RUSTY_V8_ARCHIVE: process.env.RUSTY_V8_ARCHIVE,
      RUSTY_V8_SRC_BINDING_PATH: process.env.RUSTY_V8_SRC_BINDING_PATH,
    };
  }

  const v8Script = join(sourceDir, "scripts", "codex_package", "v8.py");
  if (!existsSync(v8Script)) {
    return {};
  }

  const target = defaultV8Target();
  log(`resolving Codex V8 dependencies for ${target}...`);
  for (const py of ["python3", "python"]) {
    const r = run(py, ["-c", PYTHON_RESOLVE_SCRIPT, sourceDir, target], { cwd: sourceDir });
    if (r.status === 0 && r.stdout.trim()) {
      try {
        const parsed = JSON.parse(r.stdout.trim()) as Record<string, string>;
        if (parsed.RUSTY_V8_ARCHIVE && parsed.RUSTY_V8_SRC_BINDING_PATH) {
          log(`using Codex V8 archive: ${parsed.RUSTY_V8_ARCHIVE}`);
          return parsed;
        }
      } catch {
        // Fall through to try next binary or log warning
      }
    }
  }

  log("warning: could not resolve Codex V8 dependencies via python; build may fail if V8 prebuilts are needed");
  return {};
}
