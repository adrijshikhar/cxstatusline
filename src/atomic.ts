import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";

/** Write `text` to `file` atomically: temp sibling + rename. Creates parent dirs. */
export function writeFileAtomic(file: string, text: string): void {
  mkdirSync(dirname(file), { recursive: true });
  // Why randomBytes and not pid+Date.now(): settings, state, the state backup and hooks.json all
  // use this helper, and two writes in the same millisecond in the same process would collide.
  const tmp = join(dirname(file), `.${process.pid}.${randomBytes(4).toString("hex")}.tmp`);
  writeFileSync(tmp, text);
  renameSync(tmp, file);
}
