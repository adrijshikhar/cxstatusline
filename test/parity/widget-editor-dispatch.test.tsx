import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { render, type Instance } from "ink";
import type { ReactNode } from "react";
import { DEFAULT_SETTINGS, type Settings } from "../../src/types/Settings";
import { App } from "../../src/tui/App";
import { tmpEnv } from "../helpers";

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
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
    },
    cleanup() { instance.unmount(); instance.cleanup(); },
  };
}

function open(lines: Settings["lines"]): TuiHarness {
  const { root } = tmpEnv();
  return createTui(<App initialSettings={{ ...DEFAULT_SETTINGS, lines }} settingsPath={join(root, "settings.json")} />);
}

async function enterLineOne(app: TuiHarness): Promise<void> {
  await app.write("\r");
  await app.write("\r");
  expect(app.lastFrame()).toContain("Edit Line 1");
}

describe("widget editor dispatch", () => {
  test("an existing widget's keybinds are listed and its width editor opens on w", async () => {
    const app = open([[{ id: "b", type: "git-branch" }]]);
    try {
      await enterLineOne(app);
      expect(app.lastFrame()).toContain("(w)idth");
      expect(app.lastFrame()).toContain("(g)lyph");
      await app.write("w");
      expect(app.lastFrame()).toContain("Enter max width");
      await app.write("12");
      await app.write("\r");
      expect(app.lastFrame()).toContain("Git Branch (max:12)");
    } finally {
      app.cleanup();
    }
  });

  test("escape cancels an editor without changing the item", async () => {
    const app = open([[{ id: "b", type: "git-branch", maxWidth: 7 }]]);
    try {
      await enterLineOne(app);
      await app.write("w");
      await app.write("99");
      await app.write("\x1b");
      expect(app.lastFrame()).toContain("Git Branch (max:7)");
    } finally {
      app.cleanup();
    }
  });

  test("custom-text is edited with e and previewed live", async () => {
    const app = open([[{ id: "t", type: "custom-text" }]]);
    try {
      await enterLineOne(app);
      expect(app.lastFrame()).toContain("Custom Text (Empty)");
      await app.write("e");
      expect(app.lastFrame()).toContain("Enter custom text");
      await app.write("[PROD]");
      await app.write("\r");
      expect(app.lastFrame()).toContain("Custom Text ([PROD])");
      expect(app.lastFrame()).toContain("[PROD]");
    } finally {
      app.cleanup();
    }
  });

  test("custom-text editor supports Ctrl+Left jump to start", async () => {
    const app = open([[{ id: "t", type: "custom-text" }]]);
    try {
      await enterLineOne(app);
      await app.write("e");
      await app.write("abc");
      await app.write("\x1b[1;5D");
      await app.write("X");
      await app.write("\r");
      expect(app.lastFrame()).toContain("Custom Text (Xabc)");
    } finally {
      app.cleanup();
    }
  });

  test("custom-symbol is edited with e", async () => {
    const app = open([[{ id: "s", type: "custom-symbol" }]]);
    try {
      await enterLineOne(app);
      await app.write("e");
      expect(app.lastFrame()).toContain("Enter custom symbol");
      await app.write("⚡");
      await app.write("\r");
      expect(app.lastFrame()).toContain("Custom Symbol (⚡)");
    } finally {
      app.cleanup();
    }
  });

  test("custom-command: p toggles preserve, t opens the timeout editor, e opens the command editor, preview never runs it", async () => {
    const app = open([[{ id: "c", type: "custom-command", commandPath: "date" }]]);
    try {
      await enterLineOne(app);
      expect(app.lastFrame()).toContain("Custom Command (date)");
      expect(app.lastFrame()).toContain("[cmd: date]");
      await app.write("p");
      expect(app.lastFrame()).toContain("(preserve)");
      await app.write("t");
      expect(app.lastFrame()).toContain("Enter timeout in ms");
      await app.write("450");
      await app.write("\r");
      expect(app.lastFrame()).toContain("timeout:450ms");
      await app.write("e");
      expect(app.lastFrame()).toContain("Enter command:");
      await app.write("\x1b");
      expect(app.lastFrame()).toContain("Custom Command (date)");
    } finally {
      app.cleanup();
    }
  });

  test("the picker offers a Custom category", async () => {
    const app = open([[]]);
    try {
      await enterLineOne(app);
      await app.write("a");
      expect(app.lastFrame()).toContain("Custom");
      await app.write("custom sym");
      await app.write("\r");
      expect(app.lastFrame()).toContain("Custom Symbol (?)");
    } finally {
      app.cleanup();
    }
  });
});
