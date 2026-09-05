import { readFileSync } from "node:fs";
import { main } from "./main";

const argv = process.argv.slice(2);
/** The bare `hook` invocation Codex runs. It must exit 0 no matter what happens. */
const isHook = argv.length === 1 && argv[0] === "hook";

main(argv, {
  env: process.env,
  isTTY: Boolean(process.stdin.isTTY),
  stdin: () => {
    try {
      return readFileSync(0, "utf8");
    } catch {
      return "";
    }
  },
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
  now: () => new Date(),
}).then(
  (code) => {
    process.exitCode = isHook ? 0 : code;
  },
  (e: unknown) => {
    if (isHook) {
      // Last line of defence: a rejected promise must still be a clean SessionStart.
      process.stdout.write(`${JSON.stringify({ systemMessage: `cxstatusline hook error: ${String(e)}` })}\n`);
      process.exitCode = 0;
      return;
    }
    process.stderr.write(`cxstatusline: ${String(e)}\n`);
    process.exitCode = 1;
  },
);
