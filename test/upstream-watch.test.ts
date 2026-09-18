import { describe, expect, test } from "bun:test";
import {
  bumpMinor,
  extractRelevantChanges,
  formatConflictIssueBody,
  reportConflictIssue,
  runUpstreamWatch,
  testPatchAgainstUpstream,
  updateCiPrebuiltTestContent,
  updateManifestContent,
  updateManifestTestContent,
  updatePackageTestContent,
  updatePrebuiltWorkflowContent,
  type GitRunner,
} from "../scripts/upstream-watch";
import type { GhResult, GhRunner } from "../scripts/prebuilt/gh";

describe("upstream-watch file mutators", () => {
  test("bumpMinor advances minor version", () => {
    expect(bumpMinor("0.154.0")).toBe("0.155.0");
    expect(bumpMinor("1.2.3")).toBe("1.3.0");
    expect(bumpMinor("invalid")).toBe("invalid.next");
  });

  test("updateManifestContent adds entry and updates candidate", () => {
    const original = JSON.stringify({
      version: 1,
      tag_prefix: "rust-v",
      candidate: "0.153.4",
      patches: [{ min: "0.153.4", max: "0.153.4", file: "codex-0.153.4.patch" }],
    });
    const updated = updateManifestContent(original, "0.154.0", "codex-0.154.0.patch");
    const parsed = JSON.parse(updated);
    expect(parsed.candidate).toBe("0.154.0");
    expect(parsed.patches).toHaveLength(2);
    expect(parsed.patches[1]).toEqual({ min: "0.154.0", max: "0.154.0", file: "codex-0.154.0.patch" });

    // Idempotent when already present
    expect(updateManifestContent(updated, "0.154.0", "codex-0.154.0.patch")).toBe(updated);
  });

  test("updatePrebuiltWorkflowContent adds version choice", () => {
    const original = 'options: ["auto", "0.153.4", "0.153.0"]';
    const updated = updatePrebuiltWorkflowContent(original, "0.154.0");
    expect(updated).toBe('options: ["auto", "0.154.0", "0.153.4", "0.153.0"]');
    // Idempotent
    expect(updatePrebuiltWorkflowContent(updated, "0.154.0")).toBe(updated);
  });

  test("updateCiPrebuiltTestContent bumps tested uncovered version", () => {
    const original = 'for (const version of ["0.154.0", "0.153.0-beta.1"])';
    const updated = updateCiPrebuiltTestContent(original, "0.154.0");
    expect(updated).toBe('for (const version of ["0.155.0", "0.153.0-beta.1"])');
  });

  test("updateManifestTestContent updates assertions", () => {
    const original = 'expect(shipped.candidate).toBe("0.153.4");\nexpect(resolvePatch(shipped, v(shipped.candidate!))?.file).toBe("codex-0.153.4.patch");';
    const updated = updateManifestTestContent(original, "0.154.0", "codex-0.154.0.patch");
    expect(updated).toContain('expect(shipped.candidate).toBe("0.154.0");');
    expect(updated).toContain('expect(resolvePatch(shipped, v(shipped.candidate!))?.file).toBe("codex-0.154.0.patch");');
  });

  test("updatePackageTestContent inserts new patch file into assertion", () => {
    const original = 'const files = ["patches/codex-0.153.4.patch"];';
    const updated = updatePackageTestContent(original, "codex-0.154.0.patch");
    expect(updated).toBe('const files = ["patches/codex-0.153.4.patch", "patches/codex-0.154.0.patch"];');
    // Idempotent
    expect(updatePackageTestContent(updated, "codex-0.154.0.patch")).toBe(updated);
  });
});

describe("testPatchAgainstUpstream", () => {
  test("returns clean when git clone and apply --check succeed", () => {
    const mockGit: GitRunner = (args) => {
      if (args[0] === "clone") return { status: 0, stdout: "", stderr: "" };
      if (args.includes("apply")) return { status: 0, stdout: "", stderr: "" };
      return { status: 1, stdout: "", stderr: "unknown" };
    };
    const res = testPatchAgainstUpstream(mockGit, "rust-v0.154.0", "/path/to/patch", "/tmp/fake");
    expect(res.clean).toBe(true);
  });

  test("returns error when git clone fails", () => {
    const mockGit: GitRunner = (args) => {
      if (args[0] === "clone") return { status: 128, stdout: "", stderr: "tag not found" };
      return { status: 0, stdout: "", stderr: "" };
    };
    const res = testPatchAgainstUpstream(mockGit, "rust-v0.999.0", "/path/to/patch", "/tmp/fake");
    expect(res.clean).toBe(false);
    expect(res.error).toContain("git clone failed");
  });

  test("returns error when git apply --check fails", () => {
    const mockGit: GitRunner = (args) => {
      if (args[0] === "clone") return { status: 0, stdout: "", stderr: "" };
      if (args.includes("apply")) return { status: 1, stdout: "", stderr: "error: patch failed: app.rs:10" };
      return { status: 0, stdout: "", stderr: "" };
    };
    const res = testPatchAgainstUpstream(mockGit, "rust-v0.154.0", "/path/to/patch", "/tmp/fake");
    expect(res.clean).toBe(false);
    expect(res.error).toContain("patch failed");
  });
});

