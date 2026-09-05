import { expect, test } from "bun:test";
import type { Settings } from "../src/types";

const { renderStatusLines } = await import("../src/utils/renderer");
const { getVisibleText, getVisibleWidth } = await import("../src/utils/ansi");
const { applyColors } = await import("../src/utils/colors");

const previewContext = {
  data: {
    payload_version: 1 as const,
    model: { name: "model-content-that-is-long-enough-to-truncate" },
    git: { branch: "git-branch-content-that-is-long-enough-to-truncate" },
    session: { codex_version: "codex-version-content-that-is-long-enough-to-truncate" },
  },
  now: new Date("2026-09-03T12:00:00Z"),
  terminalWidth: 80,
  freeMemoryBytes: 0,
  isPreview: true,
};

const threeRowSettings: Settings = {
  version: 2,
  lines: [
    [{ id: "1", type: "model", color: "cyan" }],
    [{ id: "2", type: "git-branch", color: "magenta" }],
    [{ id: "3", type: "version", color: "yellow" }],
  ],
  flexMode: "full",
  compactThreshold: 60,
  colorLevel: 3,
  defaultPaddingSide: "both",
  inheritSeparatorColors: false,
  globalBold: false,
  minimalistMode: false,
  powerline: {
    enabled: false,
    separators: ["\uE0B0"],
    separatorInvertBackground: [false],
    startCaps: [],
    endCaps: [],
    autoAlign: false,
    continueThemeAcrossLines: false,
  },
};

test("renders three rows with independent ANSI reset boundaries", () => {
  const rows = renderStatusLines(threeRowSettings, previewContext);

  expect(rows).toHaveLength(3);
  expect(rows.every((row) => !row.includes("\n"))).toBe(true);
  expect(rows.every((row) => row.startsWith("\x1b[0m"))).toBe(true);
});

test("falls back to codex when every configured row resolves empty", () => {
  const settings: Settings = {
    ...threeRowSettings,
    lines: [[{ id: "1", type: "separator" }], [{ id: "2", type: "flex-separator" }]],
  };

  expect(renderStatusLines(settings, previewContext)).toEqual(["codex"]);
});

test("one broken widget does not suppress its siblings", () => {
  const settings: Settings = {
    ...threeRowSettings,
    lines: [[{ id: "1", type: "git-changes" }, { id: "2", type: "model" }]],
  };
  const changes = Object.defineProperty({}, "additions", {
    get: () => { throw new Error("broken widget"); },
  }) as { additions: number; deletions: number };
  const context = { ...previewContext, isPreview: false, data: { payload_version: 1 as const, model: { name: "gpt-5-codex" }, git: { changes } } };

  expect(renderStatusLines(settings, context)[0]).toContain("gpt-5-codex");
});

test("strips raw control bytes before widget output enters layout", () => {
  const settings: Settings = {
    ...threeRowSettings,
    colorLevel: 1,
    lines: [[{ id: "1", type: "model", color: "cyan" }]],
  };
  const context = {
    ...previewContext,
    isPreview: false,
    data: { payload_version: 1 as const, model: { name: "ok\nbad\x1b[31mred\x07\x7f\u0080\u009b\u009f" } },
  };

  const [row] = renderStatusLines(settings, context);

  expect(row).toContain("\x1b[36m");
  expect(row).not.toContain("\n");
  expect(row).not.toContain("\x07");
  expect(row).not.toContain("\x7f");
  expect(row).not.toContain("\x1b[31m");
  expect(row).not.toMatch(/[\u0080-\u009F]/);
  expect(getVisibleText(row!)).toBe("Model: okbad[31mred");
});

test("strips C1 control bytes from preview configuration before layout", () => {
  const settings: Settings = {
    ...threeRowSettings,
    lines: [[
      { id: "1", type: "model" },
      { id: "2", type: "separator", character: "\u0080|\u009b\u009f" },
      { id: "3", type: "git-branch" },
    ]],
  };

  const [row] = renderStatusLines(settings, { ...previewContext, isPreview: true });

  expect(row).not.toMatch(/[\u0080-\u009F]/);
  expect(getVisibleText(row!)).toContain("Model: Codex | ⎇ main");
});

