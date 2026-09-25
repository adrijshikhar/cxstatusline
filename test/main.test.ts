import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Context } from "../src/context";
import type { Env } from "../src/env";
import { USAGE, main, type MainDeps } from "../src/main";
import { resolvePaths } from "../src/paths";
import { canPrompt } from "../src/utils/interactive";
import { fakeExec, tmpEnv, type RecordedCall } from "./helpers";

const golden = readFileSync(new URL("./fixtures/payload-v1.json", import.meta.url), "utf8");

function io(stdin: string, envOverride: Record<string, string> = {}) {
  const { env } = tmpEnv();
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: {
      env: { ...env, ...envOverride },
      stdin: () => stdin,
      stdout: (s: string) => out.push(s),
      stderr: (s: string) => err.push(s),
      now: () => new Date("2026-09-02T12:00:00Z"),
    },
    out,
    err,
  };
}

describe("main", () => {
  test("locked revert returns failure through CLI dispatch", async () => {
    const t = io("");
    const p = resolvePaths(t.io.env);
    mkdirSync(p.binDir, { recursive: true });
    writeFileSync(p.rendererLink, "test renderer");
    mkdirSync(p.stateDir, { recursive: true });
    writeFileSync(p.lockFile, `${process.pid}\n`);
    expect(await main(["revert"], t.io)).toBe(1);
    expect(t.out.join("")).toContain("patch is running");
  });
  test("bare cxstatusline opens the TUI", async () => {
    const t = io("");
    const calls: string[] = [];
    const tuiSpy = async (settingsPath: string): Promise<void> => { calls.push(settingsPath); };

    expect(await main([], t.io, { runTUI: tuiSpy })).toBe(0);
    expect(calls).toEqual([resolvePaths(t.io.env).settingsFile]);
  });
  test("render never opens the TUI", async () => {
    const t = io(golden, { NO_COLOR: "1" });
    const tuiSpy = async (): Promise<void> => { throw new Error("TUI must not run"); };

    expect(await main(["render"], t.io, { runTUI: tuiSpy })).toBe(0);
  });
  test("bare cxstatusline refuses a non-interactive stream", async () => {
    const t = io("");
    let called = false;

    expect(await main([], { ...t.io, isTTY: false }, { runTUI: async () => { called = true; } })).toBe(2);
    expect(called).toBe(false);
    expect(t.err.join("")).toContain("usage:");
  });
  test("render prints one to three lines and exits 0", async () => {
    const t = io(golden, { NO_COLOR: "1" });
    expect(await main(["render"], t.io)).toBe(0);
    expect(t.out).toHaveLength(1);
    expect(t.out[0]).toMatch(/^.*gpt-5-codex.*\n$/s);
    expect(t.err).toEqual([]);
  });
  test("render on a bad payload prints nothing on stdout and exits 2", async () => {
    const t = io('{"payload_version": 9}');
    expect(await main(["render"], t.io)).toBe(2);
    expect(t.out).toEqual([]);
    expect(t.err.join("")).toMatch(/payload_version 9/);
  });
  test("render with a malformed settings file still renders and warns on stderr", async () => {
    const t = io(golden, { NO_COLOR: "1" });
    const { mkdirSync, writeFileSync } = await import("node:fs");
    const { resolvePaths } = await import("../src/paths");
    const p = resolvePaths(t.io.env);
    mkdirSync(p.configDir, { recursive: true });
    writeFileSync(p.settingsFile, "{{");
    expect(await main(["render"], t.io)).toBe(0);
    expect(t.out).toHaveLength(1);
    expect(t.err.join("")).toMatch(/settings\.json/);
  });
  test("--version prints the version", async () => {
    const t = io("");
    expect(await main(["--version"], t.io)).toBe(0);
    expect(t.out[0]).toMatch(/^cxstatusline (dev|\d+\.\d+\.\d+)\n$/);
  });
  test("unknown subcommand exits 2 with usage on stderr", async () => {
    const t = io("");
    expect(await main(["frobnicate"], t.io)).toBe(2);
    expect(t.out).toEqual([]);
    expect(t.err.join("")).toMatch(/usage/i);
  });
});

