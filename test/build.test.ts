import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BuildError, buildPatched } from "../src/patch/build";
import { VERSION } from "../src/version-info";
import { fakeExec, tmpEnv } from "./helpers";

const plan = (root: string) => ({ tag: "rust-v0.152.1", sourceDir: join(root, "src"), patchFile: "/p/codex-0.152.1.patch" });
const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { type?: string; version?: string; devDependencies?: Record<string, string> };
const HEAD = "e".repeat(40);
const noJust = (): string | null => null;

test("release bundle contains the TUI and attribution", () => {
  expect(pkg.type).toBe("module");
  expect(pkg.version).toBe(VERSION);
  expect(pkg.devDependencies?.ink).toBe("6.2.0");
  expect(pkg.devDependencies?.["react-devtools-core"]).toBe("^4.19.1");
  expect(readFileSync("THIRD_PARTY_NOTICES.md", "utf8")).toContain("6a3d855b82faf75b249155dcfa1624780f89cbbd");
  expect(readFileSync("THIRD_PARTY_NOTICES.md", "utf8")).toContain("Matthew Breedlove");
});

/** cargo is faked, so the test must create the artifacts `buildPatched` verifies. */
function cargoProduces(root: string, over: { testsFail?: boolean } = {}) {
  return fakeExec((cmd, args) => {
    if (cmd === "git" && args.includes("rev-parse")) return { stdout: `${HEAD}\n` };
    if ((cmd === "cargo" && args[0] === "test") || cmd === "just") {
      return over.testsFail ? { status: 101, stderr: "test cxstatusline_block ... FAILED" } : {};
    }
    if (cmd !== "cargo") return {};
    for (const name of ["codex", "codex-code-mode-host"]) {
      const bin = join(root, "src", "codex-rs", "target", "release", name);
      mkdirSync(join(bin, ".."), { recursive: true });
      writeFileSync(bin, `ELF-${name}`);
    }
    return { stderr: "   Compiling codex-tui\n" };
  });
}

const target = (root: string, name: string) => join(root, "src", "codex-rs", "target", "release", name);

describe("buildPatched", () => {
  test("fresh checkout: clone, checkout, apply, build both bins, test, report the commit", () => {
    const { root } = tmpEnv();
    const { run, calls } = cargoProduces(root);
    const built = buildPatched(plan(root), run, () => {}, noJust);
    expect(built).toEqual({
      codex: target(root, "codex"),
      codexCodeModeHost: target(root, "codex-code-mode-host"),
      upstreamCommit: HEAD,
    });
    expect(calls.map((c) => [c.cmd, ...c.args].join(" "))).toEqual([
      `git clone --filter=blob:none https://github.com/openai/codex ${join(root, "src")}`,
      `git -C ${join(root, "src")} checkout --detach rust-v0.152.1`,
      `git -C ${join(root, "src")} rev-parse HEAD`,
      `git -C ${join(root, "src")} apply --index --check /p/codex-0.152.1.patch`,
      `git -C ${join(root, "src")} apply --index /p/codex-0.152.1.patch`,
      "cargo build --release -p codex-cli --bin codex -p codex-code-mode-host --bin codex-code-mode-host",
      "cargo test --release -p codex-tui cxstatusline",
    ]);
  });
  test("existing checkout: fetch + reset instead of clone", () => {
    const { root } = tmpEnv();
    mkdirSync(join(root, "src", ".git"), { recursive: true });
    const { run, calls } = cargoProduces(root);
    buildPatched(plan(root), run, () => {}, noJust);
    expect(calls[0]?.args.slice(0, 3)).toEqual(["-C", join(root, "src"), "fetch"]);
    expect(calls[1]?.args.slice(2)).toEqual(["reset", "--hard"]);
    expect(calls[2]?.args.slice(2)).toEqual(["checkout", "--detach", "rust-v0.152.1"]);
  });
  test("apply --check failure stops before building and names the step", () => {
    const { root } = tmpEnv();
    const { run, calls } = fakeExec((_cmd, args) => (args.includes("--check") ? { status: 1, stderr: "error: patch failed" } : { stdout: `${HEAD}\n` }));
    expect(() => buildPatched(plan(root), run, () => {}, noJust)).toThrow(BuildError);
    try {
      buildPatched(plan(root), run, () => {}, noJust);
      throw new Error("expected BuildError");
    } catch (e) {
      expect((e as BuildError).step).toBe("apply --check");
      expect((e as BuildError).message).toContain("patch failed");
    }
    expect(calls.some((c) => c.cmd === "cargo")).toBe(false);
  });
  test("cargo runs inside codex-rs and logs are forwarded", () => {
    const { root } = tmpEnv();
    const lines: string[] = [];
    const { run, calls } = cargoProduces(root);
    buildPatched(plan(root), run, (l) => lines.push(l), noJust);
    expect(lines.some((l) => l.includes("Compiling codex-tui"))).toBe(true);
    expect(calls.filter((c) => c.cmd === "cargo").every((c) => c.opts?.cwd === join(root, "src", "codex-rs"))).toBe(true);
  });
  test("`just` is preferred for the focused tests, and the log says which runner ran", () => {
    const { root } = tmpEnv();
    const lines: string[] = [];
    const { run, calls } = cargoProduces(root);
    buildPatched(plan(root), run, (l) => lines.push(l), (c) => (c === "just" ? "/usr/bin/just" : null));
    expect(calls.map((c) => [c.cmd, ...c.args].join(" "))).toContain("just test --release -p codex-tui cxstatusline --retries 0");
    expect(calls.some((c) => c.cmd === "cargo" && c.args[0] === "test")).toBe(false);
    expect(lines.join("\n")).toMatch(/focused Rust tests with just/);
  });
  test("a focused test failure propagates and never yields a pair", () => {
    const { root } = tmpEnv();
    const { run } = cargoProduces(root, { testsFail: true });
    expect(() => buildPatched(plan(root), run, () => {}, noJust)).toThrow(/FAILED/);
  });
  test("cargo exiting 0 without producing either binary is a BuildError, not an ENOENT later", () => {
    const { root } = tmpEnv();
    const { run } = fakeExec((cmd, args) => (cmd === "git" && args.includes("rev-parse") ? { stdout: `${HEAD}\n` } : {}));
    expect(() => buildPatched(plan(root), run, () => {}, noJust)).toThrow(/cargo exited 0 but .* is missing or empty/);
  });
  test("a missing Code Mode host is caught by name", () => {
    const { root } = tmpEnv();
    const { run } = fakeExec((cmd, args) => {
      if (cmd === "git" && args.includes("rev-parse")) return { stdout: `${HEAD}\n` };
      if (cmd !== "cargo") return {};
      const bin = target(root, "codex");
      mkdirSync(join(bin, ".."), { recursive: true });
      writeFileSync(bin, "ELF");
      return {};
    });
    expect(() => buildPatched(plan(root), run, () => {}, noJust)).toThrow(/codex-code-mode-host is missing or empty/);
  });
  test("an unusable HEAD is a build failure, not an invented commit", () => {
    const { root } = tmpEnv();
    const { run } = fakeExec((cmd, args) => (cmd === "git" && args.includes("rev-parse") ? { stdout: "HEAD\n" } : {}));
    expect(() => buildPatched(plan(root), run, () => {}, noJust)).toThrow(/did not report a commit/);
  });
});
