import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { extractArchive } from "../src/distribution/archive";
import type { ArchiveEntry } from "../src/distribution";
import { tarStream, type TarEntry } from "./helpers";

function scratch(): { root: string; staging: string } {
  const root = mkdtempSync(join(tmpdir(), "cx package-archive-"));
  const staging = join(root, "staging");
  mkdirSync(staging);
  return { root, staging };
}

function archiveOf(entries: readonly TarEntry[], root: string): string {
  const file = join(root, "archive.tar.gz");
  writeFileSync(file, gzipSync(tarStream(entries)));
  return file;
}

/** The members of a real macOS package archive, in the order the builder packs them. */
function packageEntries(): TarEntry[] {
  return [
    { name: "LICENSE", mode: 0o644, data: "MIT" },
    { name: "NOTICE", mode: 0o644, data: "NOTICE TEXT" },
    { name: "THIRD_PARTY_NOTICES.md", mode: 0o644, data: "# Third party" },
    { name: "bin/codex", mode: 0o755, data: "CODEX-BINARY" },
    { name: "bin/codex-code-mode-host", mode: 0o755, data: "HOST-BINARY" },
    { name: "codex-package.json", mode: 0o644, data: '{"layoutVersion":1,"version":"0.157.0","target":"aarch64-apple-darwin","variant":"codex","entrypoint":"bin/codex","resourcesDir":"codex-resources","pathDir":"codex-path"}' },
    { name: "codex-path/rg", mode: 0o755, data: "RG-BINARY" },
    { name: "codex-resources/zsh/bin/zsh", mode: 0o755, data: "ZSH-BINARY" },
  ];
}

/** The manifest map for `entries`: exactly what `validateManifest` hands the installer. */
function filesFor(entries: readonly TarEntry[]): Record<string, ArchiveEntry> {
  return Object.fromEntries(entries.map((e) => {
    const data = Buffer.from(e.data as string);
    return [e.name, { sha256: createHash("sha256").update(data).digest("hex"), size: data.length }];
  }));
}

describe("extractArchive with a manifest file map", () => {
  test("extracts nested members into their directories with modes by path", async () => {
    const { root, staging } = scratch();
    const entries = packageEntries();
    await extractArchive(archiveOf(entries, root), staging, filesFor(entries));

    expect(readFileSync(join(staging, "bin", "codex"), "utf8")).toBe("CODEX-BINARY");
    expect(readFileSync(join(staging, "codex-resources", "zsh", "bin", "zsh"), "utf8")).toBe("ZSH-BINARY");
    expect(statSync(join(staging, "bin", "codex")).mode & 0o777).toBe(0o755);
    expect(statSync(join(staging, "codex-path", "rg")).mode & 0o777).toBe(0o755);
    expect(statSync(join(staging, "codex-package.json")).mode & 0o777).toBe(0o644);
    expect(statSync(join(staging, "LICENSE")).mode & 0o777).toBe(0o644);
  });

  const hostile: Array<{ name: string; entries: () => TarEntry[]; files?: (e: TarEntry[]) => Record<string, ArchiveEntry>; message: RegExp }> = [
    {
      name: "a member the manifest does not list",
      entries: () => [...packageEntries(), { name: "codex-resources/extra", mode: 0o755, data: "x" }],
      files: () => filesFor(packageEntries()),
      message: /not listed in the release manifest/,
    },
    {
      name: "a member whose size differs from the manifest",
      entries: () => packageEntries(),
      files: (e) => ({ ...filesFor(e), "bin/codex": { ...filesFor(e)["bin/codex"]!, size: 3 } }),
      message: /declares 12 bytes but the manifest records 3/,
    },
    {
      name: "a manifest member missing from the archive",
      entries: () => packageEntries().filter((e) => e.name !== "codex-path/rg"),
      files: () => filesFor(packageEntries()),
      message: /missing codex-path\/rg/,
    },
    {
      name: "a directory entry",
      entries: () => [{ name: "bin", type: "5", mode: 0o755 }, ...packageEntries()],
      files: () => filesFor(packageEntries()),
      message: /is a Directory, not a regular file/,
    },
    {
      name: "a symlink entry for a listed path",
      entries: () => [...packageEntries().filter((e) => e.name !== "codex-path/rg"), { name: "codex-path/rg", type: "2", mode: 0o777, linkname: "/usr/bin/rg" }],
      files: () => filesFor(packageEntries()),
      message: /is a SymbolicLink, not a regular file/,
    },
    {
      name: "a traversal path",
      entries: () => [...packageEntries(), { name: "bin/../../evil", mode: 0o644, data: "pwned" }],
      files: () => filesFor(packageEntries()),
      message: /not listed in the release manifest/,
    },
    {
      name: "an executable without its bit",
      entries: () => packageEntries().map((e) => (e.name === "bin/codex" ? { ...e, mode: 0o644 } : e)),
      message: /no executable mode bit/,
    },
    {
      name: "a legal text beyond the 16 MiB budget",
      entries: () => packageEntries().map((e) => (e.name === "NOTICE" ? { ...e, data: Buffer.alloc(17 * 1024 * 1024, 0x41) as unknown as string } : e)),
      files: (e) => {
        const files = filesFor(e.filter((x) => x.name !== "NOTICE"));
        return { ...files, NOTICE: { sha256: "0".repeat(64), size: 17 * 1024 * 1024 } };
      },
      message: /limit/,
    },
  ];
  for (const { name, entries, files, message } of hostile) {
    test(`rejects: ${name}`, async () => {
      const { root, staging } = scratch();
      const e = entries();
      await expect(extractArchive(archiveOf(e, root), staging, (files ?? filesFor)(e))).rejects.toThrow(message);
      expect(existsSync(join(root, "evil"))).toBe(false);
    });
  }

});
