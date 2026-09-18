import { describe, expect, test } from "bun:test";
import { promptCodexVersion } from "../src/ui/prompt-version";

describe("promptCodexVersion", () => {
  const versions = ["0.155.0", "0.154.0", "0.153.4", "0.153.0", "0.152.1"];

  test("non-TTY returns default version immediately without asking", async () => {
    let asked = false;
    const selected = await promptCodexVersion({
      supportedVersions: versions,
      defaultVersion: "0.155.0",
      isTTY: false,
      ask: async () => {
        asked = true;
        return "";
      },
    });
    expect(selected).toBe("0.155.0");
    expect(asked).toBe(false);
  });

  test("non-TTY without defaultVersion returns first supported version", async () => {
    const selected = await promptCodexVersion({
      supportedVersions: versions,
      isTTY: false,
    });
    expect(selected).toBe("0.155.0");
  });

  test("interactive TTY with empty response selects default version", async () => {
    const lines: string[] = [];
    const selected = await promptCodexVersion({
      supportedVersions: versions,
      defaultVersion: "0.154.0",
      isTTY: true,
      say: (l) => lines.push(l),
      ask: async () => "",
    });
    expect(selected).toBe("0.154.0");
    expect(lines.some((l) => l.includes("0.154.0"))).toBe(true);
  });

  test("interactive TTY entering index number selects corresponding version", async () => {
    const selected = await promptCodexVersion({
      supportedVersions: versions,
      isTTY: true,
      ask: async () => "2",
    });
    expect(selected).toBe("0.154.0");
  });

  test("interactive TTY entering exact semver string selects it", async () => {
    const selected = await promptCodexVersion({
      supportedVersions: versions,
      isTTY: true,
      ask: async () => "0.153.4",
    });
    expect(selected).toBe("0.153.4");
  });

  test("interactive TTY entering invalid input re-prompts until valid", async () => {
    const answers = ["99", "abc", "3"];
    let i = 0;
    const lines: string[] = [];
    const selected = await promptCodexVersion({
      supportedVersions: versions,
      isTTY: true,
      say: (l) => lines.push(l),
      ask: async () => answers[i++] ?? "",
    });
    expect(selected).toBe("0.153.4");
    expect(lines.some((l) => l.includes("Invalid selection"))).toBe(true);
  });
});
