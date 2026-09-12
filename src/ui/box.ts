import chalk from "chalk";
import { getVisibleWidth } from "../utils/ansi";

export interface BoxOptions {
  readonly title?: string;
  readonly badge?: string;
  readonly borderColor?: (s: string) => string;
  readonly minWidth?: number;
}

export const symbols = {
  ok: chalk.green("✔"),
  warn: chalk.yellow("▲"),
  fail: chalk.red("✖"),
  info: chalk.cyan("ℹ"),
  bullet: chalk.dim("●"),
  activeBullet: chalk.green("●"),
  dimBullet: chalk.dim("○"),
  pointer: chalk.cyan("▸"),
  diamond: chalk.magenta("◇"),
};

function splitLines(lines: readonly string[]): string[] {
  return lines.flatMap((l) => l.split("\n"));
}

export function renderBox(lines: readonly string[], options: BoxOptions = {}): string {
  const border = options.borderColor ?? chalk.dim;
  const flatLines = splitLines(lines);
  const minWidth = options.minWidth ?? 60;

  const contentWidth = flatLines.reduce((max, l) => Math.max(max, getVisibleWidth(l)), 0);
  const titleWidth = options.title ? getVisibleWidth(options.title) + (options.badge ? getVisibleWidth(options.badge) + 2 : 0) : 0;
  const innerWidth = Math.max(minWidth, contentWidth, titleWidth);

  const topBorder = `${border("╭─")}${border("─".repeat(innerWidth + 2))}${border("─╮")}`;
  const bottomBorder = `${border("╰─")}${border("─".repeat(innerWidth + 2))}${border("─╯")}`;

  const renderedLines: string[] = [topBorder];

  if (options.title) {
    const title = options.title;
    const badge = options.badge ? `  ${options.badge}` : "";
    const headerVisible = getVisibleWidth(title) + getVisibleWidth(badge);
    const rightPad = " ".repeat(Math.max(0, innerWidth - headerVisible));
    renderedLines.push(`${border("│")}  ${title}${rightPad}${badge}  ${border("│")}`);
    renderedLines.push(`${border("├─")}${border("─".repeat(innerWidth + 2))}${border("─┤")}`);
  }

  for (const line of flatLines) {
    const pad = " ".repeat(Math.max(0, innerWidth - getVisibleWidth(line)));
    renderedLines.push(`${border("│")}  ${line}${pad}  ${border("│")}`);
  }

  renderedLines.push(bottomBorder);
  return renderedLines.join("\n");
}

export function renderHeader(title: string, subtitle?: string, badge?: string, minWidth = 68): string {
  const border = chalk.cyan;
  const titleVis = getVisibleWidth(title);
  const badgeVis = badge ? getVisibleWidth(badge) : 0;
  const subVis = subtitle ? getVisibleWidth(subtitle) : 0;
  const innerWidth = Math.max(minWidth, titleVis + (badge ? badgeVis + 4 : 0), subVis);

  const topBorder = `${border("╭─")}${border("─".repeat(innerWidth + 2))}${border("─╮")}`;
  const bottomBorder = `${border("╰─")}${border("─".repeat(innerWidth + 2))}${border("─╯")}`;

  const lines: string[] = [topBorder];
  if (badge) {
    const space = " ".repeat(Math.max(2, innerWidth - titleVis - badgeVis));
    lines.push(`${border("│")}  ${chalk.bold.white(title)}${space}${chalk.dim(badge)}  ${border("│")}`);
  } else {
    const space = " ".repeat(Math.max(0, innerWidth - titleVis));
    lines.push(`${border("│")}  ${chalk.bold.white(title)}${space}  ${border("│")}`);
  }
  if (subtitle) {
    const space = " ".repeat(Math.max(0, innerWidth - subVis));
    lines.push(`${border("│")}  ${chalk.dim(subtitle)}${space}  ${border("│")}`);
  }
  lines.push(bottomBorder);
  return lines.join("\n");
}

export function renderSectionTitle(title: string): string {
  return `  ${symbols.pointer} ${chalk.bold.white(title)}`;
}
