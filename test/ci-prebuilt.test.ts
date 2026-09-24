import { expect, test } from "bun:test";
import { resolveCiBuild, validateLinkage, validateVersion } from "../scripts/ci-prebuilt";

test("CI selects only a supported exact stable patch", () => {
  expect(resolveCiBuild("0.153.0")).toEqual({ tag: "rust-v0.153.0", file: "codex-0.153.0.patch", patchVersion: 1 });
  for (const version of ["0.157.0", "0.153.0-beta.1", "0.153.0\nfile=evil", "../main", " 0.153.0"]) {
    expect(() => resolveCiBuild(version)).toThrow();
  }
});

test("smoke rejects wrong or misleading executable versions", () => {
  expect(() => validateVersion("codex-cli 0.153.0\n", "0.153.0")).not.toThrow();
  for (const output of ["codex-cli 0.152.1", "error: expected 0.153.0", "codex-cli 0.153.0-beta.1"]) {
    expect(() => validateVersion(output, "0.153.0")).toThrow();
  }
});

test("smoke refuses binaries linked to runner-specific libraries", () => {
  const header = "/tmp/artifacts/codex:\n";
  expect(() => validateLinkage(header + "\t/usr/lib/libSystem.B.dylib (compatibility version 1.0.0)\n\t/System/Library/Frameworks/Security.framework/Versions/A/Security (compatibility version 1.0.0)\n")).not.toThrow();
  for (const library of ["/opt/homebrew/lib/libssl.dylib", "/usr/local/lib/libssl.dylib", "@rpath/libssl.dylib"]) {
    expect(() => validateLinkage(header + `\t${library} (compatibility version 1.0.0)\n`)).toThrow();
  }
  expect(() => validateLinkage(header)).toThrow();
});
