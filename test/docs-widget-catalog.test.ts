import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { WIDGET_MANIFEST } from "../src/utils/widget-manifest";

const usage = readFileSync(join(import.meta.dir, "..", "docs", "usage.md"), "utf8");

/**
 * The catalog in docs/usage.md is generated from this manifest. Without this guard a widget added
 * later ships undocumented, which is how the previous catalog drifted out of the README.
 */
test("every widget in the manifest appears in the usage guide", () => {
  const undocumented = WIDGET_MANIFEST
    .map(({ type }) => type)
    .filter((type) => !usage.includes(`\`${type}\``));

  expect(undocumented).toEqual([]);
});

test("the usage guide documents no widget the manifest does not ship", () => {
  const shipped = new Set<string>(WIDGET_MANIFEST.map(({ type }) => type));
  const documented = [...usage.matchAll(/^\| `([a-z][a-z0-9-]+)` \|/gm)].map((m) => m[1]!);

  expect(documented.length).toBeGreaterThan(0);
  expect(documented.filter((type) => !shipped.has(type))).toEqual([]);
});
