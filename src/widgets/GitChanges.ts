import type { RenderContext } from '../types/RenderContext';
import type { Settings } from '../types/Settings';
import type { CustomKeybind, Widget, WidgetEditorDisplay, WidgetItem } from '../types/Widget';
import { getHideNoGitKeybinds, getHideNoGitModifierText, handleToggleNoGitAction, isHideNoGitEnabled } from './shared/git-no-git';

export class GitChangesWidget implements Widget {
  getDefaultColor(): string { return 'yellow'; }
  getDescription(): string { return 'Shows git changes count (+insertions, -deletions)'; }
  getDisplayName(): string { return 'Git Changes'; }
  getCategory(): string { return 'Git'; }
  getEditorDisplay(item: WidgetItem): WidgetEditorDisplay { return { displayText: this.getDisplayName(), modifierText: getHideNoGitModifierText(item) }; }
  handleEditorAction(action: string, item: WidgetItem): WidgetItem | null { return handleToggleNoGitAction(action, item); }
  render(item: WidgetItem, context: RenderContext, _settings: Settings): string | null {
    if (context.isPreview) return '(+42,-10)';
    const changes = context.data.git?.changes;
    if (!changes) return isHideNoGitEnabled(item) ? null : '(no git)';
    return '(+' + changes.additions + ',-' + changes.deletions + ')';
  }
  getCustomKeybinds(): CustomKeybind[] { return getHideNoGitKeybinds(); }
  supportsRawValue(): boolean { return false; }
  supportsColors(_item: WidgetItem): boolean { return true; }
}