describe("runUpstreamWatch orchestration", () => {
  test("returns already_covered when version is already in manifest", async () => {
    const res = await runUpstreamWatch({
      version: "0.153.4",
      dryRun: true,
      fetchReleases: async () => "0.153.4",
    });
    expect(res.action).toBe("already_covered");
    expect(res.version).toBe("0.153.4");
  });

  test("returns pr_exists when PR branch already exists", async () => {
    const mockGh: GhRunner = (args) => {
      if (args[0] === "pr" && args[1] === "list") {
        return { status: 0, stdout: '[{"number":12,"url":"https://github.com/adrijshikhar/cxstatusline/pull/12"}]', stderr: "" };
      }
      return { status: 0, stdout: "", stderr: "" };
    };
    const res = await runUpstreamWatch({
      version: "0.199.0",
      dryRun: true,
      fetchReleases: async () => "0.199.0",
      gh: mockGh,
    });
    expect(res.action).toBe("pr_exists");
    expect(res.version).toBe("0.199.0");
  });

  test("dry_run cleanly reports when patch check succeeds", async () => {
    const mockGh: GhRunner = () => ({ status: 0, stdout: "[]", stderr: "" });
    const mockGit: GitRunner = () => ({ status: 0, stdout: "", stderr: "" });
    const res = await runUpstreamWatch({
      version: "0.199.0",
      dryRun: true,
      fetchReleases: async () => "0.199.0",
      gh: mockGh,
      git: mockGit,
    });
    expect(res.action).toBe("dry_run");
    expect(res.detail).toContain("cleanly");
  });

  test("dry_run reports conflicts when patch check fails", async () => {
    const mockGh: GhRunner = () => ({ status: 0, stdout: "[]", stderr: "" });
    const mockGit: GitRunner = (args) => {
      if (args.includes("apply")) return { status: 1, stdout: "", stderr: "patch rejected" };
      return { status: 0, stdout: "", stderr: "" };
    };
    const res = await runUpstreamWatch({
      version: "0.199.0",
      dryRun: true,
      fetchReleases: async () => "0.199.0",
      gh: mockGh,
      git: mockGit,
    });
    expect(res.action).toBe("dry_run");
    expect(res.detail).toContain("Conflicts detected");
  });

  test("creates issue when conflicts detected and no issue exists", async () => {
    let createdArgs: readonly string[] = [];
    const mockGh: GhRunner = (args) => {
      if (args[0] === "pr" && args[1] === "list") return { status: 0, stdout: "[]", stderr: "" };
      if (args[0] === "issue" && args[1] === "list") return { status: 0, stdout: "[]", stderr: "" };
      if (args[0] === "issue" && args[1] === "create") {
        createdArgs = args;
        return { status: 0, stdout: "https://github.com/adrijshikhar/cxstatusline/issues/99", stderr: "" };
      }
      return { status: 0, stdout: "", stderr: "" };
    };
    const mockGit: GitRunner = (args) => {
      if (args.includes("apply")) return { status: 1, stdout: "", stderr: "rejected hunk #2" };
      return { status: 0, stdout: "", stderr: "" };
    };
    const res = await runUpstreamWatch({
      version: "0.199.0",
      dryRun: false,
      fetchReleases: async () => "0.199.0",
      gh: mockGh,
      git: mockGit,
    });
    expect(res.action).toBe("issue_created");
    expect(res.detail).toContain("issues/99");
    expect(createdArgs).toContain("--title");
    expect(createdArgs[3]).toContain("Support Codex 0.199.0 - patch conflicts detected");
  });

  test("creates issue including changelog and highlighted relevant changes", async () => {
    let createdBody = "";
    const mockGh: GhRunner = (args) => {
      if (args[0] === "pr" && args[1] === "list") return { status: 0, stdout: "[]", stderr: "" };
      if (args[0] === "issue" && args[1] === "list") return { status: 0, stdout: "[]", stderr: "" };
      if (args[0] === "issue" && args[1] === "create") {
        const bodyIdx = args.indexOf("--body");
        if (bodyIdx !== -1 && args[bodyIdx + 1]) createdBody = args[bodyIdx + 1]!;
        return { status: 0, stdout: "https://github.com/adrijshikhar/cxstatusline/issues/100", stderr: "" };
      }
      return { status: 0, stdout: "", stderr: "" };
    };
    const mockGit: GitRunner = (args) => {
      if (args.includes("apply")) return { status: 1, stdout: "", stderr: "rejected hunk in footer.rs" };
      return { status: 0, stdout: "", stderr: "" };
    };
    const sampleChangelog = [
      "- #44040 Harden credential handling in shell snapshots @user",
      "- #44354 Extract shared footer hint wrapping in the TUI @copyberry",
      "- #44198 Preserve voice indicator styles during composer sparkle effects @copyberry",
    ].join("\n");

    const res = await runUpstreamWatch({
      version: "0.199.0",
      dryRun: false,
      fetchReleases: async () => "0.199.0",
      fetchReleaseNotes: async () => sampleChangelog,
      gh: mockGh,
      git: mockGit,
    });
    expect(res.action).toBe("issue_created");
    expect(createdBody).toContain("### 🔍 Potentially Relevant Upstream Changes");
    expect(createdBody).toContain("Extract shared footer hint wrapping in the TUI");
    expect(createdBody).toContain("Preserve voice indicator styles during composer sparkle effects");
    expect(createdBody).toContain("### 📋 Upstream Changelog");
    expect(createdBody).toContain("Harden credential handling in shell snapshots");
  });
});