describe("main(['hook']) always exits 0", () => {
  test("a healthy but uninstalled machine: exit 0, no stdout", async () => {
    const t = io(JSON.stringify({ source: "startup" }));
    expect(await main(["hook"], t.io)).toBe(0);
    expect(t.out).toEqual([]);
  });
  test("a context that cannot even be built still exits 0 with a systemMessage", async () => {
    // No HOME -> resolvePaths throws inside realContext, before runHook is reached.
    const t = io(JSON.stringify({ source: "startup" }), {});
    const broken = { ...t.io, env: { PATH: "/usr/bin" } };
    expect(await main(["hook"], broken)).toBe(0);
    expect(t.out).toHaveLength(1);
    const parsed = JSON.parse(t.out[0]!) as { systemMessage: string };
    expect(parsed.systemMessage).toMatch(/cxstatusline hook error: .*HOME/);
  });
  test("garbage on stdin still exits 0", async () => {
    const t = io("not json at all");
    expect(await main(["hook"], t.io)).toBe(0);
  });
});

// --- command dispatch -------------------------------------------------------

/**
 * A Context that cannot reach the owner's machine: a throwaway HOME, a runner that refuses every
 * Rust tool, and no disk headroom for staging, so the prebuilt path stops at its own preflight
 * instead of going near the network. What each command is asserted on is therefore *which*
 * preflight it hit, which is exactly the dispatch decision under test.
 */
function dispatchDeps(): { deps: MainDeps; calls: RecordedCall[]; env: Env } {
  const { env, root } = tmpEnv("cxstatusline test ");
  const paths = resolvePaths(env);
  const upstream = join(root, ".codex/packages/standalone/current/bin/codex");
  mkdirSync(join(upstream, ".."), { recursive: true });
  writeFileSync(upstream, "UPSTREAM-ELF");
  chmodSync(upstream, 0o755);
  mkdirSync(paths.binDir, { recursive: true });
  symlinkSync(upstream, paths.wrapperPath);
  const patchesDir = join(root, "patches");
  mkdirSync(patchesDir, { recursive: true });
  writeFileSync(join(patchesDir, "manifest.json"),
    JSON.stringify({ version: 1, tag_prefix: "rust-v", patches: [{ min: "0.152.1", max: "0.152.1", file: "p.patch" }] }));
  writeFileSync(join(patchesDir, "p.patch"), "");
  const { run, calls } = fakeExec((cmd, args) => {
    if (args[0] === "--version") return { stdout: "codex-cli 0.152.1\n" };
    return {};
  });
  const context: NonNullable<MainDeps["context"]> = (_env, cio) => ({
    env,
    paths,
    run,
    // `rustup` absent: the compile preflight refuses by name, so a compile dispatch is unmistakable.
    which: (cmd) => (cmd === "rustup" ? null : `/usr/bin/${cmd}`),
    // Below MIN_STAGING_FREE_BYTES: the prebuilt preflight refuses before any download.
    freeBytes: () => 1024,
    cxBin: join(paths.binDir, "cxstatusline"),
    patchesDir,
    now: () => new Date("2026-09-02T12:00:00Z"),
    // The seam replaces only *where* the Context comes from, not where its output goes.
    log: cio.log,
    say: cio.say,
  });
  return {
    deps: {
      context,
      transport: { fetch: async () => new Response(JSON.stringify([{ tag_name: "codex-v0.152.1", draft: false }])) },
    },
    calls,
    env,
  };
}

