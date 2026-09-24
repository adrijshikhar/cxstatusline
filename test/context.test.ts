import { expect, test } from "bun:test";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { realContext } from "../src/context";
import { loadManifest } from "../src/patch/manifest";
import { resolvePaths } from "../src/paths";
import { tmpEnv } from "./helpers";

test("a renderer link to another installation cannot redirect the running build's patches", () => {
  const { env, root } = tmpEnv();
  const paths = resolvePaths(env);
  const other = join(root, "other", "dist", "cxstatusline.js");
  mkdirSync(join(other, ".."), { recursive: true });
  writeFileSync(other, "other installation");
  mkdirSync(paths.binDir, { recursive: true });
  symlinkSync(other, paths.rendererLink);
  const ctx = realContext(env, { say() {}, log() {} });
  expect(ctx.cxBin).toBe(paths.rendererLink);
  expect(ctx.patchesDir).toBe(fileURLToPath(new URL("../patches", import.meta.url)));
  expect(loadManifest(ctx.patchesDir).patches.length).toBeGreaterThan(0);
});
