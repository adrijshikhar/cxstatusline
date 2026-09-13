import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";

export interface WriteFileAtomicOptions {
  readonly mode?: number;
}

/** Write `text` to `file` atomically: temp sibling + rename. Creates parent dirs. */
export function writeFileAtomic(file: string, text: string, options?: WriteFileAtomicOptions): void {
  mkdirSync(dirname(file), { recursive: true });
  // Why randomBytes and not pid+Date.now(): settings, state, the state backup and hooks.json all
  // use this helper, and two writes in the same millisecond in the same process would collide.
  const tmp = join(dirname(file), `.${process.pid}.${randomBytes(4).toString("hex")}.tmp`);
  if (options?.mode !== undefined) {
    writeFileSync(tmp, text, { mode: options.mode });
  } else {
    writeFileSync(tmp, text);
  }
  renameSync(tmp, file);
}

