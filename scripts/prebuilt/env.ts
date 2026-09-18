/**
 * The runner-facing plumbing every subcommand shares: argv, repository facts, `$GITHUB_OUTPUT`,
 * `$GITHUB_STEP_SUMMARY` and the guarded directory reset a reused self-hosted workspace needs.
 *
 * Node APIs only, and every subprocess goes through `execFileSync` with an argument array - tags
 * and versions come from the network, so nothing is ever handed to a shell.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PLATFORMS, type Platform } from "../../src/distribution";

export const root = resolve(import.meta.dir, "..", "..");

const HEX40 = /^[0-9a-f]{40}$/;
const REPO = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}\/[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;

// ---- argv ----

/** `--flag value` / `--flag` only. Positional arguments are a usage error, never a silent default. */
export function parseFlags(argv: readonly string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]!;
    if (!token.startsWith("--")) throw new Error(`unexpected argument ${JSON.stringify(token)}`);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) flags[token.slice(2)] = "true";
    else {
      flags[token.slice(2)] = next;
      i += 1;
    }
  }
  return flags;
}

export function required(flags: Record<string, string>, name: string): string {
  const value = flags[name];
  if (value === undefined || value === "true") throw new Error(`--${name} is required`);
  return value;
}

/** An empty CLI value means "unresolved", which is a reportable state, not a missing flag. */
export function optional(flags: Record<string, string>, name: string): string | null {
  const value = flags[name];
  return value === undefined || value === "" || value === "true" ? null : value;
}

/**
 * The platform of the *release*, which is a property of the release and not of the machine asking.
 * `detect` and `report` run on Linux runners and only ever handle names and digests, so deriving
 * this from `process.arch` (correct for `package`/`verify`, which run on the building machine)
 * would crash there. Arm64 is the whole matrix today - controller addendum item 1.
 */
export function releasePlatform(flags: Record<string, string>): Platform {
  const value = flags["platform"];
  if (value === undefined || value === "true") return "darwin-arm64";
  const platform = PLATFORMS.find((p) => p === value);
  if (platform === undefined) throw new Error(`--platform must be one of ${PLATFORMS.join(", ")}`);
  return platform;
}

export function releasePlatforms(flags: Record<string, string>): Platform[] {
  if (flags["platform"] !== undefined && flags["platforms"] === undefined) {
    return [releasePlatform(flags)];
  }
  const value = flags["platforms"];
  if (value === undefined || value === "true") return ["darwin-arm64"];
  if (value === "all") return [...PLATFORMS];
  if (value === "darwin") return ["darwin-arm64", "darwin-x64"];
  if (value === "linux") return ["linux-x64", "linux-arm64"];
  const tokens = value.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
  return tokens.flatMap((token) => {
    if (token === "arm64") return ["darwin-arm64"];
    if (token === "x64") return ["darwin-x64"];
    if (token === "darwin") return ["darwin-arm64", "darwin-x64"];
    if (token === "linux") return ["linux-x64", "linux-arm64"];
    if (token === "all") return [...PLATFORMS];
    const found = PLATFORMS.find((p) => p === token);
    if (found === undefined) {
      throw new Error(`--platforms must be one of ${PLATFORMS.join(", ")} or arm64, x64 (got ${JSON.stringify(token)})`);
    }
    return [found];
  });
}

export function repoSlug(flags: Record<string, string>): string {
  const repo = flags["repo"] ?? process.env.GITHUB_REPOSITORY;
  if (repo === undefined || repo === "true") throw new Error("--repo or GITHUB_REPOSITORY is required");
  if (!REPO.test(repo)) throw new Error(`unusable repository ${JSON.stringify(repo)}`);
  return repo;
}

// ---- repository facts ----

export function git(args: readonly string[]): string {
  return execFileSync("git", [...args], { encoding: "utf8", timeout: 300_000, maxBuffer: 8 * 1024 * 1024 }).trim();
}

export function cxVersion(): string {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version?: unknown };
  if (typeof pkg.version !== "string") throw new Error("package.json has no version");
  return pkg.version;
}

export function patchesDir(): string {
  return join(root, "patches");
}

/**
 * The commit the release is built from.
 *
 * `GITHUB_SHA` is deliberately NOT consulted: on a scheduled run it stays at the default-branch
 * head while `validate`/`native`/`publish` check out `needs.detect.outputs.source_commit`, so
 * trusting it would stamp a manifest with a commit the build never used - and `publish` would then
 * refuse its own artifact set forever. Callers that already know the frozen commit pass it in;
 * everyone else gets the checkout's own `HEAD`, which is the commit actually being built.
 */
export function sourceCommit(explicit?: string | null): string {
  const commit = explicit ?? git(["-C", root, "rev-parse", "HEAD"]);
  if (!HEX40.test(commit)) throw new Error(`source commit ${JSON.stringify(commit)} is not a 40-hex commit`);
  return commit;
}

export function upstreamCommit(upstream: string): string {
  const commit = git(["-C", upstream, "rev-parse", "HEAD"]);
  if (!HEX40.test(commit)) throw new Error("upstream checkout has no usable commit");
  return commit;
}

// ---- workspace ----

/**
 * Recursive deletion of a caller-supplied path, but only when the directory still looks like the
 * thing we put there. A self-hosted runner reuses its workspace, so these directories do have to
 * be reset - and a mistyped `--upstream /Users/me` must not be what does it.
 */
export function resetDirectory(dir: string, looksOurs: (entries: readonly string[]) => boolean): void {
  if (!existsSync(dir)) return;
  const entries = readdirSync(dir);
  if (entries.length > 0 && !looksOurs(entries)) {
    throw new Error(`refusing to delete ${dir}: it does not look like a directory this script created`);
  }
  rmSync(dir, { recursive: true, force: true });
}

/** A scratch directory under `RUNNER_TEMP` when there is one, so CI cleans it up for us. */
export function runnerTmp(name: string): string {
  const dir = join(process.env.RUNNER_TEMP ?? tmpdir(), name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ---- CI channels ----

/**
 * A single-line rendering of a message, so it can be carried as a step output. `$GITHUB_OUTPUT`
 * is a `key=value` file: a newline inside a value would be read as the start of another output.
 */
export function oneLine(text: string, max = 500): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length <= max ? collapsed : `${collapsed.slice(0, max - 1)}\u2026`;
}

export function emit(values: Record<string, string>): void {
  for (const [k, v] of Object.entries(values)) {
    // Refused rather than truncated: a multi-line value silently corrupts every later output.
    if (/[\r\n]/.test(v)) throw new Error(`output ${k} contains a newline; pass it through oneLine()`);
  }
  const body = Object.entries(values).map(([k, v]) => `${k}=${v}\n`).join("");
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, body);
  process.stdout.write(body);
}

export function summary(lines: readonly string[]): void {
  const body = `${lines.join("\n")}\n`;
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, body);
  process.stderr.write(body);
}