describe("command dispatch", () => {
  const cases: readonly { argv: readonly string[]; code: number; expect: RegExp }[] = [
    { argv: ["install"], code: 1, expect: /staging a prebuilt Codex pair needs 2 GiB/ },
    { argv: ["install", "--compile"], code: 1, expect: /rustup is not on PATH/ },
    { argv: ["patch"], code: 1, expect: /rustup is not on PATH/ },
    { argv: ["patch", "--force"], code: 1, expect: /rustup is not on PATH/ },
    { argv: ["upgrade"], code: 1, expect: /staging a prebuilt Codex pair needs 2 GiB/ },
    { argv: ["upgrade", "--compile"], code: 1, expect: /rustup is not on PATH/ },
    { argv: ["upgrade", "--force"], code: 1, expect: /staging a prebuilt Codex pair needs 2 GiB/ },
  ];
  for (const c of cases) {
    test(`\`${c.argv.join(" ")}\` reaches its own preflight`, async () => {
      const t = io("");
      const d = dispatchDeps();
      expect(await main(c.argv, { ...t.io, env: d.env }, d.deps)).toBe(c.code);
      expect(t.out.join("")).toMatch(c.expect);
      expect(d.calls.some((k) => k.cmd === "cargo" || k.cmd === "rustup")).toBe(false);
    });
  }
  test("`update` delegates to updateTool", async () => {
    const t = io("");
    const d = dispatchDeps();
    let toolUpdateCalled = false;
    let toolUpdateFlags: readonly string[] = [];
    const updateTool = async (flags: readonly string[]) => {
      toolUpdateCalled = true;
      toolUpdateFlags = flags;
      return 0;
    };
    expect(await main(["update", "--check"], { ...t.io, env: d.env }, { ...d.deps, updateTool })).toBe(0);
    expect(toolUpdateCalled).toBe(true);
    expect(toolUpdateFlags).toEqual(["--check"]);
  });
  test("`update` with codex flags prints notice and forwards to upgrade", async () => {
    const t = io("");
    const d = dispatchDeps();
    expect(await main(["update", "--compile"], { ...t.io, env: d.env }, d.deps)).toBe(1);
    expect(t.out.join("")).toMatch(/Notice: 'cxstatusline upgrade' is now used to upgrade the patched Codex pair/);
    expect(t.out.join("")).toMatch(/rustup is not on PATH/);
  });
  test("`update` with unknown flags exits 2 with usage", async () => {
    const t = io("");
    const d = dispatchDeps();
    expect(await main(["update", "--invalid-flag"], { ...t.io, env: d.env }, d.deps)).toBe(2);
    expect(t.err.join("")).toMatch(/usage:/i);
  });
  test("`upgrade` with unknown flags exits 2 with usage", async () => {
    const t = io("");
    const d = dispatchDeps();
    expect(await main(["upgrade", "--invalid-flag"], { ...t.io, env: d.env }, d.deps)).toBe(2);
    expect(t.err.join("")).toMatch(/usage:/i);
  });
  test("`upgrade` notifies when a newer tool version is available", async () => {
    const t = io("");
    const d = dispatchDeps();
    expect(await main(["upgrade"], { ...t.io, env: d.env }, {
      ...d.deps,
      fetchLatestToolVersion: async () => "99.0.0",
    })).toBe(1);
    expect(t.out.join("")).toMatch(/Note: A newer version of cxstatusline is available/);
  });
  test("`update --force` uses the verified prebuilt path", async () => {
    const t = io("");
    const d = dispatchDeps();
    expect(await main(["update", "--force"], { ...t.io, env: d.env }, { ...d.deps, fetchPrebuilts: async () => ["0.152.1"] })).toBe(1);
    expect(d.calls.filter((k) => k.args[0] === "update")).toHaveLength(0);
    expect(t.out.join("")).toMatch(/staging a prebuilt Codex pair needs 2 GiB/);
  });
  test("`upgrade` fails closed when release discovery fails", async () => {
    const t = io("");
    const d = dispatchDeps();
    const mockFetch = async (url: string | URL | Request) => {
      const u = typeof url === "string" ? url : url.toString();
      if (u.includes("releases/latest")) {
        return new Response(JSON.stringify({ tag_name: "rust-v0.154.0" }), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    };
    expect(await main(["upgrade"], { ...t.io, env: d.env }, { ...d.deps, transport: { fetch: mockFetch } })).toBe(1);
    expect(d.calls.filter((k) => k.args[0] === "update")).toHaveLength(0);
    expect(t.out.join("")).toMatch(/No supported prebuilt release/);
  });
  test("`hook acquire` acquires the prebuilt pair and never touches hooks.json", async () => {
    const t = io("");
    const d = dispatchDeps();
    expect(await main(["hook", "acquire"], { ...t.io, env: d.env }, d.deps)).toBe(1);
    expect(t.out.join("")).toMatch(/staging a prebuilt Codex pair needs 2 GiB/);
    expect(existsSync(resolvePaths(d.env).hooksFile)).toBe(false);
    expect(USAGE).not.toContain("acquire"); // internal: never advertised
  });
  for (const flag of [["--compiled"], ["--force"], ["--compile", "--force"]]) {
    test(`install ${flag.join(" ")} is a usage error, not a default`, async () => {
      const t = io("");
      const d = dispatchDeps();
      expect(await main(["install", ...flag], { ...t.io, env: d.env }, d.deps)).toBe(2);
      expect(t.out).toEqual([]);
      expect(t.err.join("")).toMatch(/usage/i);
    });
  }
  test("install --codex-version 0.152.1 installs target version", async () => {
    const t = io("");
    const d = dispatchDeps();
    expect(await main(["install", "--codex-version", "0.152.1"], { ...t.io, env: d.env }, d.deps)).toBe(1);
    expect(t.out.join("")).toMatch(/staging a prebuilt Codex pair needs 2 GiB/);
  });
  test("install --codex-version=0.152.1 installs target version", async () => {
    const t = io("");
    const d = dispatchDeps();
    expect(await main(["install", "--codex-version=0.152.1"], { ...t.io, env: d.env }, d.deps)).toBe(1);
    expect(t.out.join("")).toMatch(/staging a prebuilt Codex pair needs 2 GiB/);
  });
  test("install --codex-version with missing argument exits 2", async () => {
    const t = io("");
    const d = dispatchDeps();
    expect(await main(["install", "--codex-version"], { ...t.io, env: d.env }, d.deps)).toBe(2);
    expect(t.err.join("")).toContain("--codex-version requires a version argument");
  });
  test("install --codex-version= with empty argument exits 2", async () => {
    const t = io("");
    const d = dispatchDeps();
    expect(await main(["install", "--codex-version="], { ...t.io, env: d.env }, d.deps)).toBe(2);
    expect(t.err.join("")).toContain("--codex-version requires a version argument");
  });
  test("install -y skips prompt and installs default", async () => {
    const t = io("");
    const d = dispatchDeps();
    let promptCalled = false;
    const promptVersion = async () => {
      promptCalled = true;
      return "0.152.1";
    };
    expect(await main(["install", "-y"], { ...t.io, isTTY: true, env: d.env }, { ...d.deps, promptVersion })).toBe(1);
    expect(promptCalled).toBe(false);
    expect(t.out.join("")).toMatch(/staging a prebuilt Codex pair needs 2 GiB/);
  });
  test("interactive install with promptVersion prompts user and installs selected version", async () => {
    const t = io("");
    const d = dispatchDeps();
    let promptCalled = false;
    const promptVersion = async (opts: { supportedVersions: readonly string[]; defaultVersion?: string }) => {
      promptCalled = true;
      expect(opts.supportedVersions).toEqual(["0.152.1"]);
      expect(opts.defaultVersion).toBe("0.152.1");
      return "0.152.1";
    };
    expect(await main(["install"], { ...t.io, isTTY: true, env: d.env }, { ...d.deps, promptVersion })).toBe(1);
    expect(promptCalled).toBe(true);
    expect(t.out.join("")).toMatch(/staging a prebuilt Codex pair needs 2 GiB/);
  });
  test("interactive install receives fetched prebuiltVersions and sets default to highest prebuilt", async () => {
    const t = io("");
    const d = dispatchDeps();
    const mockReleases = [
      { tag_name: "codex-v0.152.1", draft: false },
    ];
    const mockFetch = async () => new Response(JSON.stringify(mockReleases), { status: 200 });
    let receivedPrebuilts: readonly string[] | undefined;
    const promptVersion = async (opts: any) => {
      receivedPrebuilts = opts.prebuiltVersions;
      return { version: opts.defaultVersion, compile: false };
    };
    expect(await main(["install"], { ...t.io, isTTY: true, env: d.env }, {
      ...d.deps,
      transport: { fetch: mockFetch as any },
      promptVersion,
    })).toBe(1);
    expect(receivedPrebuilts).toEqual(["0.152.1"]);
  });
  test("cancelling the version picker exits without starting installation", async () => {
    const t = io("");
    const d = dispatchDeps();
    const result = await main(["install"], { ...t.io, isTTY: true, env: d.env }, {
      ...d.deps,
      transport: { fetch: async () => new Response("[]") },
      promptVersion: async () => null,
    });
    expect(result).toBe(0);
    expect(t.out.join("")).toContain("Installation cancelled.");
    expect(t.out.join("")).not.toContain("Installing");
  });

  test("a failed picker never falls through into an installation", async () => {
    const t = io("");
    const d = dispatchDeps();
    await expect(main(["install"], { ...t.io, isTTY: true, env: d.env }, {
      ...d.deps,
      transport: { fetch: async () => new Response("[]") },
      promptVersion: async () => { throw new Error("terminal disconnected"); },
    })).rejects.toThrow("terminal disconnected");
  });

  test("an invalid picker manifest is reported without falling through into acquisition", async () => {
    const t = io("");
    const d = dispatchDeps();
    writeFileSync(join(d.env.HOME!, "patches", "manifest.json"), '{"version":2}');
    expect(await main(["install"], { ...t.io, isTTY: true, env: d.env }, d.deps)).toBe(1);
    expect(t.err.join("")).toContain("manifest is malformed");
    expect(t.out.join("")).not.toContain("Acquiring prebuilt");
    expect(d.calls).toHaveLength(0);
  });

  test("interactive install with promptVersion selecting compile proceeds in compile mode", async () => {
    const t = io("");
    const d = dispatchDeps();
    const promptVersion = async () => ({ version: "0.152.1", compile: true });
    expect(await main(["install"], { ...t.io, isTTY: true, env: d.env }, { ...d.deps, promptVersion })).toBe(1);
    expect(t.out.join("")).toMatch(/Compiling patched Codex from source/);
  });
  test("update installs the available supported prebuilt when forced", async () => {
    const t = io("");
    const d = dispatchDeps();
    expect(await main(["update", "--force"], { ...t.io, isTTY: true, env: d.env }, {
      ...d.deps,
      fetchPrebuilts: async () => ["0.152.1"],
    })).toBe(1);
    expect(t.out.join("")).toMatch(/staging a prebuilt Codex pair needs 2 GiB/);
  });
  for (const stdinTTY of [false, true]) {
    for (const stdoutTTY of [false, true]) {
      test(`install/upgrade prompt dispatch uses both TTYs (stdin=${stdinTTY}, stdout=${stdoutTTY})`, async () => {
        const shouldPrompt = stdinTTY && stdoutTTY;
        const installIO = io("");
        const install = dispatchDeps();
        let installPrompted = false;
        const releases = [{ tag_name: "codex-v0.152.1", draft: false }];
        const installResult = await main(["install"], {
          ...installIO.io,
          env: install.env,
          isTTY: canPrompt({ isTTY: stdinTTY }, { isTTY: stdoutTTY }),
        }, {
          ...install.deps,
          transport: { fetch: async () => new Response(JSON.stringify(releases)) },
          promptVersion: async () => { installPrompted = true; return null; },
        });
        expect(installPrompted).toBe(shouldPrompt);
        expect(installResult).toBe(shouldPrompt ? 0 : 1);

        const updateIO = io("");
        const update = dispatchDeps();
        let updatePrompted = false;
        const fetchUpdate = async (url: string | URL | Request) => {
          const value = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
          return value.includes("releases/latest")
            ? new Response(JSON.stringify({ tag_name: "rust-v0.156.1" }), { status: 200 })
            : new Response("not found", { status: 404 });
        };
        const updateResult = await main(["upgrade"], {
          ...updateIO.io,
          env: update.env,
          isTTY: canPrompt({ isTTY: stdinTTY }, { isTTY: stdoutTTY }),
        }, {
          ...update.deps,
          transport: { fetch: fetchUpdate as any },
          fetchPrebuilts: async () => ["0.155.1", "0.152.1"],
          promptUpdate: async () => { updatePrompted = true; return "cancel"; },
        });
        expect(updatePrompted).toBe(shouldPrompt);
        expect(updateResult).toBe(shouldPrompt ? 0 : 1);
        expect(update.calls.some((call) => call.args[0] === "update")).toBe(false);
      });
    }
  }

  test("upgrade does not prompt when installed codex is already up to date on TTY", async () => {
    const updateIO = io("");
    const update = dispatchDeps();
    const paths = resolvePaths(update.env);
    mkdirSync(paths.stateDir, { recursive: true });
    writeFileSync(paths.stateFile, JSON.stringify({
      version: 1,
      patched_from: "0.152.1",
      upstream_bin: null,
      launcher_restore: { kind: "none" },
      policy: "stable-minors",
      last_attempt: null,
    }));

    let updatePrompted = false;
    await main(["upgrade"], {
      ...updateIO.io,
      env: update.env,
      isTTY: true,
    }, {
      ...update.deps,
      fetchPrebuilts: async () => ["0.152.1"],
      promptUpdate: async () => { updatePrompted = true; return "cancel"; },
    });
    expect(updatePrompted).toBe(false);
  });

  test("--internal-refresh-command is dispatched without reading stdin, produces no stdout, and is absent from USAGE", async () => {
    const t = io("");
    const throwingIo = {
      ...t.io,
      stdin: () => {
        throw new Error("stdin must not be read");
      },
    };
    // Missing key exits 2:
    expect(await main(["--internal-refresh-command"], throwingIo)).toBe(2);
    expect(t.out).toEqual([]);

    // Valid key with absent document exits 0:
    expect(await main(["--internal-refresh-command", "0123456789abcdef"], throwingIo)).toBe(0);
    expect(t.out).toEqual([]);

    expect(USAGE).not.toContain("--internal-refresh-command");
  });
});
