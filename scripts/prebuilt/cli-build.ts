/**
 * `build`, `package` and `verify`: the three steps that turn an upstream tag plus a patch into the
 * three verified release assets, entirely on the runner and without touching GitHub.
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { ReleaseManifest } from "../../src/distribution";
import { platformFor, validateManifest } from "../../src/distribution";
import { loadManifest } from "../../src/patch/manifest";
import { resolveDetection } from "./detect";
import { mergeManifests } from "./merge";
import {
  cxVersion,
  emit,
  git,
  patchesDir,
  releasePlatform,
  required,
  resetDirectory,
  root,
  sourceCommit,
  summary,
  upstreamCommit,
} from "./env";
import { buildManifest, workflowUrlFromEnv } from "./manifest";
import {
  ARCHIVE_ENTRIES,
  archiveFilename,
  assembleStaging,
  fileDigests,
  packArchive,
  sha256File,
  writeChecksums,
} from "./pack";
import { auditRustLicenses, generateRustNotices, type Runner } from "./rust-licenses";
import { verifyOutput } from "./verify";

/**
 * Clone the exact upstream tag and apply the exact supported patch. `--check` first so a conflict
 * fails before the index is touched; the patch is never edited and the source is never fixed up.
 */
export async function runBuild(flags: Record<string, string>): Promise<void> {
  const detection = resolveDetection(loadManifest(patchesDir()), required(flags, "codex-version"), flags["cx-version"]);
  const upstream = resolve(required(flags, "upstream"));
  const patch = join(patchesDir(), detection.patchFile);
  resetDirectory(upstream, (entries) => entries.includes(".git"));
  git(["clone", "--depth", "1", "--branch", detection.upstreamTag, "https://github.com/openai/codex.git", upstream]);
  git(["-C", upstream, "apply", "--index", "--check", patch]);
  git(["-C", upstream, "apply", "--index", patch]);
  emit({
    upstream_commit: git(["-C", upstream, "rev-parse", "HEAD"]),
    patch_sha256: (await sha256File(patch)).sha256,
    upstream_tag: detection.upstreamTag,
    patch_file: detection.patchFile,
    patch_version: String(detection.patchVersion),
  });
}



