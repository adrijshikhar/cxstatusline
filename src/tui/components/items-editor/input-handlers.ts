import type { CustomKeybind, Widget, WidgetItem, WidgetType } from "../../../types/Widget";

export type WidgetPickerAction = "change" | "add" | "insert";
export type WidgetPickerLevel = "category" | "widget";

export interface WidgetCatalogEntry {
  type: WidgetType;
  displayName: string;
  description: string;
  category: string;
  searchText: string;
}

export interface WidgetPickerState {
  action: WidgetPickerAction;
  level: WidgetPickerLevel;
  selectedCategory: string | null;
  categoryQuery: string;
  widgetQuery: string;
  selectedType: WidgetType | null;
}

/** A widget's own editor is open for the selected item (upstream ccstatusline shape). */
export interface CustomEditorWidgetState {
  widget: WidgetItem;
  impl: Widget;
  action?: string;
}

export function customKeybindsFor(impl: Widget | null, item: WidgetItem | undefined): CustomKeybind[] {
  if (!impl || !item || item.type === "separator" || item.type === "flex-separator") return [];
  return impl.getCustomKeybinds?.(item) ?? [];
}

export interface InputKey {
  ctrl?: boolean;
  meta?: boolean;
  tab?: boolean;
  upArrow?: boolean;
  downArrow?: boolean;
  leftArrow?: boolean;
  rightArrow?: boolean;
  return?: boolean;
  escape?: boolean;
  backspace?: boolean;
  delete?: boolean;
}

type Setter<T> = (value: T | ((previous: T) => T)) => void;

export function filterWidgetCatalog(catalog: readonly WidgetCatalogEntry[], category: string, query: string): WidgetCatalogEntry[] {
  const needle = query.trim().toLowerCase();
  return catalog.filter((entry) => (category === "All" || entry.category === category)
    && (!needle || entry.searchText.includes(needle)));
}

export function normalizePickerState(
  state: WidgetPickerState,
  widgetCatalog: readonly WidgetCatalogEntry[],
  widgetCategories: readonly string[],
): WidgetPickerState {
  const selectedCategory = state.selectedCategory && widgetCategories.includes(state.selectedCategory)
    ? state.selectedCategory
    : (widgetCategories[0] ?? null);
  const hasTopLevelSearch = state.level === "category" && state.categoryQuery.trim().length > 0;
  const filtered = filterWidgetCatalog(
    widgetCatalog,
    hasTopLevelSearch ? "All" : (selectedCategory ?? "All"),
    hasTopLevelSearch ? state.categoryQuery : state.widgetQuery,
  );
  const selectedType = state.selectedType && filtered.some((entry) => entry.type === state.selectedType)
    ? state.selectedType
    : (filtered[0]?.type ?? null);
  return { ...state, selectedCategory, selectedType };
}

function updatePicker(
  setWidgetPicker: Setter<WidgetPickerState | null>,
  normalize: (state: WidgetPickerState) => WidgetPickerState,
  update: (state: WidgetPickerState) => WidgetPickerState,
): void {
  setWidgetPicker((previous) => previous ? normalize(update(previous)) : previous);
}

export interface HandlePickerInputModeArgs {
  input: string;
  key: InputKey;
  widgetPicker: WidgetPickerState;
  widgetCatalog: readonly WidgetCatalogEntry[];
  widgetCategories: readonly string[];
  setWidgetPicker: Setter<WidgetPickerState | null>;
  applyWidgetPickerSelection: (selectedType: WidgetType) => void;
}

