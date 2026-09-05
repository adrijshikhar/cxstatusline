import type { RenderContext } from '../types/RenderContext';
import type { Settings } from '../types/Settings';
import type { Widget, WidgetEditorDisplay, WidgetItem } from '../types/Widget';

export class VersionWidget implements Widget {
  getDefaultColor(): string { return 'gray'; }
  getDescription(): string { return 'Shows Codex CLI version number'; }
  getDisplayName(): string { return 'Version'; }
  getCategory(): string { return 'Core'; }
  getEditorDisplay(_item: WidgetItem): WidgetEditorDisplay { return { displayText: this.getDisplayName() }; }
  render(item: WidgetItem, context: RenderContext, _settings: Settings): string | null {
    const version = context.isPreview ? '0.152.1' : context.data.session?.codex_version;
    if (!version) return null;
    return item.rawValue ? version : 'v' + version;
  }
  supportsRawValue(): boolean { return true; }
  supportsColors(_item: WidgetItem): boolean { return true; }
}

