/**
 * Release verification before publishing npm package and creating v<CX> source release.
 *
 * Verifies that:
 * 1. The git tag matches v<package.json version>
 * 2. The compiled bundle dist/cxstatusline.js contains the embedded source commit SHA
 * 3. The native release for the candidate Codex version exists
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { releaseTag } from "../src/distribution";
import { parseFlags, required } from "./prebuilt/env";

const root = resolve(import.meta.dir, "..");

export interface ReleaseIdentityInput {
  readonly tag: string;
  readonly packageVersion: string;
  readonly headSha: string;
  readonly bundle: string;
  readonly candidate: string;
  readonly nativeReleaseExists: (tag: string) => boolean;
}

export function assertReleaseIdentity(input: ReleaseIdentityInput): void {
  if (input.tag !== `v${input.packageVersion}`) {
    throw new Error(`tag ${input.tag} does not match package version v${input.packageVersion}`);
  }
  if (!input.bundle.includes(input.headSha)) {
    throw new Error(`bundle does not contain embedded source commit ${input.headSha}`);
  }
  const expectedTag = releaseTag(input.candidate);
  if (!input.nativeReleaseExists(expectedTag)) {
    throw new Error(`no native release found for tag ${expectedTag}`);
  }
}

export function checkNativeRelease(tag: string): boolean {
  try {
    execFileSync("gh", ["release", "view", tag], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export function runCheck(flags: Record<string, string>): void {
  const tag = required(flags, "tag");
  const headSha = required(flags, "sha");

  const pkgPath = join(root, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: unknown };
  if (typeof pkg.version !== "string") throw new Error("package.json has no version string");

  const bundlePath = join(root, "dist", "cxstatusline.js");
  if (!existsSync(bundlePath)) throw new Error("dist/cxstatusline.js does not exist; run build first");
  const bundle = readFileSync(bundlePath, "utf8");

  const manifestPath = join(root, "patches", "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { candidate?: unknown };
  if (typeof manifest.candidate !== "string") throw new Error("patches/manifest.json has no candidate string");

  assertReleaseIdentity({
    tag,
    packageVersion: pkg.version,
    headSha,
    bundle,
    candidate: manifest.candidate,
    nativeReleaseExists: checkNativeRelease,
  });
}

if (import.meta.main) {
  const [command, ...rest] = process.argv.slice(2);
  if (command !== "check") {
    console.error("usage: bun scripts/release-npm.ts check --tag <tag> --sha <sha>");
    process.exit(2);
  }
  try {
    const flags = parseFlags(rest);
    runCheck(flags);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
}
