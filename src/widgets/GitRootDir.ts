import type { RenderContext } from '../types/RenderContext';
import type { Settings } from '../types/Settings';
import type { CustomKeybind, HideableState, Widget, WidgetEditorDisplay, WidgetItem } from '../types/Widget';
import { buildIdeFileUrl, renderOsc8Link, type IdeLinkMode, IDE_LINK_MODES } from '../utils/hyperlink';
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
    const linkMode = item.metadata?.linkToIDE;
    if (linkMode) {
      modifiers.push(`link-${linkMode}`);
    }
    const maxWidthText = getMaxWidthModifier(item);
    if (maxWidthText) modifiers.push(maxWidthText);
    return { displayText: this.getDisplayName(), modifierText: makeModifierText(modifiers) };
  }
  handleEditorAction(action: string, item: WidgetItem): WidgetItem | null {
    if (action === 'toggle-link') {
      const current = item.metadata?.linkToIDE as IdeLinkMode | undefined;
      const nextIndex = current ? (IDE_LINK_MODES.indexOf(current) + 1) : 0;
      const nextMode = IDE_LINK_MODES[nextIndex];
      const rest = { ...(item.metadata ?? {}) };
      delete rest.linkToIDE;
      delete rest.linkToCursor;
      return {
        ...item,
        metadata: nextMode ? { ...rest, linkToIDE: nextMode } : (Object.keys(rest).length ? rest : undefined)
      };
    }
    return null;
  }
  render(item: WidgetItem, context: RenderContext, _settings: Settings): string | null {
    const linkMode = item.metadata?.linkToIDE as IdeLinkMode | undefined;
    if (context.isPreview) {
      const sample = item.maxWidth ? 'my-long-repository-name' : 'my-repo';
      const text = applyMaxWidth(sample, item.maxWidth);
      if (linkMode) {
        const url = buildIdeFileUrl('/Users/example/my-repo', linkMode);
        return url ? renderOsc8Link(url, text) : text;
      }
      return text;
    }
    const root = context.data.session?.project_root;
    if (!root) return isHideStateEnabled(item, NO_GIT_HIDEABLE_STATE) ? null : 'no git';
    const text = applyMaxWidth(baseName(root), item.maxWidth);
    if (linkMode) {
      const url = buildIdeFileUrl(root, linkMode);
      return url ? renderOsc8Link(url, text) : text;
    }
    return text;
  }
  getCustomKeybinds(): CustomKeybind[] {
    return [
      { key: 'l', label: 'IDE (l)ink', action: 'toggle-link' },
      getMaxWidthKeybind()
    ];
  }
  renderEditor(props: import('../types/Widget').WidgetEditorProps) { return props.action === MAX_WIDTH_ACTION ? renderMaxWidthEditor(props) : null; }
  supportsRawValue(): boolean { return false; }
  supportsColors(_item: WidgetItem): boolean { return true; }
}
