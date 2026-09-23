import type { RenderContext } from "../../types/RenderContext";
import type { Settings } from "../../types/Settings";
import type { CustomKeybind, HideableState, WidgetEditorDisplay, WidgetEditorProps, WidgetItem } from "../../types/Widget";
import { resolveNumberFormat } from "../../utils/number-format";
import { calculateSpeed, formatSpeed, type SpeedKind } from "../../utils/speed-tracker";
import { getWidgetSpeedWindowSeconds } from "../../utils/speed-window";
import { makeModifierText } from "./editor-display";
import { isHideStateEnabled } from "./hideable";
import { formatRawOrLabeledValue } from "./raw-or-labeled";

export type { SpeedKind };

export const NO_DATA_HIDEABLE_STATE: HideableState = {
  key: "no-data",
  label: "when there is no speed data (—)",
};

const config: Record<SpeedKind, { label: string }> = {
  input: { label: "In: " },
  output: { label: "Out: " },
  total: { label: "Total: " },
};

export function renderSpeed(kind: SpeedKind, item: WidgetItem, context: RenderContext, settings?: Settings): string | null {
  const { label } = config[kind];
  const format = settings ? resolveNumberFormat("speed", item, settings) : (item.numberFormat ?? {});

  const usage = context.data.usage;
  const hasTokens =
    kind === "input"
      ? usage?.input_tokens !== undefined
      : kind === "output"
        ? usage?.output_tokens !== undefined
        : usage?.input_tokens !== undefined || usage?.output_tokens !== undefined;

  if (!context.isPreview && !hasTokens) {
    return null;
  }

  const speed = calculateSpeed(kind, item, context);

  if (speed === null) {
    if (isHideStateEnabled(item, NO_DATA_HIDEABLE_STATE)) {
      return null;
    }
    return formatRawOrLabeledValue(item, label, "—");
  }

  return formatRawOrLabeledValue(item, label, formatSpeed(speed, format));
}

export function getSpeedWidgetDescription(kind: SpeedKind): string {
  return `Shows ${kind === "total" ? "total" : kind} session-average token speed (tokens/sec). Optional window: 0-120 seconds (0 = full-session average).`;
}

export function getSpeedWidgetDisplayName(kind: SpeedKind): string {
  return kind === "input" ? "Input Speed" : kind === "output" ? "Output Speed" : "Total Speed";
}

export function getSpeedWidgetEditorDisplay(kind: SpeedKind, item: WidgetItem): WidgetEditorDisplay {
  const windowSeconds = getWidgetSpeedWindowSeconds(item);
  const modifiers = windowSeconds > 0 ? [`${windowSeconds}s window`] : ["session avg"];

  return {
    displayText: getSpeedWidgetDisplayName(kind),
    modifierText: makeModifierText(modifiers),
  };
}

export function getSpeedWidgetHideableStates(): HideableState[] {
  return [NO_DATA_HIDEABLE_STATE];
}

export function getSpeedWidgetCustomKeybinds(): CustomKeybind[] {
  return [];
}

export function renderSpeedWidgetEditor(_props: WidgetEditorProps): null {
  return null;
}

export function renderSpeedWidgetValue(kind: SpeedKind, item: WidgetItem, context: RenderContext, settings?: Settings): string | null {
  return renderSpeed(kind, item, context, settings);
}
