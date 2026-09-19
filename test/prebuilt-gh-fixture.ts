/**
 * Shared fixtures for the prebuilt publish and report tests.
 *
 * A scripted `gh` seam plus a real, self-consistent release directory. Nothing here touches the
 * network, creates a tag, a release or an issue: `fakeGh` records the exact argument arrays, which
 * is also how the "no shell interpolation" and "never --clobber" rules are asserted.
 */
import { createHash } from "node:crypto";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  archiveFilename,
  ARCHIVE_ENTRIES,
  buildManifest,
  mergeManifests,
  packArchive,
  writeChecksums,
  type GhResult,
  type GhRunner,
} from "../scripts/prebuilt";
import type { ArtifactFile, FileDigest, Platform } from "../src/distribution";

export const CX = "0.1.0";
export const CODEX = "0.153.0";
export const TAG = `cxstatusline-v${CX}-codex-v${CODEX}`;
export const ARCHIVE = archiveFilename(CODEX, "darwin-arm64");
export const SOURCE = "a".repeat(40);
export const PATCH_SHA = "c".repeat(64);
export const RUN_ID = "42";
export const RUN_URL = `https://github.com/adrijshikhar/cxstatusline/actions/runs/${RUN_ID}`;
export const RELEASE_URL = `https://github.com/adrijshikhar/cxstatusline/releases/tag/${TAG}`;

export function tmp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), `cxsl-pub-${prefix}-`));
}

export function digests(dir: string): Record<ArtifactFile, FileDigest> {
  const out: Record<string, FileDigest> = {};
  for (const name of ARCHIVE_ENTRIES) {
    const bytes = readFileSync(join(dir, name));
    out[name] = { sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.length };
  }
  return out as Record<ArtifactFile, FileDigest>;
}

