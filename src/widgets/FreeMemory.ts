import type { RenderContext } from '../types/RenderContext';
import type { Settings } from '../types/Settings';
import type { Widget, WidgetEditorDisplay, WidgetItem } from '../types/Widget';

function formatBytes(bytes: number): string {
  const value = Math.max(0, bytes);
  if (value >= 1024 ** 3) return (value / 1024 ** 3).toFixed(1) + 'G';
  if (value >= 1024 ** 2) return (value / 1024 ** 2).toFixed(0) + 'M';
  if (value >= 1024) return (value / 1024).toFixed(0) + 'K';
  return value + 'B';
}

export class FreeMemoryWidget implements Widget {
  getDefaultColor(): string { return 'cyan'; }
  getDescription(): string { return 'Shows system memory usage (used/total)'; }
  getDisplayName(): string { return 'Memory Usage'; }
  getCategory(): string { return 'Environment'; }
  getEditorDisplay(_item: WidgetItem): WidgetEditorDisplay { return { displayText: this.getDisplayName() }; }
  render(item: WidgetItem, context: RenderContext, _settings: Settings): string | null {
    if (context.isPreview) return item.rawValue ? '12.4G/16.0G' : 'Mem: 12.4G/16.0G';
    const usage = context.memoryUsage;
    if (usage) {
      const value = formatBytes(usage.used) + '/' + formatBytes(usage.total);
      return item.rawValue ? value : 'Mem: ' + value;
    }
    if (context.freeMemoryBytes !== undefined) {
      return item.rawValue ? formatBytes(context.freeMemoryBytes) : 'Mem: ' + formatBytes(context.freeMemoryBytes);
    }
    return null;
  }
  supportsRawValue(): boolean { return true; }
  supportsColors(_item: WidgetItem): boolean { return true; }
}

