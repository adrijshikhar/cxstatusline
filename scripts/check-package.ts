import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
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
  function run(command: string, args: string[], cwd = temporary, input?: string, expected = 0): string {
    const result = spawnSync(command, args, { cwd, input, encoding: "utf8", timeout: 120_000,
      env: { ...process.env, HOME: temporary, XDG_CONFIG_HOME: join(temporary, "config"), XDG_STATE_HOME: join(temporary, "state") } });
    if (result.error || result.status !== expected) throw new Error(`${command} failed: ${result.error ?? result.stderr}`);
    return result.stdout;
  }
  try {
    run("bun", ["pm", "pack", "--destination", temporary], root);
    const tarball = join(temporary, `cxstatusline-${pkg.version}.tgz`);
    const filesOutput = run("tar", ["-tf", tarball]);
    const files = filesOutput.trim().split("\n").map(f => f.replace(/^package\//, ""));
    assertPackageFiles(files);
    const prefix = join(temporary, "installed");
    mkdirSync(prefix, { recursive: true });
    run("bun", ["init", "-y"], prefix);
    run("bun", ["add", tarball], prefix);
    const cli = join(prefix, "node_modules/cxstatusline/dist/cxstatusline.js");
    if (run("bun", [cli, "--version"]).trim() !== `cxstatusline ${pkg.version}`) throw new Error("packed version mismatch");
    const output = run("bun", [cli, "render"], temporary, '{"payload_version":1}');
    if (!output.trim() || output.trimEnd().split("\n").length > 3) throw new Error("invalid packed renderer output");
    run("bun", [cli], temporary, "", 2);
    const nodeTest = spawnSync("node", ["--version"], { encoding: "utf8" });
    if (nodeTest.status === 0) {
      if (run("node", [cli, "--version"], temporary).trim() !== `cxstatusline ${pkg.version}`) throw new Error("node packed version mismatch");
      const nodeOutput = run("node", [cli, "render"], temporary, '{"payload_version":1}');
      if (!nodeOutput.trim() || nodeOutput.trimEnd().split("\n").length > 3) throw new Error("invalid node packed renderer output");
      run("node", [cli], temporary, "", 2);
    }
    console.log(`Package smoke passed on Bun ${Bun.version}${nodeTest.status === 0 ? ` and Node ${nodeTest.stdout?.trim()}` : ""}: version, renderer, non-TTY, license files`);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}
