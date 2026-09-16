import { existsSync, readdirSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { Box, Text, useInput } from "ink";
import React, { useMemo, useState } from "react";
import type { PowerlineConfig } from "../../types/PowerlineConfig";
import type { Settings } from "../../types/Settings";
import { buildEnabledPowerlineSettings } from "../../utils/powerline-settings";
import { ConfirmDialog } from "./ConfirmDialog";
import { List, type ListEntry } from "./List";
import { PowerlineSeparatorEditor, type PowerlineEditorMode } from "./PowerlineSeparatorEditor";
import { PowerlineThemeSelector } from "./PowerlineThemeSelector";

type PowerlineMenuValue = PowerlineEditorMode | "themes";
type Screen = "menu" | PowerlineMenuValue;

const SEPARATORS = [
  { char: "\uE0B0", name: "Triangle Right" }, { char: "\uE0B2", name: "Triangle Left" },
  { char: "\uE0B4", name: "Round Right" }, { char: "\uE0B6", name: "Round Left" },
];
const CAPS = {
  start: [
    { char: "\uE0B2", name: "Triangle" }, { char: "\uE0B6", name: "Round" },
    { char: "\uE0BA", name: "Lower Triangle" }, { char: "\uE0BE", name: "Diagonal" },
  ],
  end: [
    { char: "\uE0B0", name: "Triangle" }, { char: "\uE0B4", name: "Round" },
    { char: "\uE0B8", name: "Lower Triangle" }, { char: "\uE0BC", name: "Diagonal" },
  ],
};

function display(chars: readonly string[], presets: readonly { char: string; name: string }[]): string {
  if (!chars.length) return "none";
  if (chars.length > 1) return "multiple";
  const char = chars[0] ?? "";
  const preset = presets.find((entry) => entry.char === char);
  return preset ? `${char} - ${preset.name}` : `${char} - Custom`;
}

export function getSeparatorDisplay(powerline: PowerlineConfig): string {
  return display(powerline.separators, SEPARATORS);
}

export function getCapDisplay(powerline: PowerlineConfig, side: "start" | "end"): string {
  return display(side === "start" ? powerline.startCaps : powerline.endCaps, CAPS[side]);
}

export function getThemeDisplay(powerline: PowerlineConfig): string {
  const theme = powerline.theme;
  return !theme || theme === "custom" ? "Custom" : theme.charAt(0).toUpperCase() + theme.slice(1);
}

export function buildPowerlineSetupMenuItems(powerline: PowerlineConfig): ListEntry<PowerlineMenuValue>[] {
  const disabled = !powerline.enabled;
  return [
    { label: "Separator", sublabel: `(${getSeparatorDisplay(powerline)})`, value: "separator", disabled, description: "Choose the glyph between Powerline segments." },
    { label: "Start Cap", sublabel: `(${getCapDisplay(powerline, "start")})`, value: "startCap", disabled, description: "Configure the glyph at the start of each row." },
    { label: "End Cap", sublabel: `(${getCapDisplay(powerline, "end")})`, value: "endCap", disabled, description: "Configure the glyph at the end of each row." },
    { label: "Themes", sublabel: `(${getThemeDisplay(powerline)})`, value: "themes", disabled, description: "Preview built-in Powerline themes." },
  ];
}

/** Heuristic only: the terminal still decides whether a glyph can render. */
export function detectPowerlineFont(): boolean {
  const dirs = platform() === "darwin"
    ? [join(homedir(), "Library", "Fonts"), "/Library/Fonts"]
    : platform() === "win32"
      ? [join(homedir(), "AppData", "Local", "Microsoft", "Windows", "Fonts"), "C:\\Windows\\Fonts"]
      : [join(homedir(), ".local", "share", "fonts"), join(homedir(), ".fonts"), "/usr/share/fonts"];
  try {
    return dirs.some((dir) => existsSync(dir) && readdirSync(dir).some((file) => /powerline|nerd font|meslo.*lg/i.test(file)));
  } catch {
    return false;
  }
}

export interface PowerlineSetupProps {
  settings: Settings;
  onUpdate: (settings: Settings) => void;
  onBack: () => void;
}

/** Adapted from ccstatusline; font status is deliberately read-only. */
export function PowerlineSetup({ settings, onUpdate, onBack }: PowerlineSetupProps): React.JSX.Element {
  const [screen, setScreen] = useState<Screen>("menu");
  const [selected, setSelected] = useState(0);
  const [confirmEnable, setConfirmEnable] = useState(false);
  const browserRuntime = process.env.CXSTATUSLINE_WEB === "1";
  const fontFound = useMemo(() => browserRuntime ? false : detectPowerlineFont(), [browserRuntime]);
  const powerline = settings.powerline;
  const manualSeparators = settings.lines.some((line) => line.some((item) => item.type === "separator"));

  useInput((input, key) => {
    if (confirmEnable || screen !== "menu") return;
    if (key.escape) onBack();
    else if (input.toLowerCase() === "t") {
      if (powerline.enabled) onUpdate({ ...settings, powerline: { ...powerline, enabled: false } });
      else if (manualSeparators) setConfirmEnable(true);
      else onUpdate(buildEnabledPowerlineSettings(settings, false));
    } else if (input.toLowerCase() === "a" && powerline.enabled) {
      onUpdate({ ...settings, powerline: { ...powerline, autoAlign: !powerline.autoAlign } });
    } else if (input.toLowerCase() === "c" && powerline.enabled) {
      onUpdate({ ...settings, powerline: { ...powerline, continueThemeAcrossLines: !powerline.continueThemeAcrossLines } });
    }
  });

  if (screen === "separator" || screen === "startCap" || screen === "endCap") {
    return <PowerlineSeparatorEditor settings={settings} mode={screen} onUpdate={onUpdate} onBack={() => setScreen("menu")} />;
  }
  if (screen === "themes") return <PowerlineThemeSelector settings={settings} onUpdate={onUpdate} onBack={() => setScreen("menu")} />;
  if (confirmEnable) {
    return (
      <Box flexDirection="column">
        <Text color="yellow">Enabling Powerline removes manual separators from the status lines.</Text>
        <Text>Continue?</Text>
        <ConfirmDialog inline onConfirm={() => { onUpdate(buildEnabledPowerlineSettings(settings, true)); setConfirmEnable(false); }} onCancel={() => setConfirmEnable(false)} />
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold>Powerline Setup</Text>
      <Text dimColor>{browserRuntime
        ? "Font detection: unavailable in browser (the browser terminal decides glyph rendering)"
        : `Font detection: ${fontFound ? "compatible font found" : "no compatible font found"} (informational; terminal configuration controls glyph rendering)`}</Text>
      <Text>Powerline Mode: <Text color={powerline.enabled ? "green" : "red"}>{powerline.enabled ? "Enabled" : "Disabled"}</Text><Text dimColor> — press (t) to toggle</Text></Text>
      {powerline.enabled && <>
        <Text>Align Widgets: <Text color={powerline.autoAlign ? "green" : "red"}>{powerline.autoAlign ? "Enabled" : "Disabled"}</Text><Text dimColor> — press (a) to toggle</Text></Text>
        <Text>Continue Theme: <Text color={powerline.continueThemeAcrossLines ? "green" : "red"}>{powerline.continueThemeAcrossLines ? "Enabled" : "Disabled"}</Text><Text dimColor> — press (c) to toggle</Text></Text>
      </>}
      {!powerline.enabled && <Text dimColor>Enable Powerline mode to configure separators, caps, and themes.</Text>}
      <List
        marginTop={1}
        items={buildPowerlineSetupMenuItems(powerline)}
        initialSelection={selected}
        onSelectionChange={(_, index) => setSelected(index)}
        onSelect={(value) => { if (value === "back") onBack(); else setScreen(value); }}
        showBackButton
      />
    </Box>
  );
}
