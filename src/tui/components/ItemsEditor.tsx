import { Box, Text, useInput } from "ink";
import React, { useMemo, useState } from "react";
import type { Settings } from "../../types/Settings";
import type { Widget, WidgetItem, WidgetType } from "../../types/Widget";
import { WIDGET_MANIFEST } from "../../utils/widget-manifest";
import { getWidget } from "../../utils/widgets";
import { ConfirmDialog } from "./ConfirmDialog";
import { HideStatesEditor } from "./HideStatesEditor";
import { EDIT_HIDE_STATES_ACTION, getHideModifierText } from "../../widgets/shared/hideable";
import {
  customKeybindsFor,
  filterWidgetCatalog,
  handleMoveInputMode,
  handleNormalInputMode,
  handlePickerInputMode,
  normalizePickerState,
  type CustomEditorWidgetState,
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

function getWidgetImpl(type: WidgetType): Widget | null {
  try {
    return getWidget(type);
  } catch {
    return null;
  }
}

function isLayout(type: WidgetType): boolean {
  return type === "separator" || type === "flex-separator";
}

/** Catalog rows come from the widgets themselves (upstream parity); separators stay under Layout. */
function buildCatalog(): WidgetCatalogEntry[] {
  return WIDGET_MANIFEST.map(({ type }) => {
    const impl = isLayout(type) ? null : getWidgetImpl(type);
    const displayName = impl ? impl.getDisplayName() : displayWidgetType(type);
    const description = impl ? impl.getDescription() : displayName;
    const category = impl ? impl.getCategory() : "Layout";
    return { type, displayName, description, category, searchText: `${displayName} ${type}`.toLowerCase() };
  });
}

/** One list row: separators show their character, widgets show their own editor display. */
function rowLabel(widget: WidgetItem): string {
  if (widget.type === "separator") return `${displayWidgetType(widget.type)} (${widget.character ?? "|"})`;
  const impl = isLayout(widget.type) ? null : getWidgetImpl(widget.type);
  if (!impl) return displayWidgetType(widget.type);
  const { displayText, modifierText } = impl.getEditorDisplay(widget);
  const hideModifierText = impl ? getHideModifierText(widget, impl.getHideableStates?.() ?? []) : undefined;
  const parts = [displayText];
  if (modifierText) parts.push(modifierText);
  if (hideModifierText) parts.push(hideModifierText);
  return parts.join(" ");
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
  const [customEditor, setCustomEditor] = useState<CustomEditorWidgetState | null>(null);
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
    if (customEditor) return;
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
      getWidgetImpl,
      setCustomEditorWidget: setCustomEditor,
    });
  });

  if (customEditor?.action === EDIT_HIDE_STATES_ACTION) {
    return (
      <HideStatesEditor
        widget={customEditor.widget}
        states={customEditor.impl.getHideableStates?.() ?? []}
        onComplete={(updated) => {
          onUpdate(widgets.map((widget, index) => index === selectedIndex ? updated : widget));
          setCustomEditor(null);
        }}
        onCancel={() => setCustomEditor(null)}
      />
    );
  }

  if (customEditor?.impl.renderEditor) {
    const editor = customEditor.impl.renderEditor({
      widget: customEditor.widget,
      action: customEditor.action,
      onComplete: (updated) => {
        onUpdate(widgets.map((widget, index) => index === selectedIndex ? updated : widget));
        setCustomEditor(null);
      },
      onCancel: () => setCustomEditor(null),
    });
    return editor ?? <Text>Unknown editor</Text>;
  }

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

  const current = widgets[selectedIndex];
  const customLabels = customKeybindsFor(current ? getWidgetImpl(current.type) : null, current).map((entry) => entry.label).join(", ");
  const normalHelp = "↑↓ select, ←→ change, Enter move, (a)dd, (i)nsert, (d)elete, (k)opy, (c)lear, Escape back";

  return (
    <Box flexDirection="column">
      <Text bold>{`Edit Line ${lineNumber}`}{moveMode && <Text color="blue"> [MOVE MODE]</Text>}</Text>
      <Text dimColor>{moveMode ? "↑↓ to move, Escape or Enter to finish" : customLabels ? `${normalHelp}, ${customLabels}` : normalHelp}</Text>
      <Box marginTop={1} flexDirection="column">
        {widgets.length
          ? widgets.map((widget, index) => <Text key={widget.id} {...(index === selectedIndex && { color: "green" })}>{index === selectedIndex ? "▶  " : "   "}{rowLabel(widget)}</Text>)
          : <Text dimColor>No widgets yet. Press (a) to add one.</Text>}
      </Box>
    </Box>
  );
}
