import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bundledLicenses } from "../scripts/licenses";

test("bundled license inventory preserves texts and fails on a missing license", () => {
  const root = mkdtempSync(join(tmpdir(), "cx-licenses-"));
  const directory = join(root, "node_modules/example");
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "package.json"), JSON.stringify({ name: "example", version: "1.0.0" }));
  try {
    expect(() => bundledLicenses(["node_modules/example/index.js"], root)).toThrow();
    writeFileSync(join(directory, "LICENSE"), "Copyright Example\nPermission granted\n");
    writeFileSync(join(directory, "NOTICE"), "Original attribution\n");
    const text = bundledLicenses(["node_modules/example/index.js", "node_modules/example/other.js"], root);
    expect(text).toContain("example@1.0.0");
    expect(text).toContain("Copyright Example\nPermission granted");
    expect(text).toContain("Original attribution");
    expect(text.match(/Copyright Example/g)?.length).toBe(1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
