import type { WidgetItem } from "../../../types/Widget";
import { getWidget } from "../../../utils/widgets";

export function updateWidgetById(widgets: WidgetItem[], widgetId: string, update: (widget: WidgetItem) => WidgetItem): WidgetItem[] {
  return widgets.map((widget) => widget.id === widgetId ? update(widget) : widget);
}

export function setWidgetColor(widgets: WidgetItem[], widgetId: string, color: string, editingBackground: boolean): WidgetItem[] {
  return updateWidgetById(widgets, widgetId, (widget) => editingBackground
    ? { ...widget, backgroundColor: color || undefined }
    : { ...widget, color: color || undefined });
}

export function toggleWidgetBold(widgets: WidgetItem[], widgetId: string): WidgetItem[] {
  return updateWidgetById(widgets, widgetId, (widget) => ({ ...widget, bold: !widget.bold }));
}

export function cycleWidgetDim(widgets: WidgetItem[], widgetId: string): WidgetItem[] {
  return updateWidgetById(widgets, widgetId, (widget) => {
    if (widget.dim === true) return { ...widget, dim: "parens" };
    if (widget.dim === "parens") {
      const { dim: _, ...withoutDim } = widget;
      return withoutDim;
    }
    return { ...widget, dim: true };
  });
}

export function resetWidgetStyling(widgets: WidgetItem[], widgetId: string): WidgetItem[] {
  return updateWidgetById(widgets, widgetId, (widget) => {
    const { color: _, backgroundColor: __, bold: ___, dim: ____, ...unstyled } = widget;
    return unstyled;
  });
}

export function clearAllWidgetStyling(widgets: WidgetItem[]): WidgetItem[] {
  return widgets.map((widget) => {
    const { color: _, backgroundColor: __, bold: ___, dim: ____, ...unstyled } = widget;
    return unstyled;
  });
}

function defaultForeground(widget: WidgetItem): string {
  return widget.type === "separator" || widget.type === "flex-separator" ? "white" : getWidget(widget.type).getDefaultColor();
}

export interface CycleWidgetColorOptions {
  widgets: WidgetItem[];
  widgetId: string;
  direction: "left" | "right";
  editingBackground: boolean;
  colors: readonly string[];
  backgroundColors: readonly string[];
}

export function cycleWidgetColor({ widgets, widgetId, direction, editingBackground, colors, backgroundColors }: CycleWidgetColorOptions): WidgetItem[] {
  return updateWidgetById(widgets, widgetId, (widget) => {
    const options = editingBackground ? backgroundColors : colors;
    if (!options.length) return widget;
    const current = editingBackground
      ? (widget.backgroundColor ?? "")
      : (widget.color === "dim" ? defaultForeground(widget) : (widget.color ?? defaultForeground(widget)));
    const index = Math.max(0, options.indexOf(current));
    const nextIndex = direction === "right" ? (index + 1) % options.length : (index + options.length - 1) % options.length;
    const color = options[nextIndex] ?? "";
    return editingBackground ? { ...widget, backgroundColor: color || undefined } : { ...widget, color: color || undefined };
  });
}
