/**
 * Publish coverage for `scripts/prebuilt.ts publish`.
 *
 * Every `gh` call goes through the injectable runner seam in `test/prebuilt-gh-fixture.ts`, so
 * nothing here touches the network, creates a tag or creates a release.
 */
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  blockedIssueTitle,
  BlockedError,
  compareIdentity,
  parseProvenance,
  planUploads,
  provenanceMarker,
  publishRelease,
  releaseNotes,
  selectSourceRelease,
  verifyReleaseDir,
  type NotesInput,
} from "../scripts/prebuilt";
import {
  ARCHIVE,
  CODEX,
  CX,
  fakeGh,
  handles,
  multiReleaseDir,
  ok,
  PATCH_SHA,
  publishArgs,
  releaseDir,
  releaseServer,
  RELEASE_URL,
  RUN_ID,
  RUN_URL,
  SOURCE,
  TAG,
  tmp,
} from "./prebuilt-gh-fixture";

// ---- pure helpers ----

describe("selectSourceRelease", () => {
  const rel = (tag: string, extra: Record<string, unknown> = {}) => ({
    tag_name: tag, draft: false, prerelease: false, ...extra,
  });

  test("picks highest stable v<CX> release by semver, not lexicographically", () => {
    expect(selectSourceRelease([rel("v0.9.0"), rel("v0.11.0"), rel("v0.10.3")])?.version).toBe("0.11.0");
  });

  test("excludes drafts, prereleases and non-v tags", () => {
    const releases = [rel("v0.2.0", { draft: true }), rel("v0.3.0", { prerelease: true }), rel("0.4.0"), rel("v0.1.0")];
    expect(selectSourceRelease(releases)?.tag).toBe("v0.1.0");
  });

  test("returns null when there is no stable source release", () => {
    expect(selectSourceRelease([])).toBeNull();
    expect(selectSourceRelease([rel("v0.1.0-rc.1")])).toBeNull();
  });

  test("refuses a payload that is not a list", () => {
    expect(() => selectSourceRelease({})).toThrow(/list of releases/);
  });
});

describe("planUploads", () => {
  const local = [{ name: ARCHIVE, size: 100 }, { name: "manifest.json", size: 20 }, { name: "SHA256SUMS", size: 10 }];

  test("uploads everything when the release has no assets", () => {
    expect(planUploads([], local).upload).toEqual([ARCHIVE, "manifest.json", "SHA256SUMS"]);
  });

  test("skips assets already attached with the same size and uploads only the rest", () => {
    const plan = planUploads([{ name: ARCHIVE, size: 100 }], local);
    expect(plan.skip).toEqual([ARCHIVE]);
    expect(plan.upload).toEqual(["manifest.json", "SHA256SUMS"]);
  });

  test("blocks when an attached asset has a different size", () => {
    expect(() => planUploads([{ name: ARCHIVE, size: 99 }], local)).toThrow(BlockedError);
  });
});

describe("compareIdentity", () => {
  test("accepts a manifest built from the same commit and patch", async () => {
    const manifest = JSON.parse(readFileSync(join(await releaseDir(), "manifest.json"), "utf8"));
    expect(compareIdentity(manifest, { sourceCommit: SOURCE, patchSha256: PATCH_SHA }).identical).toBe(true);
  });

  test("reports a differing sourceCommit and names both values", async () => {
    const manifest = JSON.parse(readFileSync(join(await releaseDir("d".repeat(40)), "manifest.json"), "utf8"));
    const result = compareIdentity(manifest, { sourceCommit: SOURCE, patchSha256: PATCH_SHA });
    expect(result.identical).toBe(false);
    expect(result.detail).toContain("d".repeat(40));
    expect(result.detail).toContain(SOURCE);
  });

  test("reports a differing patchSha256", async () => {
    const manifest = JSON.parse(readFileSync(join(await releaseDir(SOURCE, "e".repeat(64)), "manifest.json"), "utf8"));
    expect(compareIdentity(manifest, { sourceCommit: SOURCE, patchSha256: PATCH_SHA }).identical).toBe(false);
  });
});