describe("changelog analysis and issue formatting", () => {
  test("extractRelevantChanges extracts changes related to TUI, footer, composer, and layout", () => {
    const rawChangelog = [
      "## What's Changed",
      "- #100 Update python dependencies @alice",
      "- #101 Fix bottom_pane height calculation in TUI @bob",
      "- #102 Adjust chat_composer footer hints @charlie",
      "- #103 Network proxy improvements @dave",
      "- #104 Update rate-limit status reporting @eve",
      "- #105 Refactor app layout and render loop @frank",
    ].join("\n");

    const relevant = extractRelevantChanges(rawChangelog);
    expect(relevant).toHaveLength(4);
    expect(relevant[0]).toContain("#101 Fix bottom_pane height calculation in TUI");
    expect(relevant[1]).toContain("#102 Adjust chat_composer footer hints");
    expect(relevant[2]).toContain("#104 Update rate-limit status reporting");
    expect(relevant[3]).toContain("#105 Refactor app layout and render loop");
  });

  test("formatConflictIssueBody formats issue with changelog and highlights", () => {
    const changelog = "- #500 Refactor footer rendering in TUI @dev\n- #501 Other change";
    const body = formatConflictIssueBody("0.199.0", "rust-v0.199.0", "codex-0.198.0.patch", "patch failed", changelog);

    expect(body).toContain("## Action Required: Upstream Codex 0.199.0 Released (Patch Conflicts)");
    expect(body).toContain("OpenAI Codex has released tag `rust-v0.199.0`.");
    expect(body).toContain("### 🔍 Potentially Relevant Upstream Changes");
    expect(body).toContain("#500 Refactor footer rendering in TUI");
    expect(body).toContain("### 📋 Upstream Changelog");
    expect(body).toContain("<details open>");
    expect(body).toContain("Full Changelog for <code>rust-v0.199.0</code>");
    expect(body).toContain("https://github.com/openai/codex/releases/tag/rust-v0.199.0");
    expect(body).toContain("### Steps to Resolve");
  });

  test("formatConflictIssueBody handles empty or missing changelog gracefully", () => {
    const body = formatConflictIssueBody("0.199.0", "rust-v0.199.0", "codex-0.198.0.patch", "patch failed", null);

    expect(body).toContain("### 📋 Upstream Changelog");
    expect(body).toContain("No release notes were provided");
    expect(body).not.toContain("Potentially Relevant Upstream Changes");
    expect(body).toContain("### Steps to Resolve");
  });

  test("reportConflictIssue invokes gh with formatted body", () => {
    let sentBody = "";
    let sentTitle = "";
    const mockGh: GhRunner = (args) => {
      if (args[0] === "issue" && args[1] === "list") return { status: 0, stdout: "[]", stderr: "" };
      if (args[0] === "issue" && args[1] === "create") {
        sentTitle = args[args.indexOf("--title") + 1]!;
        sentBody = args[args.indexOf("--body") + 1]!;
        return { status: 0, stdout: "https://github.com/adrijshikhar/cxstatusline/issues/101", stderr: "" };
      }
      return { status: 0, stdout: "", stderr: "" };
    };

    const res = reportConflictIssue(mockGh, "0.199.0", "rust-v0.199.0", "codex-0.198.0.patch", "patch failed: Cargo.lock", "- #999 TUI widget fix");
    expect(res.action).toBe("issue_created");
    expect(sentTitle).toContain("[Action Needed] Support Codex 0.199.0 - patch conflicts detected");
    expect(sentBody).toContain("#999 TUI widget fix");
  });
});
