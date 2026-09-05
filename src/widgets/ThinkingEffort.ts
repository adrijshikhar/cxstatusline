import type { RenderContext } from '../types/RenderContext';
import type { Settings } from '../types/Settings';
import type { Widget, WidgetEditorDisplay, WidgetItem } from '../types/Widget';

export class ThinkingEffortWidget implements Widget {
  getDefaultColor(): string { return 'magenta'; }
  getDescription(): string { return 'Displays the current thinking effort level'; }
  getDisplayName(): string { return 'Thinking Effort'; }
  getCategory(): string { return 'Core'; }
  getEditorDisplay(_item: WidgetItem): WidgetEditorDisplay { return { displayText: this.getDisplayName() }; }
  render(item: WidgetItem, context: RenderContext, _settings: Settings): string | null {
    const effort = context.isPreview ? 'high' : context.data.model?.reasoning;
    if (!effort) return null;
    return item.rawValue ? effort : 'Thinking: ' + effort;
  }
  supportsRawValue(): boolean { return true; }
  supportsColors(_item: WidgetItem): boolean { return true; }
}

