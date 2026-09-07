import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import type { Context } from "../src/context";
import type { RunResult } from "../src/env";
import { releaseTag, type ArtifactFile, type ReleaseManifest } from "../src/distribution";
import { preparePrebuilt } from "../src/distribution";
import type { FetchLike } from "../src/distribution/transport";
import { activeGeneration, createGeneration, swapPointer } from "../src/patch/generation";
import { resolvePaths } from "../src/paths";
import { fakeExec, tarStream, tmpEnv, type RecordedCall, type TarEntry } from "./helpers";

const CX = "0.2.1";
const CODEX = "0.153.0";
const TAG = releaseTag(CX, CODEX);
const ARCHIVE = `cxstatusline-codex-${CODEX}-darwin-arm64.tar.gz`;
const EXPECTED = { cxVersion: CX, codexVersion: CODEX, platform: "darwin-arm64" } as const;

// ---- Release fixture ----

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

function entries(): TarEntry[] {
  return [
    { name: "codex", mode: 0o755, data: "CODEX-BINARY" },
    { name: "codex-code-mode-host", mode: 0o755, data: "HOST-BINARY" },
    { name: "LICENSE", mode: 0o644, data: "MIT" },
    { name: "NOTICE", mode: 0o644, data: "NOTICE TEXT" },
    { name: "THIRD_PARTY_NOTICES.md", mode: 0o644, data: "# Third party" },
  ];
}

function release(over: { archiveSha?: string } = {}): { manifest: ReleaseManifest; archive: Buffer } {
  const parts = entries();
  const archive = gzipSync(tarStream(parts));
  const files = Object.fromEntries(
    parts.map((e) => {
      const data = Buffer.from(e.data as string);
      return [e.name, { sha256: sha256(data), size: data.length }];
    }),
  ) as ReleaseManifest["artifacts"][number]["files"];
  const manifest: ReleaseManifest = {
    schema: 1,
    cxVersion: CX,
    codexVersion: CODEX,
    upstreamTag: `rust-v${CODEX}`,
    upstreamCommit: "c".repeat(40),
    patchFile: `codex-${CODEX}.patch`,
    patchSha256: "a".repeat(64),
    sourceCommit: "d".repeat(40),
    workflowUrl: "https://github.com/adrijshikhar/cxstatusline/actions/runs/123456789",
    createdAt: "2026-09-05T12:00:00Z",
    artifacts: [
      {
        platform: "darwin-arm64",
        filename: ARCHIVE,
        sha256: over.archiveSha ?? sha256(archive),
        size: archive.length,
        files,
      },
    ],
  };
  return { manifest, archive };
}

// ---- Local release server ----

type Route = Buffer | number | { redirect: string };

