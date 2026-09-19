/**
 * Report coverage for `scripts/prebuilt.ts report`.
 *
 * The reporter's whole job is to be trustworthy about state it does not control: one issue per
 * release identity, updated rather than duplicated, closed only by the success that clears it, and
 * silent about issue state whenever the API did not actually answer.
 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  blockedIssueTitle,
  errorExcerpt,
  failingStage,
  redact,
  REPORT_MARKER,
  reportBody,
  runReport,
  stageLogExcerpt,
  type JobResults,
  type ReportInput,
} from "../scripts/prebuilt";
import { CODEX, CX, fakeGh, ok, PATCH_SHA, RELEASE_URL, RUN_URL, SOURCE, TAG } from "./prebuilt-gh-fixture";

/** The one lookup the reporter makes: every open issue, paginated. */
const LOOKUP = "api --paginate";

const results = (over: Partial<JobResults> = {}): JobResults => ({
  detect: "success",
  validate: "success",
  native: "success",
  publish: "success",
  ...over,
});

const reportInput = (over: Partial<ReportInput> = {}): ReportInput => ({
  results: results(),
  codexVersion: CODEX,
  cxVersion: CX,
  tag: TAG,
  repo: "adrijshikhar/cxstatusline",
  upstreamTag: `rust-v${CODEX}`,
  runUrl: RUN_URL,
  sourceCommit: SOURCE,
  patchSha256: PATCH_SHA,
  event: "workflow_dispatch",
  shouldBuild: true,
  publishRequested: true,
  releaseUrl: null,
  errorExcerpt: null,
  logDir: null,
  blockedReason: null,
  ...over,
});

describe("failingStage", () => {
  const opts = { publishRequested: true, shouldBuild: true };

  test("reports the first non-success stage", () => {
    expect(failingStage(results({ detect: "failure" }), opts)).toBe("detect");
    expect(failingStage(results({ validate: "failure", native: "skipped" }), opts)).toBe("validate");
    expect(failingStage(results({ native: "failure", publish: "skipped" }), opts)).toBe("native");
    expect(failingStage(results({ merge: "failure", publish: "skipped" }), opts)).toBe("merge");
    expect(failingStage(results({ publish: "failure" }), opts)).toBe("publish");
  });

  test("an all-success run has no failing stage", () => {
    expect(failingStage(results(), opts)).toBeNull();
  });

  test("a skipped publish on a manual non-publish run is not a failure", () => {
    expect(failingStage(results({ publish: "skipped" }), { ...opts, publishRequested: false })).toBeNull();
  });

  test("a skipped build after a deliberate detect skip is not a failure", () => {
    const skipped = results({ validate: "skipped", native: "skipped", publish: "skipped" });
    expect(failingStage(skipped, { ...opts, shouldBuild: false })).toBeNull();
  });

  test("a failed detect is still reported when nothing was built", () => {
    expect(failingStage(results({ detect: "failure" }), { ...opts, shouldBuild: false })).toBe("detect");
  });

  test("a cancelled job counts as a failure", () => {
    expect(failingStage(results({ native: "cancelled" }), opts)).toBe("native");
  });

  test("an unexpectedly skipped publish on a publishing run is a failure", () => {
    expect(failingStage(results({ publish: "skipped" }), opts)).toBe("publish");
  });
});