/** Stage the five members, pack them deterministically, then write `manifest.json` + `SHA256SUMS`. */
export async function runPackage(flags: Record<string, string>): Promise<void> {
  const detection = resolveDetection(
    loadManifest(patchesDir()),
    required(flags, "codex-version"),
    flags["cx-version"],
  );
  const upstream = resolve(required(flags, "upstream"));
  // Required, not derived: the frozen commit `detect` resolved is the only correct answer on a
  // scheduled run, and a manifest stamped with anything else is unpublishable. Resolved before any
  // file is staged, so a missing flag fails the step instead of a copy half-way through.
  const frozenCommit = sourceCommit(required(flags, "source-commit"));
  const stagingDir = resolve(required(flags, "staging"));
  const outDir = resolve(required(flags, "out"));
  const platform = flags["platform"] ? releasePlatform(flags) : platformFor(process.platform, process.arch);
  const workflowUrl = flags["workflow-url"] ?? workflowUrlFromEnv(process.env);
  if (workflowUrl === null || workflowUrl === "true") {
    throw new Error("no workflow run URL: pass --workflow-url or run inside GitHub Actions");
  }

  const rustNoticesPath = flags["rust-notices"];
  if (rustNoticesPath === undefined || rustNoticesPath === "true") {
    throw new Error("--rust-notices <file> is required; run `bun scripts/prebuilt.ts rust-notices` first");
  }
  const rustNotices = readFileSync(resolve(rustNoticesPath), "utf8");

  resetDirectory(stagingDir, (entries) => entries.every((e) => (ARCHIVE_ENTRIES as readonly string[]).includes(e)));
  assembleStaging({ upstreamDir: upstream, repoRoot: root, stagingDir, rustNotices });
  mkdirSync(outDir, { recursive: true });
  const filename = archiveFilename(detection.codexVersion, platform);
  const archive = await packArchive(stagingDir, join(outDir, filename));

  const manifest = buildManifest({
    cxVersion: flags["cx-version"] ?? detection.cxVersion,
    codexVersion: detection.codexVersion,
    platform,
    upstreamCommit: upstreamCommit(upstream),
    patchVersion: detection.patchVersion,
    patchFile: detection.patchFile,
    patchSha256: (await sha256File(join(patchesDir(), detection.patchFile))).sha256,
    sourceCommit: frozenCommit,
    workflowUrl,
    createdAt: new Date().toISOString(),
    archive,
    files: await fileDigests(stagingDir),
  });
  validateManifest(JSON.parse(JSON.stringify(manifest)), {
    codexVersion: detection.codexVersion,
    platform,
  });
  writeFileSync(join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeChecksums(outDir, [filename, "manifest.json"]);
  emit({ tag: detection.tag, archive: filename, archive_sha256: archive.sha256, platform });
}

export async function runVerify(flags: Record<string, string>): Promise<void> {
  const report = await verifyOutput({
    outDir: resolve(required(flags, "out")),
    cxVersion: flags["cx-version"],
    codexVersion: required(flags, "codex-version"),
    platform: flags["platform"] ? releasePlatform(flags) : platformFor(process.platform, process.arch),
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

const defaultRunner: Runner = (cmd, args, opts) => {
  const res = spawnSync(cmd, args, { cwd: opts?.cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
};

export async function runRustNotices(flags: Record<string, string>): Promise<void> {
  const upstream = resolve(required(flags, "upstream"));
  const outFile = resolve(required(flags, "out"));
  auditRustLicenses(upstream, defaultRunner);
  const notices = generateRustNotices(upstream, defaultRunner);
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, notices);
}

/**
 * Merge single-platform build outputs into a multi-archive release directory.
 * Reads each <input>/manifest.json, merges manifests, copies archives, writes
 * unified manifest.json and SHA256SUMS.
 */
export async function runMerge(flags: Record<string, string>): Promise<void> {
  const inputsArg = required(flags, "inputs");
  let inputDirs = inputsArg.split(",").map((s) => resolve(s.trim())).filter((s) => s.length > 0);
  if (inputDirs.length === 1 && existsSync(inputDirs[0]!) && !existsSync(join(inputDirs[0]!, "manifest.json"))) {
    const subdirs = readdirSync(inputDirs[0]!, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => join(inputDirs[0]!, d.name))
      .filter((d) => existsSync(join(d, "manifest.json")));
    if (subdirs.length > 0) inputDirs = subdirs;
  }
  const outDir = resolve(required(flags, "out"));
  const expectedPlatforms = required(flags, "platforms").split(",").map((s) => s.trim()).sort();

  if (existsSync(outDir) && readdirSync(outDir).length > 0) {
    throw new Error(`--out directory ${outDir} must be empty or absent`);
  }
  mkdirSync(outDir, { recursive: true });

  const manifests: ReleaseManifest[] = [];
  for (const dir of inputDirs) {
    const manifestPath = join(dir, "manifest.json");
    if (!existsSync(manifestPath)) throw new Error(`manifest.json not found in ${dir}`);
    manifests.push(JSON.parse(readFileSync(manifestPath, "utf8")) as ReleaseManifest);
  }

  const merged = mergeManifests(manifests);
  const foundPlatforms = merged.artifacts.map((a) => a.platform).sort();
  if (foundPlatforms.join(",") !== expectedPlatforms.join(",")) {
    throw new Error(`expected platforms ${expectedPlatforms.join(",")} but found ${foundPlatforms.join(",")}`);
  }

  const archives: string[] = [];
  for (const artifact of merged.artifacts) {
    let copied = false;
    for (const dir of inputDirs) {
      const src = join(dir, artifact.filename);
      if (existsSync(src)) {
        copyFileSync(src, join(outDir, artifact.filename));
        archives.push(artifact.filename);
        copied = true;
        break;
      }
    }
    if (!copied) throw new Error(`archive ${artifact.filename} not found in any input directory`);
  }

  writeFileSync(join(outDir, "manifest.json"), `${JSON.stringify(merged, null, 2)}\n`);
  await writeChecksums(outDir, [...archives, "manifest.json"]);
  const manifestDigest = await sha256File(join(outDir, "manifest.json"));

  emit({
    platforms: foundPlatforms.join(","),
    manifest_sha256: manifestDigest.sha256,
  });
}

