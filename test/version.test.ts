import { describe, expect, test } from "bun:test";
import { behindWithinMinor, compareSemver, needsRepatch, parseCodexVersionOutput, parseSemver } from "../src/version";

const v = (s: string) => {
  const p = parseSemver(s);
  if (!p) throw new Error(`bad test version ${s}`);
  return p;
};

describe("parse", () => {
  test("parses release and prerelease", () => {
    expect(parseSemver("0.152.1")).toEqual({ major: 0, minor: 152, patch: 1, pre: null, raw: "0.152.1" });
    expect(parseSemver("0.152.0-alpha.7.2")?.pre).toBe("alpha.7.2");
    expect(parseSemver("rust-v0.152.1")).toBeNull();
    expect(parseSemver("")).toBeNull();
  });
  test("parses `codex --version` output", () => {
    expect(parseCodexVersionOutput("codex-cli 0.152.1\n")?.raw).toBe("0.152.1");
    expect(parseCodexVersionOutput("garbage")).toBeNull();
  });
});

describe("compareSemver", () => {
  test("orders numerically and puts prerelease below release", () => {
    expect(compareSemver(v("0.152.1"), v("0.153.0"))).toBe(-1);
    expect(compareSemver(v("0.153.0"), v("0.152.9"))).toBe(1);
    expect(compareSemver(v("0.152.1"), v("0.152.1"))).toBe(0);
    expect(compareSemver(v("0.153.0-alpha.1"), v("0.153.0"))).toBe(-1);
  });
});

describe("needsRepatch", () => {
  test("never patched -> yes, unless manual", () => {
    expect(needsRepatch(v("0.152.1"), null, "stable-minors")).toBe(true);
    expect(needsRepatch(v("0.152.1"), null, "manual")).toBe(false);
  });
  test("stable-minors: minor bump yes, patch bump no, prerelease never", () => {
    expect(needsRepatch(v("0.153.0"), v("0.152.1"), "stable-minors")).toBe(true);
    expect(needsRepatch(v("0.152.2"), v("0.152.1"), "stable-minors")).toBe(false);
    expect(needsRepatch(v("0.153.0-alpha.3"), v("0.152.1"), "stable-minors")).toBe(false);
    expect(needsRepatch(v("1.0.0"), v("0.152.1"), "stable-minors")).toBe(true);
  });
  test("every: any upgrade, including prerelease", () => {
    expect(needsRepatch(v("0.152.2"), v("0.152.1"), "every")).toBe(true);
    expect(needsRepatch(v("0.153.0-alpha.3"), v("0.152.1"), "every")).toBe(true);
    expect(needsRepatch(v("0.152.1"), v("0.152.1"), "every")).toBe(false);
  });
  test("an older upstream never downgrades a directly installed pair", () => {
    expect(needsRepatch(v("0.151.0"), v("0.152.1"), "stable-minors")).toBe(false);
    expect(needsRepatch(v("0.151.0"), v("0.152.1"), "every")).toBe(false);
  });
});

describe("behindWithinMinor", () => {
  test("true only for a newer patch release in the same minor", () => {
    expect(behindWithinMinor(v("0.152.3"), v("0.152.1"))).toBe(true);
    expect(behindWithinMinor(v("0.153.0"), v("0.152.1"))).toBe(false);
    expect(behindWithinMinor(v("0.152.1"), v("0.152.1"))).toBe(false);
  });
});
