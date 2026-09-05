import type { RenderContext } from '../types/RenderContext';
import type { Settings } from '../types/Settings';
import type { Widget, WidgetEditorDisplay, WidgetItem } from '../types/Widget';
import { makeModifierText } from './shared/editor-display';
import { getHideNoGitKeybinds, getHideNoGitModifierText, handleToggleNoGitAction, isHideNoGitEnabled } from './shared/git-no-git';
import { MAX_WIDTH_ACTION, applyMaxWidth, getMaxWidthKeybind, getMaxWidthModifier, renderMaxWidthEditor } from './shared/max-width';

function baseName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '');
  const parts = trimmed.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? trimmed;
}
export class GitRootDirWidget implements Widget {
  getDefaultColor(): string { return 'cyan'; }
  getDescription(): string { return 'Shows the git repository root directory name'; }
  getDisplayName(): string { return 'Git Root Dir'; }
  getCategory(): string { return 'Git'; }
  getEditorDisplay(item: WidgetItem): WidgetEditorDisplay {
    const modifiers = [getHideNoGitModifierText(item), getMaxWidthModifier(item)].filter((value): value is string => value !== undefined);
    return { displayText: this.getDisplayName(), modifierText: makeModifierText(modifiers) };
  }
  handleEditorAction(action: string, item: WidgetItem): WidgetItem | null { return handleToggleNoGitAction(action, item); }
  render(item: WidgetItem, context: RenderContext, _settings: Settings): string | null {
    if (context.isPreview) return 'my-repo';
    const root = context.data.session?.project_root;
    if (!root) return isHideNoGitEnabled(item) ? null : 'no git';
    return applyMaxWidth(baseName(root), item.maxWidth);
  }
  getCustomKeybinds() { return [...getHideNoGitKeybinds(), getMaxWidthKeybind()]; }
  renderEditor(props: import('../types/Widget').WidgetEditorProps) { return props.action === MAX_WIDTH_ACTION ? renderMaxWidthEditor(props) : null; }
  supportsRawValue(): boolean { return false; }
  supportsColors(_item: WidgetItem): boolean { return true; }
}

