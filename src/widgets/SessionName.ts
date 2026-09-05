import type { RenderContext } from '../types/RenderContext';
import type { Settings } from '../types/Settings';
import type { Widget, WidgetEditorDisplay, WidgetItem } from '../types/Widget';

export class SessionNameWidget implements Widget {
  getDefaultColor(): string { return 'cyan'; }
  getDescription(): string { return 'Shows the current Codex thread title'; }
  getDisplayName(): string { return 'Session Name'; }
  getCategory(): string { return 'Session'; }
  getEditorDisplay(_item: WidgetItem): WidgetEditorDisplay { return { displayText: this.getDisplayName() }; }
  render(item: WidgetItem, context: RenderContext, _settings: Settings): string | null {
    const name = context.isPreview ? 'my-session' : context.data.session?.thread_title;
    if (!name) return null;
    return item.rawValue ? name : 'Session: ' + name;
  }
  supportsRawValue(): boolean { return true; }
  supportsColors(_item: WidgetItem): boolean { return true; }
}

