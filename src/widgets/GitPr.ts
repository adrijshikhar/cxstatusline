import type { RenderContext } from '../types/RenderContext';
import type { Settings } from '../types/Settings';
import type { Widget, WidgetEditorDisplay, WidgetItem } from '../types/Widget';

export class GitPrWidget implements Widget {
  getDefaultColor(): string { return 'cyan'; }
  getDescription(): string { return 'Shows the pull request number supplied by Codex'; }
  getDisplayName(): string { return 'Git PR/MR'; }
  getCategory(): string { return 'Git'; }
  getEditorDisplay(_item: WidgetItem): WidgetEditorDisplay { return { displayText: this.getDisplayName() }; }
  render(item: WidgetItem, context: RenderContext, _settings: Settings): string | null {
    const number = context.isPreview ? 42 : context.data.git?.pr;
    if (number === undefined) return null;
    return item.rawValue ? '#' + number : 'PR #' + number;
  }
  supportsRawValue(): boolean { return true; }
  supportsColors(_item: WidgetItem): boolean { return true; }
}

