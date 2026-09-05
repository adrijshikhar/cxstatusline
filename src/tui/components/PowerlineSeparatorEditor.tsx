import { Box, Text, useInput } from "ink";
import React, { useState } from "react";
import type { Settings } from "../../types/Settings";

export type PowerlineEditorMode = "separator" | "startCap" | "endCap";

export interface PowerlineSeparatorEditorProps {
  settings: Settings;
  mode: PowerlineEditorMode;
  onUpdate: (settings: Settings) => void;
  onBack: () => void;
}

const PRESETS: Record<PowerlineEditorMode, readonly { char: string; name: string }[]> = {
  separator: [
    { char: "\uE0B0", name: "Triangle Right" }, { char: "\uE0B2", name: "Triangle Left" },
    { char: "\uE0B4", name: "Round Right" }, { char: "\uE0B6", name: "Round Left" },
  ],
  startCap: [
    { char: "\uE0B2", name: "Triangle" }, { char: "\uE0B6", name: "Round" },
    { char: "\uE0BA", name: "Lower Triangle" }, { char: "\uE0BE", name: "Diagonal" },
  ],
  endCap: [
    { char: "\uE0B0", name: "Triangle" }, { char: "\uE0B4", name: "Round" },
    { char: "\uE0B8", name: "Lower Triangle" }, { char: "\uE0BC", name: "Diagonal" },
  ],
};

function itemsFor(settings: Settings, mode: PowerlineEditorMode): string[] {
  if (mode === "separator") return settings.powerline.separators;
  return mode === "startCap" ? settings.powerline.startCaps : settings.powerline.endCaps;
}

function titleFor(mode: PowerlineEditorMode): string {
  return mode === "separator" ? "Powerline Separator Configuration" : mode === "startCap"
    ? "Powerline Start Cap Configuration" : "Powerline End Cap Configuration";
}

function isLeftFacing(char: string): boolean {
  return char === "\uE0B2" || char === "\uE0B6";
}

function acceptsText(input: string, key: { ctrl: boolean; meta: boolean; tab: boolean }): boolean {
  return Boolean(input && !key.ctrl && !key.meta && !key.tab);
}

/** Adapted from ccstatusline's Powerline glyph editor. */
export function PowerlineSeparatorEditor({ settings, mode, onUpdate, onBack }: PowerlineSeparatorEditorProps): React.JSX.Element {
  const items = itemsFor(settings, mode);
  const presets = PRESETS[mode];
  const inversions = mode === "separator" ? settings.powerline.separatorInvertBackground : [];
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [hexInput, setHexInput] = useState<string | null>(null);

  const update = (nextItems: string[], nextInversions = inversions): void => {
    const powerline = mode === "separator"
      ? { ...settings.powerline, separators: nextItems, separatorInvertBackground: nextInversions }
      : mode === "startCap"
        ? { ...settings.powerline, startCaps: nextItems }
        : { ...settings.powerline, endCaps: nextItems };
    onUpdate({ ...settings, powerline });
  };

  const selected = Math.min(selectedIndex, Math.max(0, items.length - 1));
  useInput((input, key) => {
    if (hexInput !== null) {
      if (key.escape) setHexInput(null);
      else if (key.return) {
        const point = Number.parseInt(hexInput, 16);
        if (hexInput.length >= 4 && hexInput.length <= 6 && Number.isInteger(point) && point >= 0 && point <= 0x10ffff) {
          const next = [...items];
          if (next.length) next[selected] = String.fromCodePoint(point);
          else next.push(String.fromCodePoint(point));
          update(next);
          setHexInput(null);
        }
      } else if (key.backspace || key.delete) setHexInput((value) => value?.slice(0, -1) ?? null);
      else if (acceptsText(input, key) && /^[0-9a-f]$/i.test(input) && hexInput.length < 6) setHexInput(hexInput + input.toUpperCase());
      return;
    }
    if (key.escape) onBack();
    else if (key.upArrow && items.length) setSelectedIndex((index) => index === 0 ? items.length - 1 : index - 1);
    else if (key.downArrow && items.length) setSelectedIndex((index) => index === items.length - 1 ? 0 : index + 1);
    else if ((key.leftArrow || key.rightArrow) && items.length) {
      const current = items[selected] ?? presets[0]?.char ?? "\uE0B0";
      const currentIndex = presets.findIndex((preset) => preset.char === current);
      const presetIndex = currentIndex < 0
        ? (key.rightArrow ? 0 : presets.length - 1)
        : key.rightArrow
          ? (currentIndex + 1) % presets.length
          : (currentIndex - 1 + presets.length) % presets.length;
      const char = presets[presetIndex]?.char ?? "\uE0B0";
      const next = [...items];
      next[selected] = char;
      const nextInversions = [...inversions];
      if (mode === "separator") nextInversions[selected] = isLeftFacing(char);
      update(next, nextInversions);
    } else if (input.toLowerCase() === "a" || input.toLowerCase() === "i") {
      const next = [...items];
      const char = presets[0]?.char ?? "\uE0B0";
      const index = input.toLowerCase() === "a" ? selected + 1 : selected;
      next.splice(items.length ? index : 0, 0, char);
      const nextInversions = [...inversions];
      if (mode === "separator") nextInversions.splice(items.length ? index : 0, 0, isLeftFacing(char));
      update(next, nextInversions);
      setSelectedIndex(items.length ? index : 0);
    } else if (input.toLowerCase() === "d" && (mode !== "separator" || items.length > 1)) {
      const next = items.filter((_, index) => index !== selected);
      update(next, inversions.filter((_, index) => index !== selected));
      setSelectedIndex(Math.min(selected, Math.max(0, next.length - 1)));
    } else if (input.toLowerCase() === "c") {
      update(mode === "separator" ? ["\uE0B0"] : [], mode === "separator" ? [false] : []);
      setSelectedIndex(0);
    } else if (input.toLowerCase() === "h") setHexInput("");
    else if (input.toLowerCase() === "t" && mode === "separator" && items.length) {
      const next = [...inversions];
      next[selected] = !next[selected];
      update(items, next);
    }
  });

  if (hexInput !== null) {
    return <Box flexDirection="column"><Text bold>{titleFor(mode)}</Text><Text>{`U+${hexInput}`}<Text inverse> </Text></Text><Text dimColor>Enter 4–6 hexadecimal digits, Escape to cancel</Text></Box>;
  }

  return (
    <Box flexDirection="column">
      <Text bold>{titleFor(mode)}</Text>
      <Text dimColor>{`↑↓ select, ←→ cycle, (a)dd, (i)nsert${mode !== "separator" || items.length > 1 ? ", (d)elete" : ""}, (c)lear, (h)ex${mode === "separator" ? ", (t)oggle invert" : ""}, Escape back`}</Text>
      <Box marginTop={1} flexDirection="column">
        {items.length ? items.map((item, index) => {
          const preset = presets.find((entry) => entry.char === item);
          const code = item.codePointAt(0)?.toString(16).toUpperCase().padStart(4, "0");
          const label = preset ? `${item} - ${preset.name}` : `${item} - Custom (U+${code})`;
          return <Text key={`${item}-${index}`} {...(index === selected && { color: "green" })}>{index === selected ? "▶  " : "   "}{`${index + 1}: ${label}${mode === "separator" && inversions[index] ? " [Inverted]" : ""}`}</Text>;
        }) : <Text dimColor>(none configured — press a to add)</Text>}
      </Box>
    </Box>
  );
}
