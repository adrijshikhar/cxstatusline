#!/usr/bin/env bun
/**
 * CLI helper for upstream parity workflows between sirmalloc/ccstatusline and cxstatusline.
 *
 * Provides commands to check upstream diffs, triage commits, inspect patches,
 * and manage baseline commit tracking.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { execGh, ghJson, ghText, type GhRunner } from "./prebuilt/gh";

export type TriageCategory = "A (Direct)" | "B (Adapt)" | "C (Skip)" | "D (Tooling)";

export interface CommitEntry {
  readonly sha?: string;
  readonly shortSha: string;
  readonly title: string;
  readonly category: TriageCategory;
  readonly url?: string;
}

export interface RawCommit {
  readonly sha: string;
  readonly commit: {
    readonly message: string;
  };
  readonly html_url?: string;
}

export interface RawCompareResult {
  readonly total_commits: number;
  readonly commits: readonly RawCommit[];
  readonly html_url?: string;
}

export interface UpstreamConfig {
  readonly repo: string;
  readonly baseCommit: string;
}

const DEFAULT_CONFIG_PATH = join(import.meta.dir, "upstream-ccstatusline.json");

/**
 * Classify a commit message into one of four triage categories:
 * - Category C (Skip/Drop): Claude-specific auth, keychain, OAuth, external tools
 * - Category D (Tooling): Dev dependencies, build configs, formatting/linting tooling
 * - Category B (Adapt): Usage, session duration, telemetry, reset timers, rate limits
 * - Category A (Direct): Git/JJ widgets, powerline, terminal width, layout, formatting
 */
export function classifyCommit(title: string): TriageCategory {
  const normalized = title.trim();

  // Category C: Claude-specific auth, keychain, OAuth, anthropic APIs
  if (
    /\b(keychain|oauth|auth|claudenews|anthropic)\b/i.test(normalized) ||
    /claude\s*(token|login|tier)/i.test(normalized)
  ) {
    return "C (Skip)";
  }

  // Category D: Dev-dependencies, build configuration, CI, package bump
  if (
    /^chore\((deps|deps-dev|ci|release)\)/i.test(normalized) ||
    /\b(deps-dev|dependency|dependencies)\b/i.test(normalized) ||
    /\bbump\s+(typescript|biome|chalk|react|ink|eslint)\b/i.test(normalized)
  ) {
    return "D (Tooling)";
  }

  // Category B: Usage, session, telemetry, rate limits, reset timers
  if (
    /\b(usage|rate[ -]?limit|reset[ -]?timer|session|telemetry|five[ -]?hour|weekly)\b/i.test(normalized) ||
    /\bno-data\b/i.test(normalized)
  ) {
    return "B (Adapt)";
  }

  // Category A: Direct port (widgets, git, terminal, layout, symbols, powerline, llms.txt)
  if (
    /\b(widget|widgets|git|jj|terminal|flex|width|command|symbol|powerline|ansi|layout|theme|llms\.txt|preview)\b/i.test(
      normalized,
    )
  ) {
    return "A (Direct)";
  }

  // Default to A (Direct) so unfamiliar commits prompt review rather than omission
  return "A (Direct)";
}

/**
 * Parses GitHub compare API payload into CommitEntry objects.
 */
export function parseCompareResult(raw: RawCompareResult): CommitEntry[] {
  if (!raw || !Array.isArray(raw.commits)) {
    return [];
  }
  return raw.commits.map((c) => {
    const fullSha = c.sha ?? "";
    const shortSha = fullSha.slice(0, 7);
    const message = c.commit?.message ?? "";
    const title = message.split("\n")[0]?.trim() ?? "";
    const category = classifyCommit(title);
    return {
      sha: fullSha,
      shortSha,
      title,
      category,
      url: c.html_url,
    };
  });
}

/**
 * Formats a list of commit entries as a GitHub-flavored markdown triage table.
 */
export function formatTriageTable(commits: readonly CommitEntry[]): string {
  const header = "| SHA | Category | Title |";
  const divider = "| --- | --- | --- |";
  const rows = commits.map((c) => `| ${c.shortSha} | ${c.category} | ${c.title} |`);
  return [header, divider, ...rows].join("\n");
}

/**
 * Loads upstream repository baseline configuration.
 */
