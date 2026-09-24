import { describe, expect, test } from "bun:test";
import { promptCodexVersion } from "../src/ui/prompt-version";

describe("promptCodexVersion", () => {
  const versions = ["0.156.1", "0.155.1", "0.155.0", "0.154.0"];
  const prebuilts = ["0.155.1", "0.155.0", "0.154.0"];

  test("non-TTY returns default version immediately without asking", async () => {
    const selected = await promptCodexVersion({
      supportedVersions: versions,
      prebuiltVersions: prebuilts,
      defaultVersion: "0.155.1",
      isTTY: false,
    });
    expect(selected).toEqual({ version: "0.155.1", compile: false });
  });

  test("non-TTY without defaultVersion returns first prebuilt version if available", async () => {
    const selected = await promptCodexVersion({
      supportedVersions: versions,
      prebuiltVersions: prebuilts,
      isTTY: false,
    });
    expect(selected).toEqual({ version: "0.155.1", compile: false });
  });

  test("non-TTY honors an explicit source build", async () => {
    expect(await promptCodexVersion({ supportedVersions: versions, compile: true }))
      .toEqual({ version: "0.156.1", compile: true });
  });

  test("an empty supported list is rejected", async () => {
    await expect(promptCodexVersion({ supportedVersions: [] })).rejects.toThrow("No supported Codex versions");
  });
});
