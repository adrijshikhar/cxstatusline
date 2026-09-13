import { CURRENT_VERSION } from "../types/Settings";

export interface MigrationResult {
  settings: unknown;
  migrated: boolean;
  unknownVersion: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function migrateSettings(raw: unknown): MigrationResult {
  try {
    if (!isRecord(raw) || typeof raw.version !== "number" || !Number.isFinite(raw.version)) {
      return { settings: raw, migrated: false, unknownVersion: false };
    }

    const version = raw.version;
    if (version > CURRENT_VERSION) {
      return { settings: raw, migrated: false, unknownVersion: true };
    }

    if (version === CURRENT_VERSION) {
      return { settings: raw, migrated: false, unknownVersion: false };
    }

    if (version === 2) {
      const migrated = JSON.parse(JSON.stringify(raw)) as Record<string, unknown>;
      migrated.version = 3;

      if (Array.isArray(migrated.lines)) {
        for (const line of migrated.lines) {
          if (Array.isArray(line)) {
            for (const item of line) {
              if (isRecord(item)) {
                delete item.hide;

                if (isRecord(item.metadata)) {
                  const meta = item.metadata;
                  const hideStates = new Set<string>();

                  if (typeof meta.hide === "string") {
                    for (const part of meta.hide.split(",")) {
                      const trimmed = part.trim();
                      if (trimmed) hideStates.add(trimmed);
                    }
                  }

                  if (meta.hideNoGit === "true") {
                    hideStates.add("no-git");
                  }
                  if (meta.hideWhenEmpty === "true") {
                    hideStates.add("zero");
                  }

                  delete meta.hideNoGit;
                  delete meta.hideWhenEmpty;

                  if (hideStates.size > 0) {
                    const order = ["no-git", "zero"];
                    const sorted = Array.from(hideStates).sort((a, b) => {
                      const ia = order.indexOf(a);
                      const ib = order.indexOf(b);
                      if (ia !== -1 && ib !== -1) return ia - ib;
                      if (ia !== -1) return -1;
                      if (ib !== -1) return 1;
                      return a.localeCompare(b);
                    });
                    meta.hide = sorted.join(",");
                  } else {
                    delete meta.hide;
                  }

                  if (Object.keys(meta).length === 0) {
                    delete item.metadata;
                  }
                }
              }
            }
          }
        }
      }

      return { settings: migrated, migrated: true, unknownVersion: false };
    }

    return { settings: raw, migrated: false, unknownVersion: false };
  } catch {
    return { settings: raw, migrated: false, unknownVersion: false };
  }
}
