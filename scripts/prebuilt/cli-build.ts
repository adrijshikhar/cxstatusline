/**
 * `build`, `package` and `verify`: the three steps that turn an upstream tag plus a patch into the
 * three verified release assets, entirely on the runner and without touching GitHub.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { platformFor, validateManifest } from "../../src/distribution";
import { loadManifest } from "../../src/patch/manifest";
import { resolveDetection } from "./detect";
import {
  cxVersion,
  emit,
  git,
  patchesDir,
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
import { verifyOutput } from "./verify";

/**
 * Clone the exact upstream tag and apply the exact supported patch. `--check` first so a conflict
 * fails before the index is touched; the patch is never edited and the source is never fixed up.
 */
export async function runBuild(flags: Record<string, string>): Promise<void> {
  const detection = resolveDetection(loadManifest(patchesDir()), required(flags, "codex-version"), cxVersion());
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
  });
}



/** Stage the five members, pack them deterministically, then write `manifest.json` + `SHA256SUMS`. */
export async function runPackage(flags: Record<string, string>): Promise<void> {
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

  resetDirectory(stagingDir, (entries) => entries.every((e) => (ARCHIVE_ENTRIES as readonly string[]).includes(e)));
  assembleStaging({ upstreamDir: upstream, repoRoot: root, stagingDir });
  mkdirSync(outDir, { recursive: true });
  const filename = archiveFilename(detection.codexVersion, platform);
  const archive = await packArchive(stagingDir, join(outDir, filename));

  const manifest = buildManifest({
    cxVersion: detection.cxVersion,
    codexVersion: detection.codexVersion,
    platform,
    upstreamCommit: upstreamCommit(upstream),
    patchSha256: (await sha256File(join(patchesDir(), detection.patchFile))).sha256,
    sourceCommit: sourceCommit(),
    workflowUrl,
    createdAt: new Date().toISOString(),
    archive,
    files: await fileDigests(stagingDir),
  });
  validateManifest(JSON.parse(JSON.stringify(manifest)), {
    cxVersion: detection.cxVersion,
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