/** Picker navigation intentionally mirrors the upstream Ink editor, including backspace. */
export function handlePickerInputMode({
  input,
  key,
  widgetPicker,
  widgetCatalog,
  widgetCategories,
  setWidgetPicker,
  applyWidgetPickerSelection,
}: HandlePickerInputModeArgs): void {
  const normalize = (state: WidgetPickerState) => normalizePickerState(state, widgetCatalog, widgetCategories);
  const topLevelSearch = widgetPicker.level === "category" && widgetPicker.categoryQuery.trim().length > 0;
  const category = widgetPicker.selectedCategory ?? "All";
  const entries = filterWidgetCatalog(
    widgetCatalog,
    topLevelSearch ? "All" : category,
    topLevelSearch ? widgetPicker.categoryQuery : widgetPicker.widgetQuery,
  );

  if (widgetPicker.level === "category") {
    if (key.escape) {
      if (widgetPicker.categoryQuery) {
        updatePicker(setWidgetPicker, normalize, (previous) => ({ ...previous, categoryQuery: "", selectedType: null }));
      } else {
        setWidgetPicker(null);
      }
      return;
    }
    if (key.return) {
      if (topLevelSearch) {
        const selected = entries.find((entry) => entry.type === widgetPicker.selectedType) ?? entries[0];
        if (selected) applyWidgetPickerSelection(selected.type);
      } else if (category) {
        updatePicker(setWidgetPicker, normalize, (previous) => ({ ...previous, level: "widget", selectedCategory: category }));
      }
      return;
    }
    if (key.upArrow || key.downArrow) {
      const choices = topLevelSearch ? entries.map((entry) => entry.type) : [...widgetCategories];
      if (!choices.length) return;
      const current = topLevelSearch
        ? choices.indexOf(widgetPicker.selectedType ?? choices[0]!)
        : choices.indexOf(category);
      const base = current < 0 ? 0 : current;
      const next = key.downArrow ? (base + 1) % choices.length : (base + choices.length - 1) % choices.length;
      updatePicker(setWidgetPicker, normalize, (previous) => topLevelSearch
        ? { ...previous, selectedType: choices[next] as WidgetType }
        : { ...previous, selectedCategory: choices[next] ?? null, selectedType: null });
      return;
    }
    if (key.backspace || key.delete) {
      updatePicker(setWidgetPicker, normalize, (previous) => ({ ...previous, categoryQuery: previous.categoryQuery.slice(0, -1), selectedType: null }));
      return;
    }
    if (input && !key.ctrl && !key.meta && !key.tab) {
      updatePicker(setWidgetPicker, normalize, (previous) => ({ ...previous, categoryQuery: previous.categoryQuery + input, selectedType: null }));
    }
    return;
  }

  if (key.escape) {
    if (widgetPicker.widgetQuery) {
      updatePicker(setWidgetPicker, normalize, (previous) => ({ ...previous, widgetQuery: "", selectedType: null }));
    } else {
      updatePicker(setWidgetPicker, normalize, (previous) => ({ ...previous, level: "category" }));
    }
    return;
  }
  if (key.return) {
    const selected = entries.find((entry) => entry.type === widgetPicker.selectedType) ?? entries[0];
    if (selected) applyWidgetPickerSelection(selected.type);
    return;
  }
  if (key.upArrow || key.downArrow) {
    if (!entries.length) return;
    const current = entries.findIndex((entry) => entry.type === widgetPicker.selectedType);
    const base = current < 0 ? 0 : current;
    const next = key.downArrow ? (base + 1) % entries.length : (base + entries.length - 1) % entries.length;
    updatePicker(setWidgetPicker, normalize, (previous) => ({ ...previous, selectedType: entries[next]?.type ?? null }));
    return;
  }
  if (key.backspace || key.delete) {
    updatePicker(setWidgetPicker, normalize, (previous) => ({ ...previous, widgetQuery: previous.widgetQuery.slice(0, -1), selectedType: null }));
    return;
  }
  if (input && !key.ctrl && !key.meta && !key.tab) {
    updatePicker(setWidgetPicker, normalize, (previous) => ({ ...previous, widgetQuery: previous.widgetQuery + input, selectedType: null }));
  }
}

export interface HandleMoveInputModeArgs {
  key: InputKey;
  widgets: WidgetItem[];
  selectedIndex: number;
  onUpdate: (widgets: WidgetItem[]) => void;
  setSelectedIndex: (index: number) => void;
  setMoveMode: (moveMode: boolean) => void;
}

export function handleMoveInputMode({ key, widgets, selectedIndex, onUpdate, setSelectedIndex, setMoveMode }: HandleMoveInputModeArgs): void {
  if (key.upArrow || key.downArrow) {
    if (widgets.length < 2) return;
    const target = key.upArrow
      ? (selectedIndex === 0 ? widgets.length - 1 : selectedIndex - 1)
      : (selectedIndex === widgets.length - 1 ? 0 : selectedIndex + 1);
    const next = [...widgets];
    const current = next[selectedIndex];
    const replacement = next[target];
    if (current && replacement) [next[selectedIndex], next[target]] = [replacement, current];
    onUpdate(next);
    setSelectedIndex(target);
    return;
  }
  if (key.escape || key.return) setMoveMode(false);
}

