import { describe, expect, it } from "bun:test";
import { restoreBackgroundAfterResets, stripSgrCodes } from "../../src/utils/ansi";
import { sanitizeTerminalText } from "../../src/utils/terminal-sanitize";

describe("8-bit ANSI and C1 control sanitization", () => {
  it("strips 8-bit CSI color sequences", () => {
    const text = "\x9b31mred\x9b0m";
    expect(stripSgrCodes(text)).toBe("red");
  });

  it("converts 8-bit C1 color codes to 7-bit in sanitizeTerminalText", () => {
    const text = "\x9b31mred\x9b39m";
    expect(sanitizeTerminalText(text)).toBe("\x1b[31mred\x1b[39m");
  });

  it("drops hazardous 8-bit sequences whole while keeping text", () => {
    const text = "safe\x9d8;;https://example.com\x9cpayload\x9d8;;\x9cmore";
    expect(sanitizeTerminalText(text)).toBe("safe\x1b]8;;https://example.com\x1b\\payload\x1b]8;;\x1b\\more");
  });

  it("re-applies the background after an 8-bit reset", () => {
    const BG = "\x1b[44m";
    expect(restoreBackgroundAfterResets("\x9b31ma\x9b0mb\x9b49mc", BG))
      .toBe(`\x9b31ma\x9b0m${BG}b\x9b49m${BG}c`);
  });

  it.each([
    ["clearing the screen", "\x9b2J"],
    ["moving the cursor", "\x9b10;20H"],
    ["repeating a character", "\x9bb"],
    ["an OSC 52 clipboard write", "\x9d52;c;ZWNobyBwd25lZA==\x07"],
    ["an OSC 0 title change", "\x9d0;hacked\x9c"],
    ["a hyperlink with an unsafe URL", "\x9d8;;https://x/a b\x9c"],
    ["a DCS string", "\x90q#0;2;0;0;0\x9c"],
    ["an APC string", "\x9fpayload\x1b\\"],
    ["a PM string", "\x9epayload\x9c"],
    ["a SOS string", "\x98payload\x9c"],
  ])("drops 8-bit hazardous sequences: %s", (_label, sequence) => {
    expect(sanitizeTerminalText(`a${sequence}b`)).toBe("ab");
  });
});
