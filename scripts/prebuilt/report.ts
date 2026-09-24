/**
 * Failure reporting.
 *
 * One open tracking issue per release identity, found by exact title *and* a body marker, updated
 * rather than duplicated, and closed only by the success that actually clears it. The rules that
 * matter: a deliberately skipped job is not a failure; nothing is ever claimed to exist unless the
 * GitHub API said so; and no excerpt reaches an issue body without going through `redact`.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Platform } from "../../src/distribution";
import { blockedIssueTitle } from "./detect";
import { GhError, ghJson, ghText, type GhRunner } from "./gh";
import { errorExcerpt, redact } from "./redact";

/** Stable marker. Only an issue carrying this was written by this pipeline. */
export const REPORT_MARKER = "<!-- cxstatusline-prebuilt -->";

/** Arm64 is the whole matrix today (controller addendum item 1). */
const ARCHITECTURE = "darwin-arm64";
const MAX_EXCERPT_LINES = 20;

export type Stage = "detect" | "validate" | "native" | "merge" | "publish";

const STAGES: readonly Stage[] = ["detect", "validate", "native", "merge", "publish"];

/** `needs.<job>.result` verbatim: `success` | `failure` | `cancelled` | `skipped`. */
export interface JobResults {
  readonly detect: string;
  readonly validate: string;
  readonly native: string;
  readonly merge?: string;
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
    if (stage === "merge" && results.merge === undefined) continue;
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
  readonly platforms?: readonly Platform[];
  /** Already-bounded, already-redacted text from `--error-file`, or null. */
  readonly errorExcerpt: string | null;
  /**
   * Directory holding the per-job `prebuilt-<stage>.log` files the workflow captured with `tee`
   * and uploaded as artifacts. Used only when `errorExcerpt` was not supplied explicitly.
   */
  readonly logDir: string | null;
  /** `detect`'s single-line `blocked_reason`, when the run was blocked rather than broken. */
  readonly blockedReason: string | null;
}

/**
 * The issue body. Structured known fields only - never a raw log, an environment dump, a token or
 * a presigned URL - plus a bounded, redacted excerpt and the exact retry the owner would run.
 */
