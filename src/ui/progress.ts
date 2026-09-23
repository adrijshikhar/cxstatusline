import chalk from "chalk";
import { symbols } from "./box";
import type { TransportOptions } from "../distribution/transport";

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${(ms / 1000).toFixed(1)}s`;
  const min = Math.floor(sec / 60);
  const remSec = sec % 60;
  return `${min}m ${remSec}s`;
}

export function renderProgressBar(ratio: number, width = 24): string {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0));
  const filled = Math.round(clamped * width);
  const empty = Math.max(0, width - filled);
  return `[${chalk.cyan("█".repeat(filled))}${chalk.dim("░".repeat(empty))}]`;
}

export interface ProgressIO {
  readonly isTTY?: boolean;
  write(text: string): void;
  say(line: string): void;
}

export interface InstallProgressTracker {
  readonly transport: TransportOptions;
  finish(success?: boolean): void;
}

/**
 * Creates an interactive progress reporter for both prebuilt downloads and source compilations.
 * In a TTY environment, it updates progress bars in-place using `\r`. In a non-interactive stream,
 * it emits clean, unspammed milestone lines.
 */
export function createInstallProgressTracker(
  io: ProgressIO,
  baseTransport: TransportOptions = {},
): InstallProgressTracker {
  const isTTY = io.isTTY ?? (typeof process !== "undefined" && Boolean(process.stdout?.isTTY));
  let downloadStart = 0;
  let initialLoaded = 0;
  let lastDownloadUpdate = 0;
  let hasProgressBar = false;
  let lastReportedPct = -1;
  let cursorHidden = false;
  let stdinConfigured = false;

  const hideCursor = () => {
    if (isTTY && !cursorHidden) {
      io.write("\x1b[?25l");
      cursorHidden = true;
    }
  };

  const showCursor = () => {
    if (isTTY && cursorHidden) {
      io.write("\x1b[?25h");
      cursorHidden = false;
    }
  };

  const handleStdinData = (data: Buffer | string) => {
    const str = typeof data === "string" ? data : data.toString("utf8");
    if (str === "\u0003") {
      cleanupStdin();
      showCursor();
      if (typeof process !== "undefined" && typeof process.kill === "function") {
        process.kill(process.pid, "SIGINT");
      }
    }
  };

  const setupStdin = () => {
    if (!isTTY || stdinConfigured) return;
    if (typeof process !== "undefined" && process.stdin?.isTTY && typeof process.stdin.setRawMode === "function") {
      try {
        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.on("data", handleStdinData);
        stdinConfigured = true;
      } catch {
        // Ignored if terminal does not support raw mode
      }
    }
  };

  const cleanupStdin = () => {
    if (!stdinConfigured) return;
    stdinConfigured = false;
    if (typeof process !== "undefined" && process.stdin) {
      try {
        process.stdin.removeListener("data", handleStdinData);
        if (typeof process.stdin.setRawMode === "function") {
          process.stdin.setRawMode(false);
        }
        process.stdin.pause();
      } catch {}
    }
  };

  const onExit = () => {
    cleanupStdin();
    if (cursorHidden) {
      try {
        io.write("\x1b[?25h");
      } catch {}
      cursorHidden = false;
    }
  };

  const proc = typeof process !== "undefined" ? (process as unknown as NodeJS.EventEmitter) : null;

  if (proc?.once && isTTY) {
    proc.once("exit", onExit);
    proc.once("SIGINT", onExit);
    proc.once("SIGTERM", onExit);
  }

  const clearProgressLine = () => {
    if (hasProgressBar && isTTY) {
      io.write("\r\x1b[2K");
      hasProgressBar = false;
    }
  };

  const onProgress = (loaded: number, total: number | null) => {
    hideCursor();
    setupStdin();
    const now = Date.now();
    if (!downloadStart) {
      downloadStart = now;
      initialLoaded = loaded;
    }

    // Throttle TTY updates to ~50ms
    if (isTTY && now - lastDownloadUpdate < 50 && total !== null && loaded < total) {
      return;
    }
    lastDownloadUpdate = now;

    const elapsedSec = Math.max(0.001, (now - downloadStart) / 1000);
    const transferred = Math.max(0, loaded - initialLoaded);
    const speed = transferred / elapsedSec;
    const speedStr = `${formatBytes(speed)}/s`;

    if (total !== null && total > 0) {
      const ratio = Math.min(1, loaded / total);
      const pct = Math.floor(ratio * 100);

      if (isTTY) {
        const bar = renderProgressBar(ratio, 24);
        const loadedStr = formatBytes(loaded);
        const totalStr = formatBytes(total);
        const text = `\r\x1b[2K    ${bar} ${chalk.bold(String(pct).padStart(3))}%  ${loadedStr} / ${totalStr} (${chalk.dim(speedStr)})`;
        io.write(text);
        hasProgressBar = true;
      } else {
        // In non-TTY mode, log at 25%, 50%, 75%, 100%
        const milestone = Math.floor(pct / 25) * 25;
        if (milestone > lastReportedPct && milestone > 0) {
          lastReportedPct = milestone;
          io.say(`    ${symbols.dimBullet} Downloaded ${milestone}% (${formatBytes(loaded)} / ${formatBytes(total)})`);
        }
      }
    } else {
      if (isTTY) {
        io.write(`\r\x1b[2K    ${symbols.activeBullet} ${formatBytes(loaded)} downloaded (${chalk.dim(speedStr)})`);
        hasProgressBar = true;
      }
    }
  };

  const onStatus = (phase: string, message: string) => {
    clearProgressLine();

    switch (phase) {
      case "manifest":
        io.say(`\n  ${symbols.pointer} ${chalk.bold("Release Metadata")}`);
        io.say(`    ${symbols.dimBullet} ${chalk.dim(message)}`);
        break;
      case "manifest-done":
        io.say(`    ${symbols.ok} ${chalk.white(message)}`);
        break;
      case "download":
        io.say(`\n  ${symbols.pointer} ${chalk.bold("Downloading Prebuilt Archive")}`);
        downloadStart = 0;
        initialLoaded = 0;
        lastDownloadUpdate = 0;
        lastReportedPct = -1;
        break;
      case "download-done":
        clearProgressLine();
        const duration = downloadStart ? ` in ${formatDurationMs(Date.now() - downloadStart)}` : "";
        io.say(`    ${symbols.ok} ${chalk.white(message)}${chalk.dim(duration)}`);
        break;
      case "extract":
        io.say(`\n  ${symbols.pointer} ${chalk.bold("Verification & Staging")}`);
        io.say(`    ${symbols.dimBullet} ${chalk.dim(message)}`);
        break;
      case "extract-done":
        io.say(`    ${symbols.ok} ${chalk.white(message)}`);
        break;
      case "checkout":
        io.say(`\n  ${symbols.pointer} ${chalk.bold("Upstream Source")}`);
        io.say(`    ${symbols.dimBullet} ${chalk.dim(message)}`);
        break;
      case "checkout-done":
        io.say(`    ${symbols.ok} ${chalk.white(message)}`);
        break;
      case "patch":
        io.say(`\n  ${symbols.pointer} ${chalk.bold("Statusline Patch")}`);
        io.say(`    ${symbols.dimBullet} ${chalk.dim(message)}`);
        break;
      case "patch-done":
        io.say(`    ${symbols.ok} ${chalk.white(message)}`);
        break;
      case "build":
        io.say(`\n  ${symbols.pointer} ${chalk.bold("Compiling Release Binaries")}`);
        io.say(`    ${symbols.dimBullet} ${chalk.dim(message)}`);
        break;
      case "build-done":
        io.say(`    ${symbols.ok} ${chalk.white(message)}`);
        break;
      case "test":
        io.say(`\n  ${symbols.pointer} ${chalk.bold("Regression Tests")}`);
        io.say(`    ${symbols.dimBullet} ${chalk.dim(message)}`);
        break;
      case "test-done":
        io.say(`    ${symbols.ok} ${chalk.white(message)}`);
        break;
      case "stage":
        io.say(`\n  ${symbols.pointer} ${chalk.bold("Staging & Activation")}`);
        io.say(`    ${symbols.ok} ${chalk.white(message)}`);
        break;
      default:
        io.say(`    ${symbols.info} ${message}`);
        break;
    }
  };

  const transport: TransportOptions = {
    ...baseTransport,
    onProgress: (loaded, total) => {
      onProgress(loaded, total);
      baseTransport.onProgress?.(loaded, total);
    },
    onStatus: (phase, msg) => {
      onStatus(phase, msg);
      baseTransport.onStatus?.(phase, msg);
    },
  };

  return {
    transport,
    finish: () => {
      if (proc?.removeListener) {
        proc.removeListener("exit", onExit);
        proc.removeListener("SIGINT", onExit);
        proc.removeListener("SIGTERM", onExit);
      }
      cleanupStdin();
      clearProgressLine();
      showCursor();
    },
  };
}
