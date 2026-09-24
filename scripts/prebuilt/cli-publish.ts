/**
 * `publish` and `report`: the two subcommands that talk to GitHub.
 *
 * `publish` is the only one that writes release state, and it is the only place `contents: write`
 * is granted. `report` only ever touches issues, and only through `issues: write`.
 */
import { join, resolve } from "node:path";
import { emit, optional, releasePlatforms, repoSlug, required, runnerTmp, summary } from "./env";
import { execGh } from "./gh";
import { publishRelease, restoreReleaseBackup, type PublishOptions } from "./publish";
import { backupPublishedRelease, BlockedError } from "./release";
import { excerptFromFile, runReport, type JobResults, type ReportInput } from "./report";

/**
 * Publish the verified `release-<tag>` artifact at release level. A `BlockedError` exits 3 (the
 * owner has to act; the `report` job turns it into one tracking issue) and everything else exits
 * through the top-level catch as 1, leaving any draft untouched and unpublished.
 */
export async function runPublish(flags: Record<string, string>): Promise<void> {
  const platforms = releasePlatforms(flags);
  const options: PublishOptions = {
    run: execGh,
    tag: required(flags, "tag"),
    dir: resolve(required(flags, "dir")),
    runId: required(flags, "run-id"),
    runUrl: required(flags, "run-url"),
    sourceCommit: required(flags, "source-commit"),
    codexVersion: required(flags, "codex-version"),
    cxVersion: flags["cx-version"],
    platform: platforms[0],
    platforms,
    event: flags["event"] ?? process.env.GITHUB_EVENT_NAME ?? "workflow_dispatch",
    tmpRoot: runnerTmp("prebuilt-publish"),
    backupDir: flags["backup-dir"] ? resolve(flags["backup-dir"]!) : undefined,
    repo: repoSlug(flags),
    summary,
  };
  try {
    const outcome = await publishRelease(options);
    emit({ release_url: outcome.url, published: outcome.kind === "published" ? "true" : "false" });
  } catch (e) {
    if (!(e instanceof BlockedError)) throw e;
    summary([`## ${e.title}`, "", e.message]);
    process.exit(e.exitCode);
  }
}

export async function runBackup(flags: Record<string, string>): Promise<void> {
  const dir = resolve(required(flags, "dir"));
  const backup = await backupPublishedRelease(execGh, required(flags, "tag"), required(flags, "codex-version"), dir, repoSlug(flags));
  summary([
    `## Release backup ${backup.tag}`, "",
    backup.state === "published" ? `Complete verified backup saved to ${dir}.` : `Existing release state: ${backup.state}.`,
    "Replacement must upload this directory as a workflow artifact before changing release state.",
  ]);
  emit({ backup_state: backup.state, backup_dir: dir });
}

export async function runRestore(flags: Record<string, string>): Promise<void> {
  const backupDir = resolve(required(flags, "backup-dir"));
  await restoreReleaseBackup({
    run: execGh,
    tag: required(flags, "tag"),
    dir: resolve(flags.dir ?? join(backupDir, "assets")),
    backupDir,
    runId: "restore",
    runUrl: flags["run-url"] ?? "",
    sourceCommit: "restore",
    codexVersion: required(flags, "codex-version"),
    repo: repoSlug(flags),
    event: "restore",
    tmpRoot: runnerTmp("prebuilt-restore"),
    summary,
  });
}

function jobResult(flags: Record<string, string>, name: string): string {
  const value = flags[name];
  if (value === undefined || value === "true") throw new Error(`--${name} is required (a needs.<job>.result value)`);
  return value;
}


/** Always-run reporting. Exit code is the reporter's, so a failed report fails the job. */
export async function runReportCommand(flags: Record<string, string>): Promise<void> {
  const results: JobResults = {
    detect: jobResult(flags, "detect"),
    validate: jobResult(flags, "validate"),
    native: jobResult(flags, "native"),
    merge: flags["merge"] && flags["merge"] !== "true" ? flags["merge"] : undefined,
    publish: jobResult(flags, "publish"),
  };
  const input: ReportInput = {
    results,
    codexVersion: optional(flags, "codex-version"),
    cxVersion: optional(flags, "cx-version"),
    tag: optional(flags, "tag"),
    repo: repoSlug(flags),
    upstreamTag: optional(flags, "upstream-tag"),
    runUrl: required(flags, "run-url"),
    sourceCommit: optional(flags, "source-commit") ?? "unresolved",
    patchSha256: optional(flags, "patch-sha256"),
    event: required(flags, "event"),
    shouldBuild: flags["should-build"] !== "false",
    publishRequested: flags["publish-requested"] === "true",
    releaseUrl: optional(flags, "release-url"),
    platforms: releasePlatforms(flags),
    errorExcerpt: excerptFromFile(flags["error-file"]),
    logDir: optional(flags, "log-dir"),
    blockedReason: optional(flags, "blocked-reason"),
  };
  const code = await runReport({ run: execGh, input, summary, tmpRoot: runnerTmp("prebuilt-report") });
  if (code !== 0) process.exit(code);
}
