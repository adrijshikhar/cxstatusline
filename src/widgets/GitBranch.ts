import type { RenderContext } from '../types/RenderContext';
import type { Settings } from '../types/Settings';
import type { CustomKeybind, HideableState, Widget, WidgetEditorDisplay, WidgetItem } from '../types/Widget';
import { makeModifierText } from './shared/editor-display';
import { getHideKeybind, getHideModifierText, isHideStateEnabled, NO_GIT_HIDEABLE_STATE } from './shared/hideable';
import { MAX_WIDTH_ACTION, applyMaxWidth, getMaxWidthKeybind, getMaxWidthModifier, renderMaxWidthEditor } from './shared/max-width';
import { formatSymbolPrefix, getSymbolKeybind, renderSymbolOverrideEditor } from './shared/symbol-override';

const DEFAULT_SYMBOL = '⎇';
export class GitBranchWidget implements Widget {
  getDefaultColor(): string { return 'magenta'; }
  getDescription(): string { return 'Shows the current git branch name'; }
  getDisplayName(): string { return 'Git Branch'; }
  getCategory(): string { return 'Git'; }
  getHideableStates(): HideableState[] { return [NO_GIT_HIDEABLE_STATE]; }
  getEditorDisplay(item: WidgetItem): WidgetEditorDisplay {
    const modifiers = [getHideModifierText(item, this.getHideableStates()), getMaxWidthModifier(item)].filter((value): value is string => value !== undefined);
    return { displayText: this.getDisplayName(), modifierText: makeModifierText(modifiers) };
  }
  render(item: WidgetItem, context: RenderContext, _settings: Settings): string | null {
    const prefix = formatSymbolPrefix(item, DEFAULT_SYMBOL);
    if (context.isPreview) return item.rawValue ? 'main' : prefix + 'main';
    const branch = context.data.git?.branch;
    if (!branch) return isHideStateEnabled(item, NO_GIT_HIDEABLE_STATE) ? null : prefix + 'no git';
    return applyMaxWidth(item.rawValue ? branch : prefix + branch, item.maxWidth);
  }
  getCustomKeybinds(): CustomKeybind[] { return [getHideKeybind(), getMaxWidthKeybind(), getSymbolKeybind()]; }
  renderEditor(props: import('../types/Widget').WidgetEditorProps) { return props.action === MAX_WIDTH_ACTION ? renderMaxWidthEditor(props) : renderSymbolOverrideEditor(props, DEFAULT_SYMBOL); }
  supportsRawValue(): boolean { return true; }
  supportsColors(_item: WidgetItem): boolean { return true; }
}

