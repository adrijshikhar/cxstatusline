import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeSync } from "node:fs";
import { dirname } from "node:path";

export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** The pid recorded in the lock file, or null when the file is absent or unreadable. */
export function lockHolder(file: string): number | null {
  if (!existsSync(file)) return null;
  try {
    const pid = Number(readFileSync(file, "utf8").trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

/**
 * Exclusive pidfile lock. Returns a release function, or null if another live process holds it.
 * A lock left by a dead pid is stolen - a crashed build must not wedge every future session.
 */
export function acquireLock(file: string, isAlive: (pid: number) => boolean = pidAlive): (() => void) | null {
  mkdirSync(dirname(file), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(file, "wx");
      writeSync(fd, `${process.pid}\n`);
      closeSync(fd);
      return () => {
        // Why the holder check: if another process stole this lock as stale, unlinking here would
        // delete *their* lock and let a third process in while they are still building.
        if (lockHolder(file) !== process.pid) return;
        try {
          unlinkSync(file);
        } catch {
          /* already gone */
        }
      };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      const holder = lockHolder(file);
      if (holder !== null && isAlive(holder)) return null;
      try {
        unlinkSync(file); // stale (or unreadable): steal and retry once
      } catch {
        return null;
      }
    }
  }
  return null;
}
