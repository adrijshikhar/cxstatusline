import { Box, Text, useInput } from "ink";
import React, { useMemo, useState } from "react";
import type { Settings } from "../../types/Settings";
import type { WidgetItem, WidgetType } from "../../types/Widget";
import { WIDGET_MANIFEST } from "../../utils/widget-manifest";
import { ConfirmDialog } from "./ConfirmDialog";
import {
  filterWidgetCatalog,
  handleMoveInputMode,
  handleNormalInputMode,
  handlePickerInputMode,
  normalizePickerState,
  type WidgetCatalogEntry,
  type WidgetPickerAction,
  type WidgetPickerState,
} from "./items-editor/input-handlers";

export interface ItemsEditorProps {
  widgets: WidgetItem[];
  onUpdate: (widgets: WidgetItem[]) => void;
  onBack: () => void;
  lineNumber: number;
  settings: Settings;
}

export function displayWidgetType(type: WidgetType): string {
  if (type === "flex-separator") return "Flex Separator";
  return type.replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function categoryFor(type: WidgetType): string {
  if (type === "separator" || type === "flex-separator") return "Layout";
  if (type.startsWith("git-")) return "Git";
  if (type.includes("token") || type.includes("context") || type.includes("cache") || type.includes("speed")) return "Usage";
  if (type.includes("five-hour") || type.includes("weekly")) return "Limits";
  if (type === "model" || type === "thinking-effort") return "Model";
  return "Session";
}

function buildCatalog(): WidgetCatalogEntry[] {
  return WIDGET_MANIFEST.map(({ type }) => {
    const displayName = displayWidgetType(type);
    return { type, displayName, description: displayName, category: categoryFor(type), searchText: `${displayName} ${type}`.toLowerCase() };
  });
}

function newWidget(type: WidgetType): WidgetItem {
  return {
    id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
    type,
    ...(type === "separator" && { character: "|" }),
  };
}

export function ItemsEditor({ widgets, onUpdate, onBack, lineNumber, settings: _settings }: ItemsEditorProps): React.JSX.Element {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [moveMode, setMoveMode] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [widgetPicker, setWidgetPicker] = useState<WidgetPickerState | null>(null);
  const widgetCatalog = useMemo(buildCatalog, []);
  const widgetCategories = useMemo(() => ["All", ...new Set(widgetCatalog.map((entry) => entry.category))], [widgetCatalog]);

  const openWidgetPicker = (action: WidgetPickerAction): void => {
    const selectedType = action === "change" ? widgets[selectedIndex]?.type ?? null : null;
    setWidgetPicker(normalizePickerState({
      action,
      level: "category",
      selectedCategory: "All",
      categoryQuery: "",
      widgetQuery: "",
      selectedType,
    }, widgetCatalog, widgetCategories));
  };

  const applyWidgetPickerSelection = (type: WidgetType): void => {
    if (!widgetPicker) return;
    if (widgetPicker.action === "change") {
      const current = widgets[selectedIndex];
      if (current) onUpdate(widgets.map((widget, index) => index === selectedIndex ? { ...widget, type } : widget));
    } else {
      const insertIndex = widgetPicker.action === "add" ? selectedIndex + 1 : selectedIndex;
      const index = widgets.length ? insertIndex : 0;
      onUpdate([...widgets.slice(0, index), newWidget(type), ...widgets.slice(index)]);
      setSelectedIndex(index);
    }
    setWidgetPicker(null);
  };

  useInput((input, key) => {
    if (showClearConfirm) return;
    if (widgetPicker) {
      handlePickerInputMode({ input, key, widgetPicker, widgetCatalog, widgetCategories, setWidgetPicker, applyWidgetPickerSelection });
      return;
    }
    if (moveMode) {
      handleMoveInputMode({ key, widgets, selectedIndex, onUpdate, setSelectedIndex, setMoveMode });
      return;
    }
    handleNormalInputMode({
      input,
      key,
      widgets,
      selectedIndex,
      separatorChars: ["|", "-", ",", " "],
      onBack,
      onUpdate,
      setSelectedIndex,
      setMoveMode,
      setShowClearConfirm,
      openWidgetPicker,
    });
  });

  if (showClearConfirm) {
    return (
      <Box flexDirection="column">
        <Text bold>Clear every widget from Line {lineNumber}?</Text>
        <ConfirmDialog inline onConfirm={() => { onUpdate([]); setSelectedIndex(0); setShowClearConfirm(false); }} onCancel={() => setShowClearConfirm(false)} />
      </Box>
    );
  }

  if (widgetPicker) {
    const topLevelSearch = widgetPicker.level === "category" && widgetPicker.categoryQuery.trim().length > 0;
    const query = topLevelSearch ? widgetPicker.categoryQuery : widgetPicker.widgetQuery;
    const entries = filterWidgetCatalog(widgetCatalog, topLevelSearch ? "All" : (widgetPicker.selectedCategory ?? "All"), query);
    return (
      <Box flexDirection="column">
        <Text bold>{widgetPicker.action === "change" ? "Change Widget" : "Add Widget"}</Text>
        <Text dimColor>{widgetPicker.level === "category" ? "Type to search; Enter to choose; Escape to go back" : "Type to search; Enter to add; Escape to go back"}</Text>
        <Text>{`Search: ${query}`}</Text>
        <Box marginTop={1} flexDirection="column">
          {widgetPicker.level === "category" && !topLevelSearch
            ? widgetCategories.map((category) => <Text key={category} {...(category === widgetPicker.selectedCategory && { color: "green" })}>{category === widgetPicker.selectedCategory ? "▶  " : "   "}{category}</Text>)
            : entries.length
              ? entries.map((entry) => <Text key={entry.type} {...(entry.type === widgetPicker.selectedType && { color: "green" })}>{entry.type === widgetPicker.selectedType ? "▶  " : "   "}{entry.displayName}</Text>)
              : <Text dimColor>No widgets match this search.</Text>}
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold>{`Edit Line ${lineNumber}`}{moveMode && <Text color="blue"> [MOVE MODE]</Text>}</Text>
      <Text dimColor>{moveMode ? "↑↓ to move, Escape or Enter to finish" : "↑↓ select, ←→ change, Enter move, (a)dd, (i)nsert, (d)elete, (k)opy, (c)lear, Escape back"}</Text>
      <Box marginTop={1} flexDirection="column">
        {widgets.length
          ? widgets.map((widget, index) => <Text key={widget.id} {...(index === selectedIndex && { color: "green" })}>{index === selectedIndex ? "▶  " : "   "}{displayWidgetType(widget.type)}{widget.type === "separator" ? ` (${widget.character ?? "|"})` : ""}</Text>)
          : <Text dimColor>No widgets yet. Press (a) to add one.</Text>}
      </Box>
    </Box>
  );
}
