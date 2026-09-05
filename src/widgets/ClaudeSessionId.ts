import type { RenderContext } from '../types/RenderContext';
import type { Settings } from '../types/Settings';
import type { Widget, WidgetEditorDisplay, WidgetItem } from '../types/Widget';

export class ClaudeSessionIdWidget implements Widget {
  getDefaultColor(): string { return 'cyan'; }
  getDescription(): string { return 'Shows the current Codex session ID'; }
  getDisplayName(): string { return 'Claude Session ID'; }
  getCategory(): string { return 'Core'; }
  getEditorDisplay(_item: WidgetItem): WidgetEditorDisplay { return { displayText: this.getDisplayName() }; }
  render(item: WidgetItem, context: RenderContext, _settings: Settings): string | null {
    const id = context.isPreview ? 'preview-session-id' : context.data.session?.id;
    if (!id) return null;
    return item.rawValue ? id : 'Session ID: ' + id;
  }
  supportsRawValue(): boolean { return true; }
  supportsColors(_item: WidgetItem): boolean { return true; }
}

