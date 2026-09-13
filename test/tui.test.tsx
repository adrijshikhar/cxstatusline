import { describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { PassThrough } from "node:stream";
import { join } from "node:path";
import { render, type Instance } from "ink";
import type { ReactNode } from "react";
import { tmpEnv } from "./helpers";
import { DEFAULT_SETTINGS } from "../src/types/Settings";
import { App } from "../src/tui/App";

interface TuiHarness {
  readonly instance: Instance;
  readonly stdin: PassThrough;
  lastFrame(): string;
  write(input: string): Promise<void>;
  cleanup(): void;
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
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

describe("configuration TUI", () => {
  test("bare editor adds a manifest widget, respects patched backspace, and previews through the production renderer", async () => {
    const { root } = tmpEnv();
    const settingsPath = join(root, "settings.json");
    const app = createTui(
      <App initialSettings={{ ...DEFAULT_SETTINGS, lines: [[]] }} settingsPath={settingsPath} />,
    );

    try {
      expect(app.lastFrame()).toContain("Main Menu");
      expect(app.lastFrame()).toContain("codex");

      await app.write("\r");
      expect(app.lastFrame()).toContain("Edit Lines");

      await app.write("\r");
      expect(app.lastFrame()).toContain("Edit Line 1");

      await app.write("a");
      await app.write("mo");
      expect(app.lastFrame()).toContain("Search: mo");

      await app.write("\x7f");
      expect(app.lastFrame()).toContain("Search: m");

      await app.write("\r");
      expect(app.lastFrame()).toContain("Model");
    } finally {
      app.cleanup();
    }
  });

  test("preview renders the production terminal-width widget", () => {
    const { root } = tmpEnv();
    const app = createTui(
      <App initialSettings={{ ...DEFAULT_SETTINGS, lines: [[{ id: "term", type: "terminal-width" }]] }} settingsPath={join(root, "settings.json")} />,
    );

    try {
      expect(app.lastFrame()).toContain("Term: 120");
    } finally {
      app.cleanup();
    }
  });

  test("line editor refuses a fourth configured row", async () => {
    const { root } = tmpEnv();
    const settingsPath = join(root, "settings.json");
    const app = createTui(
      <App initialSettings={{ ...DEFAULT_SETTINGS, lines: [[], [], []] }} settingsPath={settingsPath} />,
    );

    try {
      await app.write("\r");
      await app.write("a");
      expect(app.lastFrame()).toContain("Maximum of 3 lines");
    } finally {
      app.cleanup();
    }
  });

  test("editors never mutate the caller's settings and Escape only navigates", async () => {
    const { root } = tmpEnv();
    const settingsPath = join(root, "settings.json");
    const initialSettings = { ...DEFAULT_SETTINGS, lines: [[]] };
    const app = createTui(
      <App initialSettings={initialSettings} settingsPath={settingsPath} />,
    );

    try {
      await app.write("\r");
      await app.write("a");
      expect(app.lastFrame()).toContain("Line 2");
      expect(initialSettings.lines).toEqual([[]]);

      await app.write("\x1b");
      expect(app.lastFrame()).toContain("Main Menu");

      await app.write("\r");
      expect(app.lastFrame()).toContain("Line 2");
    } finally {
      app.cleanup();
    }
  });

  test("invalid existing settings require confirmation before replacement", async () => {
    const { root } = tmpEnv();
    const settingsPath = join(root, "settings.json");
    writeFileSync(settingsPath, "{");
    const app = createTui(<App settingsPath={settingsPath} />);

    try {
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
      expect(app.lastFrame()).toContain("could not be parsed");
      expect(readFileSync(settingsPath, "utf8")).toBe("{");

      await app.write("\x1b");
      expect(readFileSync(settingsPath, "utf8")).toBe("{");
    } finally {
      app.cleanup();
    }
  });

  test("cancelling a pending import ignores its later completion", async () => {
    const { root } = tmpEnv();
    const settingsPath = join(root, "settings.json");
    const pendingImport = deferred<string>();
    const importRequests: string[] = [];
    const app = createTui(
      <App
        initialSettings={{ ...DEFAULT_SETTINGS, lines: [[]] }}
        settingsPath={settingsPath}
        readImportFile={(file) => {
          importRequests.push(file);
          return pendingImport.promise;
        }}
      />,
    );

    try {
      for (let index = 0; index < 5; index++) await app.write("\x1b[B");
      await app.write("\r");
      expect(app.lastFrame()).toContain("Enter the file path to import configuration from:");

      await app.write("/pending-import.json");
      await app.write("\r");
      expect(importRequests).toEqual(["/pending-import.json"]);

      await app.write("\x1b");
      expect(app.lastFrame()).toContain("Main Menu");
      expect(app.lastFrame()).toContain("codex");

      pendingImport.resolve(JSON.stringify({
        ...DEFAULT_SETTINGS,
        lines: [[{ id: "terminal-width", type: "terminal-width" }]],
      }));
      await app.write("");

      expect(app.lastFrame()).toContain("Main Menu");
      expect(app.lastFrame()).toContain("codex");
      expect(app.lastFrame()).not.toContain("Term: 120");
    } finally {
      app.cleanup();
    }
  });

  test("saving while an import is pending ignores its later completion", async () => {
    const { root } = tmpEnv();
    const settingsPath = join(root, "settings.json");
    const pendingImport = deferred<string>();
    const app = createTui(
      <App
        initialSettings={{ ...DEFAULT_SETTINGS, lines: [[]] }}
        settingsPath={settingsPath}
        readImportFile={() => pendingImport.promise}
      />,
    );

    try {
      for (let index = 0; index < 5; index++) await app.write("\x1b[B");
      await app.write("\r");
      await app.write("/pending-import.json");
      await app.write("\r");

      await app.write("\x13");
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
      expect(app.lastFrame()).toContain("Configuration saved.");

      pendingImport.resolve(JSON.stringify({
        ...DEFAULT_SETTINGS,
        lines: [[{ id: "terminal-width", type: "terminal-width" }]],
      }));
      await app.write("");

      expect(app.lastFrame()).toContain("Main Menu");
      expect(app.lastFrame()).not.toContain("Term: 120");
    } finally {
      app.cleanup();
    }
  });
});
