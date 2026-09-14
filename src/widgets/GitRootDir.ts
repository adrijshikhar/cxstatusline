import type { RenderContext } from '../types/RenderContext';
import type { Settings } from '../types/Settings';
import type { HideableState, Widget, WidgetEditorDisplay, WidgetItem } from '../types/Widget';
import { makeModifierText } from './shared/editor-display';
import { isHideStateEnabled, NO_GIT_HIDEABLE_STATE } from './shared/hideable';
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
  getHideableStates(): HideableState[] { return [NO_GIT_HIDEABLE_STATE]; }
  getEditorDisplay(item: WidgetItem): WidgetEditorDisplay {
    const modifiers: string[] = [];
    const maxWidthText = getMaxWidthModifier(item);
    if (maxWidthText) modifiers.push(maxWidthText);
    return { displayText: this.getDisplayName(), modifierText: makeModifierText(modifiers) };
  }
  render(item: WidgetItem, context: RenderContext, _settings: Settings): string | null {
    if (context.isPreview) return 'my-repo';
    const root = context.data.session?.project_root;
    if (!root) return isHideStateEnabled(item, NO_GIT_HIDEABLE_STATE) ? null : 'no git';
    return applyMaxWidth(baseName(root), item.maxWidth);
  }
  getCustomKeybinds() { return [getMaxWidthKeybind()]; }
  renderEditor(props: import('../types/Widget').WidgetEditorProps) { return props.action === MAX_WIDTH_ACTION ? renderMaxWidthEditor(props) : null; }
  supportsRawValue(): boolean { return false; }
  supportsColors(_item: WidgetItem): boolean { return true; }
}
