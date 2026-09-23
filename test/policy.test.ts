import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Context } from "../src/context";
import { runPolicy } from "../src/commands/policy";
import { resolvePaths } from "../src/paths";
import { DEFAULT_STATE, readState, writeState } from "../src/state";
import { main } from "../src/main";
import { tmpEnv } from "./helpers";

function policySetup() {
  const { env, root } = tmpEnv("cxstatusline policy test ");
  const paths = resolvePaths(env);
  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];
  const io = {
    stdout: (s: string) => stdoutLines.push(s),
    stderr: (s: string) => stderrLines.push(s),
  };
  const ctx: Context = {
    env,
    paths,
    run: () => ({ status: 0, stdout: "", stderr: "" }),
    which: () => null,
    freeBytes: () => 1e12,
    cxBin: "/cx",
    patchesDir: "/p",
    now: () => new Date(),
    log: () => {},
    say: () => {},
  };
  return { ctx, env, paths, root, io, stdoutLines, stderrLines };
}

describe("policy command", () => {
  test("bare 'policy' prints the default policy 'every'", () => {
    const { ctx, io, stdoutLines } = policySetup();
    const code = runPolicy(ctx, [], io);
    expect(code).toBe(0);
    expect(stdoutLines.join("")).toContain("current update policy: every");
  });

  test("'policy get' prints the current policy", () => {
    const { ctx, paths, io, stdoutLines } = policySetup();
    writeState(paths.stateFile, { ...DEFAULT_STATE, policy: "stable-minors" });
    const code = runPolicy(ctx, ["get"], io);
    expect(code).toBe(0);
    expect(stdoutLines.join("")).toContain("current update policy: stable-minors");
  });

  test("'policy set stable-minors' updates state and reports success", () => {
    const { ctx, paths, io, stdoutLines } = policySetup();
    const code = runPolicy(ctx, ["set", "stable-minors"], io);
    expect(code).toBe(0);
    expect(stdoutLines.join("")).toContain("update policy set to: stable-minors");
    expect(readState(paths.stateFile).state.policy).toBe("stable-minors");
  });

  test("'policy manual' updates state and reports success", () => {
    const { ctx, paths, io, stdoutLines } = policySetup();
    const code = runPolicy(ctx, ["manual"], io);
    expect(code).toBe(0);
    expect(stdoutLines.join("")).toContain("update policy set to: manual");
    expect(readState(paths.stateFile).state.policy).toBe("manual");
  });

  test("'policy set' without argument exits 2 with usage", () => {
    const { ctx, io, stderrLines } = policySetup();
    const code = runPolicy(ctx, ["set"], io);
    expect(code).toBe(2);
    expect(stderrLines.join("")).toMatch(/usage: cxstatusline policy set/);
  });

  test("'policy set unknown' exits 2 with error message", () => {
    const { ctx, paths, io, stderrLines } = policySetup();
    const code = runPolicy(ctx, ["set", "unknown-policy"], io);
    expect(code).toBe(2);
    expect(stderrLines.join("")).toContain("invalid policy 'unknown-policy'");
    expect(readState(paths.stateFile).state.policy).toBe("every");
  });

  test("locked: another process holds the lock -> exits 1", () => {
    const { ctx, paths, io, stderrLines } = policySetup();
    mkdirSync(paths.stateDir, { recursive: true });
    writeFileSync(paths.lockFile, `${process.pid}\n`);
    const code = runPolicy(ctx, ["set", "manual"], io);
    expect(code).toBe(1);
    expect(stderrLines.join("")).toContain("another cxstatusline operation is in progress");
    expect(readState(paths.stateFile).state.policy).toBe("every");
  });
});

describe("main(['policy']) CLI dispatch", () => {
  test("main(['policy']) reads default policy", async () => {
    const { env } = policySetup();
    const out: string[] = [];
    const err: string[] = [];
    const mainIo = {
      env,
      stdin: () => "",
      stdout: (s: string) => out.push(s),
      stderr: (s: string) => err.push(s),
      now: () => new Date(),
    };
    const code = await main(["policy"], mainIo);
    expect(code).toBe(0);
    expect(out.join("")).toContain("current update policy: every");
  });

  test("main(['policy', 'set', 'stable-minors']) sets policy via CLI", async () => {
    const { env, paths } = policySetup();
    const out: string[] = [];
    const err: string[] = [];
    const mainIo = {
      env,
      stdin: () => "",
      stdout: (s: string) => out.push(s),
      stderr: (s: string) => err.push(s),
      now: () => new Date(),
    };
    const code = await main(["policy", "set", "stable-minors"], mainIo);
    expect(code).toBe(0);
    expect(out.join("")).toContain("update policy set to: stable-minors");
    expect(readState(paths.stateFile).state.policy).toBe("stable-minors");
  });
});
