/**
 * Prebuilt release CLI: `detect | build | package | verify`.
 *
 * Runs under `bun` in CI but stays Node-API-only, like `scripts/ci-prebuilt.ts`. Every subprocess
 * is invoked with an argument array - upstream tags and versions come from the network, so nothing
 * is ever handed to a shell. The pure helpers live in `scripts/prebuilt/*` and are re-exported
 * here for `test/prebuilt.test.ts`.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { platformFor, validateManifest } from "../src/distribution";
import { loadManifest } from "../src/patch/manifest";
import { blockedIssueTitle, resolveDetection, selectStableVersion, UNCOVERED_EXIT_CODE, type Detection } from "./prebuilt/detect";
import { buildManifest, workflowUrlFromEnv, type ManifestInput } from "./prebuilt/manifest";
import {
  ARCHIVE_ENTRIES,
  ARCHIVE_MTIME,
  archiveFilename,
  assembleStaging,
  fileDigests,
  packArchive,
  parseChecksums,
  sha256File,
  writeChecksums,
} from "./prebuilt/pack";
import { validateMinos, verifyOutput } from "./prebuilt/verify";

export {
  ARCHIVE_ENTRIES,
  ARCHIVE_MTIME,
  archiveFilename,
  assembleStaging,
  blockedIssueTitle,
  buildManifest,
  fileDigests,
  packArchive,
  parseChecksums,
  resolveDetection,
  selectStableVersion,
  sha256File,
  UNCOVERED_EXIT_CODE,
  validateMinos,
  verifyOutput,
  workflowUrlFromEnv,
  writeChecksums,
};
export type { Detection, ManifestInput };

const root = resolve(import.meta.dir, "..");
const RELEASES_URL = "https://api.github.com/repos/openai/codex/releases?per_page=100";
const HEX40 = /^[0-9a-f]{40}$/;

// ---- argv ----

/** `--flag value` / `--flag` only. Positional arguments are a usage error, never a silent default. */
function parseFlags(argv: readonly string[]): Record<string, string> {
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

function required(flags: Record<string, string>, name: string): string {
  const value = flags[name];
  if (value === undefined || value === "true") throw new Error(`--${name} is required`);
  return value;
}

// ---- shared helpers ----

function git(args: readonly string[]): string {
  return execFileSync("git", [...args], { encoding: "utf8", timeout: 300_000, maxBuffer: 8 * 1024 * 1024 }).trim();
}

function cxVersion(): string {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version?: unknown };
  if (typeof pkg.version !== "string") throw new Error("package.json has no version");
  return pkg.version;
}

function patchesDir(): string {
  return join(root, "patches");
}

function emit(values: Record<string, string>): void {
  const body = Object.entries(values).map(([k, v]) => `${k}=${v}\n`).join("");
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, body);
  process.stdout.write(body);
}

function summary(lines: readonly string[]): void {
  const body = `${lines.join("\n")}\n`;
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, body);
  process.stderr.write(body);
}

// ---- detect ----

