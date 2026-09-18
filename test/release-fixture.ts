import { createHash } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { gzipSync } from "node:zlib";
import { releaseTag, type Platform, type ReleaseManifest } from "../src/distribution";
import { tarStream, type TarEntry } from "./helpers";

export function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

/** The five members every published archive must carry, with recognisable bodies. */
export function releaseEntries(): TarEntry[] {
  return [
    { name: "codex", mode: 0o755, data: "CODEX-BINARY" },
    { name: "codex-code-mode-host", mode: 0o755, data: "HOST-BINARY" },
    { name: "LICENSE", mode: 0o644, data: "MIT" },
    { name: "NOTICE", mode: 0o644, data: "NOTICE TEXT" },
    {
      name: "THIRD_PARTY_NOTICES.md",
      mode: 0o644,
      data: "# Third party\n\n## Rust dependency licenses (generated)\n\n- crate-a 1.0.0 (MIT)\n",
    },
  ];
}

export interface ReleaseFixture {
  readonly manifest: ReleaseManifest;
  readonly archive: Buffer;
  readonly tag: string;
  readonly archiveName: string;
}

export function releaseFixture(o: {
  cxVersion?: string;
  codexVersion: string;
  platform?: Platform;
  archiveSha?: string;
  entries?: TarEntry[];
}): ReleaseFixture {
  const platform = o.platform ?? "darwin-arm64";
  const parts = o.entries ?? releaseEntries();
  const archive = gzipSync(tarStream(parts));
  const files = Object.fromEntries(
    parts.map((e) => {
      const data = Buffer.from(e.data as string);
      return [e.name, { sha256: sha256(data), size: data.length }];
    }),
  ) as ReleaseManifest["artifacts"][number]["files"];
  const archiveName = `cxstatusline-codex-${o.codexVersion}-${platform}.tar.gz`;
  const manifest: ReleaseManifest = {
    schema: 1,
    cxVersion: o.cxVersion ?? "0.2.1",
    codexVersion: o.codexVersion,
    upstreamTag: `rust-v${o.codexVersion}`,
    upstreamCommit: "c".repeat(40),
    patchFile: `codex-${o.codexVersion}.patch`,
    patchSha256: "a".repeat(64),
    sourceCommit: "d".repeat(40),
    workflowUrl: "https://github.com/adrijshikhar/cxstatusline/actions/runs/123456789",
    createdAt: "2026-09-05T12:00:00Z",
    artifacts: [
      { platform, filename: archiveName, sha256: o.archiveSha ?? sha256(archive), size: archive.length, files },
    ],
  };
  return { manifest, archive, tag: releaseTag(o.codexVersion), archiveName };
}

export type Route = Buffer | number | { redirect: string };

/** A loopback stand-in for the GitHub release host. Nothing in the tests touches the network. */
export async function releaseServer(routes: Record<string, Route>): Promise<{
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

export function routesFor(f: ReleaseFixture): Record<string, Route> {
  return {
    [`/${f.tag}/manifest.json`]: Buffer.from(JSON.stringify(f.manifest)),
    [`/${f.tag}/${f.archiveName}`]: f.archive,
  };
}
