import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function extractImportSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const fromRegex = /^\s*import\s[^'"]*from\s*['"]([^'"]+)['"]/gm;
  const sideEffectRegex = /^\s*import\s*['"]([^'"]+)['"]/gm;

  let match: RegExpExecArray | null;
  while ((match = fromRegex.exec(source)) !== null) {
    if (match[1]) specifiers.push(match[1]);
  }
  while ((match = sideEffectRegex.exec(source)) !== null) {
    if (match[1]) specifiers.push(match[1]);
  }
  return specifiers;
}

describe("custom-command upstream tracking and isolation parity", () => {
  const customCommandFile = join(__dirname, "../../src/widgets/CustomCommand.tsx");
  const refreshCommandFile = join(__dirname, "../../src/commands/refresh-command.ts");

  test("CustomCommand.tsx imports none of node:fs, node:path, node:child_process, node:crypto", () => {
    const content = readFileSync(customCommandFile, "utf8");
    const specifiers = extractImportSpecifiers(content);
    const forbidden = new Set([
      "node:fs",
      "fs",
      "node:path",
      "path",
      "node:child_process",
      "child_process",
      "node:crypto",
      "crypto",
    ]);

    for (const specifier of specifiers) {
      expect(forbidden.has(specifier)).toBe(false);
    }
  });

  test("CustomCommand.tsx render() is under 15 lines", () => {
    const content = readFileSync(customCommandFile, "utf8");
    const renderMatch = /render\s*\([^)]*\)[^{]*\{([\s\S]*?\n\s*\})/.exec(content);
    expect(renderMatch).not.toBeNull();
    if (renderMatch) {
      const renderBody = renderMatch[0];
      const lineCount = renderBody.split("\n").length;
      expect(lineCount).toBeLessThan(15);
    }
  });

  test("src/commands/refresh-command.ts does not import node:child_process", () => {
    const content = readFileSync(refreshCommandFile, "utf8");
    const specifiers = extractImportSpecifiers(content);
    const forbidden = new Set(["node:child_process", "child_process"]);

    for (const specifier of specifiers) {
      expect(forbidden.has(specifier)).toBe(false);
    }
  });
});
