import type { RenderContext } from '../types/RenderContext';
import type { Settings } from '../types/Settings';
import type {
  HideableState,
  Widget,
  WidgetEditorDisplay,
  WidgetItem,
} from '../types/Widget';
import { isHideStateEnabled } from './shared/hideable';

const ZERO_HIDEABLE_STATE: HideableState = { key: 'zero', label: 'when under 1 minute' };

function formatDuration(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60000);
  if (minutes < 1) return '<1m';
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return rest + 'm';
  return hours + 'hr' + (rest ? ' ' + rest + 'm' : '');
}

export class SessionClockWidget implements Widget {
  getDefaultColor(): string { return 'hex:D19A66'; }
  getDescription(): string { return 'Shows elapsed time since current session started'; }
  getDisplayName(): string { return 'Session Clock'; }
  getCategory(): string { return 'Session'; }
  getEditorDisplay(_item: WidgetItem): WidgetEditorDisplay { return { displayText: this.getDisplayName() }; }

  getHideableStates(): HideableState[] {
    return [ZERO_HIDEABLE_STATE];
  }

  render(item: WidgetItem, context: RenderContext, _settings: Settings): string | null {
    const started = context.isPreview ? Date.parse('2026-09-02T09:45:00Z') : Date.parse(context.data.session?.started_at ?? '');
    if (!Number.isFinite(started)) return null;
    const elapsedMs = context.now.getTime() - started;
    if (elapsedMs < 60000 && isHideStateEnabled(item, ZERO_HIDEABLE_STATE)) return null;
    const value = formatDuration(elapsedMs);
    return item.rawValue ? value : 'Session: ' + value;
  }
  supportsRawValue(): boolean { return true; }
  supportsColors(_item: WidgetItem): boolean { return true; }
}