export function loadUpstreamConfig(configPath: string = DEFAULT_CONFIG_PATH): UpstreamConfig {
  const raw = readFileSync(configPath, "utf8");
  return JSON.parse(raw) as UpstreamConfig;
}

/**
 * Saves upstream repository baseline configuration.
 */
export function saveUpstreamConfig(config: UpstreamConfig, configPath: string = DEFAULT_CONFIG_PATH): void {
  const serialized = JSON.stringify(config, null, 2) + "\n";
  writeFileSync(configPath, serialized, "utf8");
}

/**
 * Handles the `check` subcommand: inspects upstream commits between baseCommit and HEAD/tag.
 */
export async function runCheck(options: {
  readonly repo?: string;
  readonly baseCommit?: string;
  readonly head?: string;
  readonly ccCheckout?: string;
  readonly json?: boolean;
  readonly ghRunner?: GhRunner;
}): Promise<void> {
  const config = loadUpstreamConfig();
  const repo = options.repo ?? config.repo;
  const baseCommit = options.baseCommit ?? config.baseCommit;
  const head = options.head ?? "HEAD";
  const gh = options.ghRunner ?? execGh;

  if (options.ccCheckout) {
    const res = spawnSync("git", ["-C", options.ccCheckout, "log", "--format=%H%x09%s", `${baseCommit}..${head}`], {
      encoding: "utf8",
    });
    if (res.status !== 0) {
      throw new Error(`Failed to query local git checkout at ${options.ccCheckout}: ${res.stderr}`);
    }
    const lines = res.stdout.trim().split("\n").filter(Boolean);
    const commits: CommitEntry[] = lines.map((line) => {
      const [rawSha, ...rest] = line.split("\t");
      const sha = rawSha ?? "";
      const title = rest.join("\t").trim();
      const shortSha = sha.slice(0, 7);
      return {
        sha,
        shortSha,
        title,
        category: classifyCommit(title),
      };
    });

    if (options.json) {
      console.log(JSON.stringify(commits, null, 2));
      return;
    }

    printCheckSummary(repo, baseCommit, head, commits);
    return;
  }

  const compare = ghJson<RawCompareResult>(gh, ["api", `repos/${repo}/compare/${baseCommit}...${head}`]);
  const parsed = parseCompareResult(compare);

  if (options.json) {
    console.log(JSON.stringify(parsed, null, 2));
    return;
  }

  printCheckSummary(repo, baseCommit, head, parsed, compare.html_url);
}

