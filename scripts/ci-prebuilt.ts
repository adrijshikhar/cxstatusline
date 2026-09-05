/** Private CI smoke only. This is not the release manifest or end-user installer. */
import { createHash } from "node:crypto";
import { appendFileSync, createReadStream, lstatSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { loadManifest, resolvePatch } from "../src/patch/manifest";
import { parseSemver } from "../src/version";

const root = resolve(import.meta.dir, "..");

export function resolveCiBuild(version: string): { tag: string; file: string } {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) throw new Error("expected exact stable Codex version");
  const parsed = parseSemver(version)!;
  const patch = resolvePatch(loadManifest(join(root, "patches")), parsed);
  if (!patch || !/^codex-[\d.]+\.patch$/.test(patch.file) || patch.tag !== `rust-v${version}`) {
    throw new Error(`no supported CI patch for Codex ${version}`);
  }
  return patch;
}

export function validateVersion(output: string, version: string): void {
  if (output.trim() !== `codex-cli ${version}`) throw new Error("staged Codex version does not match requested version");
}

export function validateLinkage(output: string): void {
  const libraries = output.trimEnd().split("\n").slice(1).map(line => line.trim().split(" (")[0]!);
  if (!libraries.length || libraries.some(path => !path.startsWith("/usr/lib/") && !path.startsWith("/System/Library/"))) {
    throw new Error("binary has missing or non-system linkage; inspect CI linkage output");
  }
}

function probe(command: string, args: string[]): string {
  return execFileSync(command, args, { encoding: "utf8", timeout: 30_000, maxBuffer: 1024 * 1024 });
}

async function verify(directory: string, version: string, arch: string): Promise<void> {
  resolveCiBuild(version);
  if (process.platform !== "darwin" || !["arm64", "x64"].includes(arch) || process.arch !== arch) {
    throw new Error("smoke must run natively on the requested Mac architecture");
  }
  const files: Record<string, { sha256: string; size: number; linkage: string; buildInfo: string }> = {};
  for (const name of ["codex", "codex-code-mode-host"]) {
    const file = resolve(directory, name);
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.size === 0 || (stat.mode & 0o111) === 0) throw new Error(`${name} is not a nonempty executable file`);
    const actualArch = probe("lipo", ["-archs", file]).trim();
    if (actualArch !== (arch === "x64" ? "x86_64" : "arm64")) throw new Error(`${name}: architecture mismatch`);
    const linkage = probe("otool", ["-L", file]);
    validateLinkage(linkage);
    const buildInfo = probe("vtool", ["-show-build", file]);
    if (name === "codex") validateVersion(probe(file, ["--version"]), version);
    else if (!probe(file, ["--help"]).includes("--listen")) throw new Error("companion help smoke failed");
    const digest = createHash("sha256");
    for await (const chunk of createReadStream(file)) digest.update(chunk);
    files[name] = { sha256: digest.digest("hex"), size: stat.size, linkage, buildInfo };
  }
  writeFileSync(join(directory, "smoke.json"), JSON.stringify({
    purpose: "private-ci-smoke-not-installer-release", version, arch,
    cxCommit: probe("git", ["-C", root, "rev-parse", "HEAD"]).trim(),
    upstreamCommit: probe("git", ["-C", join(root, "upstream"), "rev-parse", "HEAD"]).trim(),
    os: probe("sw_vers", ["-productVersion"]).trim(), files,
    limitations: ["Host --help only; protocol acceptance pending", "Clean macOS 14 acceptance pending", "Release dependency-license audit pending"],
  }, null, 2) + "\n");
}

if (import.meta.main) {
  const [mode, version = "", directory = "", arch = ""] = process.argv.slice(2);
  if (mode === "resolve") {
    const patch = resolveCiBuild(version);
    const output = `tag=${patch.tag}\npatch=${patch.file}\n`;
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, output);
    else process.stdout.write(output);
  } else if (mode === "verify" && directory) {
    await verify(directory, version, arch);
  } else throw new Error("usage: ci-prebuilt.ts resolve VERSION | verify VERSION DIRECTORY ARCH");
}
