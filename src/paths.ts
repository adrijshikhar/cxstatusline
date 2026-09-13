import { join } from "node:path";
import type { Env } from "./env";

/** Every on-disk location cxstatusline reads or writes. Nothing else may hardcode a path. */
export interface Paths {
  readonly home: string;
  readonly configDir: string;
  readonly settingsFile: string;
  readonly stateDir: string;
  readonly stateFile: string;
  readonly stateBackupFile: string;
  readonly lockFile: string;
  readonly patchLog: string;
  readonly shareDir: string;
  readonly sourceDir: string;
  readonly libexecDir: string;
  /** One immutable directory per installed pair. Never reused, never rewritten. */
  readonly generationsDir: string;
  /** The symlink that decides which generation a fresh `codex` runs. Renamed, never edited. */
  readonly currentGeneration: string;
  /** Legacy flat layout, kept so `revert` can still clean up installs made before generations. */
  readonly patchedBin: string;
  readonly patchedCodeModeHost: string;
  readonly binDir: string;
  readonly wrapperPath: string;
  readonly rendererLink: string;
  readonly codexHome: string;
  readonly hooksFile: string;
  readonly commandCacheDir: string;
}

export function resolvePaths(env: Env): Paths {
  const home = env.HOME;
  if (!home) throw new Error("HOME is not set; cannot resolve cxstatusline paths");
  const configDir = join(env.XDG_CONFIG_HOME ?? join(home, ".config"), "cxstatusline");
  const commandCacheDir = join(env.XDG_CACHE_HOME ?? join(home, ".cache"), "cxstatusline", "commands");
  const stateDir = join(env.XDG_STATE_HOME ?? join(home, ".local", "state"), "cxstatusline");
  const shareDir = join(env.XDG_DATA_HOME ?? join(home, ".local", "share"), "cxstatusline");
  const libexecDir = join(home, ".local", "libexec", "cxstatusline");
  const binDir = join(home, ".local", "bin");
  const codexHome = env.CODEX_HOME ?? join(home, ".codex");
  return {
    home,
    configDir,
    commandCacheDir,
    settingsFile: join(configDir, "settings.json"),
    stateDir,
    stateFile: join(stateDir, "state.json"),
    stateBackupFile: join(stateDir, "state.json.bak"),
    lockFile: join(stateDir, "patch.lock"),
    patchLog: join(stateDir, "patch.log"),
    shareDir,
    sourceDir: join(shareDir, "codex"),
    libexecDir,
    // Deliberately siblings: `rename(2)` of the pointer is only atomic within one filesystem.
    generationsDir: join(libexecDir, "generations"),
    currentGeneration: join(libexecDir, "current"),
    patchedBin: join(libexecDir, "codex"),
    patchedCodeModeHost: join(libexecDir, "codex-code-mode-host"),
    binDir,
    wrapperPath: join(binDir, "codex"),
    rendererLink: join(binDir, "cxstatusline"),
    codexHome,
    hooksFile: join(codexHome, "hooks.json"),
  };
}

