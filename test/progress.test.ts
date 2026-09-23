import { describe, expect, test } from "bun:test";
import {
  formatBytes,
  formatDurationMs,
  renderProgressBar,
  createInstallProgressTracker,
} from "../src/ui/progress";

describe("formatBytes", () => {
  test("formats byte boundaries accurately", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(-10)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
    expect(formatBytes(1024 * 1024 * 85.5)).toBe("85.5 MB");
    expect(formatBytes(1024 * 1024 * 1024 * 2.5)).toBe("2.50 GB");
  });
});

describe("formatDurationMs", () => {
  test("formats milliseconds, seconds, and minutes", () => {
    expect(formatDurationMs(350)).toBe("350ms");
    expect(formatDurationMs(2400)).toBe("2.4s");
    expect(formatDurationMs(65000)).toBe("1m 5s");
    expect(formatDurationMs(125000)).toBe("2m 5s");
  });
});

describe("renderProgressBar", () => {
  test("renders empty, partial, and full progress bars", () => {
    const empty = renderProgressBar(0, 10);
    expect(empty).toContain("░".repeat(10));

    const half = renderProgressBar(0.5, 10);
    expect(half).toContain("█".repeat(5));
    expect(half).toContain("░".repeat(5));

    const full = renderProgressBar(1, 10);
    expect(full).toContain("█".repeat(10));

    const clampedOver = renderProgressBar(1.5, 10);
    expect(clampedOver).toContain("█".repeat(10));

    const clampedUnder = renderProgressBar(-0.2, 10);
    expect(clampedUnder).toContain("░".repeat(10));
  });
});

describe("createInstallProgressTracker", () => {
  test("reports status transitions cleanly", () => {
    const lines: string[] = [];
    const written: string[] = [];
    const tracker = createInstallProgressTracker({
      isTTY: false,
      write: (s) => written.push(s),
      say: (l) => lines.push(l),
    });

    tracker.transport.onStatus?.("manifest", "Checking release tag...");
    tracker.transport.onStatus?.("manifest-done", "Release found for darwin-arm64");
    tracker.transport.onStatus?.("download", "Downloading archive...");
    tracker.transport.onStatus?.("download-done", "Downloaded archive");
    tracker.transport.onStatus?.("extract", "Extracting binaries...");
    tracker.transport.onStatus?.("extract-done", "Verified binaries");
    tracker.finish();

    const output = lines.join("\n");
    expect(output).toContain("Release Metadata");
    expect(output).toContain("Release found for darwin-arm64");
    expect(output).toContain("Downloading Prebuilt Archive");
    expect(output).toContain("Verification & Staging");
    expect(output).toContain("Verified binaries");
  });

  test("reports download progress milestones in non-TTY mode", () => {
    const lines: string[] = [];
    const tracker = createInstallProgressTracker({
      isTTY: false,
      write: () => {},
      say: (l) => lines.push(l),
    });

    const total = 100 * 1024 * 1024;
    tracker.transport.onProgress?.(10 * 1024 * 1024, total);
    tracker.transport.onProgress?.(25 * 1024 * 1024, total);
    tracker.transport.onProgress?.(50 * 1024 * 1024, total);
    tracker.transport.onProgress?.(80 * 1024 * 1024, total);
    tracker.transport.onProgress?.(100 * 1024 * 1024, total);
    tracker.finish();

    const output = lines.join("\n");
    expect(output).toContain("25%");
    expect(output).toContain("50%");
    expect(output).toContain("75%");
    expect(output).toContain("100%");
  });

  test("writes carriage-return progress and manages cursor in TTY mode", () => {
    const writes: string[] = [];
    const tracker = createInstallProgressTracker({
      isTTY: true,
      write: (s) => writes.push(s),
      say: () => {},
    });

    const total = 100 * 1024 * 1024;
    tracker.transport.onProgress?.(50 * 1024 * 1024, total);
    // Cursor hidden
    expect(writes.some((w) => w.includes("\x1b[?25l"))).toBe(true);
    // Line cleared with \r\x1b[2K
    expect(writes.some((w) => w.includes("\r\x1b[2K") && w.includes("50%"))).toBe(true);

    tracker.finish();
    // Line cleared and cursor restored on finish
    expect(writes.some((w) => w.includes("\x1b[2K"))).toBe(true);
    expect(writes.some((w) => w.includes("\x1b[?25h"))).toBe(true);
  });

  test("reports compile phases accurately", () => {
    const lines: string[] = [];
    const tracker = createInstallProgressTracker({
      isTTY: false,
      write: () => {},
      say: (l) => lines.push(l),
    });

    tracker.transport.onStatus?.("checkout", "Preparing checkout...");
    tracker.transport.onStatus?.("checkout-done", "Upstream source ready");
    tracker.transport.onStatus?.("patch", "Applying patch...");
    tracker.transport.onStatus?.("patch-done", "Applied patch cleanly");
    tracker.transport.onStatus?.("build", "Compiling binaries...");
    tracker.transport.onStatus?.("build-done", "Release binaries compiled");
    tracker.transport.onStatus?.("test", "Running tests...");
    tracker.transport.onStatus?.("test-done", "Tests passed");
    tracker.transport.onStatus?.("stage", "Staged generation");
    tracker.finish();

    const output = lines.join("\n");
    expect(output).toContain("Upstream Source");
    expect(output).toContain("Statusline Patch");
    expect(output).toContain("Compiling Release Binaries");
    expect(output).toContain("Regression Tests");
    expect(output).toContain("Staging & Activation");
  });
});