describe("verifyReleaseDir", () => {
  const expected = { cxVersion: CX, codexVersion: CODEX, platform: "darwin-arm64" as const };

  test("accepts a complete self-consistent directory and reports the manifest digest", async () => {
    const dir = await releaseDir();
    const set = await verifyReleaseDir(dir, expected);
    expect(set.assets.map((a) => a.name)).toEqual([ARCHIVE, "manifest.json", "SHA256SUMS"]);
    expect(set.manifestSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  test("refuses a directory with a fourth file", async () => {
    const dir = await releaseDir();
    writeFileSync(join(dir, "extra.txt"), "no\n");
    await expect(verifyReleaseDir(dir, expected)).rejects.toThrow(/exactly three/);
  });

  test("refuses a tampered archive", async () => {
    const dir = await releaseDir();
    writeFileSync(join(dir, ARCHIVE), "tampered");
    await expect(verifyReleaseDir(dir, expected)).rejects.toThrow(/sha256/);
  });

  test("accepts a multi-platform release directory", async () => {
    const dir = await multiReleaseDir();
    const set = await verifyReleaseDir(dir, {
      cxVersion: CX,
      codexVersion: CODEX,
      platforms: ["darwin-arm64", "darwin-x64"],
    });
    expect(set.assets.map((a) => a.name)).toHaveLength(4);
    expect(set.manifestSha256).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("release notes", () => {
  const notesInput: NotesInput = {
    cxVersion: CX,
    codexVersion: CODEX,
    platform: "darwin-arm64",
    sourceCommit: SOURCE,
    upstreamTag: `rust-v${CODEX}`,
    upstreamCommit: "b".repeat(40),
    patchFile: `codex-${CODEX}.patch`,
    patchSha256: PATCH_SHA,
    runId: RUN_ID,
    runUrl: RUN_URL,
    manifestSha256: "f".repeat(64),
    identity: { kind: "dispatch", sha: SOURCE },
  };

  test("is deterministic for identical inputs", () => {
    expect(releaseNotes(notesInput)).toBe(releaseNotes(notesInput));
  });

  test("carries every required disclosure", () => {
    const notes = releaseNotes(notesInput);
    expect(notes).not.toMatch(/private/i);
    const disclosures = [
      `Codex ${CODEX} (darwin-arm64)`,
      `Built from cxstatusline commit ${SOURCE} (package version ${CX})`,
      `patch codex-${CODEX}.patch sha256 ${PATCH_SHA}`,
      "darwin-arm64 only (Apple Silicon); Intel is not built in this release.",
      "Unsigned, not notarized",
      "do not disable Gatekeeper globally",
      "Apache-2.0",
      "MIT",
      "cxstatusline install --compile",
      "clean macOS 14",
      "cargo deny check licenses",
      `Workflow run ${RUN_URL} (manual dispatch of commit ${SOURCE})`,
      provenanceMarker({ runId: RUN_ID, manifestSha256: "f".repeat(64) }),
    ];
    for (const d of disclosures) expect(notes).toContain(d);
  });

  test("names the source release for a scheduled build", () => {
    const notes = releaseNotes({ ...notesInput, identity: { kind: "schedule", cxVersion: CX } });
    expect(notes).toContain(`Workflow run ${RUN_URL} (scheduled build of source release v${CX})`);
  });

  test("round-trips its provenance marker", () => {
    const parsed = parseProvenance(releaseNotes(notesInput));
    expect(parsed).toEqual({ runId: RUN_ID, manifestSha256: "f".repeat(64) });
  });

  test("finds no provenance in a body that has none", () => {
    expect(parseProvenance("just some notes")).toBeNull();
  });

  test("formats multiple architectures in title and notes", () => {
    const notes = releaseNotes({ ...notesInput, platforms: ["darwin-arm64", "darwin-x64"] });
    expect(notes).toContain(`Codex ${CODEX} (darwin-arm64, darwin-x64)`);
    expect(notes).toContain("darwin-arm64 (Apple Silicon), darwin-x64 (Intel).");
  });
});

// ---- publish ----

describe("publishRelease", () => {
  test("creates a draft, uploads three assets, re-verifies, then publishes", async () => {
    const dir = await releaseDir();
    const h = handles();
    const fake = releaseServer(h);
    const outcome = await publishRelease(publishArgs(dir, fake.run));
    expect(outcome.kind).toBe("published");
    expect(fake.of("release create")[0]).toContain("--draft");
    expect(fake.of("release create")[0]).toContain("--target");
    expect(fake.of("release upload")).toHaveLength(3);
    expect(fake.of("release download")).toHaveLength(3);
    expect(fake.of("release edit")[0]).toContain("--draft=false");
    expect(fake.of("release edit")[0]).toContain("--latest=false");
    expect(fake.of("release edit")[0]).toContain("--prerelease");
    expect(fake.calls.flat()).not.toContain("--clobber");
    expect(fake.calls.flat().every((a) => !a.includes("$") && !a.includes("`"))).toBe(true);
  });

  test("skips with success when the release is already published and identical", async () => {
    const dir = await releaseDir();
    const server = tmp("published");
    for (const name of [ARCHIVE, "manifest.json", "SHA256SUMS"]) cpSync(join(dir, name), join(server, name));
    const fake = fakeGh({
      "release view": () => ok(JSON.stringify({
        isDraft: false, url: RELEASE_URL, body: "notes",
        assets: [ARCHIVE, "manifest.json", "SHA256SUMS"].map((name) => ({ name, size: readFileSync(join(server, name)).length })),
      })),
      "release download": (a) => {
        const p = a[a.indexOf("--pattern") + 1]!;
        const t = a[a.indexOf("--dir") + 1]!;
        mkdirSync(t, { recursive: true });
        cpSync(join(server, p), join(t, p));
        return ok();
      },
    });
    const outcome = await publishRelease(publishArgs(dir, fake.run));
    expect(outcome.kind).toBe("skipped-identical");
    expect(fake.of("release upload")).toHaveLength(0);
    expect(fake.of("release edit")).toHaveLength(0);
  });

  test("blocks when a published release was built from a different source commit", async () => {
    const dir = await releaseDir();
    const other = await releaseDir("d".repeat(40));
    const fake = fakeGh({
      "release view": () => ok(JSON.stringify({
        isDraft: false, url: RELEASE_URL, body: "notes",
        assets: [ARCHIVE, "manifest.json", "SHA256SUMS"].map((name) => ({ name, size: readFileSync(join(other, name)).length })),
      })),
      "release download": (a) => {
        const p = a[a.indexOf("--pattern") + 1]!;
        const t = a[a.indexOf("--dir") + 1]!;
        mkdirSync(t, { recursive: true });
        cpSync(join(other, p), join(t, p));
        return ok();
      },
    });
    const error = await publishRelease(publishArgs(dir, fake.run)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BlockedError);
    expect((error as BlockedError).title).toBe(blockedIssueTitle(CODEX));
    expect((error as BlockedError).message).toMatch(/immutab/i);
    expect((error as BlockedError).message).toMatch(/version bump/i);
    expect(fake.of("release upload")).toHaveLength(0);
  });

  test("resumes a matching draft and uploads only the missing assets", async () => {
    const dir = await releaseDir();
    const manifestSha256 = createHash("sha256").update(readFileSync(join(dir, "manifest.json"))).digest("hex");
    const h = handles();
    h.draft.value = true;
    h.body.value = `notes\n${provenanceMarker({ runId: RUN_ID, manifestSha256 })}\n`;
    const fake = releaseServer(h);
    // Replay the interrupted first run's one successful upload into the fake's server side.
    fake.run(["release", "upload", TAG, join(dir, ARCHIVE)]);

    const outcome = await publishRelease(publishArgs(dir, fake.run));
    expect(outcome.kind).toBe("published");
    const uploaded = fake.of("release upload").slice(1).map((c) => c[3]!.split("/").pop());
    expect(uploaded).toEqual(["manifest.json", "SHA256SUMS"]);
    expect(fake.of("release create")).toHaveLength(0);
    expect(fake.of("release delete")).toHaveLength(0);
  });

  test("blocks with restart instructions when a draft was built from different bytes", async () => {
    const dir = await releaseDir();
    const h = handles();
    h.draft.value = true;
    h.body.value = `notes\n${provenanceMarker({ runId: "7", manifestSha256: "9".repeat(64) })}\n`;
    h.assets.push({ name: ARCHIVE, size: 5 });
    const fake = releaseServer(h);
    const error = await publishRelease(publishArgs(dir, fake.run)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BlockedError);
    expect((error as BlockedError).message).toMatch(/delete the unpublished draft|bump/i);
    expect(fake.of("release upload")).toHaveLength(0);
    expect(fake.of("release delete")).toHaveLength(0);
    expect(fake.of("release edit")).toHaveLength(0);
  });

  test("does not publish when a downloaded asset fails re-verification", async () => {
    const dir = await releaseDir();
    const h = handles();
    const fake = releaseServer(h, {
      "release download": (a) => {
        const pattern = a[a.indexOf("--pattern") + 1]!;
        const target = a[a.indexOf("--dir") + 1]!;
        mkdirSync(target, { recursive: true });
        writeFileSync(join(target, pattern), "corrupted-in-flight");
        return ok();
      },
    });
    await expect(publishRelease(publishArgs(dir, fake.run))).rejects.toThrow(/re-verif|does not match/i);
    expect(fake.of("release edit")).toHaveLength(0);
  });

  test("upload interruption regression: manifest bytes are unchanged and nothing is rebuilt", async () => {
    const dir = await releaseDir();
    const before = readFileSync(join(dir, "manifest.json"));
    const h = handles();
    let uploads = 0;
    const fail = releaseServer(h, {
      "release upload": (a) => {
        uploads += 1;
        if (uploads > 1) return { status: 1, stdout: "", stderr: "runner lost connection" };
        const file = a[3]!;
        h.assets.push({ name: file.split("/").pop()!, size: readFileSync(file).length });
        return ok();
      },
    });
    await expect(publishRelease(publishArgs(dir, fail.run))).rejects.toThrow(/gh release upload/);
    expect(h.draft.value).toBe(true);

    // Second run: same directory, same bytes, resumes from the draft.
    const server = tmp("resume");
    cpSync(join(dir, ARCHIVE), join(server, ARCHIVE));
    const resume = fakeGh({
      "release view": () =>
        ok(JSON.stringify({ isDraft: true, url: RELEASE_URL, body: h.body.value, assets: h.assets })),
      "release upload": (a) => {
        const file = a[3]!;
        const name = file.split("/").pop()!;
        cpSync(file, join(server, name));
        h.assets.push({ name, size: readFileSync(file).length });
        return ok();
      },
      "release download": (a) => {
        const pattern = a[a.indexOf("--pattern") + 1]!;
        const target = a[a.indexOf("--dir") + 1]!;
        mkdirSync(target, { recursive: true });
        cpSync(join(server, pattern), join(target, pattern));
        return ok();
      },
      "release edit": () => ok(),
    });
    const outcome = await publishRelease(publishArgs(dir, resume.run));
    expect(outcome.kind).toBe("published");
    expect(readFileSync(join(dir, "manifest.json"))).toEqual(before);
    expect(resume.of("release create")).toHaveLength(0);
    expect(h.assets.map((a) => a.name).sort()).toEqual([ARCHIVE, "SHA256SUMS", "manifest.json"].sort());
  });

  test("publishes a multi-platform release and resumes missing upload", async () => {
    const dir = await multiReleaseDir();
    const h = handles();
    const fake = releaseServer(h);
    const outcome = await publishRelease({
      ...publishArgs(dir, fake.run),
      platforms: ["darwin-arm64", "darwin-x64"],
    });
    expect(outcome.kind).toBe("published");
    expect(fake.of("release upload")).toHaveLength(4);
    expect(fake.of("release download")).toHaveLength(4);
    expect(fake.of("release edit")[0]).toContain("--draft=false");

    const arm64 = `cxstatusline-codex-${CODEX}-darwin-arm64.tar.gz`;
    const x64 = `cxstatusline-codex-${CODEX}-darwin-x64.tar.gz`;
    const h2 = handles();
    h2.draft.value = true;
    const manifestSha256 = createHash("sha256").update(readFileSync(join(dir, "manifest.json"))).digest("hex");
    h2.body.value = `notes\n${provenanceMarker({ runId: RUN_ID, manifestSha256 })}\n`;
    const fake2 = releaseServer(h2);
    fake2.run(["release", "upload", TAG, join(dir, arm64)]);

    const outcome2 = await publishRelease({
      ...publishArgs(dir, fake2.run),
      platforms: ["darwin-arm64", "darwin-x64"],
    });
    expect(outcome2.kind).toBe("published");
    const uploaded = fake2.of("release upload").slice(1).map((c) => c[3]!.split("/").pop());
    expect(uploaded).toEqual([x64, "manifest.json", "SHA256SUMS"]);
  });
});
