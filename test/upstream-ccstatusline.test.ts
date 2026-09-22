import { describe, expect, it } from "bun:test";
import {
  checkExistingParityIssue,
  fetchCompare,
  fetchLatestRelease,
  formatParityIssueBody,
  loadUpstreamConfig,
  runCcstatuslineWatch,
  type CcCompare,
  type CcRelease,
  type UpstreamConfig,
} from "../scripts/upstream-ccstatusline";
import type { GhRunner } from "../scripts/prebuilt/gh";

describe("upstream-ccstatusline", () => {
  const sampleConfig: UpstreamConfig = {
    repo: "sirmalloc/ccstatusline",
    baseCommit: "6a3d855b82faf75b249155dcfa1624780f89cbbd",
  };

  const sampleRelease: CcRelease = {
    tag_name: "v2.2.29",
    name: "v2.2.29",
    body: "## Changes\n- Add configurable numeric precision",
    html_url: "https://github.com/sirmalloc/ccstatusline/releases/tag/v2.2.29",
    published_at: "2026-09-03T19:28:48Z",
  };

  const sampleCompare: CcCompare = {
    total_commits: 2,
    commits: [
      {
        sha: "abc1234567890",
        commit: { message: "feat: add numeric precision\n\nLonger details" },
        html_url: "https://github.com/sirmalloc/ccstatusline/commit/abc1234",
      },
      {
        sha: "def5678901234",
        commit: { message: "fix: avoid leaking temp files" },
        html_url: "https://github.com/sirmalloc/ccstatusline/commit/def5678",
      },
    ],
    html_url: "https://github.com/sirmalloc/ccstatusline/compare/base...v2.2.29",
  };

  it("loads config file properly", () => {
    const config = loadUpstreamConfig();
    expect(config.repo).toBe("sirmalloc/ccstatusline");
    expect(config.baseCommit).toBe("05554cd087249167d570aed3c869915b6a18d4d2");
  });

  it("formats parity issue body with release details and commit list", () => {
    const body = formatParityIssueBody(sampleConfig, sampleRelease, sampleCompare);
    expect(body).toContain("## 🔔 Upstream Parity Alert: `ccstatusline` v2.2.29");
    expect(body).toContain("2 new commit(s)");
    expect(body).toContain("feat: add numeric precision");
    expect(body).toContain("fix: avoid leaking temp files");
    expect(body).toContain("Add configurable numeric precision");
  });

  it("checks existing issues correctly", () => {
    const mockGhEmpty: GhRunner = () => ({ status: 0, stdout: "[]", stderr: "" });
    expect(checkExistingParityIssue(mockGhEmpty, "v2.2.29").exists).toBe(false);

    const mockGhFound: GhRunner = () => ({
      status: 0,
      stdout: JSON.stringify([
        { number: 42, title: "Upstream Parity: ccstatusline v2.2.29 released", url: "https://github.com/owner/repo/issues/42" },
      ]),
      stderr: "",
    });
    const found = checkExistingParityIssue(mockGhFound, "v2.2.29");
    expect(found.exists).toBe(true);
    expect(found.url).toBe("https://github.com/owner/repo/issues/42");
  });

  it("handles up-to-date state when total_commits is 0", async () => {
    const mockGh: GhRunner = (args) => {
      if (args[1]?.includes("/releases/latest")) {
        return { status: 0, stdout: JSON.stringify(sampleRelease), stderr: "" };
      }
      if (args[1]?.includes("/compare/")) {
        return { status: 0, stdout: JSON.stringify({ total_commits: 0, commits: [], html_url: "" }), stderr: "" };
      }
      return { status: 0, stdout: "", stderr: "" };
    };

    const res = await runCcstatuslineWatch({ ghRunner: mockGh });
    expect(res.action).toBe("up_to_date");
    expect(res.newCommitsCount).toBe(0);
  });

  it("honors dryRun option", async () => {
    const mockGh: GhRunner = (args) => {
      if (args[1]?.includes("/releases/latest")) {
        return { status: 0, stdout: JSON.stringify(sampleRelease), stderr: "" };
      }
      if (args[1]?.includes("/compare/")) {
        return { status: 0, stdout: JSON.stringify(sampleCompare), stderr: "" };
      }
      return { status: 0, stdout: "", stderr: "" };
    };

    const res = await runCcstatuslineWatch({ ghRunner: mockGh, dryRun: true });
    expect(res.action).toBe("dry_run");
    expect(res.newCommitsCount).toBe(2);
    expect(res.releaseTag).toBe("v2.2.29");
  });

  it("creates issue when new commits exist and no issue is open", async () => {
    let issueCreated = false;
    const mockGh: GhRunner = (args) => {
      if (args[1]?.includes("/releases/latest")) {
        return { status: 0, stdout: JSON.stringify(sampleRelease), stderr: "" };
      }
      if (args[1]?.includes("/compare/")) {
        return { status: 0, stdout: JSON.stringify(sampleCompare), stderr: "" };
      }
      if (args[0] === "issue" && args[1] === "list") {
        return { status: 0, stdout: "[]", stderr: "" };
      }
      if (args[0] === "issue" && args[1] === "create") {
        issueCreated = true;
        return { status: 0, stdout: "https://github.com/owner/repo/issues/43", stderr: "" };
      }
      return { status: 0, stdout: "", stderr: "" };
    };

    const res = await runCcstatuslineWatch({ ghRunner: mockGh, dryRun: false });
    expect(res.action).toBe("issue_created");
    expect(res.releaseTag).toBe("v2.2.29");
    expect(issueCreated).toBe(true);
    expect(res.detail).toBe("https://github.com/owner/repo/issues/43");
  });
});
