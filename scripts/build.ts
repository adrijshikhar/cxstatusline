import { readFileSync, chmodSync, writeFileSync } from "node:fs";
import { bundledLicenses } from "./licenses";

const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };
const result = await Bun.build({
  entrypoints: ["src/cli.ts"],
  outdir: "dist",
  naming: "cxstatusline.js",
  target: "node",
  format: "esm",
  banner: "#!/usr/bin/env node",
  define: { CXSTATUSLINE_VERSION: JSON.stringify(pkg.version) },
  minify: false,
  metafile: true,
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
chmodSync("dist/cxstatusline.js", 0o755);
if (!result.metafile) throw new Error("bundle metadata missing; cannot collect dependency licenses");
writeFileSync("dist/THIRD_PARTY_LICENSES.txt", bundledLicenses(Object.keys(result.metafile.inputs), process.cwd()));
console.log(`built dist/cxstatusline.js (${pkg.version})`);
