import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { MIN_FREE_BYTES, MIN_STAGING_FREE_BYTES, REQUIRED_TOOLCHAIN, prebuiltPreflight, preflight, realDeps, type PreflightDeps } from "../src/patch/preflight";
import { fakeExec, tmpEnv } from "./helpers";

/** A machine where everything is present and the toolchain is correct. */
const healthyRun = fakeExec((cmd, args) => {
  if (cmd === "rustup" && args[0] === "toolchain") return { stdout: `stable-aarch64-apple-darwin\n${REQUIRED_TOOLCHAIN}-aarch64-apple-darwin (override)\n` };
  if (cmd === "rustup" && args[0] === "component") return { stdout: "cargo\nclippy\nrust-src\nrust-std\nrustc\nrustfmt\n" };
  return {};
}).run;

const deps = (over: Partial<PreflightDeps> = {}): PreflightDeps => ({
  which: (c: string) => `/usr/bin/${c}`,
  run: healthyRun,
  freeBytes: () => MIN_FREE_BYTES * 2,
  ...over,
});

describe("preflight", () => {
  test("all good", () => {
    expect(preflight(deps(), "/share")).toEqual({ ok: true });
  });
  test("missing git", () => {
    const r = preflight(deps({ which: (c) => (c === "git" ? null : "/x") }), "/share");
    expect(r).toMatchObject({ ok: false, reason: expect.stringMatching(/git/), fix: expect.stringMatching(/install/i) });
  });
  test("missing rustup names the exact install command", () => {
    const r = preflight(deps({ which: (c) => (c === "rustup" ? null : "/x") }), "/share");
    expect(r).toMatchObject({ ok: false, fix: expect.stringContaining("https://sh.rustup.rs") });
  });
  test("missing cargo", () => {
    const r = preflight(deps({ which: (c) => (c === "cargo" ? null : "/x") }), "/share");
    expect(r).toMatchObject({ ok: false, reason: expect.stringMatching(/cargo/) });
  });
  test("the required toolchain is not installed", () => {
    const run = fakeExec((cmd, args) => (cmd === "rustup" && args[0] === "toolchain" ? { stdout: "stable-aarch64-apple-darwin\n" } : {})).run;
    const r = preflight(deps({ run }), "/share");
    expect(r).toMatchObject({
      ok: false,
      reason: expect.stringContaining(REQUIRED_TOOLCHAIN),
      fix: expect.stringContaining(`rustup toolchain install ${REQUIRED_TOOLCHAIN}`),
    });
  });
  test("the toolchain is installed but a component is missing", () => {
    const run = fakeExec((cmd, args) => {
      if (cmd === "rustup" && args[0] === "toolchain") return { stdout: `${REQUIRED_TOOLCHAIN}-aarch64-apple-darwin\n` };
      if (cmd === "rustup" && args[0] === "component") return { stdout: "cargo\nrustc\nrustfmt\n" };
      return {};
    }).run;
    const r = preflight(deps({ run }), "/share");
    expect(r).toMatchObject({ ok: false, reason: expect.stringMatching(/clippy/), fix: expect.stringContaining("rustup component add") });
  });
  test("`rustup toolchain list` failing is itself a refusal", () => {
    const run = fakeExec(() => ({ status: 1, stderr: "boom" })).run;
    expect(preflight(deps({ run }), "/share")).toMatchObject({ ok: false, reason: expect.stringMatching(/rustup toolchain list.*failed/) });
  });
  test("insufficient disk reports GiB numbers", () => {
    const r = preflight(deps({ freeBytes: () => 3 * 1024 ** 3 }), "/share");
    expect(r).toMatchObject({ ok: false, reason: expect.stringMatching(/3\.0 GiB free.*20 GiB/) });
  });
  test("realDeps().freeBytes reports a positive number without creating the directory", async () => {
    const { existsSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpEnv } = await import("./helpers");
    const { root } = tmpEnv();
    const missing = join(root, "not", "created", "yet");
    expect(realDeps().freeBytes(missing)).toBeGreaterThan(0);
    expect(existsSync(missing)).toBe(false);
  });
});

describe("prebuiltPreflight", () => {
  const dirs = (root: string) => ({ libexecDir: join(root, ".local", "libexec", "cxstatusline"), binDir: join(root, ".local", "bin") });

  test("a writable home with room to stage passes without asking about Rust", () => {
    const { root } = tmpEnv();
    const asked: string[] = [];
    const r = prebuiltPreflight({ freeBytes: (p) => { asked.push(p); return MIN_STAGING_FREE_BYTES * 2; } }, dirs(root));
    expect(r).toEqual({ ok: true });
    expect(asked).toEqual([dirs(root).libexecDir]);
  });
  test("less than 2 GiB under libexec is refused before any download", () => {
    const { root } = tmpEnv();
    const r = prebuiltPreflight({ freeBytes: () => MIN_STAGING_FREE_BYTES - 1 }, dirs(root));
    expect(r).toMatchObject({ ok: false, reason: expect.stringContaining("2 GiB") });
  });
  test("an unwritable destination is named", () => {
    const { root } = tmpEnv();
    const d = dirs(root);
    mkdirSync(d.binDir, { recursive: true });
    chmodSync(d.binDir, 0o500);
    try {
      const r = prebuiltPreflight({ freeBytes: () => MIN_STAGING_FREE_BYTES * 2 }, d);
      expect(r).toMatchObject({ ok: false, reason: expect.stringContaining(d.binDir) });
    } finally {
      chmodSync(d.binDir, 0o700);
    }
  });
});
