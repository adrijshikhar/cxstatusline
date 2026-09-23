import chalk from "chalk";
import type { DoctorLine } from "./doctor";
import { PLATFORMS } from "../distribution";
import { renderBox, renderHeader, renderSectionTitle, symbols } from "../ui/box";
import { VERSION } from "../version-info";

interface Section {
  readonly title: string;
  readonly keys: readonly string[];
}

const SECTIONS: readonly Section[] = [
  {
    title: "Core & Environment",
    keys: ["renderer", "settings", "platform", "toolchain"],
  },
  {
    title: "Codex Integration",
    keys: ["upstream", "wrapper", "hook", "policy", "codex_target", "drift"],
  },
  {
    title: "Active Generation & Binaries",
    keys: [
      "active", "generation", "cx_version", "release", "patch",
      "source_commit", "upstream_commit", "codex_digest", "host_digest",
      "codex_version", "legal", "bookkeeping", "legacy",
    ],
  },
  {
    title: "State & Locks",
    keys: ["state", "patched_from", "last_attempt", "lock", "command_cache"],
  },
];

function formatValue(raw: unknown, ok: boolean | null): string {
  const value = String(raw ?? "");
  if (ok === false) return chalk.red(value);
  if (value === "absent" || value === "none" || value === "never" || value.startsWith("n/a")) {
    return chalk.dim(value);
  }
  if (value === "free" || value === "ours" || (PLATFORMS as readonly string[]).includes(value)) {
    return chalk.green(value);
  }
  return chalk.white(value);
}

function statusBullet(ok: boolean | null): string {
  if (ok === true) return symbols.ok;
  if (ok === false) return symbols.fail;
  return symbols.dimBullet;
}

function renderSummary(lines: readonly DoctorLine[]): string {
  const failures = lines.filter((l) => l.ok === false);
  const driftLine = lines.find((l) => l.key === "drift");

  if (failures.length > 0) {
    const count = failures.length;
    const word = count === 1 ? "issue" : "issues";
    const detail = driftLine && driftLine.ok === false
      ? "Run `cxstatusline install` to update to the current Codex version."
      : "Check the failed items above for instructions.";
    return renderBox([
      `${symbols.fail}  ${chalk.bold.red(`${count} ${word} detected`)}`,
      `   ${chalk.dim(detail)}`,
    ], { borderColor: chalk.red, minWidth: 68 });
  }

  return renderBox([
    `${symbols.ok}  ${chalk.bold.green("All systems operational")}`,
    `   ${chalk.dim("Statusline is configured and active for OpenAI Codex.")}`,
  ], { borderColor: chalk.green, minWidth: 68 });
}

export function singleLineSummary(text: string): string {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length <= 1) return text;

  const match = /^(failed\s+\S+\s+at\s+[0-9T:.-]+Z?):\s*(.*)/.exec(lines[0]!);
  const prefix = match ? match[1]! : (lines[0]!.split(":")[0] ?? "failed");

  const errorLine = lines.find((l) => /^error(\[[A-Z0-9]+\])?:/i.test(l))
    ?? lines.find((l) => /^failed to/i.test(l))
    ?? lines.find((l) => /panic/i.test(l))
    ?? lines[lines.length - 1]!;

  return `${prefix}: ${errorLine}`;
}

function formatDiagnosticLine(item: DoctorLine, maxKeyWidth: number): string {
  const bullet = statusBullet(item.ok);
  const key = chalk.cyan(item.key.padEnd(maxKeyWidth));
  const summary = singleLineSummary(String(item.value ?? ""));
  const val = formatValue(summary, item.ok);
  return `    ${bullet} ${key}  ${val}`;
}

export function formatDoctorPretty(lines: readonly DoctorLine[]): string {
  const lineMap = new Map(lines.map((l) => [l.key, l]));
  const seen = new Set<string>();
  const maxKeyWidth = lines.reduce((max, l) => Math.max(max, l.key.length), 0);

  const parts: string[] = [
    renderHeader("cxstatusline doctor", "Diagnostics & System Health", `v${VERSION}`),
    "",
  ];

  for (const section of SECTIONS) {
    const sectionLines: DoctorLine[] = [];
    for (const key of section.keys) {
      const entry = lineMap.get(key);
      if (entry) {
        sectionLines.push(entry);
        seen.add(key);
      }
    }
    if (sectionLines.length === 0) continue;

    parts.push(renderSectionTitle(section.title));
    for (const item of sectionLines) {
      parts.push(formatDiagnosticLine(item, maxKeyWidth));
    }
    parts.push("");
  }

  // Any extra/unrecognized keys
  const extra = lines.filter((l) => !seen.has(l.key));
  if (extra.length > 0) {
    parts.push(renderSectionTitle("Other Diagnostics"));
    for (const item of extra) {
      parts.push(formatDiagnosticLine(item, maxKeyWidth));
    }
    parts.push("");
  }

  parts.push(renderSummary(lines));
  return `${parts.join("\n")}\n`;
}
