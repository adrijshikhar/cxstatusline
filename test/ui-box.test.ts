import { describe, expect, test } from "bun:test";
import { renderBox, renderHeader, renderSectionTitle, symbols } from "../src/ui/box";
import { formatDoctorPretty, singleLineSummary } from "../src/commands/doctor-format";
import { line } from "../src/commands/doctor";
import { renderInstallFailure, renderInstallHeader, renderInstallHookError, renderInstallSuccess } from "../src/ui/install-format";

describe("UI Box & Cards", () => {
  test("renderBox draws rounded borders and fits content", () => {
    const card = renderBox(["Hello world", "Line 2"]);
    expect(card).toContain("╭");
    expect(card).toContain("╰");
    expect(card).toContain("Hello world");
    expect(card).toContain("Line 2");
  });

  test("renderHeader renders title, subtitle and badge", () => {
    const header = renderHeader("Test Title", "Test Subtitle", "v1.0.0");
    expect(header).toContain("Test Title");
    expect(header).toContain("Test Subtitle");
    expect(header).toContain("v1.0.0");
  });

  test("renderSectionTitle renders pointer and title", () => {
    const sec = renderSectionTitle("Core & Environment");
    expect(sec).toContain("Core & Environment");
  });
});

describe("Doctor & Install UI Formatters", () => {
  test("formatDoctorPretty formats sections and summary for healthy state", () => {
    const lines = [
      line("renderer", "/bin/cli (0.2.0)"),
      line("upstream", "/bin/codex 0.154.0", true),
      line("drift", "none", true),
      line("toolchain", "present", null),
    ];
    const out = formatDoctorPretty(lines);
    expect(out).toContain("cxstatusline doctor");
    expect(out).toContain("Core & Environment");
    expect(out).toContain("All systems operational");
  });

  test("formatDoctorPretty surfaces issues when checks fail", () => {
    const lines = [
      line("upstream", "not found", false),
      line("drift", "install due", false),
    ];
    const out = formatDoctorPretty(lines);
    expect(out).toContain("2 issues detected");
  });

  test("singleLineSummary condenses multiline cargo errors into one line", () => {
    const multiline = `failed 0.154.0 at 2026-09-11T14:00:40.557Z:
The following warnings were emitted during compilation:
warning: clang: warning: ...
error: failed to run custom build command for \`v8 v150.4.0\`
--- stderr
thread 'main' panicked at 'assertion failed'`;

    const summary = singleLineSummary(multiline);
    expect(summary).toBe(
      "failed 0.154.0 at 2026-09-11T14:00:40.557Z: error: failed to run custom build command for `v8 v150.4.0`",
    );
  });

  test("singleLineSummary preserves single line strings unchanged", () => {
    expect(singleLineSummary("ok 0.154.0")).toBe("ok 0.154.0");
  });

  test("renderInstallSuccess formats success card", () => {
    const card = renderInstallSuccess({
      version: "0.154.0",
      source: "prebuilt",
      reused: false,
      hookAction: "added",
      hookFile: "~/.codex/hooks.json",
    });
    expect(card).toContain("Installation Complete");
    expect(card).toContain("0.154.0");
    expect(card).toContain("prebuilt release");
    expect(card).toContain("Start Codex once and accept the cxstatusline hook when prompted.");
  });

  test("renderInstallFailure formats failure card with advice", () => {
    const card = renderInstallFailure(
      { kind: "refused", reason: "disk space insufficient" },
      ["Free up 2 GiB disk space."],
    );
    expect(card).toContain("Installation Incomplete");
    expect(card).toContain("disk space insufficient");
    expect(card).toContain("Free up 2 GiB disk space.");
  });
});
