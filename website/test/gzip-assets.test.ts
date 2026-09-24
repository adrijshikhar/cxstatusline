import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { test, expect } from "bun:test";

const assets = join(import.meta.dir, "../dist/_astro");

function gzipBytes(extension: string): number {
  return readdirSync(assets)
    .filter((file) => file.endsWith(extension))
    .reduce((total, file) => total + gzipSync(readFileSync(join(assets, file)), { level: 9 }).byteLength, 0);
}

test("emitted JavaScript and CSS stay within documented gzip budgets", () => {
  expect(gzipBytes(".js")).toBeLessThanOrEqual(385000);
  expect(gzipBytes(".css")).toBeLessThanOrEqual(8500);
});