async function fetchUpstreamReleases(): Promise<unknown> {
  const headers: Record<string, string> = { accept: "application/vnd.github+json", "user-agent": "cxstatusline-prebuilt" };
  const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(RELEASES_URL, { headers, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`upstream release listing failed with HTTP ${response.status}`);
  return response.json();
}

/**
 * Resolve the release inputs. `--codex-version` (anything but `auto`) pins the version; otherwise
 * the highest stable upstream release is chosen and must be covered by `patches/manifest.json`.
 * An uncovered upstream exits `UNCOVERED_EXIT_CODE` so the workflow can report it as blocked
 * rather than as an infrastructure failure.
 */
async function runDetect(flags: Record<string, string>): Promise<void> {
  const requested = flags["codex-version"];
  const pinned = requested !== undefined && requested !== "auto" && requested !== "true";
  const releases = flags["releases-file"] !== undefined
    ? (JSON.parse(readFileSync(flags["releases-file"], "utf8")) as unknown)
    : null;
  const codexVersion = pinned ? requested! : selectStableVersion(releases ?? (await fetchUpstreamReleases()));
  const cx = cxVersion();
  let detection: Detection;
  try {
    detection = resolveDetection(loadManifest(patchesDir()), codexVersion, cx);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    summary([`## ${blockedIssueTitle(codexVersion)}`, "", message]);
    process.exit(UNCOVERED_EXIT_CODE);
  }
  if (!existsSync(join(patchesDir(), detection.patchFile))) {
    throw new Error(`patches/${detection.patchFile} is referenced by the manifest but missing from the checkout`);
  }
  emit({
    codex_version: detection.codexVersion,
    cx_version: detection.cxVersion,
    tag: detection.tag,
    upstream_tag: detection.upstreamTag,
    patch_file: detection.patchFile,
    source: pinned ? "dispatch" : "auto",
  });
}

// ---- build ----

/**
 * Clone the exact upstream tag and apply the exact supported patch. `--check` first so a conflict
 * fails before the index is touched; the patch is never edited and the source is never fixed up.
 */
function runBuild(flags: Record<string, string>): void {
  const detection = resolveDetection(loadManifest(patchesDir()), required(flags, "codex-version"), cxVersion());
  const upstream = resolve(required(flags, "upstream"));
  const patch = join(patchesDir(), detection.patchFile);
  if (existsSync(upstream)) rmSync(upstream, { recursive: true, force: true });
  git(["clone", "--depth", "1", "--branch", detection.upstreamTag, "https://github.com/openai/codex.git", upstream]);
  git(["-C", upstream, "apply", "--index", "--check", patch]);
  git(["-C", upstream, "apply", "--index", patch]);
  emit({
    upstream_commit: git(["-C", upstream, "rev-parse", "HEAD"]),
    patch_sha256: sha256File(patch).sha256,
    upstream_tag: detection.upstreamTag,
    patch_file: detection.patchFile,
  });
}

// ---- package ----

function sourceCommit(): string {
  const commit = process.env.GITHUB_SHA ?? git(["-C", root, "rev-parse", "HEAD"]);
  if (!HEX40.test(commit)) throw new Error(`source commit ${JSON.stringify(commit)} is not a 40-hex commit`);
  return commit;
}

function upstreamCommit(upstream: string): string {
  const commit = git(["-C", upstream, "rev-parse", "HEAD"]);
  if (!HEX40.test(commit)) throw new Error("upstream checkout has no usable commit");
  return commit;
}

/** Stage the five members, pack them deterministically, then write `manifest.json` + `SHA256SUMS`. */
async function runPackage(flags: Record<string, string>): Promise<void> {
  const detection = resolveDetection(
    loadManifest(patchesDir()),
    required(flags, "codex-version"),
    required(flags, "cx-version"),
  );
  const upstream = resolve(required(flags, "upstream"));
  const stagingDir = resolve(required(flags, "staging"));
  const outDir = resolve(required(flags, "out"));
  const platform = platformFor(process.platform, process.arch);
  const workflowUrl = flags["workflow-url"] ?? workflowUrlFromEnv(process.env);
  if (workflowUrl === null || workflowUrl === "true") {
    throw new Error("no workflow run URL: pass --workflow-url or run inside GitHub Actions");
  }

  rmSync(stagingDir, { recursive: true, force: true });
  assembleStaging({ upstreamDir: upstream, repoRoot: root, stagingDir });
  mkdirSync(outDir, { recursive: true });
  const filename = archiveFilename(detection.codexVersion, platform);
  const archive = await packArchive(stagingDir, join(outDir, filename));

  const manifest = buildManifest({
    cxVersion: detection.cxVersion,
    codexVersion: detection.codexVersion,
    platform,
    upstreamCommit: upstreamCommit(upstream),
    patchSha256: sha256File(join(patchesDir(), detection.patchFile)).sha256,
    sourceCommit: sourceCommit(),
    workflowUrl,
    createdAt: new Date().toISOString(),
    archive,
    files: fileDigests(stagingDir),
  });
  validateManifest(JSON.parse(JSON.stringify(manifest)), {
    cxVersion: detection.cxVersion,
    codexVersion: detection.codexVersion,
    platform,
  });
  writeFileSync(join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  writeChecksums(outDir, [filename, "manifest.json"]);
  emit({ tag: detection.tag, archive: filename, archive_sha256: archive.sha256, platform });
}

// ---- verify ----

async function runVerify(flags: Record<string, string>): Promise<void> {
  const report = await verifyOutput({
    outDir: resolve(required(flags, "out")),
    cxVersion: required(flags, "cx-version"),
    codexVersion: required(flags, "codex-version"),
    platform: platformFor(process.platform, process.arch),
    skipMacho: flags["skip-macho"] === "true",
  });
  summary([
    `## Prebuilt verification: ${report.archive}`,
    "",
    ...report.checks.map((c) => `- ${c}`),
    "",
    report.machoSkipped ? "Mach-O probes were SKIPPED for this run." : "",
    "Known acceptance gap: no clean macOS 14 machine or VM was used; the deployment target is",
    "evidence of intent, not proof of macOS 14 behaviour.",
  ]);
}

// ---- CLI ----

const USAGE = [
  "usage: bun scripts/prebuilt.ts <command> [flags]",
  "  detect  [--codex-version auto|X.Y.Z] [--releases-file FILE]",
  "  build   --codex-version X.Y.Z --upstream DIR",
  "  package --codex-version X.Y.Z --cx-version X.Y.Z --upstream DIR --staging DIR --out DIR [--workflow-url URL]",
  "  verify  --out DIR --codex-version X.Y.Z --cx-version X.Y.Z [--skip-macho]",
].join("\n");

if (import.meta.main) {
  const [command, ...rest] = process.argv.slice(2);
  const flags = parseFlags(rest);
  if (command === "detect") await runDetect(flags);
  else if (command === "build") runBuild(flags);
  else if (command === "package") await runPackage(flags);
  else if (command === "verify") await runVerify(flags);
  else {
    process.stderr.write(`${USAGE}\n`);
    process.exit(2);
  }
}
