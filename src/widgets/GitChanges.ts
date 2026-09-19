import type React from 'react';
import type { RenderContext } from '../types/RenderContext';
import type { Settings } from '../types/Settings';
import type {
  CustomKeybind,
  HideableState,
  Widget,
  WidgetEditorDisplay,
  WidgetEditorProps,
  WidgetItem,
} from '../types/Widget';
import { getGitDiffChanges } from '../utils/git';
import { isHideStateEnabled, NO_GIT_HIDEABLE_STATE } from './shared/hideable';
import {
  type SymbolSlot,
  getSlotSymbol,
  getSymbolKeybind,
  renderSymbolSlotsEditor as renderSymbolEditor,
} from './shared/symbol-override';

const INSERTIONS_SLOT: SymbolSlot = { id: 'symbolInsertions', label: 'Insertions symbol', defaultSymbol: '+' };
const DELETIONS_SLOT: SymbolSlot = { id: 'symbolDeletions', label: 'Deletions symbol', defaultSymbol: '-' };

export class GitChangesWidget implements Widget {
  getDefaultColor(): string { return 'yellow'; }
  getDescription(): string { return 'Shows git changes count (+insertions, -deletions)'; }
  getDisplayName(): string { return 'Git Changes'; }
  getCategory(): string { return 'Git'; }
  getHideableStates(): HideableState[] { return [NO_GIT_HIDEABLE_STATE]; }
  getCustomKeybinds(): CustomKeybind[] { return [getSymbolKeybind()]; }
  getEditorDisplay(_item: WidgetItem): WidgetEditorDisplay { return { displayText: this.getDisplayName() }; }
  renderEditor(props: WidgetEditorProps): React.ReactElement {
    return renderSymbolEditor(props, [INSERTIONS_SLOT, DELETIONS_SLOT]);
  }
  render(item: WidgetItem, context: RenderContext, _settings: Settings): string | null {
    const ins = getSlotSymbol(item, INSERTIONS_SLOT);
    const del = getSlotSymbol(item, DELETIONS_SLOT);
    if (context.isPreview) return `(${ins}42,${del}10)`;
    const cwd = context.data.session?.cwd ?? context.data.session?.project_root;
    const shouldCheckLive = Boolean(context.commandCacheDir || context.liveGit || !context.data.git?.changes);
    const liveChanges = shouldCheckLive ? getGitDiffChanges(cwd) : null;
    const changes = liveChanges ?? context.data.git?.changes;
    if (!changes) return isHideStateEnabled(item, NO_GIT_HIDEABLE_STATE) ? null : '(no git)';
    return `(${ins}${changes.additions},${del}${changes.deletions})`;
  }
  supportsRawValue(): boolean { return false; }
  supportsColors(_item: WidgetItem): boolean { return true; }
}
