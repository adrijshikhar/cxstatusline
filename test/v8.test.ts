import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defaultV8Target, resolveV8Env } from "../src/patch/v8";
import { fakeExec, tmpEnv } from "./helpers";

describe("v8 resolver", () => {
  test("defaultV8Target resolves a valid target triple for current platform and arch", () => {
    const target = defaultV8Target();
    expect(["aarch64-apple-darwin", "x86_64-apple-darwin", "aarch64-unknown-linux-gnu", "x86_64-unknown-linux-gnu", "aarch64-pc-windows-msvc", "x86_64-pc-windows-msvc"]).toContain(target);
  });

  test("resolveV8Env returns empty if scripts/codex_package/v8.py does not exist", () => {
    const { root } = tmpEnv();
    const { run, calls } = fakeExec(() => ({}));
    const env = resolveV8Env(root, run, () => {});
    expect(env).toEqual({});
    expect(calls.length).toBe(0);
  });

  test("resolveV8Env uses process.env overrides when already provided", () => {
    const { root } = tmpEnv();
    const origArchive = process.env.RUSTY_V8_ARCHIVE;
    const origBinding = process.env.RUSTY_V8_SRC_BINDING_PATH;
    try {
      process.env.RUSTY_V8_ARCHIVE = "/custom/archive.a.gz";
      process.env.RUSTY_V8_SRC_BINDING_PATH = "/custom/binding.rs";
      const { run, calls } = fakeExec(() => ({}));
      const env = resolveV8Env(root, run, () => {});
      expect(env).toEqual({
        RUSTY_V8_ARCHIVE: "/custom/archive.a.gz",
        RUSTY_V8_SRC_BINDING_PATH: "/custom/binding.rs",
      });
      expect(calls.length).toBe(0);
    } finally {
      if (origArchive === undefined) delete process.env.RUSTY_V8_ARCHIVE;
      else process.env.RUSTY_V8_ARCHIVE = origArchive;
      if (origBinding === undefined) delete process.env.RUSTY_V8_SRC_BINDING_PATH;
      else process.env.RUSTY_V8_SRC_BINDING_PATH = origBinding;
    }
  });

  test("resolveV8Env invokes python3 when v8.py exists and returns parsed env", () => {
    const { root } = tmpEnv();
    const v8Dir = join(root, "scripts", "codex_package");
    mkdirSync(v8Dir, { recursive: true });
    writeFileSync(join(v8Dir, "v8.py"), "# mock");

    const expected = {
      RUSTY_V8_ARCHIVE: "/tmp/librusty_v8.a.gz",
      RUSTY_V8_SRC_BINDING_PATH: "/tmp/src_binding.rs",
    };

    const { run, calls } = fakeExec((cmd) => {
      if (cmd === "python3") {
        return { status: 0, stdout: JSON.stringify(expected) };
      }
      return { status: 1 };
    });

    const logs: string[] = [];
    const env = resolveV8Env(root, run, (l) => logs.push(l));
    expect(env).toEqual(expected);
    expect(calls.length).toBe(1);
    expect(calls[0]?.cmd).toBe("python3");
    expect(calls[0]?.opts?.cwd).toBe(root);
    expect(logs.some((l) => l.includes("using Codex V8 archive"))).toBe(true);
  });

  test("resolveV8Env logs warning and returns empty when python fails", () => {
    const { root } = tmpEnv();
    const v8Dir = join(root, "scripts", "codex_package");
    mkdirSync(v8Dir, { recursive: true });
    writeFileSync(join(v8Dir, "v8.py"), "# mock");

    const { run, calls } = fakeExec(() => ({ status: 1, stderr: "module not found" }));

    const logs: string[] = [];
    const env = resolveV8Env(root, run, (l) => logs.push(l));
    expect(env).toEqual({});
    expect(calls.length).toBe(2); // tries python3 then python
    expect(logs.some((l) => l.includes("warning: could not resolve Codex V8 dependencies"))).toBe(true);
  });
});
