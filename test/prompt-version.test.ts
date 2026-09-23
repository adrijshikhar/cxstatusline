import { describe, expect, test } from "bun:test";
import { promptCodexVersion } from "../src/ui/prompt-version";

describe("promptCodexVersion", () => {
  const versions = ["0.156.1", "0.155.1", "0.155.0", "0.154.0"];
  const prebuilts = ["0.155.1", "0.155.0", "0.154.0"];

  test("non-TTY returns default version immediately without asking", async () => {
    let asked = false;
    const selected = await promptCodexVersion({
      supportedVersions: versions,
      prebuiltVersions: prebuilts,
      defaultVersion: "0.155.1",
      isTTY: false,
      ask: async () => {
        asked = true;
        return "";
      },
    });
    expect(selected).toEqual({ version: "0.155.1", compile: false });
    expect(asked).toBe(false);
  });

  test("non-TTY without defaultVersion returns first prebuilt version if available", async () => {
    const selected = await promptCodexVersion({
      supportedVersions: versions,
      prebuiltVersions: prebuilts,
      isTTY: false,
    });
    expect(selected).toEqual({ version: "0.155.1", compile: false });
  });

  test("interactive TTY with empty response selects default prebuilt version", async () => {
    const lines: string[] = [];
    const selected = await promptCodexVersion({
      supportedVersions: versions,
      prebuiltVersions: prebuilts,
      defaultVersion: "0.155.1",
      isTTY: true,
      say: (l) => lines.push(l),
      ask: async () => "",
    });
    expect(selected).toEqual({ version: "0.155.1", compile: false });
    expect(lines.some((l) => l.includes("[prebuilt available]"))).toBe(true);
    expect(lines.some((l) => l.includes("[compile from source - prebuilt pending]"))).toBe(true);
  });

  test("interactive TTY selecting prebuilt version returns compile: false", async () => {
    const selected = await promptCodexVersion({
      supportedVersions: versions,
      prebuiltVersions: prebuilts,
      isTTY: true,
      ask: async () => "2",
    });
    expect(selected).toEqual({ version: "0.155.1", compile: false });
  });

  test("interactive TTY selecting source-only version prompts for compile confirmation", async () => {
    const lines: string[] = [];
    const questions: string[] = [];
    const answers = ["1", "y"]; // selects 0.156.1, then confirms compile
    let i = 0;

    const selected = await promptCodexVersion({
      supportedVersions: versions,
      prebuiltVersions: prebuilts,
      isTTY: true,
      say: (l) => lines.push(l),
      ask: async (q) => {
        questions.push(q);
        return answers[i++] ?? "";
      },
    });

    expect(selected).toEqual({ version: "0.156.1", compile: true });
    expect(questions.some((q) => q.includes("compile from source instead"))).toBe(true);
  });

  test("interactive TTY declining source compile re-prompts until prebuilt selected", async () => {
    const lines: string[] = [];
    const answers = ["1", "n", "2"]; // selects 0.156.1, declines compile, then selects 0.155.1
    let i = 0;

    const selected = await promptCodexVersion({
      supportedVersions: versions,
      prebuiltVersions: prebuilts,
      isTTY: true,
      say: (l) => lines.push(l),
      ask: async () => answers[i++] ?? "",
    });

    expect(selected).toEqual({ version: "0.155.1", compile: false });
    expect(lines.some((l) => l.includes("Please select a version with prebuilt binaries available"))).toBe(true);
  });
});
