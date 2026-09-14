import type { RenderContext } from '../types/RenderContext';
import type { Settings } from '../types/Settings';
import type { HideableState, Widget, WidgetEditorDisplay, WidgetItem } from '../types/Widget';
import { isHideStateEnabled, NO_GIT_HIDEABLE_STATE } from './shared/hideable';

export class GitChangesWidget implements Widget {
  getDefaultColor(): string { return 'yellow'; }
  getDescription(): string { return 'Shows git changes count (+insertions, -deletions)'; }
  getDisplayName(): string { return 'Git Changes'; }
  getCategory(): string { return 'Git'; }
  getHideableStates(): HideableState[] { return [NO_GIT_HIDEABLE_STATE]; }
  getEditorDisplay(_item: WidgetItem): WidgetEditorDisplay { return { displayText: this.getDisplayName() }; }
  render(item: WidgetItem, context: RenderContext, _settings: Settings): string | null {
    if (context.isPreview) return '(+42,-10)';
    const changes = context.data.git?.changes;
    if (!changes) return isHideStateEnabled(item, NO_GIT_HIDEABLE_STATE) ? null : '(no git)';
    return '(+' + changes.additions + ',-' + changes.deletions + ')';
  }
  supportsRawValue(): boolean { return false; }
  supportsColors(_item: WidgetItem): boolean { return true; }
}
