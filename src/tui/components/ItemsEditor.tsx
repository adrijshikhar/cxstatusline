import { Box, Text, useInput, useStdout } from "ink";
import React, { useEffect, useMemo, useRef, useState } from "react";
import type { Settings } from "../../types/Settings";
import type { Widget, WidgetItem, WidgetType } from "../../types/Widget";
import { getBackgroundColorsForPowerline } from "../../utils/colors";
import { getMatchSegments } from "../../utils/fuzzy";
import { WIDGET_MANIFEST } from "../../utils/widget-manifest";
import { getWidget } from "../../utils/widgets";
import { ConfirmDialog } from "./ConfirmDialog";
import { HideStatesEditor } from "./HideStatesEditor";
import { LabelEditor } from "./LabelEditor";
import { EDIT_HIDE_STATES_ACTION, getHideModifierText } from "../../widgets/shared/hideable";
import {
  EDIT_LABEL_ACTION,
  clearLabel,
  getLabelModifierText,
} from "../../widgets/shared/raw-or-labeled";
import { getNumberFormatModifierText } from "../../utils/number-format";
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
import {
  getDescriptionRows,
  getListWindow,
  getPickerMaxVisible,
} from "./items-editor/list-window";
import {
  getPickerInsertIndex,
  placePickerSelection,
} from "./items-editor/picker-selection";

