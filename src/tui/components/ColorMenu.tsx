import { Box, Text, useInput } from "ink";
import React, { useState } from "react";
import { getColorLevelString } from "../../types/ColorLevel";
import type { Settings } from "../../types/Settings";
import type { WidgetItem } from "../../types/Widget";
import { getAvailableBackgroundColorsForUI, getAvailableColorsForUI, applyColors } from "../../utils/colors";
import { ConfirmDialog } from "./ConfirmDialog";
import { displayWidgetType } from "./ItemsEditor";
import {
  clearAllWidgetStyling,
  cycleWidgetColor,
  cycleWidgetDim,
  resetWidgetStyling,
  setWidgetColor,
  toggleWidgetBold,
} from "./color-menu/mutations";

export interface ColorMenuProps {
  widgets: WidgetItem[];
  lineIndex: number;
  settings: Settings;
  onUpdate: (widgets: WidgetItem[]) => void;
  onBack: () => void;
}

function isTextInput(input: string, key: { ctrl: boolean; meta: boolean; tab: boolean }): boolean {
  return Boolean(input && !key.ctrl && !key.meta && !key.tab);
}

export function ColorMenu({ widgets, lineIndex, settings, onUpdate, onBack }: ColorMenuProps): React.JSX.Element {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [showSeparators, setShowSeparators] = useState(false);
  const [editingBackground, setEditingBackground] = useState(false);
  const [hexInput, setHexInput] = useState<string | null>(null);
  const [ansiInput, setAnsiInput] = useState<string | null>(null);
  const [clearConfirm, setClearConfirm] = useState(false);
  const colorable = widgets.filter((widget) => widget.type !== "separator" && widget.type !== "flex-separator" || showSeparators);
  const selected = colorable[selectedIndex];
  const colors = getAvailableColorsForUI().map((entry) => entry.value);
  const backgrounds = getAvailableBackgroundColorsForUI().map((entry) => entry.value);

  useInput((input, key) => {
    if (clearConfirm) return;
    if (hexInput !== null) {
      if (key.escape) setHexInput(null);
      else if (key.return) {
        if (hexInput.length === 6 && selected) onUpdate(setWidgetColor(widgets, selected.id, `hex:${hexInput}`, editingBackground));
        setHexInput(null);
      } else if (key.backspace || key.delete) setHexInput((value) => value?.slice(0, -1) ?? null);
      else if (isTextInput(input, key) && /^[0-9a-f]$/i.test(input) && hexInput.length < 6) setHexInput(hexInput + input.toUpperCase());
      return;
    }
    if (ansiInput !== null) {
      if (key.escape) setAnsiInput(null);
      else if (key.return) {
        const value = Number.parseInt(ansiInput, 10);
        if (selected && Number.isInteger(value) && value >= 0 && value <= 255) onUpdate(setWidgetColor(widgets, selected.id, `ansi256:${value}`, editingBackground));
        setAnsiInput(null);
      } else if (key.backspace || key.delete) setAnsiInput((value) => value?.slice(0, -1) ?? null);
      else if (isTextInput(input, key) && /^[0-9]$/.test(input) && ansiInput.length < 3) setAnsiInput(ansiInput + input);
      return;
    }
    if (key.escape) {
      onBack();
    } else if (key.upArrow && colorable.length) {
      setSelectedIndex((index) => index === 0 ? colorable.length - 1 : index - 1);
    } else if (key.downArrow && colorable.length) {
      setSelectedIndex((index) => index === colorable.length - 1 ? 0 : index + 1);
    } else if (key.leftArrow || key.rightArrow) {
      if (selected) onUpdate(cycleWidgetColor({ widgets, widgetId: selected.id, direction: key.rightArrow ? "right" : "left", editingBackground, colors, backgroundColors: backgrounds }));
    } else if (input.toLowerCase() === "f") {
      setEditingBackground((value) => !value);
    } else if (input.toLowerCase() === "b" && selected) {
      onUpdate(toggleWidgetBold(widgets, selected.id));
    } else if (input.toLowerCase() === "d" && selected) {
      onUpdate(cycleWidgetDim(widgets, selected.id));
    } else if (input.toLowerCase() === "r" && selected) {
      onUpdate(resetWidgetStyling(widgets, selected.id));
    } else if (input.toLowerCase() === "c") {
      setClearConfirm(true);
    } else if (input.toLowerCase() === "s" && !settings.powerline.enabled && !settings.defaultSeparator) {
      setShowSeparators((value) => !value);
      setSelectedIndex(0);
    } else if (input.toLowerCase() === "h" && settings.colorLevel === 3 && selected) {
      setHexInput("");
    } else if (input.toLowerCase() === "a" && settings.colorLevel === 2 && selected) {
      setAnsiInput("");
    }
  });

  if (clearConfirm) {
    return (
      <Box flexDirection="column">
        <Text bold>Clear all widget styling?</Text>
        <ConfirmDialog inline onConfirm={() => { onUpdate(clearAllWidgetStyling(widgets)); setClearConfirm(false); }} onCancel={() => setClearConfirm(false)} />
      </Box>
    );
  }

  if (!colorable.length) {
    return <Box flexDirection="column"><Text bold>{`Colors — Line ${lineIndex + 1}`}</Text><Text dimColor>No colorable widgets. Press Escape to go back.</Text></Box>;
  }

  const inputMode = hexInput !== null ? `Hex: #${hexInput}` : ansiInput !== null ? `ANSI 256: ${ansiInput}` : null;
  return (
    <Box flexDirection="column">
      <Text bold>{`Colors — Line ${lineIndex + 1}`}{editingBackground && <Text color="yellow"> [Background]</Text>}</Text>
      {inputMode ? <Text>{inputMode}<Text dimColor>  Enter to apply, Escape to cancel</Text></Text> : <Text dimColor>{`↑↓ select, ←→ cycle ${editingBackground ? "background" : "foreground"}, (f)g/bg, (b)old, (d)im, (r)eset, (c)lear${settings.colorLevel === 3 ? ", (h)ex" : settings.colorLevel === 2 ? ", (a)nsi256" : ""}, Escape back`}</Text>}
      <Box marginTop={1} flexDirection="column">
        {colorable.map((widget, index) => {
          const label = displayWidgetType(widget.type);
          const styled = applyColors(label, widget.color, widget.backgroundColor, widget.bold, getColorLevelString(settings.colorLevel), widget.dim);
          return <Text key={widget.id} {...(index === selectedIndex && { color: "green" })}>{index === selectedIndex ? "▶  " : "   "}{styled}</Text>;
        })}
      </Box>
      {!settings.powerline.enabled && !settings.defaultSeparator && <Text dimColor>{`(s)how separators: ${showSeparators ? "ON" : "OFF"}`}</Text>}
    </Box>
  );
}
