import { expect, test } from "bun:test";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { render, type Instance } from "ink";
import type { ReactNode } from "react";
import { DEFAULT_SETTINGS, type Settings } from "../src/types/Settings";
import { App } from "../src/tui/App";
import { exportPreset } from "../src/utils/presets";
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
      stdin.write(input);
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    },
    cleanup() { instance.unmount(); instance.cleanup(); },
  };
}

function initialSettings(): Settings {
  return { ...DEFAULT_SETTINGS, lines: [[{ id: "model", type: "model" }]] };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

async function openImport(app: TuiHarness, file: string): Promise<void> {
  for (let index = 0; index < 5; index++) await app.write("\x1b[B");
  await app.write("\r");
  await app.write(file);
  await app.write("\r");
}

test("cancelling an import preview leaves the settings file byte-identical", async () => {
  const { root } = tmpEnv();
  const settingsPath = join(root, "settings.json");
  const importPath = join(root, "import.json");
  const before = "{\"kept\":true}\n";
  writeFileSync(settingsPath, before);
  writeFileSync(importPath, exportPreset({ ...initialSettings(), lines: [[{ id: "term", type: "terminal-width" }]] }));
  const app = createTui(<App initialSettings={initialSettings()} settingsPath={settingsPath} />);

  try {
    await openImport(app, importPath);
    expect(app.lastFrame()).toContain("Import Preview");
    expect(app.lastFrame()).toContain("Term: 120");
    expect(readFileSync(settingsPath, "utf8")).toBe(before);

    await app.write("\x1b");
    expect(app.lastFrame()).toContain("Main Menu");
    expect(app.lastFrame()).not.toContain("Term: 120");
    expect(readFileSync(settingsPath, "utf8")).toBe(before);
  } finally {
    app.cleanup();
  }
});

test("confirming an import saves the preview atomically", async () => {
  const { root } = tmpEnv();
  const settingsPath = join(root, "settings.json");
  const importPath = join(root, "import.json");
  const imported: Settings = { ...initialSettings(), lines: [[{ id: "term", type: "terminal-width" }]] };
  writeFileSync(settingsPath, "old bytes");
  writeFileSync(importPath, exportPreset(imported));
  const app = createTui(<App initialSettings={initialSettings()} settingsPath={settingsPath} />);

  try {
    await openImport(app, importPath);
    await app.write("\r");
    await new Promise<void>((resolve) => setTimeout(resolve, 20));

    expect(app.lastFrame()).toContain("Imported");
    expect(JSON.parse(readFileSync(settingsPath, "utf8"))).toEqual(imported);
    expect(readdirSync(root).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  } finally {
    app.cleanup();
  }
});

test("import confirmation stays busy until its save completes", async () => {
  const { root } = tmpEnv();
  const settingsPath = join(root, "settings.json");
  const importPath = join(root, "import.json");
  const imported: Settings = { ...initialSettings(), lines: [[{ id: "term", type: "terminal-width" }]] };
  const pendingWrite = deferred<void>();
  let persisted = initialSettings();
  const writes: Settings[] = [];
  writeFileSync(importPath, exportPreset(imported));
  const app = createTui(<App
    initialSettings={initialSettings()}
    settingsPath={settingsPath}
    writeSettings={async (_file, settings) => {
      writes.push(settings);
      await pendingWrite.promise;
      persisted = settings;
    }}
  />);

  try {
    await openImport(app, importPath);
    await app.write("\r");
    expect(app.lastFrame()).toContain("Applying imported configuration");
    expect(writes).toEqual([imported]);

    await app.write("\x1b");
    await app.write("\x13");
    expect(writes).toEqual([imported]);

    pendingWrite.resolve();
    await app.write("");
    expect(app.lastFrame()).toContain("Imported configuration.");
    expect(persisted).toEqual(imported);
  } finally {
    pendingWrite.resolve();
    app.cleanup();
  }
});
