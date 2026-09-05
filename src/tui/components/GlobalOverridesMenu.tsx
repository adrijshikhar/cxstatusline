import { Box, Text, useInput } from "ink";
import React, { useState } from "react";
import { getColorLevelString } from "../../types/ColorLevel";
import { DefaultPaddingSideSchema, type Settings } from "../../types/Settings";
import { applyColors, getAvailableBackgroundColorsForUI, getAvailableColorsForUI } from "../../utils/colors";
import { GRADIENT_PRESET_NAMES } from "../../utils/gradient";
import { ConfirmDialog } from "./ConfirmDialog";

export interface GlobalOverridesMenuProps {
  settings: Settings;
  onUpdate: (settings: Settings) => void;
  onBack: () => void;
}

type EditField = "padding" | "separator" | null;

function acceptsText(input: string, key: { ctrl: boolean; meta: boolean; tab: boolean }): boolean {
  return Boolean(input && !key.ctrl && !key.meta && !key.tab);
}

function cycle(values: readonly string[], current: string | undefined): string | undefined {
  const index = Math.max(0, values.indexOf(current ?? ""));
  return values[(index + 1) % values.length] || undefined;
}

export function GlobalOverridesMenu({ settings, onUpdate, onBack }: GlobalOverridesMenuProps): React.JSX.Element {
  const [editing, setEditing] = useState<EditField>(null);
  const [value, setValue] = useState("");
  const [confirmSeparator, setConfirmSeparator] = useState(false);
  const [gradientMode, setGradientMode] = useState(false);
  const [gradientIndex, setGradientIndex] = useState(0);
  const [gradientStep, setGradientStep] = useState<"start" | "end" | null>(null);
  const [gradientStart, setGradientStart] = useState("");
  const [gradientInput, setGradientInput] = useState("");
  const foregrounds = getAvailableColorsForUI().map((entry) => entry.value);
  const backgrounds = getAvailableBackgroundColorsForUI().map((entry) => entry.value);
  const powerline = settings.powerline.enabled;

  const commitText = (): void => {
    if (editing === "padding") onUpdate({ ...settings, defaultPadding: value || undefined });
    if (editing === "separator") {
      const hasManualSeparators = settings.lines.some((line) => line.some((item) => item.type === "separator"));
      if (value && hasManualSeparators) setConfirmSeparator(true);
      else onUpdate({ ...settings, defaultSeparator: value || undefined });
    }
    if (editing !== "separator" || !value || !settings.lines.some((line) => line.some((item) => item.type === "separator"))) setEditing(null);
  };

  useInput((input, key) => {
    if (confirmSeparator) return;
    if (gradientMode) {
      const closeGradient = (): void => {
        setGradientMode(false);
        setGradientStep(null);
        setGradientStart("");
        setGradientInput("");
      };
      const applyGradient = (next: string): void => {
        onUpdate({ ...settings, overrideForegroundColor: next });
        closeGradient();
      };
      if (gradientStep) {
        if (key.escape) {
          setGradientStep(null);
          setGradientInput("");
        } else if (key.return && gradientInput.length === 6) {
          if (gradientStep === "start") {
            setGradientStart(gradientInput);
            setGradientInput("");
            setGradientStep("end");
          } else {
            applyGradient(`gradient:${gradientStart}-${gradientInput}`);
          }
        } else if (key.backspace || key.delete) {
          setGradientInput((current) => current.slice(0, -1));
        } else if (acceptsText(input, key) && /^[0-9a-f]$/i.test(input) && gradientInput.length < 6) {
          setGradientInput((current) => current + input.toUpperCase());
        }
      } else {
        const count = GRADIENT_PRESET_NAMES.length + 1;
        if (key.escape) closeGradient();
        else if (key.upArrow) setGradientIndex((index) => (index - 1 + count) % count);
        else if (key.downArrow) setGradientIndex((index) => (index + 1) % count);
        else if (key.return) {
          const preset = GRADIENT_PRESET_NAMES[gradientIndex];
          if (preset) applyGradient(`gradient:${preset}`);
          else {
            setGradientStep("start");
            setGradientInput("");
          }
        }
      }
      return;
    }
    if (editing) {
      if (key.escape) {
        setEditing(null);
      } else if (key.return) {
        commitText();
      } else if (key.backspace || key.delete) {
        setValue((current) => current.slice(0, -1));
      } else if (acceptsText(input, key)) {
        setValue((current) => current + input);
      }
      return;
    }
    if (key.escape) onBack();
    else if (input.toLowerCase() === "p") { setValue(settings.defaultPadding ?? ""); setEditing("padding"); }
    else if (input.toLowerCase() === "s" && !powerline) { setValue(settings.defaultSeparator ?? ""); setEditing("separator"); }
    else if (input.toLowerCase() === "i" && !powerline) onUpdate({ ...settings, inheritSeparatorColors: !settings.inheritSeparatorColors });
    else if (input.toLowerCase() === "o") onUpdate({ ...settings, globalBold: !settings.globalBold });
    else if (input.toLowerCase() === "m") onUpdate({ ...settings, minimalistMode: !settings.minimalistMode });
    else if (input.toLowerCase() === "f") onUpdate({ ...settings, overrideForegroundColor: cycle(foregrounds, settings.overrideForegroundColor) });
    else if (input.toLowerCase() === "g") { setGradientMode(true); setGradientIndex(0); }
    else if (input.toLowerCase() === "x") onUpdate({ ...settings, overrideForegroundColor: undefined });
    else if (input.toLowerCase() === "b" && !powerline) onUpdate({ ...settings, overrideBackgroundColor: cycle(backgrounds, settings.overrideBackgroundColor) });
    else if (input.toLowerCase() === "c" && !powerline) onUpdate({ ...settings, overrideBackgroundColor: undefined });
    else if (input.toLowerCase() === "d") {
      const options = DefaultPaddingSideSchema.options;
      const index = Math.max(0, options.indexOf(settings.defaultPaddingSide));
      onUpdate({ ...settings, defaultPaddingSide: options[(index + 1) % options.length] ?? "both" });
    }
  });

  if (confirmSeparator) {
    return (
      <Box flexDirection="column">
        <Text color="yellow">Setting a default separator removes manual separators. Continue?</Text>
        <ConfirmDialog inline onConfirm={() => {
          onUpdate({ ...settings, defaultSeparator: value, lines: settings.lines.map((line) => line.filter((item) => item.type !== "separator")) });
          setConfirmSeparator(false);
          setEditing(null);
        }} onCancel={() => { setConfirmSeparator(false); setEditing(null); }} />
      </Box>
    );
  }

  if (gradientMode) {
    if (gradientStep) {
      return (
        <Box flexDirection="column">
          <Text bold>Custom Gradient — Override FG Color</Text>
          <Text>{gradientStep === "start" ? "Enter START hex color:" : "Enter END hex color:"}</Text>
          {gradientStep === "end" && <Text dimColor>{`Start: #${gradientStart}`}</Text>}
          <Text>{`#${gradientInput}`}<Text dimColor>{"_".repeat(6 - gradientInput.length)}</Text></Text>
          <Text dimColor>Enter to continue, Escape to go back</Text>
        </Box>
      );
    }
    const level = getColorLevelString(settings.colorLevel);
    return (
      <Box flexDirection="column">
        <Text bold>Select Gradient — Override FG Color</Text>
        <Text dimColor>↑↓ select, Enter apply, Escape cancel</Text>
        <Box marginTop={1} flexDirection="column">
          {GRADIENT_PRESET_NAMES.map((name, index) => <Text key={name}>{index === gradientIndex ? "▶ " : "  "}{applyColors(name, `gradient:${name}`, undefined, index === gradientIndex, level)}</Text>)}
          <Text>{gradientIndex === GRADIENT_PRESET_NAMES.length ? "▶ " : "  "}Custom (two hex stops)</Text>
        </Box>
      </Box>
    );
  }

  if (editing) {
    return (
      <Box flexDirection="column">
        <Text bold>{editing === "padding" ? "Default Padding" : "Default Separator"}</Text>
        <Text>{value}<Text inverse> </Text></Text>
        <Text dimColor>Enter to apply, Escape to cancel</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold>Global Overrides</Text>
      <Text dimColor>Configure rendering-wide padding, separators, and styling.</Text>
      <Text>{`Global Bold: ${settings.globalBold ? "Enabled" : "Disabled"} (o)`}</Text>
      <Text>{`Minimalist Mode: ${settings.minimalistMode ? "Enabled" : "Disabled"} (m)`}</Text>
      <Text>{`Default Padding: ${settings.defaultPadding ? JSON.stringify(settings.defaultPadding) : "none"} (p)`}</Text>
      <Text>{`Padding Side: ${settings.defaultPaddingSide} (d)`}</Text>
      <Text>{`Override FG: ${settings.overrideForegroundColor ?? "none"} (f cycle, g gradient, x clear)`}</Text>
      <Text>{powerline ? "Override BG: disabled while Powerline is active" : `Override BG: ${settings.overrideBackgroundColor ?? "none"} (b cycle, c clear)`}</Text>
      <Text>{powerline ? "Default Separator: disabled while Powerline is active" : `Default Separator: ${settings.defaultSeparator ? JSON.stringify(settings.defaultSeparator) : "none"} (s)`}</Text>
      {!powerline && <Text>{`Inherit Separator Colors: ${settings.inheritSeparatorColors ? "Enabled" : "Disabled"} (i)`}</Text>}
      <Text dimColor>Escape to cancel these changes</Text>
    </Box>
  );
}