describe("reportBody", () => {
  test("carries every required field", () => {
    const body = reportBody(reportInput(), "native");
    expect(body.startsWith(REPORT_MARKER)).toBe(true);
    const required = [
      `cxstatusline version: ${CX}`, `Codex version: ${CODEX}`, `rust-v${CODEX}`,
      "Failing stage: native", "Architecture: darwin-arm64", RUN_URL, PATCH_SHA,
      SOURCE, "workflow_dispatch", "self_hosted=true", "publish=true",
    ];
    for (const r of required) expect(body).toContain(r);
  });

  test("formats multiple architectures when provided", () => {
    const body = reportBody(reportInput({ platforms: ["darwin-arm64", "darwin-x64"] }), "native");
    expect(body).toContain("Architecture: darwin-arm64, darwin-x64");
  });

  test("includes merge in Job results when present", () => {
    const body = reportBody(reportInput({ results: results({ merge: "success" }) }), "publish");
    expect(body).toContain("native=success merge=success publish=success");
  });

  test("says so when upstream identity is unknown", () => {
    const body = reportBody(reportInput({ codexVersion: null, tag: null, upstreamTag: null }), "detect");
    expect(body).toContain("Codex version: unresolved");
    expect(body).toContain("Upstream tag: unresolved");
  });

  test("bounds and sanitizes the error excerpt", () => {
    const raw = [...Array(50).keys()].map((i) => `line ${i} ghp_${"A".repeat(36)}`).join("\n");
    const body = reportBody(reportInput({ errorExcerpt: errorExcerpt(raw) }), "native");
    expect(body).not.toContain("ghp_");
    const fenced = body.split("```")[1]!;
    expect(fenced.trim().split("\n")).toHaveLength(20);
  });

  test("says so, rather than omitting the section, when no log was captured", () => {
    const body = reportBody(reportInput(), "publish");
    expect(body).toContain("### Error excerpt");
    expect(body).toContain("no error excerpt captured");
  });

  test("carries detect's blocked reason when the run was blocked rather than broken", () => {
    const reason = "upstream Codex 0.154.0 is not covered by patches/manifest.json";
    const body = reportBody(reportInput({ blockedReason: reason }), "detect");
    expect(body).toContain(`Blocked reason: ${reason}`);
  });

  test("no blocked-reason line when the run simply failed", () => {
    expect(reportBody(reportInput(), "native")).not.toContain("Blocked reason:");
  });
});

describe("redact", () => {
  test("strips classic, fine-grained and server tokens", () => {
    expect(redact(`ghp_${"A".repeat(36)} github_pat_${"B".repeat(30)} ghs_${"C".repeat(36)}`)).not.toMatch(
      /ghp_|github_pat_|ghs_/,
    );
  });

  test("strips Authorization headers", () => {
    expect(redact("Authorization: Bearer secretvalue")).not.toContain("secretvalue");
  });

  test("strips query strings from URLs but keeps the path", () => {
    const out = redact("fetch https://objects.example.com/a/b.tar.gz?X-Amz-Signature=deadbeef failed");
    expect(out).toContain("https://objects.example.com/a/b.tar.gz");
    expect(out).not.toContain("deadbeef");
  });

  test("leaves ordinary text alone", () => {
    expect(redact("cargo build failed at codex-tui")).toBe("cargo build failed at codex-tui");
  });

  test("errorExcerpt keeps at most the requested number of lines", () => {
    expect(errorExcerpt([...Array(90).keys()].join("\n"), 20).split("\n")).toHaveLength(20);
  });
});

