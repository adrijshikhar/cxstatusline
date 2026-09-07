/**
 * Failure reporting.
 *
 * One open tracking issue per release identity, found by exact title *and* a body marker, updated
 * rather than duplicated, and closed only by the success that actually clears it. The rules that
 * matter: a deliberately skipped job is not a failure; nothing is ever claimed to exist unless the
 * GitHub API said so; and no excerpt reaches an issue body without going through `redact`.
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { blockedIssueTitle } from "./detect";
import { GhError, ghJson, ghText, type GhRunner } from "./gh";
import { errorExcerpt, redact } from "./redact";

/** Stable marker. Only an issue carrying this was written by this pipeline. */
export const REPORT_MARKER = "<!-- cxstatusline-prebuilt -->";

/** Arm64 is the whole matrix today (controller addendum item 1). */
const ARCHITECTURE = "darwin-arm64";
const MAX_EXCERPT_LINES = 20;

export type Stage = "detect" | "validate" | "native" | "publish";

const STAGES: readonly Stage[] = ["detect", "validate", "native", "publish"];

/** `needs.<job>.result` verbatim: `success` | `failure` | `cancelled` | `skipped`. */
export interface JobResults {
  readonly detect: string;
  readonly validate: string;
  readonly native: string;
  readonly publish: string;
}

export interface StageContext {
  /** Whether this run was asked to publish at all (cron, or `publish=true` dispatch). */
  readonly publishRequested: boolean;
  /** `detect`'s `should_build`: false when there was deliberately nothing to build. */
  readonly shouldBuild: boolean;
}

/** A `skipped` job that this run's own inputs asked to be skipped is not a failure. */
function skipWasDeliberate(stage: Stage, c: StageContext): boolean {
  if (stage === "detect") return false;
  if (!c.shouldBuild) return true;
  return stage === "publish" && !c.publishRequested;
}

/**
 * The first stage that did not succeed, or null for a run with nothing to report. Ordered, so a
 * cascade of downstream skips is attributed to the job that actually broke.
 */
export function failingStage(results: JobResults, c: StageContext): Stage | null {
  for (const stage of STAGES) {
    const result = results[stage];
    if (result === "success") continue;
    if (result === "skipped" && skipWasDeliberate(stage, c)) continue;
    return stage;
  }
  return null;
}

export interface ReportInput {
  readonly results: JobResults;
  readonly codexVersion: string | null;
  readonly cxVersion: string | null;
  readonly tag: string | null;
  readonly repo: string;
  readonly upstreamTag: string | null;
  readonly runUrl: string;
  readonly sourceCommit: string;
  readonly patchSha256: string | null;
  readonly event: string;
  readonly shouldBuild: boolean;
  readonly publishRequested: boolean;
  readonly releaseUrl: string | null;
  /** Already-bounded, already-redacted text from `--error-file`, or null. */
  readonly errorExcerpt: string | null;
}

/**
 * The issue body. Structured known fields only - never a raw log, an environment dump, a token or
 * a presigned URL - plus a bounded, redacted excerpt and the exact retry the owner would run.
 */
export function reportBody(i: ReportInput, stage: Stage): string {
  const lines = [
    REPORT_MARKER,
    "",
    `A prebuilt release run failed at the **${stage}** stage.`,
    "",
    `- cxstatusline version: ${i.cxVersion ?? "unresolved"}`,
    `- Codex version: ${i.codexVersion ?? "unresolved"}`,
    `- Upstream tag: ${i.upstreamTag ?? "unresolved"}`,
    `- Release tag: ${i.tag ?? "unresolved"}`,
    `- Failing stage: ${stage}`,
    `- Architecture: ${ARCHITECTURE} (Apple Silicon only)`,
    `- Source commit: ${i.sourceCommit}`,
    `- Patch sha256: ${i.patchSha256 ?? "unresolved"}`,
    `- Trigger: ${i.event}`,
    `- Job results: detect=${i.results.detect} validate=${i.results.validate} `
      + `native=${i.results.native} publish=${i.results.publish}`,
    `- Workflow run: ${i.runUrl}`,
    "",
  ];
  if (i.errorExcerpt !== null && i.errorExcerpt !== "") {
    lines.push(`### Error excerpt (last ${MAX_EXCERPT_LINES} lines, sanitized)`, "", "```", i.errorExcerpt, "```", "");
  }
  lines.push(
    "### Retry",
    "",
    "Dispatch `Prebuilt release` manually from the Actions tab with:",
    "",
    "- `self_hosted=true` (hosted macOS minutes are billing-blocked)",
    `- \`codex_version=${i.codexVersion ?? "auto"}\``,
    "- `publish=true` only when the artifact should become a release",
    "",
    "Nothing about the failed run is rewritten by a retry: a retry publishes under the same tag, ",
    "resuming an existing draft, or reports blocked if that draft holds different bytes.",
    "",
  );
  return lines.join("\n");
}

// ---- gh-backed issue upsert ----

interface OpenIssue {
  readonly number: number;
  readonly title: string;
  readonly body: string;
}

/**
 * Every open issue this pipeline owns. One paginated read, so both the detection issue and the
 * version issue are resolved from the same snapshot and a second page can never hide one.
 */
function listOwnIssues(run: GhRunner, repo: string): readonly OpenIssue[] {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}\/[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(repo)) {
    throw new Error(`unusable repository ${JSON.stringify(repo)}`);
  }
  const raw = ghJson<unknown>(run, ["api", "--paginate", `repos/${repo}/issues?state=open&per_page=100`]);
  if (!Array.isArray(raw)) throw new Error("issue lookup did not return a list");
  return raw
    .filter((e): e is Record<string, unknown> => typeof e === "object" && e !== null)
    .filter((e) => typeof e.number === "number" && typeof e.title === "string" && typeof e.body === "string")
    .map((e) => ({ number: e.number as number, title: e.title as string, body: e.body as string }))
    .filter((issue) => issue.body.includes(REPORT_MARKER));
}

