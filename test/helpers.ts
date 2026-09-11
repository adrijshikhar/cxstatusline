import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Env, RunResult, Runner } from "../src/env";

/**
 * A throwaway HOME. `prefix` exists so activation tests can demand a directory whose name
 * contains a space - the wrapper script and every staged path must survive it.
 */
export function tmpEnv(prefix = "cxstatusline-test-"): { env: Env; root: string } {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const env: Env = {
    HOME: root,
    XDG_CONFIG_HOME: join(root, ".config"),
    XDG_STATE_HOME: join(root, ".local", "state"),
    XDG_DATA_HOME: join(root, ".local", "share"),
    CODEX_HOME: join(root, ".codex"),
    PATH: join(root, "usr-bin"),
  };
  return { env, root };
}

/**
 * One recorded `Runner` invocation.
 * Why `| undefined` on `opts`: `exactOptionalPropertyTypes: true` rejects assigning the optional
 * parameter (`{...} | undefined`) to a plain `opts?: {...}` property (TS2379).
 */
export interface RecordedCall {
  cmd: string;
  args: readonly string[];
  opts?: { cwd?: string; interactive?: boolean; timeoutMs?: number; env?: NodeJS.ProcessEnv } | undefined;
}

/** A Runner that replays canned results and records every call, including its options. */
export function fakeExec(
  script: (cmd: string, args: readonly string[]) => Partial<RunResult> | undefined,
): { run: Runner; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const run: Runner = (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    const r = script(cmd, args) ?? {};
    return { status: r.status ?? 0, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
  };
  return { run, calls };
}

/**
 * One entry in a hand-built tar stream. `type` is the raw POSIX typeflag so tests can produce
 * links, devices and metadata entries that no ordinary packer would emit.
 */
export interface TarEntry {
  readonly name: string;
  /** POSIX typeflag: "0" file, "1" hardlink, "2" symlink, "3" chardev, "5" dir, "x" pax, "S" sparse. */
  readonly type?: string;
  readonly mode?: number;
  readonly data?: Buffer | string;
  readonly linkname?: string;
  /** Declared size, when it must differ from `data.length` (truncation / oversize fixtures). */
  readonly size?: number;
}

function octalField(value: number, width: number): string {
  return `${value.toString(8).padStart(width - 1, "0").slice(-(width - 1))}\0`;
}

function tarHeader(entry: TarEntry, size: number): Buffer {
  const header = Buffer.alloc(512);
  header.write(entry.name, 0, 100, "utf8");
  header.write(octalField(entry.mode ?? 0o644, 8), 100, "utf8");
  header.write(octalField(0, 8), 108, "utf8");
  header.write(octalField(0, 8), 116, "utf8");
  header.write(octalField(size, 12), 124, "utf8");
  header.write(octalField(0, 12), 136, "utf8");
  header.write("        ", 148, "utf8"); // checksum placeholder: eight spaces
  header.write(entry.type ?? "0", 156, "utf8");
  if (entry.linkname) header.write(entry.linkname, 157, 100, "utf8");
  header.write("ustar\0", 257, "utf8");
  header.write("00", 263, "utf8");
  let sum = 0;
  for (const byte of header) sum += byte;
  header.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, "utf8");
  return header;
}

/** A raw (uncompressed) tar stream built from `entries`, including the two-block end marker. */
export function tarStream(entries: readonly TarEntry[]): Buffer {
  const blocks: Buffer[] = [];
  for (const entry of entries) {
    const data = typeof entry.data === "string" ? Buffer.from(entry.data) : (entry.data ?? Buffer.alloc(0));
    blocks.push(tarHeader(entry, entry.size ?? data.length));
    if (data.length > 0) {
      const padded = Buffer.alloc(Math.ceil(data.length / 512) * 512);
      data.copy(padded);
      blocks.push(padded);
    }
  }
  blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
}