test("strips controls from both configured separator sources before layout", () => {
  const context = {
    ...previewContext,
    isPreview: false,
    data: { payload_version: 1 as const, model: { name: "one" }, git: { branch: "two" } },
  };
  const controlSeparator = "\n\x1b[31m|\x07\x7f";
  const settings: Settings[] = [
    {
      ...threeRowSettings,
      lines: [[{ id: "1", type: "model" }, { id: "2", type: "separator", character: controlSeparator }, { id: "3", type: "git-branch" }]],
    },
    {
      ...threeRowSettings,
      defaultSeparator: controlSeparator,
      lines: [[{ id: "1", type: "model" }, { id: "2", type: "git-branch" }]],
    },
  ];

  for (const settingsForSource of settings) {
    const [row] = renderStatusLines(settingsForSource, context);
    expect(row).not.toContain("\n");
    expect(row).not.toContain("\x07");
    expect(row).not.toContain("\x7f");
    expect(row).not.toContain("\x1b[31m");
  }
});

test("applies a truecolor gradient after truncation", () => {
  const settings: Settings = {
    ...threeRowSettings,
    lines: [[{ id: "1", type: "model" }]],
    flexMode: "full",
    overrideForegroundColor: "gradient:hex:FF0000,hex:0000FF",
  };

  const [row] = renderStatusLines(settings, { ...previewContext, isPreview: false, terminalWidth: 24 });

  expect(row).toContain("\x1b[38;2;");
  expect(getVisibleWidth(row!)).toBeLessThanOrEqual(18);
  expect(getVisibleText(row!)).toBe("Model: model-co...");
});

test("keeps padding and collapses adjacent separators", () => {
  const settings: Settings = {
    ...threeRowSettings,
    lines: [[
      { id: "1", type: "model" },
      { id: "2", type: "separator", character: "|" },
      { id: "3", type: "separator", character: "|" },
      { id: "4", type: "git-branch" },
    ]],
    defaultPadding: " ",
  };

  const [row] = renderStatusLines(settings, { ...previewContext, terminalWidth: 200 });

  expect(getVisibleText(row!).match(/\|/g)).toHaveLength(1);
});

test("renders Powerline segments with configured separators", () => {
  const settings: Settings = {
    ...threeRowSettings,
    lines: [[{ id: "1", type: "model", backgroundColor: "blue" }, { id: "2", type: "git-branch", backgroundColor: "magenta" }]],
    powerline: { ...threeRowSettings.powerline, enabled: true },
  };

  const [row] = renderStatusLines(settings, previewContext);

  expect(getVisibleText(row!)).toContain("\uE0B0");
});

test("uses the requested ANSI color level without process-wide Chalk state", () => {
  expect(applyColors("x", "red", undefined, false, "ansi16")).toContain("\x1b[31m");
  expect(applyColors("x", "red", undefined, false, "ansi256")).toContain("\x1b[38;5;160m");
  expect(applyColors("x", "hex:112233", undefined, false, "truecolor")).toContain("\x1b[38;2;17;34;51m");
});

test("uses flex space to fill the effective terminal width", () => {
  const settings: Settings = {
    ...threeRowSettings,
    lines: [[
      { id: "1", type: "model" },
      { id: "2", type: "flex-separator" },
      { id: "3", type: "git-branch" },
    ]],
  };

  const [row] = renderStatusLines(settings, { ...previewContext, terminalWidth: 100 });

  expect(getVisibleWidth(row!)).toBe(94);
});

test("settings minimalist mode controls production and preview rendering", () => {
  const settings: Settings = {
    ...threeRowSettings,
    minimalistMode: true,
    lines: [[{ id: "1", type: "terminal-width", rawValue: false }]],
  };

  const [production] = renderStatusLines(settings, { ...previewContext, isPreview: false, terminalWidth: 100 });
  const [preview] = renderStatusLines(settings, { ...previewContext, isPreview: true, terminalWidth: 100 });

  expect(getVisibleText(production!)).toBe("100");
  expect(getVisibleText(preview!)).toBe("100");
});

test("derives full-until-compact width from payload context usage at the threshold", () => {
  const settings: Settings = {
    ...threeRowSettings,
    colorLevel: 0,
    flexMode: "full-until-compact",
    compactThreshold: 60,
    lines: [[
      { id: "1", type: "model" },
      { id: "2", type: "flex-separator" },
      { id: "3", type: "git-branch" },
    ]],
  };
  const base = {
    ...previewContext,
    isPreview: false,
    terminalWidth: 100,
    data: { payload_version: 1 as const, model: { name: "left" }, git: { branch: "right" } },
  };

  const [below] = renderStatusLines(settings, { ...base, data: { ...base.data, usage: { context_used: 0.59 } } });
  const [atThreshold] = renderStatusLines(settings, { ...base, data: { ...base.data, usage: { context_used: 0.60 } } });

  expect(getVisibleWidth(below!)).toBe(94);
  expect(getVisibleWidth(atThreshold!)).toBe(60);
});
