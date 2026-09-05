import type { RenderContext } from "../../types/RenderContext";
import type { CustomKeybind, WidgetEditorDisplay, WidgetEditorProps, WidgetItem } from "../../types/Widget";
import { formatRawOrLabeledValue } from "./raw-or-labeled";

type SpeedKind = "input" | "output" | "total";

const config: Record<SpeedKind, { label: string; preview: string }> = {
  input: { label: "In: ", preview: "85.2 t/s" },
  output: { label: "Out: ", preview: "42.5 t/s" },
  total: { label: "Total: ", preview: "127.7 t/s" },
};

export function renderSpeed(kind: SpeedKind, item: WidgetItem, context: RenderContext): string | null {
  const { label, preview } = config[kind];
  if (context.isPreview) return formatRawOrLabeledValue(item, label, preview);

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
  return formatRawOrLabeledValue(item, label, `${(tokens / elapsedSeconds).toFixed(1)} t/s`);
}

export function getSpeedWidgetDescription(kind: SpeedKind): string { return `Shows ${kind === 'total' ? 'total' : kind} session-average token speed (tokens/sec).`; }
export function getSpeedWidgetDisplayName(kind: SpeedKind): string { return kind === 'input' ? 'Input Speed' : kind === 'output' ? 'Output Speed' : 'Total Speed'; }
export function getSpeedWidgetEditorDisplay(kind: SpeedKind, _item: WidgetItem): WidgetEditorDisplay { return { displayText: getSpeedWidgetDisplayName(kind) }; }
export function getSpeedWidgetCustomKeybinds(): CustomKeybind[] { return []; }
export function renderSpeedWidgetEditor(_props: WidgetEditorProps): null { return null; }
export function renderSpeedWidgetValue(kind: SpeedKind, item: WidgetItem, context: RenderContext): string | null { return renderSpeed(kind, item, context); }