export interface HandleNormalInputModeArgs {
  input: string;
  key: InputKey;
  widgets: WidgetItem[];
  selectedIndex: number;
  separatorChars: readonly string[];
  onBack: () => void;
  onUpdate: (widgets: WidgetItem[]) => void;
  setSelectedIndex: (index: number) => void;
  setMoveMode: (moveMode: boolean) => void;
  setShowClearConfirm: (show: boolean) => void;
  openWidgetPicker: (action: WidgetPickerAction) => void;
  getWidgetImpl: (type: WidgetType) => Widget | null;
  setCustomEditorWidget: (state: CustomEditorWidgetState | null) => void;
}

export function handleNormalInputMode({
  input,
  key,
  widgets,
  selectedIndex,
  separatorChars,
  onBack,
  onUpdate,
  setSelectedIndex,
  setMoveMode,
  setShowClearConfirm,
  openWidgetPicker,
  getWidgetImpl,
  setCustomEditorWidget,
}: HandleNormalInputModeArgs): void {
  if (key.upArrow && widgets.length) {
    setSelectedIndex(selectedIndex === 0 ? widgets.length - 1 : selectedIndex - 1);
  } else if (key.downArrow && widgets.length) {
    setSelectedIndex(selectedIndex === widgets.length - 1 ? 0 : selectedIndex + 1);
  } else if ((key.leftArrow || key.rightArrow) && widgets.length) {
    openWidgetPicker("change");
  } else if (key.return && widgets.length) {
    setMoveMode(true);
  } else if (input === "a") {
    openWidgetPicker("add");
  } else if (input === "i") {
    openWidgetPicker("insert");
  } else if (input === "d" && widgets.length) {
    const next = widgets.filter((_, index) => index !== selectedIndex);
    onUpdate(next);
    if (selectedIndex >= next.length && selectedIndex > 0) setSelectedIndex(selectedIndex - 1);
  } else if (input === "k" && widgets.length) {
    const current = widgets[selectedIndex];
    if (!current) return;
    const clone: WidgetItem = {
      ...current,
      id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
      ...(current.metadata && { metadata: { ...current.metadata } }),
    };
    const index = selectedIndex + 1;
    onUpdate([...widgets.slice(0, index), clone, ...widgets.slice(index)]);
    setSelectedIndex(index);
  } else if (input === "c" && widgets.length) {
    setShowClearConfirm(true);
  } else if (input === " " && widgets[selectedIndex]?.type === "separator") {
    const current = widgets[selectedIndex]!;
    const index = Math.max(0, separatorChars.indexOf(current.character ?? "|"));
    const character = separatorChars[(index + 1) % separatorChars.length];
    onUpdate(widgets.map((widget, itemIndex) => itemIndex === selectedIndex ? { ...widget, character } : widget));
  } else if (input === "r" && widgets.length) {
    const current = widgets[selectedIndex];
    if (current && current.type !== "separator" && current.type !== "flex-separator") {
      onUpdate(widgets.map((widget, index) => index === selectedIndex ? { ...widget, rawValue: !widget.rawValue } : widget));
    }
  } else if (input === "m" && widgets.length) {
    const current = widgets[selectedIndex];
    if (current && selectedIndex < widgets.length - 1 && current.type !== "separator" && current.type !== "flex-separator") {
      const merge = current.merge === undefined ? true : current.merge === true ? "no-padding" : undefined;
      onUpdate(widgets.map((widget, index) => {
        if (index !== selectedIndex) return widget;
        if (merge === undefined) {
          const { merge: _, ...withoutMerge } = widget;
          return withoutMerge;
        }
        return { ...widget, merge };
      }));
    }
  } else if (input === "x" && widgets.length) {
    const current = widgets[selectedIndex];
    if (current && current.type !== "separator" && current.type !== "flex-separator") {
      onUpdate(widgets.map((widget, index) => {
        if (index !== selectedIndex) return widget;
        if (widget.excludeFromAutoAlign) {
          const { excludeFromAutoAlign: _, ...withoutExclude } = widget;
          return withoutExclude;
        }
        return { ...widget, excludeFromAutoAlign: true };
      }));
    }
  } else if (input && !key.ctrl && !key.meta && widgets.length) {
    // Widget-specific keys come last so reserved keys always win.
    const current = widgets[selectedIndex];
    if (!current) return;
    const impl = getWidgetImpl(current.type);
    const keybind = customKeybindsFor(impl, current).find((entry) => entry.key === input);
    if (!impl || !keybind) return;
    const updated = impl.handleEditorAction?.(keybind.action, current) ?? null;
    if (updated) {
      onUpdate(widgets.map((widget, index) => index === selectedIndex ? updated : widget));
    } else if (impl.renderEditor) {
      setCustomEditorWidget({ widget: current, impl, action: keybind.action });
    }
  } else if (key.escape) {
    onBack();
  }
}
