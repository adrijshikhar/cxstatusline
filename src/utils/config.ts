import { lstat, mkdir, readFile, readlink, realpath, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { CURRENT_VERSION, DEFAULT_SETTINGS, SettingsSchema, type Settings } from "../types/Settings";

interface AtomicWriteTarget {
  targetPath: string;
  tempDir: string;
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : undefined;
}

async function resolveSymlinkTarget(linkPath: string): Promise<string> {
  try {
    return await realpath(linkPath);
  } catch (error) {
    if (errorCode(error) !== "ENOENT") throw error;
    return resolve(dirname(linkPath), await readlink(linkPath));
  }
}

async function resolveAtomicWriteTarget(file: string): Promise<AtomicWriteTarget> {
  try {
    if (!(await lstat(file)).isSymbolicLink()) {
      return { targetPath: file, tempDir: dirname(file) };
    }
    const targetPath = await resolveSymlinkTarget(file);
    return { targetPath, tempDir: dirname(targetPath) };
  } catch (error) {
    if (errorCode(error) === "ENOENT") return { targetPath: file, tempDir: dirname(file) };
    throw error;
  }
}

async function writeSettingsJson(file: string, settings: Settings): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const target = await resolveAtomicWriteTarget(file);
  await mkdir(target.tempDir, { recursive: true });
  const tempPath = resolve(target.tempDir, `${basename(target.targetPath)}.${process.pid}.${Date.now()}.tmp`);
  try {
    await writeFile(tempPath, JSON.stringify(settings, null, 2), "utf8");
    await rename(tempPath, target.targetPath);
  } catch (error) {
    await unlink(tempPath).catch(() => undefined);
    throw error;
  }
}

export async function loadSettings(file: string): Promise<{ settings: Settings; error: string | null }> {
  let content: string;
  try {
    content = await readFile(file, "utf8");
  } catch (error) {
    if (errorCode(error) !== "ENOENT") {
      return { settings: DEFAULT_SETTINGS, error: "settings.json could not be read" };
    }
    try {
      await writeSettingsJson(file, DEFAULT_SETTINGS);
      return { settings: DEFAULT_SETTINGS, error: null };
    } catch {
      return { settings: DEFAULT_SETTINGS, error: "settings.json could not be written" };
    }
  }

  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    return { settings: DEFAULT_SETTINGS, error: "settings.json is not valid JSON" };
  }

  const parsed = SettingsSchema.safeParse(raw);
  return parsed.success
    ? { settings: parsed.data, error: null }
    : { settings: DEFAULT_SETTINGS, error: "settings.json is not in a valid format" };
}

export async function saveSettings(file: string, settings: Settings): Promise<void> {
  await writeSettingsJson(file, { ...settings, version: CURRENT_VERSION });
}
