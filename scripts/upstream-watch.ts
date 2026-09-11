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
import { parseSemver } from "../src/version";
import { selectStableVersion } from "./prebuilt/detect";
import { execGh, type GhRunner } from "./prebuilt/gh";
import { redact } from "./prebuilt/redact";

export interface GitResult {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

export type GitRunner = (args: readonly string[], cwd?: string) => GitResult;

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

export function updateManifestContent(content: string, newVersion: string, patchFile: string): string {
  const m = JSON.parse(content) as { version: number; tag_prefix: string; candidate?: string; patches: Array<{ min: string; max: string; file: string }> };
  if (m.patches.some((p) => p.min === newVersion && p.max === newVersion)) {
    return content;
  }
  m.candidate = newVersion;
  m.patches.push({ min: newVersion, max: newVersion, file: patchFile });
  const patchesFormatted = m.patches
    .map((p) => `    { "min": "${p.min}", "max": "${p.max}", "file": "${p.file}" }`)
    .join(",\n");
  return `{\n  "version": ${m.version},\n  "tag_prefix": "${m.tag_prefix}",\n  "candidate": "${m.candidate}",\n  "patches": [\n${patchesFormatted}\n  ]\n}\n`;
}

export function updatePrebuiltWorkflowContent(content: string, newVersion: string): string {
  const marker = 'options: ["auto", ';
  if (content.includes(`"${newVersion}"`) || !content.includes(marker)) return content;
  return content.replace(marker, `options: ["auto", "${newVersion}", `);
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
  const prCheck = gh(["pr", "list", "--head", branchName, "--json", "number,url"]);
  if (prCheck.status === 0 && prCheck.stdout.trim() !== "[]" && prCheck.stdout.trim().length > 2) {
    return { action: "pr_exists", version: targetVersion, detail: `PR already open: ${prCheck.stdout.trim()}` };
  }

  const latestPatchRange = manifest.patches[manifest.patches.length - 1];
  if (!latestPatchRange) {
    throw new Error("patches/manifest.json does not contain any patch ranges");
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
      return applyCleanSupport(repoDir, git, gh, targetVersion, newPatchName, newPatchPath, latestPatchPath, branchName);
    } else {
      if (options.dryRun) {
        return { action: "dry_run", version: targetVersion, detail: `Conflicts detected: ${patchTest.error}` };
      }
      return reportConflictIssue(gh, targetVersion, upstreamTag, latestPatchRange.file, patchTest.error ?? "unknown conflict");
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
): WatchResult {
  const patchContent = readFileSync(latestPatchPath, "utf8");
  writeFileSync(patchPath, patchContent, "utf8");

  const manifestFile = join(repoDir, "patches", "manifest.json");
  writeFileSync(manifestFile, updateManifestContent(readFileSync(manifestFile, "utf8"), targetVersion, patchName));

  const prebuiltFile = join(repoDir, ".github", "workflows", "prebuilt.yml");
  if (existsSync(prebuiltFile)) {
    writeFileSync(prebuiltFile, updatePrebuiltWorkflowContent(readFileSync(prebuiltFile, "utf8"), targetVersion));
  }

  const ciTest = join(repoDir, "test", "ci-prebuilt.test.ts");
  if (existsSync(ciTest)) writeFileSync(ciTest, updateCiPrebuiltTestContent(readFileSync(ciTest, "utf8"), targetVersion));

  const manifestTest = join(repoDir, "test", "manifest.test.ts");
  if (existsSync(manifestTest)) writeFileSync(manifestTest, updateManifestTestContent(readFileSync(manifestTest, "utf8"), targetVersion, patchName));

  const packageTest = join(repoDir, "test", "package.test.ts");
  if (existsSync(packageTest)) writeFileSync(packageTest, updatePackageTestContent(readFileSync(packageTest, "utf8"), patchName));

  git(["checkout", "-b", branchName], repoDir);
  git(["config", "user.name", "Adrij Shikhar"], repoDir);
  git(["config", "user.email", "adrijshikhar26@gmail.com"], repoDir);
  git(["add", "patches/", ".github/workflows/prebuilt.yml", "test/"], repoDir);
  git(["commit", "-m", `feat: support Codex ${targetVersion}`], repoDir);
  git(["push", "-u", "origin", branchName], repoDir);

  const prBody = [
    `## Automated Upstream Watcher: Support Codex ${targetVersion}`,
    "",
    `Upstream Codex release \`${targetVersion}\` was detected and tested.`,
    "The statusline patch applied cleanly with zero conflicts.",
    "",
    "### Changes",
    `- Added \`patches/${patchName}\``,
    `- Updated \`patches/manifest.json\` (candidate: \`${targetVersion}\`)`,
    "- Updated workflows and test suites",
    "",
    "### Maintainer Review Gate",
    "Please review and approve this pull request to merge support into `main`.",
    "Once merged, native prebuilts can be built and published upon verification.",
  ].join("\n");

  const prRes = gh(["pr", "create", "--title", `feat: support Codex ${targetVersion}`, "--body", prBody]);
  return { action: "pr_created", version: targetVersion, detail: prRes.stdout.trim() };
}

function reportConflictIssue(gh: GhRunner, version: string, tag: string, lastPatch: string, err: string): WatchResult {
  const issueSearch = gh(["issue", "list", "--search", `Codex ${version} patch conflicts`, "--json", "number,url"]);
  if (issueSearch.status === 0 && issueSearch.stdout.trim() !== "[]" && issueSearch.stdout.trim().length > 2) {
    return { action: "issue_exists", version, detail: `Issue already open: ${issueSearch.stdout.trim()}` };
  }
  const body = [
    `## Action Required: Upstream Codex ${version} Released (Patch Conflicts)`,
    "",
    `OpenAI Codex has released tag \`${tag}\`.`,
    `Automated patch application using \`${lastPatch}\` failed with conflicts:`,
    "",
    "```",
    redact(err.slice(0, 2000)),
    "```",
    "",
    "### Steps to Resolve",
    `1. \`git checkout -b feat/support-codex-${version}\``,
    `2. Resolve conflicts against \`openai/codex\` at tag \`${tag}\``,
    `3. Add \`patches/codex-${version}.patch\` and update \`patches/manifest.json\``,
    "4. Submit pull request for review.",
  ].join("\n");
  const issueRes = gh(["issue", "create", "--title", `[Action Needed] Support Codex ${version} - patch conflicts detected`, "--body", body]);
  return { action: "issue_created", version, detail: issueRes.stdout.trim() };
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