async function releaseServer(routes: Record<string, Route>): Promise<{
  baseUrl: string;
  requests: string[];
  close: () => Promise<void>;
}> {
  const requests: string[] = [];
  const server = createServer((req, res) => {
    const path = req.url ?? "";
    requests.push(path);
    const route = routes[path];
    if (route === undefined) {
      res.writeHead(404).end("not found");
      return;
    }
    if (typeof route === "number") {
      res.writeHead(route).end("nope");
      return;
    }
    if (Buffer.isBuffer(route)) {
      res.writeHead(200, { "content-length": String(route.length) }).end(route);
      return;
    }
    res.writeHead(302, { location: route.redirect }).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function routesFor(fixture: { manifest: ReleaseManifest; archive: Buffer }): Record<string, Route> {
  return {
    [`/${TAG}/manifest.json`]: Buffer.from(JSON.stringify(fixture.manifest)),
    [`/${TAG}/${ARCHIVE}`]: fixture.archive,
  };
}

// ---- Context ----

interface CtxOptions {
  gh?: (args: readonly string[]) => Partial<RunResult>;
  ghPath?: string | null;
  version?: string;
}

function prebuiltCtx(over: CtxOptions = {}): { ctx: Context; root: string; calls: RecordedCall[] } {
  const { env, root } = tmpEnv("cx prebuilt ");
  const paths = resolvePaths(env);
  const { run, calls } = fakeExec((cmd, args) => {
    if (cmd === "cargo" || cmd === "rustup") throw new Error(`a prebuilt install must never run ${cmd}`);
    if (cmd === "gh") return over.gh ? over.gh(args) : { status: 1, stderr: "release not found" };
    if (args[0] === "--version") return { stdout: `codex-cli ${over.version ?? CODEX}\n` };
    return {};
  });
  const ctx: Context = {
    env,
    paths,
    run,
    which: (cmd) => (cmd === "gh" ? (over.ghPath === undefined ? null : over.ghPath) : null),
    freeBytes: () => 10 * 1024 * 1024 * 1024,
    cxBin: join(paths.binDir, "cxstatusline"),
    patchesDir: join(root, "patches"),
    now: () => new Date("2026-09-07T10:00:00Z"),
    log: () => {},
    say: () => {},
  };
  return { ctx, root, calls };
}

/** Everything preparePrebuilt is allowed to leave behind on failure: nothing. */
function libexecEntries(ctx: Context): string[] {
  try {
    return readdirSync(ctx.paths.libexecDir).sort();
  } catch {
    return [];
  }
}

// ---- Happy path ----

test("stages a verified prebuilt pair from a release server", async () => {
  const fixture = release();
  const server = await releaseServer(routesFor(fixture));
  const { ctx, calls } = prebuiltCtx();
  try {
    const result = await preparePrebuilt(ctx, EXPECTED, { baseUrl: server.baseUrl });
    expect(result.kind).toBe("staged");
    const { pair } = result;
    expect(readdirSync(pair.directory).sort()).toEqual([
      "LICENSE",
      "NOTICE",
      "THIRD_PARTY_NOTICES.md",
      "codex",
      "codex-code-mode-host",
    ]);
    expect(readFileSync(join(pair.directory, "codex"), "utf8")).toBe("CODEX-BINARY");
    expect(pair.codexVersion).toBe(CODEX);
    expect(pair.provenance.source).toBe("prebuilt");
    expect(pair.provenance.cxVersion).toBe(CX);
    expect(pair.provenance.platform).toBe("darwin-arm64");
    expect(pair.provenance.patchSha256).toBe(fixture.manifest.patchSha256);
    expect(pair.provenance.upstreamCommit).toBe(fixture.manifest.upstreamCommit);
    expect(pair.provenance.sourceCommit).toBe(fixture.manifest.sourceCommit);
    expect(pair.provenance.sourceDirty).toBe(false);
    expect(pair.provenance.installedAt).toBe("2026-09-07T10:00:00.000Z");
    expect(pair.provenance.executables.codex).toEqual(fixture.manifest.artifacts[0]!.files.codex);
    expect(pair.provenance.release?.tag).toBe(TAG);
    expect(pair.provenance.release?.archiveSha256).toBe(fixture.manifest.artifacts[0]!.sha256);
    expect(pair.provenance.release?.manifest).toEqual(fixture.manifest);
    // The version probe runs the staged binary, from the staging directory, under a timeout.
    expect(calls).toHaveLength(1);
    expect(calls[0]!.cmd).toBe(join(pair.directory, "codex"));
    expect(calls[0]!.args).toEqual(["--version"]);
    expect(calls[0]!.opts?.timeoutMs).toBeGreaterThan(0);
    // The download temp is gone; only the staging directory survives, for the caller to install.
    expect(libexecEntries(ctx)).toEqual([pair.directory.split("/").pop()!]);
  } finally {
    await server.close();
  }
});

test("follows one redirect but refuses an endless chain", async () => {
  const fixture = release();
  const direct = routesFor(fixture);
  const server = await releaseServer({
    ...direct,
    [`/${TAG}/manifest.json`]: { redirect: "/moved/manifest.json" },
    "/moved/manifest.json": Buffer.from(JSON.stringify(fixture.manifest)),
  });
  const { ctx } = prebuiltCtx();
  try {
    const result = await preparePrebuilt(ctx, EXPECTED, { baseUrl: server.baseUrl });
    expect(result.kind).toBe("staged");
  } finally {
    await server.close();
  }

  const loop = await releaseServer({ [`/${TAG}/manifest.json`]: { redirect: `/${TAG}/manifest.json` } });
  const second = prebuiltCtx();
  try {
    await expect(preparePrebuilt(second.ctx, EXPECTED, { baseUrl: loop.baseUrl })).rejects.toThrow(/redirect/i);
    expect(libexecEntries(second.ctx)).toEqual([]);
  } finally {
    await loop.close();
  }
});

// ---- Rejections ----

test("a missing public release with no gh installed rejects and stages nothing", async () => {
  const server = await releaseServer({});
  const { ctx } = prebuiltCtx({ ghPath: null });
  try {
    await expect(preparePrebuilt(ctx, EXPECTED, { baseUrl: server.baseUrl })).rejects.toThrow(
      /GitHub CLI \(gh\) is not installed/,
    );
    expect(libexecEntries(ctx)).toEqual([]);
  } finally {
    await server.close();
  }
});

test("gh that is not logged in is reported as an auth problem, not a private release", async () => {
  const server = await releaseServer({});
  const { ctx } = prebuiltCtx({
    ghPath: "/usr/bin/gh",
    gh: () => ({ status: 1, stderr: "gh: To get started with GitHub CLI, please run: gh auth login\n" }),
  });
  try {
    await expect(preparePrebuilt(ctx, EXPECTED, { baseUrl: server.baseUrl })).rejects.toThrow(/gh is not logged in/);
  } finally {
    await server.close();
  }
});

test("denied or missing private release never claims the 404 proves privacy", async () => {
  const server = await releaseServer({});
  const { ctx } = prebuiltCtx({
    ghPath: "/usr/bin/gh",
    gh: () => ({ status: 1, stderr: "HTTP 404: Not Found (https://api.github.com/repos/x/y?per_page=1)\n" }),
  });
  try {
    const failure = await preparePrebuilt(ctx, EXPECTED, { baseUrl: server.baseUrl }).catch((e: unknown) => e);
    expect(String(failure)).toContain(`release ${TAG} not found or access denied`);
    expect(String(failure)).not.toMatch(/private/i);
    expect(String(failure)).not.toMatch(/\?per_page/);
    expect(String(failure).length).toBeLessThan(400);
  } finally {
    await server.close();
  }
});

test("gh supplies both assets when the public path 404s", async () => {
  const fixture = release();
  const server = await releaseServer({});
  const { ctx } = prebuiltCtx({
    ghPath: "/usr/bin/gh",
    gh: (args) => {
      const pattern = args[args.indexOf("--pattern") + 1]!;
      const dir = args[args.indexOf("--dir") + 1]!;
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, pattern),
        pattern === "manifest.json" ? Buffer.from(JSON.stringify(fixture.manifest)) : fixture.archive,
      );
      return { status: 0 };
    },
  });
  try {
    const result = await preparePrebuilt(ctx, EXPECTED, { baseUrl: server.baseUrl });
    expect(result.kind).toBe("staged");
    expect(readFileSync(join(result.pair.directory, "codex"), "utf8")).toBe("CODEX-BINARY");
  } finally {
    await server.close();
  }
});

test("an archive whose bytes do not match the manifest digest rejects and cleans up", async () => {
  const fixture = release({ archiveSha: "b".repeat(64) });
  const server = await releaseServer(routesFor(fixture));
  const { ctx } = prebuiltCtx();
  try {
    await expect(preparePrebuilt(ctx, EXPECTED, { baseUrl: server.baseUrl })).rejects.toThrow(/sha256|digest/i);
    expect(libexecEntries(ctx)).toEqual([]);
  } finally {
    await server.close();
  }
});

test("a staged codex reporting the wrong version rejects and cleans up", async () => {
  const server = await releaseServer(routesFor(release()));
  const { ctx } = prebuiltCtx({ version: "0.152.1" });
  try {
    await expect(preparePrebuilt(ctx, EXPECTED, { baseUrl: server.baseUrl })).rejects.toThrow(/version/i);
    expect(libexecEntries(ctx)).toEqual([]);
  } finally {
    await server.close();
  }
});

test("an oversized manifest is refused before it is parsed", async () => {
  const server = await releaseServer({ [`/${TAG}/manifest.json`]: Buffer.alloc(2 * 1024 * 1024, 0x7b) });
  const { ctx } = prebuiltCtx();
  try {
    await expect(preparePrebuilt(ctx, EXPECTED, { baseUrl: server.baseUrl })).rejects.toThrow(/large|limit/i);
    expect(libexecEntries(ctx)).toEqual([]);
  } finally {
    await server.close();
  }
});

test("a failed install leaves an already-installed generation byte-identical", async () => {
  const good = await releaseServer(routesFor(release()));
  const { ctx } = prebuiltCtx();
  let generation: string;
  try {
    const first = await preparePrebuilt(ctx, EXPECTED, { baseUrl: good.baseUrl });
    generation = createGeneration(first.pair, ctx.paths);
    swapPointer(ctx.paths, generation);
    rmSync(first.pair.directory, { recursive: true, force: true }); // the caller owns staged bytes
  } finally {
    await good.close();
  }
  const before = readFileSync(join(generation, "codex"));

  const broken = await releaseServer({});
  try {
    await expect(preparePrebuilt(ctx, EXPECTED, { baseUrl: broken.baseUrl })).rejects.toThrow();
  } finally {
    await broken.close();
  }
  expect(readFileSync(join(generation, "codex"))).toEqual(before);
  expect(activeGeneration(ctx.paths)).toBe(generation);
  expect(libexecEntries(ctx)).toEqual(["current", "generations"]);
});

// ---- The verified no-op ----

async function installOnce(ctx: Context, baseUrl: string): Promise<string> {
  const result = await preparePrebuilt(ctx, EXPECTED, { baseUrl });
  const dir = createGeneration(result.pair, ctx.paths);
  swapPointer(ctx.paths, dir);
  rmSync(result.pair.directory, { recursive: true, force: true }); // the caller owns staged bytes
  return dir;
}

test("a second identical install is a verified no-op that downloads the archive once", async () => {
  const server = await releaseServer(routesFor(release()));
  const { ctx } = prebuiltCtx();
  try {
    const generation = await installOnce(ctx, server.baseUrl);
    const again = await preparePrebuilt(ctx, EXPECTED, { baseUrl: server.baseUrl });
    expect(again.kind).toBe("unchanged");
    expect(again.pair.directory).toBe(generation);
    expect(again.pair.provenance.source).toBe("prebuilt");
    expect(server.requests.filter((p) => p.endsWith(ARCHIVE))).toHaveLength(1);
    expect(server.requests.filter((p) => p.endsWith("manifest.json"))).toHaveLength(2);
    expect(libexecEntries(ctx)).toEqual(["current", "generations"]);
  } finally {
    await server.close();
  }
});

test("a tampered installed binary forces a fresh download instead of a no-op", async () => {
  const server = await releaseServer(routesFor(release()));
  const { ctx } = prebuiltCtx();
  try {
    const generation = await installOnce(ctx, server.baseUrl);
    writeFileSync(join(generation, "codex"), "TAMPERED-BINARY");
    const again = await preparePrebuilt(ctx, EXPECTED, { baseUrl: server.baseUrl });
    expect(again.kind).toBe("staged");
    expect(again.pair.directory).not.toBe(generation);
    expect(server.requests.filter((p) => p.endsWith(ARCHIVE))).toHaveLength(2);
  } finally {
    await server.close();
  }
});

test("a missing legal file in the active generation forces a fresh download", async () => {
  const server = await releaseServer(routesFor(release()));
  const { ctx } = prebuiltCtx();
  try {
    const generation = await installOnce(ctx, server.baseUrl);
    writeFileSync(join(generation, "NOTICE"), "REWRITTEN");
    const again = await preparePrebuilt(ctx, EXPECTED, { baseUrl: server.baseUrl });
    expect(again.kind).toBe("staged");
    expect(existsSync(join(again.pair.directory, "NOTICE"))).toBe(true);
  } finally {
    await server.close();
  }
});

test("every artifact file key is covered by the staged pair", () => {
  const keys: ArtifactFile[] = ["codex", "codex-code-mode-host", "LICENSE", "NOTICE", "THIRD_PARTY_NOTICES.md"];
  expect(new Set(entries().map((e) => e.name))).toEqual(new Set(keys));
});

// ---- The injected-fetch seam (no server, no sockets) ----

const NOWHERE = "https://releases.invalid/download";

test("a non-404 HTTP status is reported and stages nothing", async () => {
  const { ctx } = prebuiltCtx();
  const stub: FetchLike = async () => new Response("upstream is unwell", { status: 503 });
  await expect(preparePrebuilt(ctx, EXPECTED, { fetch: stub, baseUrl: NOWHERE })).rejects.toThrow(/HTTP 503/);
  expect(libexecEntries(ctx)).toEqual([]);
});

test("a body shorter than its content-length is refused as truncated", async () => {
  const { ctx } = prebuiltCtx();
  const stub: FetchLike = async () =>
    new Response("{}", { status: 200, headers: { "content-length": "4096" } });
  await expect(preparePrebuilt(ctx, EXPECTED, { fetch: stub, baseUrl: NOWHERE })).rejects.toThrow(/truncated/);
  expect(libexecEntries(ctx)).toEqual([]);
});

test("a redirect off https is refused", async () => {
  const { ctx } = prebuiltCtx();
  const stub: FetchLike = async () =>
    new Response(null, { status: 302, headers: { location: "file:///etc/passwd" } });
  await expect(preparePrebuilt(ctx, EXPECTED, { fetch: stub })).rejects.toThrow(/file: URL/);
  expect(libexecEntries(ctx)).toEqual([]);
});