/** A complete, self-consistent release directory: archive + manifest.json + SHA256SUMS. */
export async function releaseDir(sourceCommit = SOURCE, patchSha256 = PATCH_SHA): Promise<string> {
  const stage = tmp("staging");
  for (const name of ARCHIVE_ENTRIES) {
    const executable = name === "codex" || name === "codex-code-mode-host";
    writeFileSync(join(stage, name), executable ? "#!/bin/sh\necho stub\n" : `${name} text\n`);
    chmodSync(join(stage, name), executable ? 0o755 : 0o644);
  }
  const out = tmp("out");
  const archive = await packArchive(stage, join(out, ARCHIVE));
  const manifest = buildManifest({
    cxVersion: CX,
    codexVersion: CODEX,
    platform: "darwin-arm64",
    upstreamCommit: "b".repeat(40),
    patchSha256,
    sourceCommit,
    workflowUrl: RUN_URL,
    createdAt: "2026-09-07T00:00:00Z",
    archive,
    files: digests(stage),
  });
  writeFileSync(join(out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeChecksums(out, [ARCHIVE, "manifest.json"]);
  return out;
}

/** Multi-platform release directory: archives for each platform + merged manifest.json + SHA256SUMS. */
export async function multiReleaseDir(
  platforms: readonly Platform[] = ["darwin-arm64", "darwin-x64"],
  sourceCommit = SOURCE,
): Promise<string> {
  const stage = tmp("staging-multi");
  for (const name of ARCHIVE_ENTRIES) {
    const executable = name === "codex" || name === "codex-code-mode-host";
    writeFileSync(join(stage, name), executable ? "#!/bin/sh\necho stub\n" : `${name} text\n`);
    chmodSync(join(stage, name), executable ? 0o755 : 0o644);
  }
  const out = tmp("out-multi");
  const manifests = [];
  const archiveNames: string[] = [];
  for (const platform of platforms) {
    const archiveName = archiveFilename(CODEX, platform);
    archiveNames.push(archiveName);
    const archive = await packArchive(stage, join(out, archiveName));
    manifests.push(
      buildManifest({
        cxVersion: CX,
        codexVersion: CODEX,
        platform,
        upstreamCommit: "b".repeat(40),
        patchSha256: PATCH_SHA,
        sourceCommit,
        workflowUrl: RUN_URL,
        createdAt: "2026-09-07T00:00:00Z",
        archive,
        files: digests(stage),
      }),
    );
  }
  const merged = mergeManifests(manifests);
  writeFileSync(join(out, "manifest.json"), `${JSON.stringify(merged, null, 2)}\n`);
  await writeChecksums(out, [...archiveNames, "manifest.json"]);
  return out;
}

export const ok = (stdout = ""): GhResult => ({ status: 0, stdout, stderr: "" });

export interface Fake {
  readonly run: GhRunner;
  readonly calls: readonly (readonly string[])[];
  readonly of: (verb: string) => readonly (readonly string[])[];
}

/** A scripted `gh`. Handlers are keyed on `"<noun> <verb>"`, e.g. `"release view"`. */
export function fakeGh(handlers: Record<string, (args: readonly string[]) => GhResult>): Fake {
  const calls: string[][] = [];
  const run: GhRunner = (args) => {
    calls.push([...args]);
    const key = `${args[0]} ${args[1]}`;
    const found = Object.keys(handlers).find((k) => key === k || key.startsWith(k));
    if (found === undefined) return { status: 1, stdout: "", stderr: `unscripted: ${args.join(" ")}` };
    return handlers[found]!(args);
  };
  return { run, calls, of: (verb) => calls.filter((c) => `${c[0]} ${c[1]}`.startsWith(verb)) };
}

export interface Handles {
  readonly assets: { name: string; size: number }[];
  readonly body: { value: string };
  readonly draft: { value: boolean };
}

/**
 * A `gh` that behaves like a real release for the happy paths: uploads land in a server-side
 * directory, `release download` copies from it, `release view` reports what is there.
 */
export function releaseServer(h: Handles, extra: Record<string, (a: readonly string[]) => GhResult> = {}): Fake {
  const server = tmp("server");
  return fakeGh({
    "release view": () =>
      h.assets.length === 0 && h.body.value === ""
        ? { status: 1, stdout: "", stderr: "release not found" }
        : ok(JSON.stringify({ isDraft: h.draft.value, url: RELEASE_URL, body: h.body.value, assets: h.assets })),
    "release create": (a) => {
      const notes = a[a.indexOf("--notes-file") + 1]!;
      h.body.value = readFileSync(notes, "utf8");
      h.draft.value = true;
      return ok(RELEASE_URL);
    },
    "release upload": (a) => {
      const file = a[3]!;
      const name = file.slice(file.lastIndexOf("/") + 1);
      cpSync(file, join(server, name));
      const existingIdx = h.assets.findIndex((asset) => asset.name === name);
      if (existingIdx >= 0) {
        h.assets[existingIdx] = { name, size: readFileSync(file).length };
      } else {
        h.assets.push({ name, size: readFileSync(file).length });
      }
      return ok();
    },
    "release download": (a) => {
      const pattern = a[a.indexOf("--pattern") + 1]!;
      const dir = a[a.indexOf("--dir") + 1]!;
      mkdirSync(dir, { recursive: true });
      if (!existsSync(join(server, pattern))) return { status: 1, stdout: "", stderr: "asset not found" };
      cpSync(join(server, pattern), join(dir, pattern));
      return ok();
    },
    "release edit": () => {
      h.draft.value = false;
      return ok();
    },
    ...extra,
  });
}

export function handles(): Handles {
  return { assets: [], body: { value: "" }, draft: { value: false } };
}

export const publishArgs = (dir: string, run: GhRunner) => ({
  run,
  tag: TAG,
  dir,
  runId: RUN_ID,
  runUrl: RUN_URL,
  sourceCommit: SOURCE,
  codexVersion: CODEX,
  cxVersion: CX,
  platform: "darwin-arm64" as const,
  event: "workflow_dispatch",
  tmpRoot: tmp("pubtmp"),
  summary: () => {},
});

