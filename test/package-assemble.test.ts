import { describe, expect, test } from "bun:test";
import { assembleArgs, assembleEnv, assemblePackage, findPython, rustcHostTarget, type AssembleInput } from "../src/patch/package-assemble";
import { fakeExec } from "./helpers";

const input: AssembleInput = {
  upstream: "/src/codex",
  target: "aarch64-apple-darwin",
  codexVersion: "0.157.0",
  codex: "/src/codex/codex-rs/target/release/codex",
  codeModeHost: "/src/codex/codex-rs/target/release/codex-code-mode-host",
  packageDir: "/tmp/pkg",
  python: "/opt/homebrew/bin/python3",
  cargo: "/Users/me/.cargo/bin/cargo",
  tmpDir: "/tmp/cache",
  force: false,
};

describe("assemblePackage", () => {
  test("spells out upstream's packager command exactly once, with our two binaries substituted", () => {
    expect(assembleArgs(input)).toEqual([
      "/src/codex/scripts/build_codex_package.py",
      "--variant", "codex",
      "--target", "aarch64-apple-darwin",
      "--package-version", "0.157.0",
      "--entrypoint-bin", "/src/codex/codex-rs/target/release/codex",
      "--code-mode-host-bin", "/src/codex/codex-rs/target/release/codex-code-mode-host",
      "--cargo", "/Users/me/.cargo/bin/cargo",
      "--cargo-profile", "release",
      "--package-dir", "/tmp/pkg",
    ]);
    expect(assembleArgs({ ...input, bwrapBin: "/usr/bin/bwrap", force: true }).slice(-3)).toEqual(["--bwrap-bin", "/usr/bin/bwrap", "--force"]);
  });

  test("runs with a scrubbed environment: CODEX_REPO_ROOT and TMPDIR set, CARGO_TARGET_DIR and PYTHONPATH dropped", () => {
    const env = assembleEnv(input, { PATH: "/usr/bin", HOME: "/Users/me", CARGO_TARGET_DIR: "/elsewhere", PYTHONPATH: "/evil", HTTPS_PROXY: "http://proxy:3128", SCCACHE_DIR: "/cache" });
    expect(env).toEqual({ PATH: "/usr/bin", HOME: "/Users/me", HTTPS_PROXY: "http://proxy:3128", SCCACHE_DIR: "/cache", CODEX_REPO_ROOT: "/src/codex", TMPDIR: "/tmp/cache" });
  });

  test("invokes the interpreter in the upstream checkout and surfaces the script's stderr on failure", () => {
    const ok = fakeExec(() => ({}));
    const logged: string[] = [];
    assemblePackage(input, ok.run, (l) => logged.push(l));
    expect(ok.calls[0]!.cmd).toBe("/opt/homebrew/bin/python3");
    expect(ok.calls[0]!.args[0]).toBe("/src/codex/scripts/build_codex_package.py");
    expect(ok.calls[0]!.opts?.cwd).toBe("/src/codex");
    expect(ok.calls[0]!.opts?.env?.CODEX_REPO_ROOT).toBe("/src/codex");
    expect(logged[0]).toContain("build_codex_package.py");

    const bad = fakeExec(() => ({ status: 1, stderr: "RuntimeError: ripgrep is required for all package targets\n" }));
    expect(() => assemblePackage(input, bad.run, () => {})).toThrow(/build_codex_package.py failed \(exit 1\): RuntimeError: ripgrep is required/);
  });
});

describe("findPython / rustcHostTarget", () => {
  test("picks the first interpreter on PATH that is Python >= 3.10", () => {
    const which = (cmd: string): string | null => (cmd === "python3.12" || cmd === "python3" ? `/usr/bin/${cmd}` : null);
    const { run, calls } = fakeExec((cmd) => (cmd === "/usr/bin/python3.12" ? {} : { status: 1 }));
    expect(findPython(which, run)).toBe("/usr/bin/python3.12");
    expect(calls).toHaveLength(1);
  });

  test("returns null when every candidate is missing or too old (macOS CLT ships 3.9)", () => {
    const which = (cmd: string): string | null => (cmd === "python3" ? "/usr/bin/python3" : null);
    const old = fakeExec(() => ({ status: 1 })).run;
    expect(findPython(which, old)).toBeNull();
    expect(findPython(() => null, old)).toBeNull();
  });

  test("reads the host triple from rustc -vV and refuses anything else", () => {
    const { run } = fakeExec(() => ({ stdout: "rustc 1.95.0 (abc 2026-01-01)\nbinary: rustc\nhost: x86_64-unknown-linux-musl\nrelease: 1.95.0\n" }));
    expect(rustcHostTarget(run)).toBe("x86_64-unknown-linux-musl");
    expect(() => rustcHostTarget(fakeExec(() => ({ stdout: "nope" })).run)).toThrow(/did not report a host target/);
  });
});
