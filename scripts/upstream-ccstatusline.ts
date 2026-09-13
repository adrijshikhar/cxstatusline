/**
 * Automated Upstream Watcher for ccstatusline (Claude Code statusline).
 *
 * Checks for new releases and commits from sirmalloc/ccstatusline since the last
 * recorded base commit, formats changelog and commit summaries, and opens an issue
 * with the `upstream-parity` label to guide maintainers on feature/bugfix parity.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execGh, ghJson, type GhRunner } from "./prebuilt/gh";
import { redact } from "./prebuilt/redact";

export interface UpstreamConfig {
  readonly repo: string;
  readonly baseCommit: string;
}

export interface CcRelease {
  readonly tag_name: string;
  readonly name?: string;
  readonly body?: string;
  readonly html_url: string;
  readonly published_at: string;
}

export interface CcCommit {
  readonly sha: string;
  readonly commit: {
    readonly message: string;
    readonly author?: { readonly name: string; readonly date: string };
    readonly committer?: { readonly name: string; readonly date: string };
  };
  readonly html_url: string;
}

export interface CcCompare {
  readonly total_commits: number;
  readonly commits: readonly CcCommit[];
  readonly html_url: string;
}

export interface WatchResult {
  readonly action: "up_to_date" | "dry_run" | "issue_exists" | "issue_created";
  readonly releaseTag: string;
  readonly newCommitsCount: number;
  readonly detail?: string;
}

export function loadUpstreamConfig(configPath?: string): UpstreamConfig {
  const path = configPath ?? join(import.meta.dir, "upstream-ccstatusline.json");
  const raw = readFileSync(path, "utf8");
  return JSON.parse(raw) as UpstreamConfig;
}

export function fetchLatestRelease(gh: GhRunner, upstreamRepo: string): CcRelease {
  return ghJson<CcRelease>(gh, ["api", `repos/${upstreamRepo}/releases/latest`]);
}

export function fetchCompare(gh: GhRunner, upstreamRepo: string, baseCommit: string, head: string = "HEAD"): CcCompare {
  return ghJson<CcCompare>(gh, ["api", `repos/${upstreamRepo}/compare/${baseCommit}...${head}`]);
}

export function checkExistingParityIssue(gh: GhRunner, releaseTag: string): { exists: boolean; url?: string } {
  const res = gh(["issue", "list", "--label", "upstream-parity", "--state", "open", "--json", "number,url,title"]);
  if (res.status !== 0 || !res.stdout.trim() || res.stdout.trim() === "[]") {
    return { exists: false };
  }
  try {
    const list = JSON.parse(res.stdout) as Array<{ number: number; url: string; title: string }>;
    const match = list.find((i) => i.title.includes(releaseTag));
    if (match) return { exists: true, url: match.url };
    return { exists: false };
  } catch {
    return { exists: false };
  }
}

export function formatParityIssueBody(config: UpstreamConfig, release: CcRelease, compare: CcCompare): string {
  const firstLines = compare.commits.map((c) => {
    const header = c.commit.message.split("\n")[0] ?? "update";
    const shortSha = c.sha.slice(0, 7);
    return `- [\`${shortSha}\`](${c.html_url}) ${header}`;
  });

  const commitList = firstLines.length > 0 ? firstLines.join("\n") : "_No additional commits._";
  const releaseNotes = release.body && release.body.trim().length > 0
    ? redact(release.body.trim())
    : "_No release notes provided in upstream release._";

  return [
    `## 🔔 Upstream Parity Alert: \`ccstatusline\` ${release.tag_name}`,
    "",
    `A new release or update has been detected in [${config.repo}](https://github.com/${config.repo})!`,
    "",
    `| Detail | Value |`,
    `| :--- | :--- |`,
    `| **Latest Upstream Release** | [${release.tag_name}](${release.html_url}) |`,
    `| **Published Date** | ${release.published_at} |`,
    `| **Baseline Commit** | [\`${config.baseCommit.slice(0, 7)}\`](https://github.com/${config.repo}/commit/${config.baseCommit}) |`,
    `| **Commits Ahead** | ${compare.total_commits} new commit(s) ([view diff](${compare.html_url})) |`,
    "",
    "### 📦 Upstream Release Notes",
    "",
    "<details>",
    "<summary>Click to expand upstream release notes</summary>",
    "",
    releaseNotes,
    "",
    "</details>",
    "",
    "### 🔍 Commits to Evaluate for Parity",
    "",
    commitList,
    "",
    "### 🛠️ Suggested Steps for Porting",
    "1. **Review upstream changes**: Check if any new widgets, themes, renderer optimizations, or bug fixes apply to Codex.",
    "2. **Implement in cxstatusline**: Adapt widgets for Codex session telemetry and types.",
    "3. **Update Baseline**: Update `scripts/upstream-ccstatusline.json` and `NOTICE` with the new upstream commit hash once ported.",
  ].join("\n");
}

export async function runCcstatuslineWatch(options: {
  readonly configPath?: string;
  readonly dryRun?: boolean;
  readonly ghRunner?: GhRunner;
}): Promise<WatchResult> {
  const gh = options.ghRunner ?? execGh;
  const config = loadUpstreamConfig(options.configPath);

  const release = fetchLatestRelease(gh, config.repo);
  const compare = fetchCompare(gh, config.repo, config.baseCommit, release.tag_name);

  if (compare.total_commits === 0) {
    return {
      action: "up_to_date",
      releaseTag: release.tag_name,
      newCommitsCount: 0,
      detail: `Already up to date with ${config.repo}@${release.tag_name}`,
    };
  }

  if (options.dryRun) {
    return {
      action: "dry_run",
      releaseTag: release.tag_name,
      newCommitsCount: compare.total_commits,
      detail: `Dry run complete. ${compare.total_commits} commits found up to ${release.tag_name}.`,
    };
  }

  const existing = checkExistingParityIssue(gh, release.tag_name);
  if (existing.exists) {
    return {
      action: "issue_exists",
      releaseTag: release.tag_name,
      newCommitsCount: compare.total_commits,
      detail: `Issue already open: ${existing.url}`,
    };
  }

  const title = `Upstream Parity: ccstatusline ${release.tag_name} released (${compare.total_commits} commits ahead)`;
  const body = formatParityIssueBody(config, release, compare);

  const createRes = gh([
    "issue",
    "create",
    "--title",
    title,
    "--body",
    body,
    "--label",
    "upstream-parity,enhancement",
  ]);

  return {
    action: "issue_created",
    releaseTag: release.tag_name,
    newCommitsCount: compare.total_commits,
    detail: createRes.stdout.trim(),
  };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");

  runCcstatuslineWatch({ dryRun })
    .then((result) => {
      console.log(`ccstatusline Upstream Watch result: ${result.action} (${result.releaseTag}, ${result.newCommitsCount} commits)`);
      if (result.detail) console.log(result.detail);
    })
    .catch((err) => {
      console.error("ccstatusline Upstream Watch failed:", err);
      process.exit(1);
    });
}