describe("runReport", () => {
  const issue = (number: number, title: string, body: string) => ({ number, title, body });
  const listOut = (items: unknown[]) => ok(JSON.stringify(items));
  const failed = () => reportInput({ results: results({ native: "failure", publish: "skipped" }) });

  test("creates one issue for a native failure and fails the job", async () => {
    const fake = fakeGh({ [LOOKUP]: () => listOut([]), "issue create": () => ok(RELEASE_URL) });
    const code = await runReport({ run: fake.run, input: failed(), summary: () => {} });
    expect(code).toBe(1);
    expect(fake.of("issue create")[0]).toContain(blockedIssueTitle(CODEX));
    expect(fake.of("issue create")[0]).toContain("adrijshikhar/cxstatusline");
    expect(fake.of("issue edit")).toHaveLength(0);
  });

  test("reads every page of open issues in one paginated call", async () => {
    const fake = fakeGh({ [LOOKUP]: () => listOut([]), "issue create": () => ok() });
    await runReport({ run: fake.run, input: failed(), summary: () => {} });
    const lookup = fake.of(LOOKUP)[0]!;
    expect(lookup).toContain("--paginate");
    expect(lookup.join(" ")).toContain("repos/adrijshikhar/cxstatusline/issues?state=open&per_page=100");
    expect(fake.of(LOOKUP)).toHaveLength(1);
  });

  test("repeated failure updates the one existing issue instead of creating another", async () => {
    const existing = issue(7, blockedIssueTitle(CODEX), `${REPORT_MARKER}\nold body`);
    const fake = fakeGh({ [LOOKUP]: () => listOut([existing]), "issue edit": () => ok() });
    await runReport({ run: fake.run, input: failed(), summary: () => {} });
    expect(fake.of("issue create")).toHaveLength(0);
    expect(fake.of("issue edit")[0]).toContain("7");
  });

  test("ignores an open issue with the same title but no marker", async () => {
    const impostor = issue(9, blockedIssueTitle(CODEX), "written by hand");
    const fake = fakeGh({ [LOOKUP]: () => listOut([impostor]), "issue create": () => ok() });
    await runReport({ run: fake.run, input: failed(), summary: () => {} });
    expect(fake.of("issue create")).toHaveLength(1);
    expect(fake.of("issue edit")).toHaveLength(0);
  });

  test("suppresses issue creation for a failure on a manual non-publishing run", async () => {
    const fake = fakeGh({ [LOOKUP]: () => listOut([]) });
    const code = await runReport({
      run: fake.run,
      input: reportInput({
        results: results({ native: "failure", publish: "skipped" }),
        publishRequested: false,
      }),
      summary: () => {},
    });
    expect(code).toBe(1);
    expect(fake.of("issue create")).toHaveLength(0);
    expect(fake.of("issue edit")).toHaveLength(0);
  });

  test("an unresolved detection failure uses the detection title", async () => {
    const fake = fakeGh({ [LOOKUP]: () => listOut([]), "issue create": () => ok() });
    await runReport({
      run: fake.run,
      input: reportInput({
        results: results({ detect: "failure", validate: "skipped", native: "skipped", publish: "skipped" }),
        codexVersion: null,
        tag: null,
      }),
      summary: () => {},
    });
    expect(fake.of("issue create")[0]).toContain(blockedIssueTitle(null));
  });

  test("a successful publish closes the version issue with the release link", async () => {
    const existing = issue(7, blockedIssueTitle(CODEX), `${REPORT_MARKER}\nold`);
    const fake = fakeGh({
      [LOOKUP]: () => listOut([existing]),
      "issue comment": () => ok(),
      "issue close": () => ok(),
    });
    const code = await runReport({
      run: fake.run,
      input: reportInput({ releaseUrl: RELEASE_URL }),
      summary: () => {},
    });
    expect(code).toBe(0);
    expect(fake.of("issue comment")[0]!.join(" ")).toContain("7");
    expect(fake.of("issue close")[0]).toContain("7");
  });

  test("a successful detect closes only the detection issue", async () => {
    const detection = issue(3, blockedIssueTitle(null), `${REPORT_MARKER}\ndetect`);
    const version = issue(4, blockedIssueTitle(CODEX), `${REPORT_MARKER}\nversion`);
    const fake = fakeGh({
      [LOOKUP]: () => listOut([detection, version]),
      "issue comment": () => ok(),
      "issue close": () => ok(),
    });
    await runReport({
      run: fake.run,
      input: reportInput({ results: results({ publish: "skipped" }), publishRequested: false }),
      summary: () => {},
    });
    expect(fake.of("issue close").map((c) => c[2])).toEqual(["3"]);
    expect(fake.of("issue comment").map((c) => c[2]).sort()).toEqual(["3", "4"]);
  });

  test("an arm64 build that was not published comments without closing", async () => {
    const version = issue(4, blockedIssueTitle(CODEX), `${REPORT_MARKER}\nversion`);
    const bodies: string[] = [];
    const fake = fakeGh({
      [LOOKUP]: () => listOut([version]),
      "issue comment": (a) => {
        bodies.push(readFileSync(a[a.indexOf("--body-file") + 1]!, "utf8"));
        return ok();
      },
    });
    await runReport({
      run: fake.run,
      input: reportInput({ results: results({ publish: "skipped" }), publishRequested: false }),
      summary: () => {},
    });
    expect(fake.of("issue close")).toHaveLength(0);
    expect(bodies.join("\n")).toContain("not published");
  });

  test("a gh failure fails the job and never claims an issue exists", async () => {
    const fake = fakeGh({ [LOOKUP]: () => ({ status: 1, stdout: "", stderr: "gh: rate limited" }) });
    const lines: string[] = [];
    const code = await runReport({ run: fake.run, input: failed(), summary: (l) => lines.push(...l) });
    expect(code).toBe(1);
    expect(lines.join("\n")).toContain("rate limited");
    expect(lines.join("\n")).not.toMatch(/issue (created|updated|closed)/i);
    expect(fake.of("issue create")).toHaveLength(0);
    expect(fake.of("issue edit")).toHaveLength(0);
  });

  test("a failure after a successful write lists the issue actions that did complete", async () => {
    const detection = issue(3, blockedIssueTitle(null), `${REPORT_MARKER}\ndetect`);
    const fake = fakeGh({
      [LOOKUP]: () => listOut([detection]),
      "issue comment": () => ok(),
      "issue close": () => ({ status: 1, stdout: "", stderr: "gh: rate limited" }),
    });
    const lines: string[] = [];
    const code = await runReport({
      run: fake.run,
      input: reportInput({ results: results({ publish: "skipped" }), publishRequested: false }),
      summary: (l) => lines.push(...l),
    });
    expect(code).toBe(1);
    const summary = lines.join("\n");
    expect(summary).toContain("Issue actions that did complete before the failure:");
    expect(summary).toContain("Commented on issue #3");
    // The close is the call that failed, so it is never listed as done.
    expect(summary).not.toContain("Closed issue #3");
  });

  test("claims nothing when the failure came before any write", async () => {
    const fake = fakeGh({ [LOOKUP]: () => ({ status: 1, stdout: "", stderr: "gh: rate limited" }) });
    const lines: string[] = [];
    await runReport({ run: fake.run, input: failed(), summary: (l) => lines.push(...l) });
    expect(lines.join("\n")).toContain("No issue was created, updated, commented on or closed before the failure.");
  });

  test("sanitizes a gh failure summary", async () => {
    const fake = fakeGh({
      [LOOKUP]: () => ({ status: 1, stdout: "", stderr: `gh failed: Authorization: Bearer ghp_${"A".repeat(36)}` }),
    });
    const lines: string[] = [];
    await runReport({ run: fake.run, input: failed(), summary: (l) => lines.push(...l) });
    expect(lines.join("\n")).not.toContain("ghp_");
  });

  test("refuses a repository slug that is not owner/name", async () => {
    const fake = fakeGh({});
    const code = await runReport({
      run: fake.run,
      input: reportInput({ repo: "https://example.com/x?y=1" }),
      summary: () => {},
    });
    expect(code).toBe(1);
    expect(fake.calls).toHaveLength(0);
  });
});