function printCheckSummary(
  repo: string,
  baseCommit: string,
  head: string,
  commits: readonly CommitEntry[],
  compareUrl?: string,
): void {
  console.log(`\n🔍 Upstream Parity Check: ${repo}`);
  console.log(`   Baseline: ${baseCommit.slice(0, 7)}`);
  console.log(`   Target:   ${head}`);
  if (compareUrl) console.log(`   Compare:  ${compareUrl}`);
  console.log(`   Commits:  ${commits.length} new commit(s)\n`);

  if (commits.length === 0) {
    console.log("✅ Up to date with upstream baseline.");
    return;
  }

  const catCounts = commits.reduce(
    (acc, c) => {
      acc[c.category] = (acc[c.category] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  console.log("📊 Category Breakdown:");
  for (const [cat, count] of Object.entries(catCounts)) {
    console.log(`   - ${cat}: ${count}`);
  }
  console.log("");
  console.log(formatTriageTable(commits));
}

/**
 * Handles the `diff` subcommand: fetches commit diff or stat.
 */
export async function runDiff(
  commitOrRange: string,
  options: {
    readonly repo?: string;
    readonly ccCheckout?: string;
    readonly stat?: boolean;
    readonly ghRunner?: GhRunner;
  },
): Promise<void> {
  const config = loadUpstreamConfig();
  const repo = options.repo ?? config.repo;
  const gh = options.ghRunner ?? execGh;

  if (options.ccCheckout) {
    const args = ["-C", options.ccCheckout, "show"];
    if (options.stat) args.push("--stat");
    args.push(commitOrRange);

    const res = spawnSync("git", args, { encoding: "utf8" });
    if (res.status !== 0) {
      throw new Error(`Failed to show commit ${commitOrRange} from ${options.ccCheckout}: ${res.stderr}`);
    }
    process.stdout.write(res.stdout);
    return;
  }

  if (options.stat) {
    const isRange = commitOrRange.includes("...");
    const endpoint = isRange
      ? `repos/${repo}/compare/${commitOrRange}`
      : `repos/${repo}/commits/${commitOrRange}`;
    const data = ghJson<{
      stats?: { total: number; additions: number; deletions: number };
      files?: Array<{ filename: string; additions: number; deletions: number; status: string }>;
    }>(gh, ["api", endpoint]);

    if (data.stats) {
      console.log(`Total changes: +${data.stats.additions} -${data.stats.deletions} (total ${data.stats.total})`);
    }
    if (data.files) {
      for (const file of data.files) {
        console.log(`  ${file.status.padEnd(8)} +${file.additions} -${file.deletions} ${file.filename}`);
      }
    }
    return;
  }

  const isRange = commitOrRange.includes("...");
  const endpoint = isRange
    ? `repos/${repo}/compare/${commitOrRange}`
    : `repos/${repo}/commits/${commitOrRange}`;

  const diffText = ghText(gh, ["api", endpoint, "-H", "Accept: application/vnd.github.v3.diff"]);
  process.stdout.write(diffText);
}

/**
 * Handles the `apply-baseline` (or `update-baseline`) subcommand.
 */
export function runApplyBaseline(commit: string, configPath?: string): void {
  if (!commit || commit.trim().length < 7) {
    throw new Error("Invalid commit SHA provided to apply-baseline.");
  }
  const config = loadUpstreamConfig(configPath);
  const updated: UpstreamConfig = {
    ...config,
    baseCommit: commit.trim(),
  };
  saveUpstreamConfig(updated, configPath);
  console.log(`✅ Updated upstream baseline commit to ${commit.trim()} in ${configPath ?? DEFAULT_CONFIG_PATH}`);
}

function printHelp(): void {
  console.log(`
Usage: bun run scripts/port-upstream.ts <command> [options]

Commands:
  check                     Compare upstream repository against current baseline commit
  diff <commit>             Fetch patch/diff for an upstream commit
  apply-baseline <commit>   Update scripts/upstream-ccstatusline.json to new base commit
  update-baseline <commit>  Alias for apply-baseline

Options:
  --repo <repo>             Upstream repository (default: sirmalloc/ccstatusline)
  --head <ref>              Head ref to compare against (default: HEAD)
  --base <commit>           Base commit to compare from
  --cc-checkout <path>      Path to local clone of ccstatusline
  --stat                    Show diffstat / summary instead of full patch
  --json                    Output results as JSON
  --help, -h                Show this help message
`);
}

// CLI entry point
if (import.meta.main) {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === "--help" || command === "-h" || command === "help") {
    printHelp();
    process.exit(0);
  }

  const parseOption = (name: string): string | undefined => {
    const idx = args.indexOf(name);
    return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : undefined;
  };

  const hasFlag = (name: string): boolean => args.includes(name);

  try {
    switch (command) {
      case "check": {
        await runCheck({
          repo: parseOption("--repo"),
          baseCommit: parseOption("--base"),
          head: parseOption("--head"),
          ccCheckout: parseOption("--cc-checkout"),
          json: hasFlag("--json"),
        });
        break;
      }
      case "diff": {
        const commit = args[1] && !args[1].startsWith("-") ? args[1] : undefined;
        if (!commit) {
          console.error("Error: 'diff' requires a commit SHA or range argument.");
          process.exit(1);
        }
        await runDiff(commit, {
          repo: parseOption("--repo"),
          ccCheckout: parseOption("--cc-checkout"),
          stat: hasFlag("--stat"),
        });
        break;
      }
      case "apply-baseline":
      case "update-baseline": {
        const commit = args[1] && !args[1].startsWith("-") ? args[1] : undefined;
        if (!commit) {
          console.error(`Error: '${command}' requires a target commit SHA argument.`);
          process.exit(1);
        }
        runApplyBaseline(commit);
        break;
      }
      default: {
        console.error(`Unknown command: ${command}`);
        printHelp();
        process.exit(1);
      }
    }
  } catch (err) {
    console.error("Error:", err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
