import type { RenderContext } from '../types/RenderContext';
import type { Settings } from '../types/Settings';
import type { Widget, WidgetEditorDisplay, WidgetItem } from '../types/Widget';
import { formatRawOrLabeledValue } from './shared/raw-or-labeled';

const LABEL = 'Model: ';

export class ModelWidget implements Widget {
  getDefaultColor(): string { return 'cyan'; }
  getDescription(): string { return 'Displays the current Codex model name'; }
  getDisplayName(): string { return 'Model'; }
  getCategory(): string { return 'Core'; }
  getEditorDisplay(_item: WidgetItem): WidgetEditorDisplay { return { displayText: this.getDisplayName() }; }
  getLabelPrefix(): string { return LABEL; }
  render(item: WidgetItem, context: RenderContext, _settings: Settings): string | null {
    const name = context.isPreview ? 'Codex' : context.data.model?.name;
    if (!name) return null;
    const suffix = name.indexOf(' (');
    const shortName = suffix >= 0 ? name.slice(0, suffix) : name;
    return formatRawOrLabeledValue(item, this.getLabelPrefix(), shortName);
  }
  supportsRawValue(): boolean { return true; }
  supportsColors(_item: WidgetItem): boolean { return true; }
}

