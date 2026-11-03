import type { NumberFormat } from '../types/NumberFormat';
import type { RenderContext } from '../types/RenderContext';
import type { Settings } from '../types/Settings';
import type { Widget, WidgetEditorDisplay, WidgetItem } from '../types/Widget';
import { effectiveDecimals, renderMagnitude, resolveNumberFormat } from '../utils/number-format';
import { formatRawOrLabeledValue } from './shared/raw-or-labeled';

const LABEL = 'Mem: ';

function formatBytes(bytes: number, format: NumberFormat): string {
  const value = Math.max(0, bytes);
  const GB = 1024 ** 3;
  const MB = 1024 ** 2;
  const KB = 1024;
  // Promote to the next unit once the smaller-unit value would round up to
  // "1024" at the displayed precision (e.g. 1023.6M -> "1.0G", not "1024M").
  const rollover = 1024 - 0.5 / 10 ** effectiveDecimals(format, 0);

  if (value >= MB * rollover) return renderMagnitude(value / GB, format, 1) + 'G';
  if (value >= KB * rollover) return renderMagnitude(value / MB, format, 0) + 'M';
  if (value >= KB) return renderMagnitude(value / KB, format, 0) + 'K';
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
    const dataMem = (context.data as any)?.memory;
    const usage = context.memoryUsage ?? (dataMem && typeof dataMem.totalBytes === 'number' && typeof dataMem.freeBytes === 'number'
      ? { used: dataMem.totalBytes - dataMem.freeBytes, total: dataMem.totalBytes }
      : undefined);
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
