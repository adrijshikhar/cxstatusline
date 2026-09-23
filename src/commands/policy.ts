import type { Context } from "../context";
import { acquireLock } from "../lock";
import { readState, writeState } from "../state";
import { POLICIES, type Policy } from "../version";

export interface PolicyIo {
  stdout(s: string): void;
  stderr(s: string): void;
}

export function runPolicy(ctx: Context, argv: readonly string[], io: PolicyIo): number {
  if (argv.length === 0 || (argv.length === 1 && argv[0] === "get")) {
    const { state } = readState(ctx.paths.stateFile);
    io.stdout(`current update policy: ${state.policy}\n`);
    return 0;
  }

  let target: string | undefined;
  if (argv[0] === "set") {
    if (argv.length < 2) {
      io.stderr(`usage: cxstatusline policy set <${POLICIES.join("|")}>\n`);
      return 2;
    }
    target = argv[1];
  } else if (argv.length === 1) {
    target = argv[0];
  } else {
    io.stderr(`usage: cxstatusline policy [get|set <${POLICIES.join("|")}>]\n`);
    return 2;
  }

  if (!POLICIES.includes(target as Policy)) {
    io.stderr(`invalid policy '${target}'; valid policies are: ${POLICIES.join(", ")}\n`);
    return 2;
  }

  const release = acquireLock(ctx.paths.lockFile);
  if (!release) {
    io.stderr("cannot set policy: another cxstatusline operation is in progress\n");
    return 1;
  }

  try {
    const { state } = readState(ctx.paths.stateFile);
    writeState(ctx.paths.stateFile, { ...state, policy: target as Policy });
    io.stdout(`update policy set to: ${target}\n`);
    return 0;
  } finally {
    release();
  }
}
