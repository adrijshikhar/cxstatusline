import type { Widget, WidgetType } from "../types";
import { WIDGET_MANIFEST } from "./widget-manifest";

const registry = new Map<WidgetType, Widget>(WIDGET_MANIFEST.map(({ type, create }) => [type, create()]));

export function getWidget(type: WidgetType): Widget {
  const widget = registry.get(type);
  if (!widget) throw new Error(`unknown widget type: ${type}`);
  return widget;
}
