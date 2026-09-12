import chalk from "chalk";
import type { PatchOutcome } from "../patch/acquire";
import { describeOutcome } from "../patch/acquire";
import { renderBox, renderHeader, symbols } from "./box";
import { VERSION } from "../version-info";

export function renderInstallHeader(compile: boolean): string {
  const subtitle = compile
    ? "Compiling patched Codex from source"
    : "Acquiring prebuilt statusline integration for OpenAI Codex";
  return renderHeader("cxstatusline install", subtitle, `v${VERSION}`);
}

export function renderInstallSuccess(opts: {
  readonly version: string;
  readonly source: "prebuilt" | "compiled";
  readonly reused: boolean;
  readonly hookAction: "added" | "unchanged" | "replaced";
  readonly hookFile: string;
}): string {
  const sourceDesc = opts.source === "prebuilt"
    ? (opts.reused ? "prebuilt release (reused existing generation)" : "prebuilt release")
    : "source build";
  const hookDesc = `hook ${opts.hookAction} in ${opts.hookFile}`;
  const lines = [
    `${symbols.ok}  ${chalk.bold.green("Installation Complete")}`,
    "",
    `  ${chalk.dim("Codex Target:")}    ${chalk.bold.white(opts.version)}`,
    `  ${chalk.dim("Source:")}          ${chalk.cyan(sourceDesc)}`,
    `  ${chalk.dim("Hook:")}            ${chalk.white(hookDesc)}`,
    "",
    chalk.white("Start Codex once and accept the cxstatusline hook when prompted."),
  ];
  return renderBox(lines, { borderColor: chalk.green, minWidth: 68 });
}

export function renderInstallHookError(opts: {
  readonly version: string;
  readonly hookFile: string;
  readonly error: string;
}): string {
  const lines = [
    `${symbols.warn}  ${chalk.bold.yellow("Codex Installed (Hook Notice)")}`,
    "",
    `Codex ${opts.version} is installed, but the SessionStart hook could not be written: ${opts.error}`,
    "",
    `Fix ${opts.hookFile} by hand, then run \`cxstatusline hook install\`.`,
  ];
  return renderBox(lines, { borderColor: chalk.yellow, minWidth: 68 });
}

export function renderInstallFailure(outcome: PatchOutcome, advice: readonly string[]): string {
  const desc = describeOutcome(outcome);
  const lines = [
    `${symbols.fail}  ${chalk.bold.red("Installation Incomplete")}`,
    "",
    chalk.white(desc),
  ];
  if (advice.length > 0) {
    lines.push("");
    lines.push(chalk.bold.cyan("Next Steps:"));
    for (const a of advice) {
      lines.push(`  ${symbols.pointer} ${a}`);
    }
  }
  return renderBox(lines, { borderColor: chalk.red, minWidth: 68 });
}