describe("stage log excerpting", () => {
  const logDir = () => mkdtempSync(join(tmpdir(), "cxsl-logs-"));

  test("excerpts the tail of the failing stage's captured log", () => {
    const dir = logDir();
    writeFileSync(join(dir, "prebuilt-native.log"), [...Array(40).keys()].map((n) => `line ${n}`).join("\n"));
    const excerpt = stageLogExcerpt(dir, "native")!;
    expect(excerpt.split("\n")).toHaveLength(20);
    expect(excerpt).toContain("line 39");
    expect(excerpt).not.toContain("line 19");
  });

  test("redacts tokens in a captured log", () => {
    const dir = logDir();
    writeFileSync(join(dir, "prebuilt-publish.log"), `gh failed ghp_${"A".repeat(36)}\n`);
    expect(stageLogExcerpt(dir, "publish")).not.toContain("ghp_");
  });

  test("a missing or empty log is null, and a null log dir makes no filesystem claim", () => {
    const dir = logDir();
    writeFileSync(join(dir, "prebuilt-validate.log"), "\n \n");
    expect(stageLogExcerpt(dir, "validate")).toBeNull();
    expect(stageLogExcerpt(dir, "native")).toBeNull();
    expect(stageLogExcerpt(null, "native")).toBeNull();
  });

  test("runReport reaches for the failing stage's log when no --error-file was given", async () => {
    const dir = logDir();
    writeFileSync(join(dir, "prebuilt-native.log"), "error: linker failed on codex-tui\n");
    writeFileSync(join(dir, "prebuilt-publish.log"), "unrelated publish chatter\n");
    const bodies: string[] = [];
    const fake = fakeGh({
      [LOOKUP]: () => ok("[]"),
      "issue create": (a) => {
        bodies.push(readFileSync(a[a.indexOf("--body-file") + 1]!, "utf8"));
        return ok();
      },
    });
    const input = reportInput({ results: results({ native: "failure", publish: "skipped" }), logDir: dir });
    expect(await runReport({ run: fake.run, input, summary: () => {} })).toBe(1);
    expect(bodies[0]).toContain("linker failed on codex-tui");
    expect(bodies[0]).not.toContain("unrelated publish chatter");
  });

  test("an uncaptured log is reported as such, not omitted", async () => {
    const bodies: string[] = [];
    const fake = fakeGh({
      [LOOKUP]: () => ok("[]"),
      "issue create": (a) => {
        bodies.push(readFileSync(a[a.indexOf("--body-file") + 1]!, "utf8"));
        return ok();
      },
    });
    const input = reportInput({ results: results({ native: "failure" }), logDir: logDir() });
    await runReport({ run: fake.run, input, summary: () => {} });
    expect(bodies[0]).toContain("no error excerpt captured");
  });
});
