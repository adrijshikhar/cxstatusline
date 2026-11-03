import { describe, expect, test } from "bun:test";
import { PassThrough } from "node:stream";
import { render, type Instance } from "ink";
import React, { type ReactNode } from "react";
import { DEFAULT_SETTINGS } from "../src/types/Settings";
import type { WidgetItem } from "../src/types/Widget";
import { ItemsEditor } from "../src/tui/components/ItemsEditor";
import { App } from "../src/tui/App";
import { tmpEnv } from "./helpers";
import { join } from "node:path";

interface TuiHarness {
  readonly instance: Instance;
  readonly stdin: PassThrough;
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
  stdout.on("data", (chunk: Buffer) => {
    lastFrame = chunk.toString();
  });

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
    stdin,
    lastFrame: () => lastFrame,
    async write(input: string): Promise<void> {
      stdin.write(input);
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
    },
    cleanup() {
      instance.unmount();
      instance.cleanup();
    },
  };
}

describe("ItemsEditor windowing and live preview", () => {
  test("windows widget list and displays ↓ N more marker", async () => {
    let preview: WidgetItem[] | null = null;
    const onPreviewChange = (p: WidgetItem[] | null) => { preview = p; };
    const tui = createTui(
      <ItemsEditor
        widgets={[{ id: "1", type: "model" }]}
        onUpdate={() => {}}
        onPreviewChange={onPreviewChange}
        onBack={() => {}}
        lineNumber={1}
        settings={DEFAULT_SETTINGS}
      />
    );

    try {
      await tui.write("a");
      expect(tui.lastFrame()).toContain("ADD WIDGET");
      // Open the 'All' category
      await tui.write("\r");
      expect(tui.lastFrame()).toMatch(/↓ \d+ more/);
      expect(preview).not.toBeNull();
    } finally {
      tui.cleanup();
    }
  });

  test("App reflects live preview in status line while browsing picker", async () => {
    const { root } = tmpEnv();
    const settingsPath = join(root, "settings.json");
    const app = createTui(
      <App
        initialSettings={{ ...DEFAULT_SETTINGS, lines: [[]] }}
        settingsPath={settingsPath}
      />
    );

    try {
      // Enter Lines menu
      await app.write("\r");
      // Enter Edit Line 1
      await app.write("\r");
      expect(app.lastFrame()).toContain("Edit Line 1");

      // Press 'a' to open Add Widget picker
      await app.write("a");
      // Type search for "git-branch"
      await app.write("git-branch");
      expect(app.lastFrame()).toContain("Search: git-branch");

      // While highlighted in picker, status line preview should reflect git branch widget
      expect(app.lastFrame()).toContain("⎇ main");

      // Escape cancels the search and picker, restoring empty line
      await app.write("\x1b"); // Clears search query
      await app.write("\x1b"); // Closes picker
      expect(app.lastFrame()).not.toContain("⎇ main");
    } finally {
      app.cleanup();
    }
  });
});
