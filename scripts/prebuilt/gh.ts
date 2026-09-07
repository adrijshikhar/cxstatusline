/**
 * The `gh` seam.
 *
 * Every GitHub write in this pipeline goes through a `GhRunner`, so `test/prebuilt-publish.test.ts`
 * can script responses and assert the exact argument arrays without a network call, a tag, a
 * release or an issue ever existing. The real runner uses `spawnSync` with an argument array: tags,
 * versions and issue titles are partly attacker-influenced (they come from upstream release data),
 * so nothing is ever handed to a shell.
 */
import { spawnSync } from "node:child_process";
import { redact } from "./redact";

export interface GhResult {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

export type GhRunner = (args: readonly string[]) => GhResult;

/** A `gh` invocation that failed. Its message is already redacted. */
export class GhError extends Error {
  override readonly name = "GhError";
  constructor(
    readonly args: readonly string[],
    readonly result: GhResult,
  ) {
    super(`gh ${args.slice(0, 3).join(" ")} failed (exit ${result.status}): ${redact(result.stderr.trim())}`);
  }
}

const TIMEOUT_MS = 900_000;
const MAX_BUFFER = 64 * 1024 * 1024;

/** The real runner. Argument array only; `gh` authenticates from `GH_TOKEN`/`GITHUB_TOKEN`. */
export const execGh: GhRunner = (args) => {
  const r = spawnSync("gh", [...args], { encoding: "utf8", timeout: TIMEOUT_MS, maxBuffer: MAX_BUFFER });
  if (r.error) throw new Error(`gh could not be started: ${redact(r.error.message)}`);
  return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
};

/** Run `gh` and return stdout, or throw `GhError`. Never swallows a non-zero exit. */
export function ghText(run: GhRunner, args: readonly string[]): string {
  const result = run(args);
  if (result.status !== 0) throw new GhError(args, result);
  return result.stdout;
}

/** Run `gh` and parse its JSON stdout. A parse failure is an error, never an empty default. */
export function ghJson<T>(run: GhRunner, args: readonly string[]): T {
  const stdout = ghText(run, args);
  try {
    return JSON.parse(stdout) as T;
  } catch (e) {
    throw new Error(`gh ${args.slice(0, 3).join(" ")} did not return JSON: ${e instanceof Error ? e.message : e}`);
  }
}