export interface ItemsEditorProps {
  widgets: WidgetItem[];
  onUpdate: (widgets: WidgetItem[]) => void;
  // Receives the line as it would look with a pending change (a label draft,
  // or the widget highlighted in the picker), or null when nothing is being
  // previewed. Pass a stable callback.
  onPreviewChange?: (widgets: WidgetItem[] | null) => void;
  onBack: () => void;
  lineNumber: number;
  settings: Settings;
  initialSelectedIndex?: number;
  onSelectedIndexChange?: (index: number) => void;
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
  const labelModifierText = impl?.getLabelPrefix && !widget.rawValue ? getLabelModifierText(widget) : undefined;
  const numberFormatModifierText = impl.supportsNumberFormat?.() ? getNumberFormatModifierText(widget) : undefined;
  const hideModifierText = impl ? getHideModifierText(widget, impl.getHideableStates?.() ?? []) : undefined;
  const parts = [displayText];
  if (modifierText) parts.push(modifierText);
  if (labelModifierText) parts.push(labelModifierText);
  if (numberFormatModifierText) parts.push(numberFormatModifierText);
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

// The highlighted widget's description is indented under the picker list
const DESCRIPTION_INDENT = 2;

const HiddenEntriesMarker: React.FC<{ arrow: string; count: number }> = ({ arrow, count }) => (
  <Box paddingLeft={3}>
    <Text dimColor>{count > 0 ? `${arrow} ${count} more` : " "}</Text>
  </Box>
);

// Long picker lists show only the entries around the selection so the whole
// screen, status line preview included, fits in the terminal. Both marker
// rows stay reserved while windowed so the list doesn't shift as it scrolls.
function renderWindowedList<T>(
  items: T[],
  selectedIndex: number,
  maxVisible: number,
  renderItem: (item: T, index: number) => React.ReactNode
): React.ReactNode {
  const visible = getListWindow(items.length, Math.max(0, selectedIndex), maxVisible);
  const isWindowed = items.length > maxVisible;

  return (
    <>
      {isWindowed && <HiddenEntriesMarker arrow="↑" count={visible.hiddenAbove} />}
      {items.slice(visible.start, visible.end).map((item, offset) => renderItem(item, visible.start + offset))}
      {isWindowed && <HiddenEntriesMarker arrow="↓" count={visible.hiddenBelow} />}
    </>
  );
}

export function ItemsEditor({
  widgets,
  onUpdate,
  onPreviewChange,
  onBack,
  lineNumber,
  settings,
  initialSelectedIndex = 0,
  onSelectedIndexChange,
}: ItemsEditorProps): React.JSX.Element {
  const [selectedIndex, setSelectedIndex] = useState(() => Math.min(initialSelectedIndex, Math.max(0, widgets.length - 1)));
  const [moveMode, setMoveMode] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [widgetPicker, setWidgetPicker] = useState<WidgetPickerState | null>(null);
  const [pickerNewWidget, setPickerNewWidget] = useState<Omit<WidgetItem, "type"> | null>(null);
  const [customEditor, setCustomEditor] = useState<CustomEditorWidgetState | null>(null);
  const { stdout } = useStdout();
  const widgetCatalog = useMemo(buildCatalog, []);
  const widgetCategories = useMemo(() => ["All", ...new Set(widgetCatalog.map((entry) => entry.category))], [widgetCatalog]);

  const onPreviewChangeRef = useRef(onPreviewChange);
  useEffect(() => {
    onPreviewChangeRef.current = onPreviewChange;
  });

  // Discard a label draft or picker preview if navigation unmounts the editor (for example, a save dialog).
  useEffect(() => () => {
    onPreviewChangeRef.current?.(null);
  }, []);

  // Get a unique background color for powerline mode
  const getUniqueBackgroundColor = (insertIndex: number): string | undefined => {
    if (!settings.powerline.enabled || settings.powerline.theme === "custom") {
      return undefined;
    }

    const bgColors = getBackgroundColorsForPowerline();
    const prevWidget = insertIndex > 0 ? widgets[insertIndex - 1] : null;
    const nextWidget = insertIndex < widgets.length ? widgets[insertIndex] : null;

    const prevBg = prevWidget?.backgroundColor;
    const nextBg = nextWidget?.backgroundColor;

    const availableColors = bgColors.filter((color) => color !== prevBg && color !== nextBg);

    if (availableColors.length > 0) {
      const randomIndex = Math.floor(Math.random() * availableColors.length);
      return availableColors[randomIndex];
    }

    return bgColors.find((c) => c !== prevBg) ?? bgColors[0];
  };

  const openWidgetPicker = (action: WidgetPickerAction): void => {
    if (widgetCatalog.length === 0) return;
    const currentType = widgets[selectedIndex]?.type;
    const selectedType = action === "change" ? currentType ?? null : null;
    const backgroundColor = action === "change"
      ? undefined
      : getUniqueBackgroundColor(getPickerInsertIndex(action, widgets.length, selectedIndex));

    setPickerNewWidget({
      id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
      ...(backgroundColor && { backgroundColor }),
    });

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
    const placement = placePickerSelection(
      widgets,
      widgetPicker.action,
      selectedIndex,
      type,
      pickerNewWidget ?? newWidget(type)
    );
    if (placement.widgets !== widgets) {
      onUpdate(placement.widgets);
      setSelectedIndex(placement.selectedIndex);
    }
    setWidgetPicker(null);
  };

  const pickerCategories = widgetPicker ? [...widgetCategories] : [];
  const selectedPickerCategory = widgetPicker
    ? (widgetPicker.selectedCategory && pickerCategories.includes(widgetPicker.selectedCategory)
      ? widgetPicker.selectedCategory
      : (pickerCategories[0] ?? null))
    : null;
  const topLevelSearchEntries = widgetPicker?.level === "category" && widgetPicker.categoryQuery.trim().length > 0
    ? filterWidgetCatalog(widgetCatalog, "All", widgetPicker.categoryQuery)
    : [];
  const selectedTopLevelSearchEntry = widgetPicker
    ? (topLevelSearchEntries.find((entry) => entry.type === widgetPicker.selectedType) ?? topLevelSearchEntries[0])
    : null;
  const pickerEntries = widgetPicker
    ? filterWidgetCatalog(widgetCatalog, selectedPickerCategory ?? "All", widgetPicker.widgetQuery)
    : [];
  const selectedPickerEntry = widgetPicker
    ? (pickerEntries.find((entry) => entry.type === widgetPicker.selectedType) ?? pickerEntries[0])
    : null;

  // Sized so the whole picker screen fits in the terminal, with room for the
  // tallest description the list can show.
  const browsedEntries = widgetPicker?.level === "widget" ? pickerEntries : topLevelSearchEntries;
  const tty = stdout as NodeJS.WriteStream | undefined;
  const descriptionWidth = tty?.columns ? tty.columns - DESCRIPTION_INDENT : undefined;
  const pickerMaxVisible = getPickerMaxVisible(
    tty?.rows,
    settings.lines.filter((line) => line.length > 0).length,
    Math.max(1, ...browsedEntries.map((entry) => getDescriptionRows(entry.description, descriptionWidth)))
  );

  // Only a widget the picker visibly highlights is previewed; browsing the
  // category list leaves the line as it is
  const searchResultType = widgetPicker && widgetPicker.categoryQuery.trim().length > 0 ? selectedTopLevelSearchEntry?.type : undefined;
  const highlightedPickerType = widgetPicker?.level === "widget" ? selectedPickerEntry?.type : searchResultType;
  const pickerAction = widgetPicker?.action;
  const previewWidgets = useMemo(() => {
    if (!pickerAction || !highlightedPickerType || !pickerNewWidget) {
      return null;
    }

    return placePickerSelection(widgets, pickerAction, selectedIndex, highlightedPickerType, pickerNewWidget).widgets;
  }, [widgets, pickerAction, selectedIndex, highlightedPickerType, pickerNewWidget]);

  useEffect(() => {
    onPreviewChangeRef.current?.(previewWidgets);
  }, [previewWidgets]);

  const onSelectedIndexChangeRef = useRef(onSelectedIndexChange);
  useEffect(() => {
    onSelectedIndexChangeRef.current = onSelectedIndexChange;
  });

  useEffect(() => {
    onSelectedIndexChangeRef.current?.(selectedIndex);
  }, [selectedIndex]);

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

  if (customEditor?.action === EDIT_LABEL_ACTION && customEditor.impl.getLabelPrefix) {
    return (
      <LabelEditor
        widget={customEditor.widget}
        defaultLabel={customEditor.impl.getLabelPrefix(customEditor.widget)}
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
    const pickerActionLabel = widgetPicker.action === "add"
      ? "Add Widget"
      : widgetPicker.action === "insert"
        ? "Insert Widget"
        : "Change Widget";
    return (
      <Box flexDirection="column">
        <Text bold>
          {widgetPicker.action === "change" ? "Change Widget" : "Add Widget"}
          {" "}
          <Text color="cyan">{`[${pickerActionLabel.toUpperCase()}]`}</Text>
        </Text>
        <Text dimColor>{widgetPicker.level === "category" ? "Type to search; Enter to choose; Escape to go back" : "Type to search; Enter to add; Escape to go back"}</Text>
        <Text>{`Search: ${query}`}</Text>
        <Box marginTop={1} flexDirection="column">
          {widgetPicker.level === "category" ? (
            topLevelSearch ? (
              topLevelSearchEntries.length === 0 ? (
                <Text dimColor>No widgets match this search.</Text>
              ) : (
                <>
                  {renderWindowedList(
                    topLevelSearchEntries,
                    topLevelSearchEntries.findIndex((entry) => entry.type === selectedTopLevelSearchEntry?.type),
                    pickerMaxVisible,
                    (entry, index) => {
                      const isSelected = entry.type === selectedTopLevelSearchEntry?.type;
                      const segments = getMatchSegments(entry.displayName, widgetPicker.categoryQuery);
                      return (
                        <Box key={entry.type} flexDirection="row" flexWrap="nowrap">
                          <Box width={3}>
                            <Text color={isSelected ? "green" : undefined}>
                              {isSelected ? "▶ " : "  "}
                            </Text>
                          </Box>
                          <Text color={isSelected ? "green" : undefined}>{`${index + 1}. `}</Text>
                          {segments.map((seg, i) => (
                            <Text
                              key={i}
                              color={isSelected ? "green" : (seg.matched ? "yellowBright" : undefined)}
                              bold={isSelected ? true : seg.matched}
                            >
                              {seg.text}
                            </Text>
                          ))}
                        </Box>
                      );
                    }
                  )}
                  {selectedTopLevelSearchEntry && (
                    <Box marginTop={1} paddingLeft={DESCRIPTION_INDENT}>
                      <Text dimColor>{selectedTopLevelSearchEntry.description}</Text>
                    </Box>
                  )}
                </>
              )
            ) : (
              pickerCategories.length === 0 ? (
                <Text dimColor>No categories available.</Text>
              ) : (
                <>
                  {renderWindowedList(
                    pickerCategories,
                    selectedPickerCategory === null ? -1 : pickerCategories.indexOf(selectedPickerCategory),
                    pickerMaxVisible,
                    (category, index) => {
                      const isSelected = category === selectedPickerCategory;
                      return (
                        <Box key={category} flexDirection="row" flexWrap="nowrap">
                          <Box width={3}>
                            <Text color={isSelected ? "green" : undefined}>
                              {isSelected ? "▶ " : "  "}
                            </Text>
                          </Box>
                          <Text color={isSelected ? "green" : undefined}>
                            {`${index + 1}. ${category}`}
                          </Text>
                        </Box>
                      );
                    }
                  )}
                  {selectedPickerCategory === "All" && (
                    <Box marginTop={1} paddingLeft={2}>
                      <Text dimColor>Search across all widget categories.</Text>
                    </Box>
                  )}
                </>
              )
            )
          ) : (
            pickerEntries.length === 0 ? (
              <Text dimColor>No widgets match the current category/search.</Text>
            ) : (
              <>
                {renderWindowedList(
                  pickerEntries,
                  pickerEntries.findIndex((entry) => entry.type === selectedPickerEntry?.type),
                  pickerMaxVisible,
                  (entry, index) => {
                    const isSelected = entry.type === selectedPickerEntry?.type;
                    const segments = getMatchSegments(entry.displayName, widgetPicker.widgetQuery);
                    return (
                      <Box key={entry.type} flexDirection="row" flexWrap="nowrap">
                        <Box width={3}>
                          <Text color={isSelected ? "green" : undefined}>
                            {isSelected ? "▶ " : "  "}
                          </Text>
                        </Box>
                        <Text color={isSelected ? "green" : undefined}>{`${index + 1}. `}</Text>
                        {segments.map((seg, i) => (
                          <Text
                            key={i}
                            color={isSelected ? "green" : (seg.matched ? "yellowBright" : undefined)}
                            bold={isSelected ? true : seg.matched}
                          >
                            {seg.text}
                          </Text>
                        ))}
                      </Box>
                    );
                  }
                )}
                {selectedPickerEntry && (
                  <Box marginTop={1} paddingLeft={DESCRIPTION_INDENT}>
                    <Text dimColor>{selectedPickerEntry.description}</Text>
                  </Box>
                )}
              </>
            )
          )}
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
