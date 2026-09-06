/**
 * Child process for the SIGKILL test in test/wrapper.test.ts.
 * Writes `started` immediately before `activatePair` and `done` immediately after, so the parent
 * can kill it inside the activation window and then check what a fresh `codex` would observe.
 */
import { readFileSync, writeFileSync } from "node:fs";
import type { Env } from "../../src/env";
import type { PreparedPair } from "../../src/distribution";
import { resolvePaths } from "../../src/paths";
import { activatePair } from "../../src/patch/wrapper";

const args = JSON.parse(readFileSync(process.argv[2] as string, "utf8")) as {
  pair: PreparedPair;
  env: Env;
  started: string;
  done: string;
};

writeFileSync(args.started, "1");
activatePair(args.pair, {
  env: args.env,
  paths: resolvePaths(args.env),
  run: () => ({ status: 0, stdout: "", stderr: "" }),
  which: () => null,
  freeBytes: () => 1e12,
  cxBin: "/cx",
  patchesDir: "/p",
  now: () => new Date(),
  log: () => {},
  say: () => {},
});
writeFileSync(args.done, "1");