function findIssue(issues: readonly OpenIssue[], title: string): OpenIssue | null {
  return issues.find((issue) => issue.title === title) ?? null;
}

/** Body text goes through a file: never an argv payload, never a shell. */
function bodyFile(tmpRoot: string, name: string, body: string): string {
  mkdirSync(tmpRoot, { recursive: true });
  const file = join(tmpRoot, name);
  writeFileSync(file, body.endsWith("\n") ? body : `${body}\n`);
  return file;
}

export interface RunReportOptions {
  readonly run: GhRunner;
  readonly input: ReportInput;
  readonly summary: (lines: readonly string[]) => void;
  readonly tmpRoot?: string;
}

/**
 * `--repo` is explicit on every issue write: the read above already names the repository, so a
 * write must not quietly fall back to whatever remote the runner's checkout happens to have.
 */
function upsertFailure(o: RunReportOptions, issues: readonly OpenIssue[], stage: Stage, tmpRoot: string): string {
  const repo = o.input.repo;
  const title = blockedIssueTitle(o.input.codexVersion ?? null);
  const file = bodyFile(tmpRoot, "issue-body.md", reportBody(o.input, stage));
  const existing = findIssue(issues, title);
  if (existing !== null) {
    ghText(o.run, ["issue", "edit", String(existing.number), "--repo", repo, "--body-file", file]);
    return `Updated issue #${existing.number}: ${title}`;
  }
  ghText(o.run, ["issue", "create", "--repo", repo, "--title", title, "--body-file", file]);
  return `Created issue: ${title}`;
}

function commentAndClose(o: RunReportOptions, issue: OpenIssue, body: string, tmpRoot: string, close: boolean): string {
  const repo = o.input.repo;
  const file = bodyFile(tmpRoot, `comment-${issue.number}.md`, `${REPORT_MARKER}\n\n${body}`);
  ghText(o.run, ["issue", "comment", String(issue.number), "--repo", repo, "--body-file", file]);
  if (!close) return `Commented on issue #${issue.number}`;
  ghText(o.run, ["issue", "close", String(issue.number), "--repo", repo]);
  return `Closed issue #${issue.number}`;
}

/**
 * Report the outcome of a run. Returns the exit code the `report` job should take: 1 when the run
 * failed or the GitHub API did, 0 when there was nothing wrong to report.
 *
 * Never partial-credits: if the API call that would find or write an issue fails, the job fails
 * with a sanitized summary and claims nothing about issue state.
 */
export async function runReport(o: RunReportOptions): Promise<number> {
  const tmpRoot = o.tmpRoot ?? mkdtempSync(join(tmpdir(), "cxsl-report-"));
  const i = o.input;
  const stage = failingStage(i.results, { publishRequested: i.publishRequested, shouldBuild: i.shouldBuild });
  const done: string[] = [];
  try {
    const issues = listOwnIssues(o.run, i.repo);
    if (stage !== null) {
      done.push(upsertFailure(o, issues, stage, tmpRoot));
      o.summary([`## Prebuilt run failed at ${stage}`, "", ...done.map((d) => `- ${d}`), "", `Run: ${i.runUrl}`]);
      return 1;
    }

    const detection = findIssue(issues, blockedIssueTitle(null));
    if (detection !== null) {
      done.push(
        commentAndClose(o, detection, `Upstream detection succeeded in ${i.runUrl}; closing.`, tmpRoot, true),
      );
    }
    const version = i.codexVersion === null ? null : findIssue(issues, blockedIssueTitle(i.codexVersion));
    if (version !== null) {
      const published = i.results.publish === "success" && i.releaseUrl !== null;
      const body = published
        ? `Published ${i.tag ?? "the release"}: ${i.releaseUrl}\n\nBuilt by ${i.runUrl}. Closing.`
        : `Build succeeded, not published (${ARCHITECTURE}) in ${i.runUrl}. `
          + `Leaving this issue open until a publishing run closes it.`;
      done.push(commentAndClose(o, version, body, tmpRoot, published));
    }
    const outcome = done.length === 0 ? ["- No open tracking issue to update."] : done.map((d) => `- ${d}`);
    o.summary(["## Prebuilt run succeeded", "", ...outcome, "", `Run: ${i.runUrl}`]);
    return 0;
  } catch (e) {
    const detail = e instanceof GhError || e instanceof Error ? e.message : String(e);
    o.summary([
      "## Prebuilt reporting failed",
      "",
      "The GitHub API call the reporter needed did not succeed, so no claim is made about issue state.",
      "The next run re-examines this one and reports again.",
      "",
      "```",
      errorExcerpt(redact(detail), MAX_EXCERPT_LINES),
      "```",
      "",
      `Run: ${i.runUrl}`,
    ]);
    return 1;
  }
}

/** Read a bounded, redacted excerpt from an error file, or null when there is none. */
export function excerptFromFile(path: string | undefined): string | null {
  if (path === undefined || path === "" || path === "true") return null;
  try {
    return errorExcerpt(readFileSync(path, "utf8"), MAX_EXCERPT_LINES);
  } catch {
    // A missing error file is not itself a reportable failure - the stage results already say
    // what broke - but it must not be silently indistinguishable from "no error output".
    return `error file ${path} could not be read`;
  }
}
