import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { loadManifest } from "../src/patch/manifest";
import pkg from "../package.json";

const root = resolve(import.meta.dir, "..");
export function assertPackageFiles(files: string[]): void {
  const required = ["package.json", "README.md", "LICENSE", "NOTICE", "THIRD_PARTY_NOTICES.md",
    "dist/cxstatusline.js", "dist/THIRD_PARTY_LICENSES.txt", "patches/manifest.json", "patches/ink@6.2.0.patch",
    ...loadManifest(join(root, "patches")).patches.map(patch => `patches/${patch.file}`)];
  for (const file of required) if (!files.includes(file)) throw new Error(`package missing ${file}`);
  for (const file of files) if (!required.includes(file)) throw new Error(`unexpected packaged file: ${file}`);
}

if (import.meta.main) {
  const temporary = mkdtempSync(join(tmpdir(), "cx-package-"));
  function run(command: string, args: string[], input?: string, expected = 0): string {
    const result = spawnSync(command, args, { cwd: temporary, input, encoding: "utf8", timeout: 120_000,
      env: { ...process.env, HOME: temporary, XDG_CONFIG_HOME: join(temporary, "config"), XDG_STATE_HOME: join(temporary, "state") } });
    if (result.error || result.status !== expected) throw new Error(`${command} failed: ${result.error ?? result.stderr}`);
    return result.stdout;
  }
  try {
    const [packed] = JSON.parse(run("npm", ["pack", root, "--ignore-scripts", "--json", "--pack-destination", temporary])) as
      Array<{ filename: string; files: Array<{ path: string }> }>;
    if (!packed) throw new Error("npm produced no package");
    assertPackageFiles(packed.files.map(file => file.path));
    const prefix = join(temporary, "installed");
    run("npm", ["install", "--prefix", prefix, "--ignore-scripts", "--no-package-lock", "--no-audit", "--no-fund", join(temporary, packed.filename)]);
    const cli = join(prefix, "node_modules/cxstatusline/dist/cxstatusline.js");
    if (run("node", [cli, "--version"]).trim() !== `cxstatusline ${pkg.version}`) throw new Error("packed version mismatch");
    const output = run("node", [cli, "render"], '{"payload_version":1}');
    if (!output.trim() || output.trimEnd().split("\n").length > 3) throw new Error("invalid packed renderer output");
    run("node", [cli], "", 2);
    console.log(`Package smoke passed on ${run("node", ["--version"]).trim()}: version, renderer, non-TTY, license files`);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}
