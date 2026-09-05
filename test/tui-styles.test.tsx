import { expect, test } from "bun:test";
import { PassThrough } from "node:stream";
import { render, type Instance } from "ink";
import { act, type ReactNode } from "react";
import { DEFAULT_SETTINGS, type Settings } from "../src/types/Settings";
import { App } from "../src/tui/App";
import { PowerlineSeparatorEditor } from "../src/tui/components/PowerlineSeparatorEditor";
import { applyCustomPowerlineTheme } from "../src/tui/components/PowerlineThemeSelector";
import { PREVIEW_CONTEXT } from "../src/tui/components/StatusLinePreview";
import { getVisibleText } from "../src/utils/ansi";
import { renderStatusLines } from "../src/utils/renderer";
import { tmpEnv } from "./helpers";

interface TuiHarness {
  readonly instance: Instance;
  lastFrame(): string;
  write(input: string): Promise<void>;
  cleanup(): void;
}

function createTui(node: ReactNode): TuiHarness {
  const stdin = new PassThrough() as PassThrough & {
    isTTY: boolean;
    setRawMode(enabled: boolean): PassThrough;
    ref(): PassThrough;
    unref(): PassThrough;
  };
  stdin.isTTY = true;
  stdin.setRawMode = () => stdin;
  stdin.ref = () => stdin;
  stdin.unref = () => stdin;
  const stdout = new PassThrough() as PassThrough & { columns: number; rows: number };
  stdout.columns = 120;
  stdout.rows = 40;
  let lastFrame = "";
  stdout.on("data", (chunk: Buffer) => { lastFrame = chunk.toString(); });
  const instance = render(node, {
    stdin: stdin as unknown as NodeJS.ReadStream,
    stdout: stdout as unknown as NodeJS.WriteStream,
    stderr: new PassThrough() as unknown as NodeJS.WriteStream,
    debug: true,
    exitOnCtrlC: false,
    patchConsole: false,
  });
  return {
    instance,
    lastFrame: () => lastFrame,
    async write(input: string): Promise<void> {
      // Flush React effects between keypresses; 10ms alone loses selections on CI.
      const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
      const previous = environment.IS_REACT_ACT_ENVIRONMENT;
      environment.IS_REACT_ACT_ENVIRONMENT = true;
      try {
        await act(async () => {
          stdin.write(input);
          await new Promise<void>((resolve) => setTimeout(resolve, 10));
        });
      } finally {
        if (previous === undefined) delete environment.IS_REACT_ACT_ENVIRONMENT;
        else environment.IS_REACT_ACT_ENVIRONMENT = previous;
      }
    },
    cleanup() { instance.unmount(); instance.cleanup(); },
  };
}

function styleSettings(): Settings {
  return {
    ...DEFAULT_SETTINGS,
    lines: [[
      { id: "model", type: "model" },
      { id: "current-working-dir", type: "current-working-dir" },
    ]],
  };
}

test("selecting a Powerline theme changes the production preview", async () => {
  const { root } = tmpEnv();
  const initialSettings = styleSettings();
  const app = createTui(<App initialSettings={initialSettings} settingsPath={`${root}/settings.json`} />);

  try {
    await app.write("\x1b[B");
    await app.write("\x1b[B");
    await app.write("\r");
    expect(app.lastFrame()).toContain("Powerline Setup");

    await app.write("t");
    for (let index = 0; index < 3; index++) await app.write("\x1b[B");
    await app.write("\r");
    expect(app.lastFrame()).toContain("Powerline Theme Selection");

    for (let index = 0; index < 4; index++) await app.write("\x1b[B");
    await app.write("\r");

    const expected = renderStatusLines({
      ...initialSettings,
      defaultPadding: " ",
      powerline: { ...initialSettings.powerline, enabled: true, theme: "dracula" },
    }, { ...PREVIEW_CONTEXT, isPreview: true, terminalWidth: 120 })[0];
    expect(app.lastFrame()).toContain("Dracula");
    expect(getVisibleText(app.lastFrame())).toContain(getVisibleText(expected ?? ""));
    expect(app.lastFrame()).toContain("\x1b[48;5;141m");
  } finally {
    app.cleanup();
  }
});

test("selecting a gradient changes the production preview", async () => {
  const { root } = tmpEnv();
  const initialSettings = styleSettings();
  const app = createTui(<App initialSettings={initialSettings} settingsPath={`${root}/settings.json`} />);

  try {
    for (let index = 0; index < 3; index++) await app.write("\x1b[B");
    await app.write("\r");
    await app.write("g");
    expect(app.lastFrame()).toContain("Select Gradient");

    await app.write("\r");
    const expected = renderStatusLines(
      { ...initialSettings, overrideForegroundColor: "gradient:atlas" },
      { ...PREVIEW_CONTEXT, isPreview: true, terminalWidth: 120 },
    )[0];
    expect(getVisibleText(app.lastFrame())).toContain(getVisibleText(expected ?? ""));
    expect(app.lastFrame()).toContain("\x1b[38;5;216m");
  } finally {
    app.cleanup();
  }
});

test("customizing a Powerline theme restarts its palette on every row", () => {
  const customized = applyCustomPowerlineTheme({
    ...styleSettings(),
    lines: [
      [{ id: "model", type: "model" }, { id: "current-working-dir", type: "current-working-dir" }],
      [{ id: "branch", type: "git-branch" }],
    ],
  }, "dracula");

  expect(customized?.powerline.theme).toBe("custom");
  expect(customized?.lines[0]?.[0]?.backgroundColor).toBe("ansi256:141");
  expect(customized?.lines[1]?.[0]?.backgroundColor).toBe("ansi256:141");
});

test("cycling a custom separator left uses the last preset and its inversion", async () => {
  const updates: Settings[] = [];
  const app = createTui(<PowerlineSeparatorEditor
    settings={{ ...styleSettings(), powerline: { ...DEFAULT_SETTINGS.powerline, separators: ["X"], separatorInvertBackground: [false] } }}
    mode="separator"
    onUpdate={(settings) => updates.push(settings)}
    onBack={() => undefined}
  />);

  try {
    await app.write("\x1b[D");
    expect(updates.at(-1)?.powerline.separators).toEqual(["\uE0B6"]);
    expect(updates.at(-1)?.powerline.separatorInvertBackground).toEqual([true]);
  } finally {
    app.cleanup();
  }
});
