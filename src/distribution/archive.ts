import { createReadStream, createWriteStream, type WriteStream } from "node:fs";
import { join } from "node:path";
import { createGunzip } from "node:zlib";
import { Parser, type ReadEntry } from "tar";
import type { ArtifactFile } from "../distribution";

/**
 * Parse-only tar handling: `tar.Parser` hands us type, name, size and mode of every entry *before*
 * a single byte is written, so nothing is created on disk until the entry has passed the allowlist.
 * `tar.x`/`extract` would write first and ask later, so it is never used here.
 */

/** Exactly what a release archive may contain - basenames only, regular files only. */
const EXECUTABLES = ["codex", "codex-code-mode-host"] as const;
const LEGAL_FILES = ["LICENSE", "NOTICE", "THIRD_PARTY_NOTICES.md"] as const;
const ALLOWED: readonly ArtifactFile[] = [...EXECUTABLES, ...LEGAL_FILES];

/** Untrusted archive metadata is only ever compared against these; it never sets them. */
export const EXTRACTED_TOTAL_LIMIT = 2 * 1024 * 1024 * 1024;
export const LEGAL_TOTAL_LIMIT = 16 * 1024 * 1024;

const EXECUTABLE_MODE = 0o755;
const LEGAL_MODE = 0o644;

function isExecutable(name: string): boolean {
  return (EXECUTABLES as readonly string[]).includes(name);
}

/** Archive-controlled text must never reach a message unbounded or with control characters. */
function quoteName(name: string): string {
  return JSON.stringify(name.replace(/[\u0000-\u001f\u007f]/g, "?").slice(0, 120));
}

function toError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}

/** Running totals that the untrusted header sizes are charged against. */
interface Budget {
  total: number;
  legal: number;
}

/**
 * Everything decided from the header alone. Returns the reason to reject, or null to accept.
 * Sizes here are *declared* - the write below still refuses an entry whose body does not match.
 */
function rejectionReason(entry: ReadEntry, seen: Set<string>, budget: Budget): string | null {
  const name = entry.path;
  if (entry.type !== "File") {
    return `archive entry ${quoteName(name)} is a ${entry.type}, not a regular file`;
  }
  // `entry.path` only normalises Windows separators, so the header name is compared verbatim:
  // "../evil", "/etc/passwd", "bin/codex" and "./" all fail this membership test.
  if (!(ALLOWED as readonly string[]).includes(name) || entry.header.path !== name) {
    return `archive entry ${quoteName(name)} is not one of the five expected files`;
  }
  if (seen.has(name)) return `archive contains ${quoteName(name)} more than once`;
  if (entry.linkpath) return `archive entry ${quoteName(name)} carries a link target`;

  const size = entry.size;
  if (!Number.isSafeInteger(size) || size < 0) return `archive entry ${quoteName(name)} declares an unusable size`;
  const executable = isExecutable(name);
  if (executable && size === 0) return `archive entry ${quoteName(name)} is an empty executable`;
  const mode = entry.mode ?? entry.header.mode ?? 0;
  if (executable && (mode & 0o111) === 0) return `archive entry ${quoteName(name)} has no executable mode bit`;

  if (budget.total + size > EXTRACTED_TOTAL_LIMIT) {
    return `archive entry ${quoteName(name)} exceeds the ${EXTRACTED_TOTAL_LIMIT}-byte extraction limit`;
  }
  if (!executable && budget.legal + size > LEGAL_TOTAL_LIMIT) {
    return `archive entry ${quoteName(name)} exceeds the ${LEGAL_TOTAL_LIMIT}-byte legal-text limit`;
  }
  budget.total += size;
  if (!executable) budget.legal += size;
  return null;
}

/** One accepted entry being streamed to disk, with the handle needed to tear it down on failure. */
interface Write {
  readonly done: Promise<void>;
  abort(cause: Error): void;
}

function writeEntry(entry: ReadEntry, staging: string): Write {
  const name = entry.path;
  const mode = isExecutable(name) ? EXECUTABLE_MODE : LEGAL_MODE;
  // "wx": a name is only ever written once, so a duplicate slipping past the check still cannot
  // overwrite bytes that were already verified.
  const sink: WriteStream = createWriteStream(join(staging, name), { mode, flags: "wx" });
  const done = new Promise<void>((resolve, reject) => {
    sink.on("error", reject);
    entry.on("error", reject);
    sink.on("finish", () => {
      if (sink.bytesWritten !== entry.size) {
        reject(new Error(`archive entry ${quoteName(name)} ended after ${sink.bytesWritten} of ${entry.size} bytes`));
        return;
      }
      resolve();
    });
    entry.pipe(sink);
  });
  return {
    done,
    abort: (cause) => {
      entry.destroy();
      sink.destroy(cause);
    },
  };
}

/** Drive the gunzip -> parse pipeline, accepting or rejecting each entry from its header alone. */
function parseArchive(archivePath: string, staging: string, writes: Write[]): Promise<void> {
  const seen = new Set<string>();
  const budget: Budget = { total: 0, legal: 0 };
  return new Promise<void>((resolve, reject) => {
    const source = createReadStream(archivePath);
    const gunzip = createGunzip();
    let settled = false;
    const fail = (cause: unknown): void => {
      if (settled) return;
      settled = true;
      const error = toError(cause);
      source.destroy();
      gunzip.destroy();
      for (const write of writes) write.abort(error);
      reject(error);
    };
    // strict: node-tar warnings (bad checksum, truncated archive, unknown header) become errors.
    const parser = new Parser({ strict: true });
    parser.on("entry", (entry: ReadEntry) => {
      if (settled) {
        entry.resume();
        return;
      }
      const reason = rejectionReason(entry, seen, budget);
      if (reason !== null) {
        fail(new Error(reason));
        entry.resume();
        return;
      }
      seen.add(entry.path);
      writes.push(writeEntry(entry, staging));
    });
    parser.on("error", fail);
    gunzip.on("error", fail);
    source.on("error", fail);
    parser.on("end", () => {
      if (settled) return;
      settled = true;
      const missing = ALLOWED.filter((name) => !seen.has(name));
      if (missing.length > 0) {
        reject(new Error(`archive is missing ${missing.join(", ")}`));
        return;
      }
      resolve();
    });
    source.pipe(gunzip).pipe(parser as unknown as NodeJS.WritableStream);
  });
}

/**
 * Gunzip `archivePath` with node:zlib, validate every tar entry against the five-file allowlist,
 * and write the accepted files into `staging`. Rejects on the first violation; the caller owns
 * removing `staging` afterwards.
 */
export async function extractArchive(archivePath: string, staging: string): Promise<void> {
  const writes: Write[] = [];
  try {
    await parseArchive(archivePath, staging, writes);
  } catch (e) {
    await Promise.allSettled(writes.map((w) => w.done));
    throw e;
  }
  await Promise.all(writes.map((w) => w.done));
}
