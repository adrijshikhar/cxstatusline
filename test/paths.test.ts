import { describe, expect, test } from "bun:test";
import { resolvePaths } from "../src/paths";

describe("resolvePaths", () => {
  test("uses XDG dirs and CODEX_HOME when set", () => {
    const p = resolvePaths({
      HOME: "/h",
      XDG_CONFIG_HOME: "/x/cfg",
      XDG_STATE_HOME: "/x/state",
      XDG_DATA_HOME: "/x/data",
      CODEX_HOME: "/x/codex",
    });
    expect(p.settingsFile).toBe("/x/cfg/cxstatusline/settings.json");
    expect(p.stateFile).toBe("/x/state/cxstatusline/state.json");
    expect(p.stateBackupFile).toBe("/x/state/cxstatusline/state.json.bak");
    expect(p.lockFile).toBe("/x/state/cxstatusline/patch.lock");
    expect(p.patchLog).toBe("/x/state/cxstatusline/patch.log");
    expect(p.sourceDir).toBe("/x/data/cxstatusline/codex");
    expect(p.hooksFile).toBe("/x/codex/hooks.json");
  });

  test("falls back to ~/.config, ~/.local and ~/.codex", () => {
    const p = resolvePaths({ HOME: "/h" });
    expect(p.settingsFile).toBe("/h/.config/cxstatusline/settings.json");
    expect(p.stateDir).toBe("/h/.local/state/cxstatusline");
    expect(p.shareDir).toBe("/h/.local/share/cxstatusline");
    expect(p.libexecDir).toBe("/h/.local/libexec/cxstatusline");
    expect(p.patchedBin).toBe("/h/.local/libexec/cxstatusline/codex");
    expect(p.patchedCodeModeHost).toBe("/h/.local/libexec/cxstatusline/codex-code-mode-host");
    expect(p.binDir).toBe("/h/.local/bin");
    expect(p.wrapperPath).toBe("/h/.local/bin/codex");
    expect(p.rendererLink).toBe("/h/.local/bin/cxstatusline");
    expect(p.codexHome).toBe("/h/.codex");
  });

  test("generations live under libexec and `current` is their sibling pointer", () => {
    const p = resolvePaths({ HOME: "/h" });
    expect(p.generationsDir).toBe("/h/.local/libexec/cxstatusline/generations");
    expect(p.currentGeneration).toBe("/h/.local/libexec/cxstatusline/current");
    // Same filesystem as `current` is what makes the pointer rename atomic.
    expect(p.generationsDir.startsWith(`${p.libexecDir}/`)).toBe(true);
    expect(p.currentGeneration.startsWith(`${p.libexecDir}/`)).toBe(true);
  });

  test("throws without HOME", () => {
    expect(() => resolvePaths({})).toThrow(/HOME/);
  });
});
