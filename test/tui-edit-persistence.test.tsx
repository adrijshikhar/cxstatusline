import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { render, type Instance } from "ink";
import type { ReactNode } from "react";
import { DEFAULT_SETTINGS, type Settings } from "../src/types/Settings";
import type { WidgetItem } from "../src/types/Widget";
import { App } from "../src/tui/App";
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
  stdout.columns = 200;
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
      stdin.write(input);
      await new Promise<void>((resolve) => setTimeout(resolve, 60));
    },
    cleanup() { instance.unmount(); instance.cleanup(); },
  };
}

/** Edit the widget, press Escape `escapes` times, save, and return what reached disk. */
async function editThenBackOut(key: string, escapes: number): Promise<WidgetItem> {
  const { root } = tmpEnv();
  const settingsPath = join(root, "settings.json");
  const initialSettings: Settings = {
    ...DEFAULT_SETTINGS,
    lines: [[{ id: "cwd", type: "current-working-dir" }], [], []],
  };
  const app = createTui(<App initialSettings={initialSettings} settingsPath={settingsPath} />);

  try {
    await app.write("\r");
    await app.write("\r");
    expect(app.lastFrame()).toContain("Edit Line 1");

    await app.write(key);
    for (let index = 0; index < escapes; index++) await app.write("\x1b");

    await app.write("\x13");
    await new Promise<void>((resolve) => setTimeout(resolve, 200));

    const saved = JSON.parse(readFileSync(settingsPath, "utf8")) as Settings;
    return saved.lines[0]![0]!;
  } finally {
    app.cleanup();
  }
}

describe("widget edits survive navigating back", () => {
  test("a widget-editor toggle is kept from every screen it can be saved on", async () => {
    for (const escapes of [0, 1, 2]) {
      const widget = await editThenBackOut("f", escapes);
      expect(widget.metadata?.fishStyle, `fish style after ${escapes} Escape presses`).toBe("true");
    }
  });

  test("a reserved-key toggle is kept the same way", async () => {
    for (const escapes of [0, 1, 2]) {
      const widget = await editThenBackOut("r", escapes);
      expect(widget.rawValue, `raw value after ${escapes} Escape presses`).toBe(true);
    }
  });
});
