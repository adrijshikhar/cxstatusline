/**
 * Prebuilt release CLI: `detect | build | package | verify | publish | report`.
 *
 * Runs under `bun` in CI but stays Node-API-only, like `scripts/ci-prebuilt.ts`. Every subprocess
 * is invoked with an argument array - upstream tags and versions come from the network, so nothing
 * is ever handed to a shell. The subcommands live in `scripts/prebuilt/cli-*.ts`, the logic they
 * call in the other `scripts/prebuilt/*` modules, and `./prebuilt/api` re-exports the tested
 * surface so `test/prebuilt*.test.ts` has one import path.
 */
import { runBuild, runMerge, runPackage, runRustNotices, runVerify } from "./prebuilt/cli-build";
import { runDetect } from "./prebuilt/cli-detect";
import { runPublish, runReportCommand } from "./prebuilt/cli-publish";
import { parseFlags } from "./prebuilt/env";

export * from "./prebuilt/api";
export { runMerge, runPackage, runRustNotices } from "./prebuilt/cli-build";
export { resetDirectory, sourceCommit } from "./prebuilt/env";

// ---- CLI ----

const USAGE = [
  "usage: bun scripts/prebuilt.ts <command> [flags]",
  "  detect       [--codex-version auto|X.Y.Z] [--event NAME] [--repo OWNER/NAME] [--platforms P]",
  "               [--self-hosted true|false] [--releases-file FILE] [--source-releases-file FILE]",
  "  build        --codex-version X.Y.Z --upstream DIR",
  "  rust-notices --upstream DIR --out FILE",
  "  package      --codex-version X.Y.Z --cx-version X.Y.Z --source-commit SHA --upstream DIR --staging DIR",
  "               --out DIR --rust-notices FILE [--workflow-url URL] [--platform P]",
  "  verify       --out DIR --codex-version X.Y.Z --cx-version X.Y.Z [--platform P] [--skip-macho]",
  "  merge        --inputs DIR[,DIR...] --out DIR --platforms P[,P...]",
  "  publish      --tag TAG --dir DIR --run-id ID --run-url URL --source-commit SHA",
  "               --codex-version X.Y.Z --cx-version X.Y.Z [--event NAME] [--platforms P]",
  "  report       --detect R --validate R --native R [--merge R] --publish R --codex-version V --tag TAG --run-url URL",
  "               --source-commit SHA --patch-sha256 SHA --event NAME [--cx-version V] [--upstream-tag TAG]",
  "               [--repo OWNER/NAME] [--should-build true|false] [--publish-requested true|false]",
  "               [--release-url URL] [--error-file PATH] [--log-dir DIR] [--blocked-reason TEXT] [--platforms P]",
].join("\n");

if (import.meta.main) {
  const [command, ...rest] = process.argv.slice(2);
  try {
    const flags = parseFlags(rest);
    if (command === "detect") await runDetect(flags);
    else if (command === "build") await runBuild(flags);
    else if (command === "rust-notices") await runRustNotices(flags);
    else if (command === "package") await runPackage(flags);
    else if (command === "verify") await runVerify(flags);
    else if (command === "merge") await runMerge(flags);
    else if (command === "publish") await runPublish(flags);
    else if (command === "report") await runReportCommand(flags);
    else {
      process.stderr.write(`${USAGE}\n`);
      process.exit(2);
    }
  } catch (e) {
    // Anything that reaches here - a malformed patches/manifest.json, a bad flag, a non-stable
    // input version - is a plain error (exit 1), never the blocked-issue exit 3. `runDetect`
    // exits directly (via `process.exit(UNCOVERED_EXIT_CODE)`) for the one failure that is
    // "blocked, not broken", so it never reaches this catch.
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
}
