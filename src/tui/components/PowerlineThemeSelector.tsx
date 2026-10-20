import { Box, Text, useInput } from "ink";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { getColorLevelString } from "../../types/ColorLevel";
import type { Settings } from "../../types/Settings";
import { getPowerlineTheme, getPowerlineThemes } from "../../utils/colors";
import { assignPowerlineThemeSlots } from "../../utils/powerline-theme-index";
import { getPlainInput } from "../../utils/input-guards";
import { ConfirmDialog } from "./ConfirmDialog";
import { List, type ListEntry } from "./List";

export function buildPowerlineThemeItems(themes: readonly string[], originalTheme: string): ListEntry<string>[] {
  return themes.map((themeName) => {
    const theme = getPowerlineTheme(themeName);
    return {
      label: theme?.name ?? themeName,
      ...(themeName === originalTheme && { sublabel: "(original)" }),
      value: themeName,
      description: theme?.description ?? "",
    };
  });
}

/** Copy a built-in palette to widget colors, then leave the user in custom mode. */
export function applyCustomPowerlineTheme(settings: Settings, themeName: string): Settings | null {
  const theme = getPowerlineTheme(themeName);
  if (!theme || themeName === "custom") return null;
  const level = getColorLevelString(settings.colorLevel);
  if (level === "none") return null;
  const colors = theme[level === "ansi16" ? "1" : level === "ansi256" ? "2" : "3"];
  if (!colors) return null;

  let nextLineSlot = 0;
  const lines = settings.lines.map((line) => {
    const { slots, nextSlot } = assignPowerlineThemeSlots(
      line,
      settings.powerline.continueThemeAcrossLines ? nextLineSlot : 0
    );
    nextLineSlot = nextSlot;

    return line.map((widget, index) => {
      const slot = slots[index];
      if (typeof slot !== "number") {
        return widget;
      }

      const color = colors.fg[slot % colors.fg.length];
      const backgroundColor = colors.bg[slot % colors.bg.length];

      return {
        ...widget,
        ...(color && { color }),
        ...(backgroundColor && { backgroundColor }),
      };
    });
  });

  return {
    ...settings,
    lines,
    powerline: { ...settings.powerline, theme: "custom" },
  };
}

export interface PowerlineThemeSelectorProps {
  settings: Settings;
  onUpdate: (settings: Settings) => void;
  onBack: () => void;
}

/** Adapted from ccstatusline's live-preview theme chooser. */
export function PowerlineThemeSelector({ settings, onUpdate, onBack }: PowerlineThemeSelectorProps): React.JSX.Element {
  const themes = useMemo(() => getPowerlineThemes(), []);
  const originalSettings = useRef(settings);
  const originalTheme = useRef(settings.powerline.theme ?? "custom");
  const [selectedIndex, setSelectedIndex] = useState(Math.max(0, themes.indexOf(originalTheme.current)));
  const [confirmCustom, setConfirmCustom] = useState(false);
  const latest = useRef({ settings, onUpdate });
  const initialized = useRef(false);

  useEffect(() => { latest.current = { settings, onUpdate }; }, [settings, onUpdate]);
  useEffect(() => {
    const theme = themes[selectedIndex];
    if (!theme || !initialized.current) {
      initialized.current = true;
      return;
    }
    latest.current.onUpdate({ ...latest.current.settings, powerline: { ...latest.current.settings.powerline, theme } });
  }, [selectedIndex, themes]);

  useInput((input, key) => {
    if (confirmCustom) return;
    const shortcut = getPlainInput(input, key);
    if (key.escape) {
      onUpdate(originalSettings.current);
      onBack();
    } else if (shortcut.toLowerCase() === "c") {
      const theme = themes[selectedIndex];
      if (theme && theme !== "custom") setConfirmCustom(true);
    }
  });

  const selectedTheme = themes[selectedIndex];
  if (confirmCustom) {
    return (
      <Box flexDirection="column">
        <Text bold color="yellow">Confirm Customization</Text>
        <Text>This copies the current theme colors to widgets and overwrites existing widget colors.</Text>
        <Text>Continue?</Text>
        <ConfirmDialog inline onConfirm={() => {
          if (selectedTheme) {
            const customized = applyCustomPowerlineTheme(settings, selectedTheme);
            if (customized) onUpdate(customized);
          }
          setConfirmCustom(false);
          onBack();
        }} onCancel={() => setConfirmCustom(false)} />
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold>Powerline Theme Selection <Text dimColor>{`| Original: ${originalTheme.current}`}</Text></Text>
      <Text dimColor>{`↑↓ navigate, Enter apply${selectedTheme && selectedTheme !== "custom" ? ", (c)ustomize theme" : ""}, Escape cancel`}</Text>
      <List
        marginTop={1}
        items={buildPowerlineThemeItems(themes, originalTheme.current)}
        initialSelection={selectedIndex}
        onSelectionChange={(theme, index) => { if (theme !== "back") setSelectedIndex(index); }}
        onSelect={() => onBack()}
      />
      {settings.colorLevel === 1 && <Text color="yellow">16-color themes have a limited palette.</Text>}
    </Box>
  );
}
