import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_URL, executeDrift, resolveClaudeSeoPath, USAGE } from "../scripts/seo-drift";

const root = join(import.meta.dir, "..");
const scriptPath = join(root, "scripts", "seo-drift.ts");

describe("seo-drift CLI helper", () => {
  test("--help prints usage instructions and exits with 0", () => {
    const result = spawnSync(process.execPath, [scriptPath, "--help"], {
      cwd: root,
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(USAGE);
  });

  test("-h prints usage instructions and exits with 0", () => {
    const result = spawnSync(process.execPath, [scriptPath, "-h"], {
      cwd: root,
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(USAGE);
  });

  test("invalid subcommand prints error and exits non-zero", () => {
    const result = spawnSync(process.execPath, [scriptPath, "invalid-action"], {
      cwd: root,
      encoding: "utf8",
    });
    expect(result.status).not.toBe(0);
    const combinedOutput = `${result.stdout}\n${result.stderr}`;
    expect(combinedOutput).toContain('Invalid action: "invalid-action"');
    expect(combinedOutput).toContain(USAGE);
  });

  test("missing subcommand prints error and exits non-zero", () => {
    const result = spawnSync(process.execPath, [scriptPath], {
      cwd: root,
      encoding: "utf8",
    });
    expect(result.status).not.toBe(0);
    const combinedOutput = `${result.stdout}\n${result.stderr}`;
    expect(combinedOutput).toContain(USAGE);
  });

  describe("resolveClaudeSeoPath", () => {
    test("uses process.env.CLAUDE_SEO_PATH if set", () => {
      const customPath = "/custom/path/to/claude-seo";
      const resolved = resolveClaudeSeoPath({ CLAUDE_SEO_PATH: customPath }, "/nonexistent");
      expect(resolved).toBe(customPath);
    });

    test("falls back to aim profile path when it exists", () => {
      const tempHome = mkdtempSync(join(tmpdir(), "seo-test-home-"));
      try {
        const aimDir = join(tempHome, ".aim", "profiles", "bot", ".agents", "skills", "seo", "scripts");
        mkdirSync(aimDir, { recursive: true });
        const aimFile = join(aimDir, "claude-seo");
        writeFileSync(aimFile, "#!/bin/sh\n");

        const resolved = resolveClaudeSeoPath({}, tempHome);
        expect(resolved).toBe(aimFile);
      } finally {
        rmSync(tempHome, { recursive: true, force: true });
      }
    });

    test("falls back to .claude skills path if aim profile does not exist", () => {
      const tempHome = mkdtempSync(join(tmpdir(), "seo-test-home-"));
      try {
        const claudeDir = join(tempHome, ".claude", "skills", "seo", "scripts");
        mkdirSync(claudeDir, { recursive: true });
        const claudeFile = join(claudeDir, "claude-seo");
        writeFileSync(claudeFile, "#!/bin/sh\n");

        const resolved = resolveClaudeSeoPath({}, tempHome);
        expect(resolved).toBe(claudeFile);
      } finally {
        rmSync(tempHome, { recursive: true, force: true });
      }
    });
  });

  describe("drift command execution", () => {
    test("invokes baseline with expected args and default url", () => {
      const tempDir = mkdtempSync(join(tmpdir(), "seo-mock-"));
      try {
        const mockRunner = join(tempDir, "claude-seo");
        const logFile = join(tempDir, "invocation.log");
        writeFileSync(
          mockRunner,
          `#!/bin/sh\necho "$@" > "${logFile}"\nexit 0\n`
        );
        chmodSync(mockRunner, 0o755);

        const code = executeDrift(["baseline"], {
          claudeSeoPath: mockRunner,
          stdio: "pipe",
        });
        expect(code).toBe(0);

        const loggedArgs = readFileSync(logFile, "utf8").trim();
        expect(loggedArgs).toBe(`run drift_baseline.py --skip-cwv ${DEFAULT_URL}`);
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test("invokes capture alias with expected args and custom url", () => {
      const tempDir = mkdtempSync(join(tmpdir(), "seo-mock-"));
      try {
        const mockRunner = join(tempDir, "claude-seo");
        const logFile = join(tempDir, "invocation.log");
        writeFileSync(
          mockRunner,
          `#!/bin/sh\necho "$@" > "${logFile}"\nexit 0\n`
        );
        chmodSync(mockRunner, 0o755);

        const code = executeDrift(["capture", "https://example.com"], {
          claudeSeoPath: mockRunner,
          stdio: "pipe",
        });
        expect(code).toBe(0);

        const loggedArgs = readFileSync(logFile, "utf8").trim();
        expect(loggedArgs).toBe("run drift_baseline.py --skip-cwv https://example.com");
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test("invokes compare with expected args", () => {
      const tempDir = mkdtempSync(join(tmpdir(), "seo-mock-"));
      try {
        const mockRunner = join(tempDir, "claude-seo");
        const logFile = join(tempDir, "invocation.log");
        writeFileSync(
          mockRunner,
          `#!/bin/sh\necho "$@" > "${logFile}"\nexit 0\n`
        );
        chmodSync(mockRunner, 0o755);

        const code = executeDrift(["compare", "https://cxstatusline.pages.dev"], {
          claudeSeoPath: mockRunner,
          stdio: "pipe",
        });
        expect(code).toBe(0);

        const loggedArgs = readFileSync(logFile, "utf8").trim();
        expect(loggedArgs).toBe("run drift_compare.py --skip-cwv https://cxstatusline.pages.dev");
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test("normalizes schemeless URLs to http://", () => {
      const tempDir = mkdtempSync(join(tmpdir(), "seo-drift-test-"));
      const mockRunner = join(tempDir, "mock-claude-seo");
      const logFile = join(tempDir, "args.log");
      try {
        writeFileSync(
          mockRunner,
          `#!/bin/sh\necho "$@" > "${logFile}"\nexit 0\n`
        );
        chmodSync(mockRunner, 0o755);

        const code = executeDrift(["compare", "localhost:4321"], {
          claudeSeoPath: mockRunner,
          stdio: "pipe",
        });
        expect(code).toBe(0);

        const loggedArgs = readFileSync(logFile, "utf8").trim();
        expect(loggedArgs).toBe("run drift_compare.py --skip-cwv http://localhost:4321");
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test("handles flags placed before the target URL", () => {
      const tempDir = mkdtempSync(join(tmpdir(), "seo-drift-test-"));
      const mockRunner = join(tempDir, "mock-claude-seo");
      const logFile = join(tempDir, "args.log");
      try {
        writeFileSync(
          mockRunner,
          `#!/bin/sh\necho "$@" > "${logFile}"\nexit 0\n`
        );
        chmodSync(mockRunner, 0o755);

        const code = executeDrift(["compare", "--verbose", "localhost:4321"], {
          claudeSeoPath: mockRunner,
          stdio: "pipe",
        });
        expect(code).toBe(0);

        const loggedArgs = readFileSync(logFile, "utf8").trim();
        expect(loggedArgs).toBe("run drift_compare.py --skip-cwv http://localhost:4321 --verbose");
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test("exits non-zero when runner is missing", () => {
      const code = executeDrift(["baseline"], {
        claudeSeoPath: "/nonexistent/path/to/claude-seo",
        stdio: "pipe",
      });
      expect(code).toBe(1);
    });
  });
});
