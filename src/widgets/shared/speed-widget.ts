import type { RenderContext } from "../../types/RenderContext";
import type { Settings } from "../../types/Settings";
import type { CustomKeybind, WidgetEditorDisplay, WidgetEditorProps, WidgetItem } from "../../types/Widget";
import { renderMagnitude, resolveNumberFormat } from "../../utils/number-format";
import { formatRawOrLabeledValue } from "./raw-or-labeled";

type SpeedKind = "input" | "output" | "total";

const config: Record<SpeedKind, { label: string; previewVal: number }> = {
  input: { label: "In: ", previewVal: 85.2 },
  output: { label: "Out: ", previewVal: 42.5 },
  total: { label: "Total: ", previewVal: 127.7 },
};

export function renderSpeed(kind: SpeedKind, item: WidgetItem, context: RenderContext, settings?: Settings): string | null {
  const { label, previewVal } = config[kind];
  const format = settings ? resolveNumberFormat("speed", item, settings) : (item.numberFormat ?? {});
  if (context.isPreview) return formatRawOrLabeledValue(item, label, `${renderMagnitude(previewVal, format, 1)} t/s`);

  const startedAt = Date.parse(context.data.session?.started_at ?? "");
  if (Number.isNaN(startedAt)) return null;
  const usage = context.data.usage;
  const tokens = kind === "input"
    ? usage?.input_tokens
    : kind === "output"
      ? usage?.output_tokens
      : usage?.input_tokens === undefined && usage?.output_tokens === undefined
        ? undefined
        : (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0);
  if (tokens === undefined) return null;

  const elapsedSeconds = Math.max(1, (context.now.getTime() - startedAt) / 1000);
  const speed = tokens / elapsedSeconds;
  return formatRawOrLabeledValue(item, label, `${renderMagnitude(speed, format, 1)} t/s`);
}

export function getSpeedWidgetDescription(kind: SpeedKind): string { return `Shows ${kind === 'total' ? 'total' : kind} session-average token speed (tokens/sec).`; }
export function getSpeedWidgetDisplayName(kind: SpeedKind): string { return kind === 'input' ? 'Input Speed' : kind === 'output' ? 'Output Speed' : 'Total Speed'; }
export function getSpeedWidgetEditorDisplay(kind: SpeedKind, _item: WidgetItem): WidgetEditorDisplay { return { displayText: getSpeedWidgetDisplayName(kind) }; }
export function getSpeedWidgetCustomKeybinds(): CustomKeybind[] { return []; }
export function renderSpeedWidgetEditor(_props: WidgetEditorProps): null { return null; }
export function renderSpeedWidgetValue(kind: SpeedKind, item: WidgetItem, context: RenderContext, settings?: Settings): string | null { return renderSpeed(kind, item, context, settings); }
