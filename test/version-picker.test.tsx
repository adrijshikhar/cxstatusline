import { expect, test } from "bun:test";
import { PassThrough } from "node:stream";
import { render } from "ink";
import { VersionPicker } from "../src/ui/VersionPicker";
import type { PromptVersionSelection } from "../src/ui/prompt-version";

function picker(compile = false) {
  const stdin = new PassThrough() as PassThrough & { isTTY: boolean; setRawMode: () => void; ref: () => void; unref: () => void };
  Object.assign(stdin, { isTTY: true, setRawMode() {}, ref() {}, unref() {} });
  const stdout = Object.assign(new PassThrough(), { columns: 80, rows: 24 });
  let frame = "";
  let result: PromptVersionSelection | null | undefined;
  stdout.on("data", (chunk) => { frame = chunk.toString(); });
  const instance = render(<VersionPicker
    supportedVersions={["0.156.1", "0.155.1", "0.155.0"]}
    prebuiltVersions={["0.155.1", "0.155.0"]}
    defaultVersion="0.155.1"
    compile={compile}
    onSelect={(selection) => { result = selection; }}
  />, {
    stdin: stdin as unknown as NodeJS.ReadStream,
    stdout: stdout as unknown as NodeJS.WriteStream,
    stderr: new PassThrough() as unknown as NodeJS.WriteStream,
    debug: true, exitOnCtrlC: false, patchConsole: false,
  });
  return {
    frame: () => frame,
    result: () => result,
    async key(key: string) {
      stdin.write(key);
      await new Promise((resolve) => setTimeout(resolve, 50));
    },
    cleanup() { instance.unmount(); instance.cleanup(); },
  };
}

test("arrow keys select a prebuilt and Enter accepts the highlighted row", async () => {
  const ui = picker();
  try {
    expect(ui.frame()).toContain("prebuilt");
    expect(ui.frame()).toContain("build from source");
    expect(ui.frame()).toContain("▶  0.155.1");
    await ui.key("\x1b[B");
    expect(ui.frame()).toContain("▶  0.155.0");
    await ui.key("\r");
    expect(ui.result()).toEqual({ version: "0.155.0", compile: false });
  } finally { ui.cleanup(); }
});

test("source builds require explicit confirmation and Escape returns to versions", async () => {
  const ui = picker();
  try {
    await ui.key("\x1b[A");
    await ui.key("\r");
    expect(ui.frame()).toContain("Build Codex 0.156.1 from source?");
    expect(ui.result()).toBeUndefined();
    await ui.key("\r"); // Default is back, not an expensive build.
    expect(ui.frame()).toContain("Select Codex version");
    await ui.key("\r");
    await ui.key("\x1b");
    expect(ui.frame()).toContain("Select Codex version");
    await ui.key("\r");
    await ui.key("\x1b[B");
    await ui.key("\r");
    expect(ui.result()).toEqual({ version: "0.156.1", compile: true });
  } finally { ui.cleanup(); }
});

for (const key of ["\x1b", "\x03"]) {
  test(`${key === "\x1b" ? "Escape" : "Ctrl+C"} cancels without choosing a version`, async () => {
    const ui = picker();
    try {
      await ui.key(key);
      expect(ui.result()).toBeNull();
    } finally { ui.cleanup(); }
  });
}

test("explicit --compile labels source builds and does not ask twice", async () => {
  const ui = picker(true);
  try {
    expect(ui.frame()).not.toContain("prebuilt");
    await ui.key("\r");
    expect(ui.result()).toEqual({ version: "0.155.1", compile: true });
  } finally { ui.cleanup(); }
});
