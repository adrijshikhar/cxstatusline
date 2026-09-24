/**
 * Automated Upstream Watcher for OpenAI Codex releases.
 *
 * Checks for new stable Codex releases, tests existing statusline patches against the new tag,
 * updates the patch manifest and test fixtures when clean, and opens a maintainer-gated PR.
 * If conflicts are encountered, files a diagnostic issue for maintainer resolution.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { loadManifest, resolvePatch } from "../src/patch/manifest";
import { compareSemver, parseSemver } from "../src/version";
import { selectStableVersion } from "./prebuilt/detect";
import { execGh, ghJson, ghText, type GhRunner } from "./prebuilt/gh";
import { redact } from "./prebuilt/redact";

export interface GitResult {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

export type GitRunner = (args: readonly string[], cwd?: string) => GitResult;

function checkedGit(git: GitRunner, args: readonly string[], cwd: string): string {
  const result = git(args, cwd);
  if (result.status !== 0) throw new Error(`git ${args.slice(0, 2).join(" ")} failed (exit ${result.status}): ${redact(result.stderr.trim())}`);
  return result.stdout;
}

const REPOSITORY = "adrijshikhar/cxstatusline";

export const defaultGitRunner: GitRunner = (args, cwd) => {
  const r = spawnSync("git", [...args], { cwd, encoding: "utf8", timeout: 180_000, maxBuffer: 64 * 1024 * 1024 });
  return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
};

export function bumpMinor(version: string): string {
  const parts = version.split(".").map(Number);
  const p0 = parts[0];
  const p1 = parts[1];
  if (parts.length === 3 && p0 !== undefined && p1 !== undefined && !parts.some(isNaN)) {
    return `${p0}.${p1 + 1}.0`;
  }
  return `${version}.next`;
}

export function updateManifestContent(content: string, newVersion: string, patchFile: string, patchVersion?: number): string {
  const m = JSON.parse(content) as { version: number; candidate?: string; patches: Array<{ min: string; max: string; file: string; patchVersion?: number; [key: string]: unknown }>; [key: string]: unknown };
  const existing = m.patches.find((p) => p.min === newVersion && p.max === newVersion);
  if (existing) {
    if (m.version === 2 && existing.patchVersion !== patchVersion) throw new Error(`conflicting patch ownership for Codex ${newVersion}`);
    return content;
  }
  if (m.version === 2 && (!Number.isSafeInteger(patchVersion) || patchVersion! < 1)) throw new Error("patchVersion is required for format 2 manifests");
  const version = parseSemver(newVersion);
  if (!version || version.pre !== null) throw new Error(`invalid stable Codex version ${newVersion}`);
  if (m.patches.some((p) => {
    const min = parseSemver(p.min);
    const max = parseSemver(p.max);
    return min && max && compareSemver(version, min) >= 0 && compareSemver(version, max) <= 0;
  })) throw new Error(`conflicting patch ownership for Codex ${newVersion}`);
  const candidate = m.candidate ? parseSemver(m.candidate) : null;
  m.candidate = candidate && compareSemver(candidate, version) > 0 ? candidate.raw : version.raw;
  m.patches.push({ min: newVersion, max: newVersion, file: patchFile, ...(m.version === 2 ? { patchVersion } : {}) });
  return `${JSON.stringify(m, null, 2)}\n`;
}

export function updateCiPrebuiltTestContent(content: string, newVersion: string): string {
  const pattern = /for \(const version of \["([^"]+)"/;
  const match = content.match(pattern);
  if (!match || match[1] !== newVersion) return content;
  const nextVer = bumpMinor(newVersion);
  return content.replace(`["${match[1]}"`, `["${nextVer}"`);
}

export function updateManifestTestContent(content: string, newVersion: string, patchFile: string): string {
  let updated = content.replace(/expect\(shipped\.candidate\)\.toBe\("[^"]+"\);/, `expect(shipped.candidate).toBe("${newVersion}");`);
  updated = updated.replace(/expect\(resolvePatch\(shipped, v\(shipped\.candidate!\)\)\?\.file\)\.toBe\("[^"]+"\);/, `expect(resolvePatch(shipped, v(shipped.candidate!))?.file).toBe("${patchFile}");`);
  return updated;
}

export function updatePackageTestContent(content: string, patchFile: string): string {
  const fullRef = `"patches/${patchFile}"`;
  if (content.includes(fullRef)) return content;
  const targetPattern = /"patches\/codex-[^"]+\.patch"/g;
  const matches = [...content.matchAll(targetPattern)];
  if (matches.length === 0) return content;
  const lastMatch = matches[matches.length - 1];
  if (!lastMatch || lastMatch.index === undefined) return content;
  const insertPos = lastMatch.index + lastMatch[0].length;
  return content.slice(0, insertPos) + `, ${fullRef}` + content.slice(insertPos);
}

export async function defaultFetchReleases(token?: string): Promise<string> {
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "user-agent": "cxstatusline-upstream-watch",
  };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch("https://api.github.com/repos/openai/codex/releases?per_page=100", {
    headers,
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`upstream releases API failed: HTTP ${res.status}`);
  const releases = await res.json();
  return selectStableVersion(releases);
}

export async function defaultFetchReleaseNotes(tag: string, token?: string): Promise<string | null> {
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "user-agent": "cxstatusline-upstream-watch",
  };
  if (token) headers.authorization = `Bearer ${token}`;
  try {
    const res = await fetch(`https://api.github.com/repos/openai/codex/releases/tags/${encodeURIComponent(tag)}`, {
      headers,
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return null;
    const release = (await res.json()) as { body?: string | null };
    return release.body ?? null;
  } catch {
    return null;
  }
}

export const RELEVANT_CHANGE_PATTERN =
  /\b(tui|footer|composer|bottom_pane|status(?:line)?|ratelimit|rate_limit|rate-limit|widget|layout|render|terminal|chatwidget|pane|sparkle|indicator)\b/i;

export function extractRelevantChanges(changelog: string): string[] {
  const lines = changelog.split("\n");
  const matches: string[] = [];
  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    if (/^#{1,6}\s+/.test(trimmed)) continue;
    if (RELEVANT_CHANGE_PATTERN.test(trimmed)) {
      matches.push(trimmed);
    }
  }
  return matches;
}

export function formatConflictIssueBody(
  version: string,
  tag: string,
  lastPatch: string,
  err: string,
  changelog?: string | null,
): string {
  const releaseUrl = `https://github.com/openai/codex/releases/tag/${tag}`;
  const lines: string[] = [
    `## Action Required: Upstream Codex ${version} Released (Patch Conflicts)`,
    "",
    `OpenAI Codex has released tag \`${tag}\`.`,
    `Automated patch application using \`${lastPatch}\` failed with conflicts:`,
    "",
    "```",
    redact(err.slice(0, 2000)),
    "```",
  ];

  if (changelog && changelog.trim().length > 0) {
    const relevant = extractRelevantChanges(changelog);
    if (relevant.length > 0) {
      lines.push(
        "",
        "### 🔍 Potentially Relevant Upstream Changes",
        "The following changes in this release touch TUI, footer, composer, or status components that may relate to our patch:",
        "",
        ...relevant.map((line) => (line.startsWith("- ") || line.startsWith("* ") ? line : `- ${line}`)),
      );
    }

    const MAX_CHANGELOG_CHARS = 25_000;
    let sanitizedChangelog = redact(changelog.trim());
    if (sanitizedChangelog.length > MAX_CHANGELOG_CHARS) {
      sanitizedChangelog =
        sanitizedChangelog.slice(0, MAX_CHANGELOG_CHARS) +
        `\n\n... [Changelog truncated. View full release notes on GitHub](${releaseUrl})`;
    }

    lines.push(
      "",
      "### 📋 Upstream Changelog",
      `<details open>`,
      `<summary><b>Full Changelog for <code>${tag}</code></b> (click to collapse)</summary>`,
      "",
      `[View full release notes on GitHub](${releaseUrl})`,
      "",
      sanitizedChangelog,
      "",
      `</details>`,
    );
  } else {
    lines.push(
      "",
      "### 📋 Upstream Changelog",
      `[View upstream release on GitHub](${releaseUrl})`,
      "",
      "_No release notes were provided in the upstream release or unable to fetch changelog._",
    );
  }

  lines.push(
    "",
    "### Steps to Resolve",
    `1. \`git checkout -b feat/support-codex-${version}\``,
    `2. Resolve conflicts against \`openai/codex\` at tag \`${tag}\``,
    `3. Add \`patches/codex-${version}.patch\` and update \`patches/manifest.json\``,
    "4. Submit pull request for review.",
  );

  return lines.join("\n");
}

export function testPatchAgainstUpstream(
  git: GitRunner,
  upstreamTag: string,
  patchPath: string,
  tempDir: string,
): { clean: boolean; error?: string } {
  const cloneRes = git(["clone", "--depth", "1", "--branch", upstreamTag, "https://github.com/openai/codex.git", tempDir]);
  if (cloneRes.status !== 0) {
    return { clean: false, error: `git clone failed: ${cloneRes.stderr.trim()}` };
  }
  const checkRes = git(["-C", tempDir, "apply", "--check", patchPath]);
  if (checkRes.status === 0) return { clean: true };
  return { clean: false, error: checkRes.stderr.trim() || checkRes.stdout.trim() || "git apply --check failed" };
}

export interface WatchOptions {
  version?: string;
  dryRun?: boolean;
  repoDir?: string;
  token?: string;
  fetchReleases?: (token?: string) => Promise<string>;
  fetchReleaseNotes?: (tag: string, token?: string) => Promise<string | null>;
  git?: GitRunner;
  gh?: GhRunner;
}

export interface WatchResult {
  action: "already_covered" | "pr_exists" | "issue_exists" | "pr_created" | "issue_created" | "dry_run";
  version: string;
  detail?: string;
}

export async function runUpstreamWatch(options: WatchOptions = {}): Promise<WatchResult> {
  const repoDir = options.repoDir ?? join(import.meta.dir, "..");
  const git = options.git ?? defaultGitRunner;
  const gh = options.gh ?? execGh;
  const fetcher = options.fetchReleases ?? defaultFetchReleases;
  const fetchNotes = options.fetchReleaseNotes ?? (options.fetchReleases ? (async () => null) : defaultFetchReleaseNotes);
  const token = options.token ?? process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;

  const targetVersion = options.version && options.version !== "auto"
    ? options.version
    : await fetcher(token);

  const manifest = loadManifest(join(repoDir, "patches"));
  const parsed = parseSemver(targetVersion);
  if (!parsed || parsed.pre !== null) {
    throw new Error(`Target version must be exact stable semver, got: ${targetVersion}`);
  }

  if (resolvePatch(manifest, parsed) !== null) {
    return { action: "already_covered", version: targetVersion, detail: "Manifest already covers version" };
  }

  const branchName = `codex/support-${targetVersion}`;
  const prList = ghJson<unknown[]>(gh, ["pr", "list", "-R", REPOSITORY, "--head", branchName, "--json", "number,url"]);
  if (prList.length > 0) {
    return { action: "pr_exists", version: targetVersion, detail: `PR already open: ${JSON.stringify(prList)}` };
  }

  const latestPatchRange = [...manifest.patches].sort((a, b) => compareSemver(parseSemver(b.max)!, parseSemver(a.max)!))[0];
  if (!latestPatchRange) {
    throw new Error("patches/manifest.json does not contain any patch ranges");
  }
  if (compareSemver(parsed, parseSemver(latestPatchRange.max)!) < 0) {
    return { action: "dry_run", version: targetVersion, detail: "Historical gap requires maintainer review; patch ownership was not inferred." };
  }
  const latestPatchPath = join(repoDir, "patches", latestPatchRange.file);
  const upstreamTag = `${manifest.tag_prefix}${targetVersion}`;
  const scratch = join(tmpdir(), `codex-watch-${targetVersion}-${Date.now()}`);

  try {
    mkdirSync(scratch, { recursive: true });
    const patchTest = testPatchAgainstUpstream(git, upstreamTag, latestPatchPath, scratch);
    const newPatchName = `codex-${targetVersion}.patch`;
    const newPatchPath = join(repoDir, "patches", newPatchName);

    if (patchTest.clean) {
      if (options.dryRun) {
        return { action: "dry_run", version: targetVersion, detail: "Patch applies cleanly; dry run completed." };
      }
      const changelog = await fetchNotes(upstreamTag, token);
      return applyCleanSupport(repoDir, git, gh, targetVersion, newPatchName, newPatchPath, latestPatchPath, branchName, upstreamTag, changelog, latestPatchRange.patchVersion);
    } else {
      if (options.dryRun) {
        return { action: "dry_run", version: targetVersion, detail: `Conflicts detected: ${patchTest.error}` };
      }
      const changelog = await fetchNotes(upstreamTag, token);
      return reportConflictIssue(gh, targetVersion, upstreamTag, latestPatchRange.file, patchTest.error ?? "unknown conflict", changelog);
    }
  } finally {
    if (existsSync(scratch)) rmSync(scratch, { recursive: true, force: true });
  }
}

function applyCleanSupport(
  repoDir: string,
  git: GitRunner,
  gh: GhRunner,
  targetVersion: string,
  patchName: string,
  patchPath: string,
  latestPatchPath: string,
  branchName: string,
  upstreamTag: string,
  changelog?: string | null,
  patchVersion?: number,
): WatchResult {
  checkedGit(git, ["checkout", "-b", branchName], repoDir);
  const patchContent = readFileSync(latestPatchPath, "utf8");
  writeFileSync(patchPath, patchContent, "utf8");

  const manifestFile = join(repoDir, "patches", "manifest.json");
  writeFileSync(manifestFile, updateManifestContent(readFileSync(manifestFile, "utf8"), targetVersion, patchName, patchVersion));

  const ciTest = join(repoDir, "test", "ci-prebuilt.test.ts");
  if (existsSync(ciTest)) writeFileSync(ciTest, updateCiPrebuiltTestContent(readFileSync(ciTest, "utf8"), targetVersion));

  const manifestTest = join(repoDir, "test", "manifest.test.ts");
  if (existsSync(manifestTest)) writeFileSync(manifestTest, updateManifestTestContent(readFileSync(manifestTest, "utf8"), targetVersion, patchName));

  const packageTest = join(repoDir, "test", "package.test.ts");
  if (existsSync(packageTest)) writeFileSync(packageTest, updatePackageTestContent(readFileSync(packageTest, "utf8"), patchName));

  checkedGit(git, ["config", "user.name", "Adrij Shikhar"], repoDir);
  checkedGit(git, ["config", "user.email", "adrijshikhar26@gmail.com"], repoDir);
  checkedGit(git, ["add", "patches/", "test/"], repoDir);
  checkedGit(git, ["commit", "-m", `feat: support Codex ${targetVersion}`], repoDir);
  checkedGit(git, ["push", "-u", "origin", branchName], repoDir);

  const releaseUrl = `https://github.com/openai/codex/releases/tag/${upstreamTag}`;
  const prBodyLines = [
    `## Automated Upstream Watcher: Support Codex ${targetVersion}`,
    "",
    `Upstream Codex release \`${targetVersion}\` was detected and tested.`,
    "The statusline patch applies cleanly; compilation and runtime validation are required before merge.",
    "",
    "### Changes",
    `- Added \`patches/${patchName}\``,
    `- Updated \`patches/manifest.json\` (candidate: \`${targetVersion}\`)`,
    "- Updated workflows and test suites",
    "",
    "### Maintainer Review Gate",
    "Please review and approve this pull request to merge support into `main`.",
    "Once merged, native prebuilts can be built and published upon verification.",
  ];

  if (changelog && changelog.trim().length > 0) {
    const relevant = extractRelevantChanges(changelog);
    if (relevant.length > 0) {
      prBodyLines.push(
        "",
        "### 🔍 Upstream Changes Related to TUI / Statusline",
        ...relevant.map((line) => (line.startsWith("- ") || line.startsWith("* ") ? line : `- ${line}`)),
      );
    }
    prBodyLines.push(
      "",
      "### 📋 Upstream Changelog",
      `<details>`,
      `<summary><b>Full Changelog for <code>${upstreamTag}</code></b> (click to expand)</summary>`,
      "",
      `[View full release notes on GitHub](${releaseUrl})`,
      "",
      redact(changelog.trim().slice(0, 15_000)),
      "",
      `</details>`,
    );
  }

  const bodyFile = join(tmpdir(), `codex-watch-pr-${targetVersion}-${Date.now()}.md`);
  writeFileSync(bodyFile, prBodyLines.join("\n"));
  try {
    const url = ghText(gh, ["pr", "create", "-R", REPOSITORY, "--title", `feat: support Codex ${targetVersion}`, "--body-file", bodyFile]).trim();
    if (!url) throw new Error("gh pr create succeeded without returning a PR URL");
    return { action: "pr_created", version: targetVersion, detail: url };
  } finally { rmSync(bodyFile, { force: true }); }
}

export function reportConflictIssue(
  gh: GhRunner,
  version: string,
  tag: string,
  lastPatch: string,
  err: string,
  changelog?: string | null,
): WatchResult {
  const issueSearch = ghJson<unknown[]>(gh, ["issue", "list", "-R", REPOSITORY, "--search", `in:title Codex ${version} patch conflicts`, "--json", "number,url,title,body"]);
  const matching = issueSearch.find((issue) => typeof issue === "object" && issue !== null
    && (issue as { title?: unknown }).title === `[Action Needed] Support Codex ${version} - patch conflicts detected`);
  if (matching) {
    return { action: "issue_exists", version, detail: `Issue already open: ${JSON.stringify(matching)}` };
  }
  const body = formatConflictIssueBody(version, tag, lastPatch, err, changelog);
  const bodyFile = join(tmpdir(), `codex-watch-issue-${version}-${Date.now()}.md`);
  writeFileSync(bodyFile, body);
  try {
    const url = ghText(gh, ["issue", "create", "-R", REPOSITORY, "--title", `[Action Needed] Support Codex ${version} - patch conflicts detected`, "--body-file", bodyFile]).trim();
    if (!url) throw new Error("gh issue create succeeded without returning an issue URL");
    return { action: "issue_created", version, detail: url };
  } finally { rmSync(bodyFile, { force: true }); }
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const vIdx = args.indexOf("--version");
  const targetVer = vIdx !== -1 && args[vIdx + 1] ? args[vIdx + 1] : undefined;
  const dryRun = args.includes("--dry-run");

  runUpstreamWatch({ version: targetVer, dryRun })
    .then((result) => {
      console.log(`Upstream Watch result: ${result.action} (${result.version})`);
      if (result.detail) console.log(result.detail);
    })
    .catch((err) => {
      console.error("Upstream Watch failed:", err);
      process.exit(1);
    });
}
