import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { test, expect } from "bun:test";

const assets = join(import.meta.dir, "../dist/assets");

function gzipBytes(extension: string): number {
  return readdirSync(assets)
    .filter((file) => file.endsWith(extension))
    .reduce((total, file) => total + gzipSync(readFileSync(join(assets, file)), { level: 9, mtime: 0 }).byteLength, 0);
}

test("emitted JavaScript and CSS stay within documented gzip budgets", () => {
  expect(gzipBytes(".js")).toBe(283518);
  expect(gzipBytes(".css")).toBe(2497);
  expect(gzipBytes(".js")).toBeLessThanOrEqual(284000);
  expect(gzipBytes(".css")).toBeLessThanOrEqual(2600);
});
