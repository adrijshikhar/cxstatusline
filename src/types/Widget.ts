import { z } from "zod";
import { CANONICAL_WIDGET_TYPES } from "./canonical-widget-types";
import type { RenderContext } from "./RenderContext";
import type { Settings } from "./Settings";

export const WidgetTypeSchema = z.enum(CANONICAL_WIDGET_TYPES);

export const WidgetItemSchema = z.object({
  id: z.string(),
  type: WidgetTypeSchema,
  color: z.string().optional(),
  backgroundColor: z.string().optional(),
  bold: z.boolean().optional(),
  dim: z.union([z.boolean(), z.literal("parens")]).optional(),
  character: z.string().optional(),
  rawValue: z.boolean().optional(),
  // User-defined widgets (upstream ccstatusline field names, kept so presets import unchanged).
  customText: z.string().optional(),
  customSymbol: z.string().optional(),
  commandPath: z.string().optional(),
  preserveColors: z.boolean().optional(),
  // Any positive integer is stored; the widget clamps to its range at render time.
  timeout: z.number().int().positive().optional(),
  maxWidth: z.number().optional(),
  merge: z.union([z.boolean(), z.literal("no-padding")]).optional(),
  hide: z.boolean().optional(),
  excludeFromAutoAlign: z.boolean().optional(),
  metadata: z.record(z.string(), z.string()).optional(),
});

export type WidgetItem = z.infer<typeof WidgetItemSchema>;
export type WidgetType = z.infer<typeof WidgetTypeSchema>;

export interface WidgetEditorDisplay {
  displayText: string;
  modifierText?: string | undefined;
}

export interface WidgetEditorProps {
  widget: WidgetItem;
  onComplete: (updatedWidget: WidgetItem) => void;
  onCancel: () => void;
  action?: string | undefined;
}

export interface CustomKeybind {
  key: string;
  label: string;
  action: string;
}

export interface Widget {
  getDefaultColor(): string;
  getDescription(): string;
  getDisplayName(): string;
  getCategory(): string;
  getEditorDisplay(item: WidgetItem): WidgetEditorDisplay;
  render(item: WidgetItem, context: RenderContext, settings: Settings): string | null;
  supportsRawValue(): boolean;
  supportsColors(item: WidgetItem): boolean;
  getCustomKeybinds?(item?: WidgetItem): CustomKeybind[];
  renderEditor?(props: WidgetEditorProps): React.ReactElement | null;
  handleEditorAction?(action: string, item: WidgetItem): WidgetItem | null;
  getNumericValue?(context: RenderContext, item: WidgetItem): number | null;
  /** True when render() returns text carrying its own SGR styling that the renderer must keep. */
  emitsStyledOutput?(item: WidgetItem): boolean;
}
