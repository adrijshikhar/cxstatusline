import type { NumberFormat } from '../types/NumberFormat';
import type { RenderContext } from '../types/RenderContext';
import type { Settings } from '../types/Settings';
import type { Widget, WidgetEditorDisplay, WidgetItem } from '../types/Widget';
import { renderMagnitude, resolveNumberFormat } from '../utils/number-format';
import { formatRawOrLabeledValue } from './shared/raw-or-labeled';

const LABEL = 'Mem: ';

function formatBytes(bytes: number, format: NumberFormat): string {
  const value = Math.max(0, bytes);
  if (value >= 1024 ** 3) return renderMagnitude(value / 1024 ** 3, format, 1) + 'G';
  if (value >= 1024 ** 2) return renderMagnitude(value / 1024 ** 2, format, 0) + 'M';
  if (value >= 1024) return renderMagnitude(value / 1024, format, 0) + 'K';
  return value + 'B';
}

export class FreeMemoryWidget implements Widget {
  getDefaultColor(): string { return 'cyan'; }
  getDescription(): string { return 'Shows system memory usage (used/total)'; }
  getDisplayName(): string { return 'Memory Usage'; }
  getCategory(): string { return 'Environment'; }
  getEditorDisplay(_item: WidgetItem): WidgetEditorDisplay { return { displayText: this.getDisplayName() }; }
  getLabelPrefix(): string { return LABEL; }
  render(item: WidgetItem, context: RenderContext, settings: Settings): string | null {
    const format = resolveNumberFormat('memory', item, settings);
    if (context.isPreview) {
      const value = formatBytes(12.4 * 1024 ** 3, format) + '/' + formatBytes(16 * 1024 ** 3, format);
      return formatRawOrLabeledValue(item, this.getLabelPrefix(), value);
    }
    const usage = context.memoryUsage;
    if (usage) {
      const value = formatBytes(usage.used, format) + '/' + formatBytes(usage.total, format);
      return formatRawOrLabeledValue(item, this.getLabelPrefix(), value);
    }
    if (context.freeMemoryBytes !== undefined) {
      return formatRawOrLabeledValue(item, this.getLabelPrefix(), formatBytes(context.freeMemoryBytes, format));
    }
    return null;
  }
  supportsRawValue(): boolean { return true; }
  supportsColors(_item: WidgetItem): boolean { return true; }
  supportsNumberFormat(): boolean { return true; }
}
