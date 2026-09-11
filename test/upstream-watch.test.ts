import { describe, expect, test } from "bun:test";
import {
  bumpMinor,
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
});