export function reportBody(i: ReportInput, stage: Stage): string {
  const platforms = i.platforms && i.platforms.length > 0 ? i.platforms : [ARCHITECTURE as Platform];
  const archLine = platforms.length === 1 && platforms[0] === "darwin-arm64"
    ? `${ARCHITECTURE} (Apple Silicon only)`
    : platforms.join(", ");
  const mergePart = i.results.merge !== undefined ? ` merge=${i.results.merge}` : "";
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
    `- Architecture: ${archLine}`,
    `- Source commit: ${i.sourceCommit}`,
    `- Patch sha256: ${i.patchSha256 ?? "unresolved"}`,
    `- Trigger: ${i.event}`,
    `- Job results: detect=${i.results.detect} validate=${i.results.validate} `
      + `native=${i.results.native}${mergePart} publish=${i.results.publish}`,
    `- Workflow run: ${i.runUrl}`,
    "",
  ];
  if (i.blockedReason !== null && i.blockedReason !== "") {
    lines.push(`Blocked reason: ${i.blockedReason}`, "");
  }
  // Always rendered: "no excerpt was captured" is itself information, and silently omitting the
  // section makes a lost log indistinguishable from a stage that failed without output.
  const excerpt = i.errorExcerpt !== null && i.errorExcerpt !== "" ? i.errorExcerpt : "no error excerpt captured";
  lines.push(`### Error excerpt (last ${MAX_EXCERPT_LINES} lines, sanitized)`, "", "```", excerpt, "```", "");
  lines.push(
    "### Retry",
    "",
    "Dispatch `Prebuilt release` manually from the Actions tab with:",
    "",
    "- Keep the M5 Pro and its `m5-pro` Actions runner active; macOS and Linux both build there. No hosted fallback.",
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
function upsertFailure(
  o: RunReportOptions,
  issues: readonly OpenIssue[],
  stage: Stage,
  tmpRoot: string,
  completed: string[],
): string {
  const repo = o.input.repo;
  const title = blockedIssueTitle(o.input.codexVersion ?? null);
  const file = bodyFile(tmpRoot, "issue-body.md", reportBody(o.input, stage));
  const existing = findIssue(issues, title);
  if (existing !== null) {
    ghText(o.run, ["issue", "edit", String(existing.number), "--repo", repo, "--body-file", file]);
    return record(completed, `Updated issue #${existing.number}: ${title}`);
  }
  ghText(o.run, ["issue", "create", "--repo", repo, "--title", title, "--body-file", file]);
  return record(completed, `Created issue: ${title}`);
}

/**
 * Note an issue write that the API has already confirmed. Recorded per call, not per function, so
 * a later failure can still say exactly what happened - a comment that landed before its `close`
 * failed is a fact the owner needs.
 */
function record(completed: string[], action: string): string {
  completed.push(action);
  return action;
}

interface CloseRequest {
  readonly issue: OpenIssue;
  readonly body: string;
  readonly tmpRoot: string;
  readonly close: boolean;
  readonly completed: string[];
}

function commentAndClose(o: RunReportOptions, r: CloseRequest): string {
  const repo = o.input.repo;
  const file = bodyFile(r.tmpRoot, `comment-${r.issue.number}.md`, `${REPORT_MARKER}\n\n${r.body}`);
  ghText(o.run, ["issue", "comment", String(r.issue.number), "--repo", repo, "--body-file", file]);
  const commented = record(r.completed, `Commented on issue #${r.issue.number}`);
  if (!r.close) return commented;
  ghText(o.run, ["issue", "close", String(r.issue.number), "--repo", repo]);
  return record(r.completed, `Closed issue #${r.issue.number}`);
}

/**
 * The issues a success clears: a successful detection closes the detection issue, and a published
 * release closes the version issue with its link. A build that was not published only comments.
 */
function closeOnSuccess(
  o: RunReportOptions,
  issues: readonly OpenIssue[],
  tmpRoot: string,
  completed: string[],
): readonly string[] {
  const i = o.input;
  const done: string[] = [];
  const detection = findIssue(issues, blockedIssueTitle(null));
  if (detection !== null) {
    const body = `Upstream detection succeeded in ${i.runUrl}; closing.`;
    done.push(commentAndClose(o, { issue: detection, body, tmpRoot, close: true, completed }));
  }
  const version = i.codexVersion === null ? null : findIssue(issues, blockedIssueTitle(i.codexVersion));
  if (version !== null) {
    const published = i.results.publish === "success" && i.releaseUrl !== null;
    const archLabel = i.platforms && i.platforms.length > 0 ? i.platforms.join(", ") : ARCHITECTURE;
    const body = published
      ? `Published ${i.tag ?? "the release"}: ${i.releaseUrl}\n\nBuilt by ${i.runUrl}. Closing.`
      : `Build succeeded, not published (${archLabel}) in ${i.runUrl}. `
        + `Leaving this issue open until a publishing run closes it.`;
    done.push(commentAndClose(o, { issue: version, body, tmpRoot, close: published, completed }));
  }
  return done;
}

/**
 * The API itself failed: say so, sanitized, and claim nothing that the API did not confirm.
 * `completed` is the writes it *did* acknowledge before the failure - reporting "nothing happened"
 * when a comment already landed would send the owner looking for it in the wrong place.
 */
function reportApiFailure(o: RunReportOptions, error: unknown, completed: readonly string[]): void {
  const detail = error instanceof GhError || error instanceof Error ? error.message : String(error);
  o.summary([
    "## Prebuilt reporting failed",
    "",
    "A GitHub API call the reporter needed did not succeed, so nothing beyond the actions listed",
    "below is claimed about issue state. The next run re-examines this one and reports again.",
    "",
    ...(completed.length === 0
      ? ["No issue was created, updated, commented on or closed before the failure."]
      : ["Issue actions that did complete before the failure:", "", ...completed.map((a) => `- ${a}`)]),
    "",
    "```",
    errorExcerpt(redact(detail), MAX_EXCERPT_LINES),
    "```",
    "",
    `Run: ${o.input.runUrl}`,
  ]);
}

/**
 * Report the outcome of a run. Returns the exit code the `report` job should take: 1 when the run
 * failed or the GitHub API did, 0 when there was nothing wrong to report.
 *
 * Never partial-credits: if the API call that would find or write an issue fails, the job fails
 * with a sanitized summary and claims nothing about issue state.
 */
export async function runReport(options: RunReportOptions): Promise<number> {
  const tmpRoot = options.tmpRoot ?? mkdtempSync(join(tmpdir(), "cxsl-report-"));
  const first = options.input;
  const stage = failingStage(first.results, {
    publishRequested: first.publishRequested,
    shouldBuild: first.shouldBuild,
  });
  // The failing stage names the log to excerpt, so the excerpt is resolved after classification.
  const o: RunReportOptions = stage === null
    ? options
    : { ...options, input: { ...first, errorExcerpt: first.errorExcerpt ?? stageLogExcerpt(first.logDir, stage) } };
  const runUrl = o.input.runUrl;
  const completed: string[] = [];
  try {
    const issues = listOwnIssues(o.run, o.input.repo);
    if (stage !== null) {
      if (!o.input.publishRequested && o.input.event === "workflow_dispatch") {
        o.summary([
          `## Prebuilt run failed at ${stage} (dry run)`,
          "",
          `Run: ${runUrl}`,
          "",
          "Issue creation is suppressed for manual non-publishing dispatches (publish=false).",
        ]);
        return 1;
      }
      const done = upsertFailure(o, issues, stage, tmpRoot, completed);
      o.summary([`## Prebuilt run failed at ${stage}`, "", `- ${done}`, "", `Run: ${runUrl}`]);
      return 1;
    }
    const done = closeOnSuccess(o, issues, tmpRoot, completed);
    const outcome = done.length === 0 ? ["- No open tracking issue to update."] : done.map((d) => `- ${d}`);
    o.summary(["## Prebuilt run succeeded", "", ...outcome, "", `Run: ${runUrl}`]);
    return 0;
  } catch (e) {
    reportApiFailure(o, e, completed);
    return 1;
  }
}

/**
 * The tail of the failing job's captured log, or null when the workflow captured none (an expired
 * or never-uploaded artifact). Null is rendered as "no error excerpt captured", never omitted.
 */
export function stageLogExcerpt(logDir: string | null, stage: Stage): string | null {
  if (logDir === null || logDir === "") return null;
  const file = join(logDir, `prebuilt-${stage}.log`);
  if (!existsSync(file)) return null;
  try {
    const text = readFileSync(file, "utf8");
    return text.trim() === "" ? null : errorExcerpt(text, MAX_EXCERPT_LINES);
  } catch (e) {
    return redact(`stage log ${file} could not be read: ${e instanceof Error ? e.message : String(e)}`);
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
