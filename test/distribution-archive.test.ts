import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { gzipSync } from "node:zlib";
import { extractArchive } from "../src/distribution/archive";
import { tarStream, type TarEntry } from "./helpers";

/** A throwaway root whose name contains a space; staging lives inside it. */
function scratch(): { root: string; staging: string } {
  const root = mkdtempSync(join(tmpdir(), "cx archive-"));
  const staging = join(root, "staging");
  mkdirSync(staging);
  return { root, staging };
}

function archiveOf(entries: readonly TarEntry[], root: string, compress = true): string {
  const raw = tarStream(entries);
  const file = join(root, "archive.tar.gz");
  writeFileSync(file, compress ? gzipSync(raw) : raw);
  return file;
}

function validEntries(): TarEntry[] {
  return [
    { name: "codex", mode: 0o755, data: "CODEX-BINARY" },
    { name: "codex-code-mode-host", mode: 0o755, data: "HOST-BINARY" },
    { name: "LICENSE", mode: 0o644, data: "MIT" },
    { name: "NOTICE", mode: 0o644, data: "NOTICE TEXT" },
    { name: "THIRD_PARTY_NOTICES.md", mode: 0o644, data: "# Third party" },
  ];
}

test("extracts exactly the five allowed entries with sane modes", async () => {
  const { root, staging } = scratch();
  await extractArchive(archiveOf(validEntries(), root), staging);

  expect(readdirSync(staging).sort()).toEqual([
    "LICENSE",
    "NOTICE",
    "THIRD_PARTY_NOTICES.md",
    "codex",
    "codex-code-mode-host",
  ]);
  expect(readFileSync(join(staging, "codex"), "utf8")).toBe("CODEX-BINARY");
  expect(readFileSync(join(staging, "THIRD_PARTY_NOTICES.md"), "utf8")).toBe("# Third party");
  expect(statSync(join(staging, "codex")).mode & 0o111).not.toBe(0);
  expect(statSync(join(staging, "codex-code-mode-host")).mode & 0o111).not.toBe(0);
  for (const legal of ["LICENSE", "NOTICE", "THIRD_PARTY_NOTICES.md"]) {
    expect(statSync(join(staging, legal)).mode & 0o111).toBe(0);
  }
});

const GIB = 1024 * 1024 * 1024;

const hostile: Array<{ name: string; entries: () => TarEntry[]; escapes?: string }> = [
  {
    name: "path traversal out of the staging directory",
    entries: () => [...validEntries(), { name: "../evil", mode: 0o644, data: "pwned" }],
    escapes: "evil",
  },
  {
    name: "absolute path",
    entries: () => [...validEntries(), { name: "/tmp/cx-absolute-evil", mode: 0o644, data: "pwned" }],
  },
  {
    name: "nested path instead of a basename",
    entries: () => [...validEntries(), { name: "bin/codex", mode: 0o755, data: "x" }],
  },
  {
    name: "leading ./ directory entry",
    entries: () => [{ name: "./", type: "5", mode: 0o755 }, ...validEntries()],
  },
  {
    name: "symlink entry",
    entries: () => [
      ...validEntries().filter((e) => e.name !== "LICENSE"),
      { name: "LICENSE", type: "2", mode: 0o777, linkname: "/etc/passwd" },
    ],
  },
  {
    name: "hardlink entry",
    entries: () => [
      ...validEntries().filter((e) => e.name !== "NOTICE"),
      { name: "NOTICE", type: "1", mode: 0o644, linkname: "codex" },
    ],
  },
  {
    name: "character device entry",
    entries: () => [...validEntries(), { name: "codex-dev", type: "3", mode: 0o666 }],
  },
  {
    name: "directory entry",
    entries: () => [...validEntries(), { name: "extras", type: "5", mode: 0o755 }],
  },
  {
    name: "duplicate allowed name",
    entries: () => [...validEntries(), { name: "codex", mode: 0o755, data: "SECOND" }],
  },
  {
    name: "missing codex-code-mode-host",
    entries: () => validEntries().filter((e) => e.name !== "codex-code-mode-host"),
  },
  {
    name: "missing legal file",
    entries: () => validEntries().filter((e) => e.name !== "NOTICE"),
  },
  {
    name: "extra unexpected file",
    entries: () => [...validEntries(), { name: "README.md", mode: 0o644, data: "hi" }],
  },
  {
    name: "empty executable",
    entries: () => [{ name: "codex", mode: 0o755, data: "" }, ...validEntries().slice(1)],
  },
  {
    name: "executable without an executable mode bit",
    entries: () => [{ name: "codex", mode: 0o644, data: "CODEX-BINARY" }, ...validEntries().slice(1)],
  },
  {
    name: "sparse entry type",
    entries: () => [{ name: "codex", type: "S", mode: 0o755, data: "CODEX-BINARY" }, ...validEntries().slice(1)],
  },
  {
    name: "declared size beyond the extracted-total limit",
    entries: () => [{ name: "codex", mode: 0o755, data: "CODEX-BINARY", size: 3 * GIB }],
  },
  {
    name: "declared size larger than the body (truncated entry)",
    entries: () => [{ name: "codex", mode: 0o755, data: "CODEX-BINARY", size: 4096 }, ...validEntries().slice(1)],
  },
];

for (const { name, entries, escapes } of hostile) {
  test(`rejects hostile archive: ${name}`, async () => {
    const { root, staging } = scratch();
    await expect(extractArchive(archiveOf(entries(), root), staging)).rejects.toThrow();
    if (escapes) expect(existsSync(join(dirname(staging), escapes))).toBe(false);
    expect(existsSync("/tmp/cx-absolute-evil")).toBe(false);
  });
}

test("rejects a legal text beyond the 16 MiB legal-file budget", async () => {
  const { root, staging } = scratch();
  const entries = validEntries().map((e) =>
    e.name === "NOTICE" ? { ...e, data: Buffer.alloc(17 * 1024 * 1024, 0x41) } : e,
  );
  await expect(extractArchive(archiveOf(entries, root), staging)).rejects.toThrow(/limit|budget|large/i);
});

test("rejects malformed compression", async () => {
  const { root, staging } = scratch();
  const file = join(root, "archive.tar.gz");
  writeFileSync(file, Buffer.from("this is not gzip data at all"));
  await expect(extractArchive(file, staging)).rejects.toThrow();
});

test("rejects a truncated archive", async () => {
  const { root, staging } = scratch();
  const raw = tarStream(validEntries()).subarray(0, 900);
  const file = join(root, "archive.tar.gz");
  writeFileSync(file, gzipSync(raw));
  await expect(extractArchive(file, staging)).rejects.toThrow();
});
