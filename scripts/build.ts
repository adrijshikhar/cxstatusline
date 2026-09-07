import { readFileSync, chmodSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { bundledLicenses } from "./licenses";
import { assertReleaseProvenance, sourceProvenance } from "./provenance";

const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };
const provenance = sourceProvenance((args) => {
  const r = spawnSync("git", [...args], { encoding: "utf8" });
  return { status: r.status, stdout: r.stdout ?? "" };
});
if (process.env.CXSTATUSLINE_RELEASE_BUILD === "1") {
  try {
    assertReleaseProvenance(provenance);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
}
const result = await Bun.build({
  entrypoints: ["src/cli.ts"],
  outdir: "dist",
  naming: "cxstatusline.js",
  target: "node",
  format: "esm",
  banner: "#!/usr/bin/env node",
  define: {
    CXSTATUSLINE_VERSION: JSON.stringify(pkg.version),
    CXSTATUSLINE_SOURCE_COMMIT: JSON.stringify(provenance.commit),
    CXSTATUSLINE_SOURCE_DIRTY: JSON.stringify(provenance.dirty),
  },
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
console.log(`built dist/cxstatusline.js (${pkg.version}, ${provenance.commit ?? "no source commit"}${provenance.dirty ? ", dirty" : ""})`);
