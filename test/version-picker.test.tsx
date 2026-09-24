import { expect, test } from "bun:test";
import { PassThrough } from "node:stream";
import { render } from "ink";
import { UpdatePicker } from "../src/ui/UpdatePicker";
import type { UpdateAction } from "../src/ui/UpdatePicker";
import { VersionPicker } from "../src/ui/VersionPicker";
import type { PromptVersionSelection } from "../src/ui/prompt-version";

function picker(compile = false, update?: { latest: string; highestAvailable?: string }) {
  const stdin = new PassThrough() as PassThrough & { isTTY: boolean; setRawMode: () => void; ref: () => void; unref: () => void };
  Object.assign(stdin, { isTTY: true, setRawMode() {}, ref() {}, unref() {} });
  const stdout = Object.assign(new PassThrough(), { columns: 80, rows: 24 });
  let frame = "";
  let result: PromptVersionSelection | UpdateAction | null | undefined;
  stdout.on("data", (chunk) => { frame = chunk.toString(); });
  const instance = render(update ? <UpdatePicker {...update} onSelect={(selection) => { result = selection; }} /> : <VersionPicker
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
    async resize(columns: number, rows: number) {
      Object.assign(stdout, { columns, rows });
      stdout.emit("resize");
      await new Promise((resolve) => setTimeout(resolve, 50));
    },
    cleanup() { instance.unmount(); instance.cleanup(); },
  };
}

function frameRows(frame: string): number {
  return frame.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "").trim().split("\n").length;
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

for (const highestAvailable of ["0.155.1", undefined]) {
  test(`update picker defaults safely with prebuilt ${highestAvailable ?? "unavailable"}`, async () => {
    const ui = picker(false, { latest: "0.156.1", highestAvailable });
    try {
      expect(ui.frame()).toContain("How would you like to proceed?");
      await ui.key("\r");
      expect(ui.result()).toBe(highestAvailable ? "prebuilt" : "cancel");
    } finally { ui.cleanup(); }
  });
}
for (const key of ["\x1b", "\x03"]) {
  test("update picker cancels via keyboard", async () => {
    const ui = picker(false, { latest: "0.156.1", highestAvailable: "0.155.1" });
    try {
      await ui.key(key);
      expect(ui.result()).toBe("cancel");
    } finally { ui.cleanup(); }
  });
}
test("update picker navigates to source and cancel choices", async () => {
  const ui = picker(false, { latest: "0.156.1", highestAvailable: "0.155.1" });
  try {
    await ui.key("\x1b[B");
    expect(ui.frame()).toContain("20 GiB");
    await ui.key("\r");
    expect(ui.result()).toBe("compile");
    await ui.key("\x1b[B");
    await ui.key("\r");
    expect(ui.result()).toBe("cancel");
  } finally { ui.cleanup(); }
});

test("install picker requires a usable size after resize and permits only cancellation while small", async () => {
  const ui = picker();
  try {
    await ui.resize(20, 12);
    expect(ui.frame()).toContain("Resize terminal to");
    await ui.key("\r");
    expect(ui.result()).toBeUndefined();
    await ui.key("\x1b");
    expect(ui.result()).toBeNull();
  } finally { ui.cleanup(); }
});

test("update picker requires a usable size after resize and permits only cancellation while small", async () => {
  const ui = picker(false, { latest: "0.156.1", highestAvailable: "0.155.1" });
  try {
    await ui.resize(30, 12);
    expect(ui.frame()).toContain("Resize terminal to");
    await ui.key("\r");
    expect(ui.result()).toBeUndefined();
    await ui.resize(40, 20);
    expect(ui.frame()).toContain("Install prebuilt Codex 0.155.1");
    expect(ui.frame()).toContain("▶  Install prebuilt Codex 0.155.1");
    expect(frameRows(ui.frame())).toBeLessThanOrEqual(20);
    await ui.key("\x1b");
    expect(ui.result()).toBe("cancel");
  } finally { ui.cleanup(); }
});

test("source confirmation cannot start a build while terminal is too small", async () => {
  const ui = picker();
  try {
    await ui.key("\x1b[A");
    await ui.key("\r");
    expect(ui.frame()).toContain("Build Codex 0.156.1 from source?");
    await ui.resize(30, 12);
    await ui.key("\r");
    expect(ui.result()).toBeUndefined();
    expect(ui.frame()).toContain("Resize terminal to");
    await ui.resize(40, 20);
    expect(ui.frame()).toContain("Build Codex 0.156.1 from source?");
    expect(frameRows(ui.frame())).toBeLessThanOrEqual(20);
    await ui.key("\r");
    expect(ui.result()).toBeUndefined(); // Back remains the default.
    expect(ui.frame()).toContain("Select Codex version");
  } finally { ui.cleanup(); }
});

test("update without a prebuilt remains cancellation-default after a small resize", async () => {
  const ui = picker(false, { latest: "0.156.1" });
  try {
    await ui.resize(30, 12);
    await ui.key("\r");
    expect(ui.result()).toBeUndefined();
    await ui.resize(40, 20);
    expect(ui.frame()).toContain("Cancel");
    expect(ui.frame()).toContain("▶  Cancel");
    expect(frameRows(ui.frame())).toBeLessThanOrEqual(20);
    await ui.key("\r");
    expect(ui.result()).toBe("cancel");
  } finally { ui.cleanup(); }
});
