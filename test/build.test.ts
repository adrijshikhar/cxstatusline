import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BuildError, buildPatched } from "../src/patch/build";
import { fakeExec, tmpEnv } from "./helpers";

const plan = (root: string) => ({ tag: "rust-v0.152.1", sourceDir: join(root, "src"), patchFile: "/p/codex-0.152.1.patch" });
const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { type?: string; version?: string; devDependencies?: Record<string, string> };

test("release bundle contains the TUI and attribution", () => {
  expect(pkg.type).toBe("module");
  expect(pkg.version).toBe("0.1.0");
  expect(pkg.devDependencies?.ink).toBe("6.2.0");
  expect(pkg.devDependencies?.["react-devtools-core"]).toBe("^4.19.1");
  expect(readFileSync("THIRD_PARTY_NOTICES.md", "utf8")).toContain("6a3d855b82faf75b249155dcfa1624780f89cbbd");
  expect(readFileSync("THIRD_PARTY_NOTICES.md", "utf8")).toContain("Matthew Breedlove");
});

/** cargo is faked, so the test must create the artifact `buildPatched` verifies. */
function cargoProduces(root: string) {
  return fakeExec((cmd) => {
    if (cmd !== "cargo") return {};
    const bin = join(root, "src", "codex-rs", "target", "release", "codex");
    mkdirSync(join(bin, ".."), { recursive: true });
    writeFileSync(bin, "ELF");
    return { stderr: "   Compiling codex-tui\n" };
  });
}

describe("buildPatched", () => {
  test("fresh checkout: clone, checkout, apply --check, apply, cargo build; returns binary path", () => {
    const { root } = tmpEnv();
    const { run, calls } = cargoProduces(root);
    const bin = buildPatched(plan(root), run, () => {});
    expect(bin).toBe(join(root, "src", "codex-rs", "target", "release", "codex"));
    expect(calls.map((c) => [c.cmd, ...c.args].join(" "))).toEqual([
      `git clone --filter=blob:none https://github.com/openai/codex ${join(root, "src")}`,
      `git -C ${join(root, "src")} checkout --detach rust-v0.152.1`,
      `git -C ${join(root, "src")} apply --index --check /p/codex-0.152.1.patch`,
      `git -C ${join(root, "src")} apply --index /p/codex-0.152.1.patch`,
      `cargo build --release -p codex-cli --bin codex`,
    ]);
  });
  test("existing checkout: fetch + reset instead of clone", () => {
    const { root } = tmpEnv();
    mkdirSync(join(root, "src", ".git"), { recursive: true });
    const { run, calls } = cargoProduces(root);
    buildPatched(plan(root), run, () => {});
    expect(calls[0]?.args.slice(0, 3)).toEqual(["-C", join(root, "src"), "fetch"]);
    expect(calls[1]?.args.slice(2)).toEqual(["reset", "--hard"]);
    expect(calls[2]?.args.slice(2)).toEqual(["checkout", "--detach", "rust-v0.152.1"]);
  });
  test("apply --check failure stops before building and names the step", () => {
    const { root } = tmpEnv();
    const { run, calls } = fakeExec((_cmd, args) => (args.includes("--check") ? { status: 1, stderr: "error: patch failed" } : {}));
    expect(() => buildPatched(plan(root), run, () => {})).toThrow(BuildError);
    try {
      buildPatched(plan(root), run, () => {});
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
    buildPatched(plan(root), run, (l) => lines.push(l));
    expect(lines.some((l) => l.includes("Compiling codex-tui"))).toBe(true);
    expect(calls.at(-1)?.opts?.cwd).toBe(join(root, "src", "codex-rs"));
  });
  test("cargo exiting 0 without producing the binary is a BuildError, not an ENOENT later", () => {
    const { root } = tmpEnv();
    const { run } = fakeExec(() => ({}));
    expect(() => buildPatched(plan(root), run, () => {})).toThrow(/cargo exited 0 but .* is missing or empty/);
  });
});
