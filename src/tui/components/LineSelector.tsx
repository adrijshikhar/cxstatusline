import { Box, Text, useInput } from "ink";
import React, { useEffect, useState } from "react";
import type { WidgetItem } from "../../types/Widget";
import { ConfirmDialog } from "./ConfirmDialog";
import { List } from "./List";

export interface LineSelectorProps {
  lines: WidgetItem[][];
  onSelect: (line: number) => void;
  onBack: () => void;
  onLinesUpdate?: (lines: WidgetItem[][]) => void;
  initialSelection?: number;
  title?: string;
  allowEditing?: boolean;
}

function cloneLines(lines: WidgetItem[][]): WidgetItem[][] {
  return lines.map((line) => line.map((item) => ({ ...item, ...(item.metadata && { metadata: { ...item.metadata } }) })));
}

function lineSummary(line: WidgetItem[]): string {
  return line.length === 1 ? "1 widget" : line.length ? `${line.length} widgets` : "empty";
}

export function LineSelector({
  lines,
  onSelect,
  onBack,
  onLinesUpdate,
  initialSelection = 0,
  title = "Edit Lines",
  allowEditing = false,
}: LineSelectorProps): React.JSX.Element {
  const [selectedIndex, setSelectedIndex] = useState(initialSelection);
  const [localLines, setLocalLines] = useState(() => cloneLines(lines));
  const [moveMode, setMoveMode] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [limitMessage, setLimitMessage] = useState<string | null>(null);

  useEffect(() => {
    setLocalLines(cloneLines(lines));
    setSelectedIndex((current) => Math.min(current, Math.max(0, lines.length - 1)));
  }, [lines]);

  const update = (nextLines: WidgetItem[][]): void => {
    const cloned = cloneLines(nextLines);
    setLocalLines(cloned);
    onLinesUpdate?.(cloned);
  };

  useInput((input, key) => {
    if (confirmDelete) return;
    if (moveMode) {
      if (key.upArrow || key.downArrow) {
        if (localLines.length < 2) return;
        const target = key.upArrow
          ? (selectedIndex === 0 ? localLines.length - 1 : selectedIndex - 1)
          : (selectedIndex === localLines.length - 1 ? 0 : selectedIndex + 1);
        const next = cloneLines(localLines);
        const current = next[selectedIndex];
        const replacement = next[target];
        if (current && replacement) [next[selectedIndex], next[target]] = [replacement, current];
        update(next);
        setSelectedIndex(target);
      } else if (key.escape || key.return) {
        setMoveMode(false);
      }
      return;
    }

    if (input === "a" && allowEditing) {
      if (localLines.length >= 3) {
        setLimitMessage("Maximum of 3 lines");
      } else {
        const next = [...cloneLines(localLines), []];
        update(next);
        setSelectedIndex(next.length - 1);
        setLimitMessage(null);
      }
      return;
    }
    if (input === "d" && allowEditing && localLines.length > 1) {
      setConfirmDelete(true);
      return;
    }
    if (input === "m" && allowEditing && localLines.length > 1) {
      setMoveMode(true);
      return;
    }
    if (key.escape) onBack();
  });

  if (confirmDelete) {
    return (
      <Box flexDirection="column">
        <Text bold>{`Delete Line ${selectedIndex + 1}?`}</Text>
        <Text dimColor>{lineSummary(localLines[selectedIndex] ?? [])}</Text>
        <ConfirmDialog
          inline
          onConfirm={() => {
            const next = localLines.filter((_, index) => index !== selectedIndex);
            update(next);
            setSelectedIndex(Math.max(0, selectedIndex - 1));
            setConfirmDelete(false);
          }}
          onCancel={() => setConfirmDelete(false)}
        />
      </Box>
    );
  }

  if (moveMode) {
    return (
      <Box flexDirection="column">
        <Text bold>{title} <Text color="blue">[MOVE MODE]</Text></Text>
        <Text dimColor>↑↓ to move a line, Escape or Enter to finish</Text>
        <Box marginTop={1} flexDirection="column">
          {localLines.map((line, index) => <Text key={index} {...(index === selectedIndex && { color: "green" })}>
            {index === selectedIndex ? "◆  " : "   "}{`Line ${index + 1} (${lineSummary(line)})`}
          </Text>)}
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold>{title}</Text>
      <Text dimColor>{allowEditing ? "Enter to edit; (a)dd, (d)elete, (m)ove; Escape to cancel" : "Enter to choose a line; Escape to cancel"}</Text>
      {limitMessage && <Text color="yellow">{limitMessage}</Text>}
      <List
        marginTop={1}
        items={localLines.map((line, index) => ({ label: `Line ${index + 1}`, sublabel: `(${lineSummary(line)})`, value: index }))}
        initialSelection={selectedIndex}
        onSelectionChange={(_, index) => setSelectedIndex(index)}
        onSelect={(line) => line === "back" ? onBack() : onSelect(line)}
        showBackButton
      />
    </Box>
  );
}
