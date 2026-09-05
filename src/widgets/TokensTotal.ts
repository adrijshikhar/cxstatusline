import type { RenderContext } from '../types/RenderContext';
import type { Settings } from '../types/Settings';
import type { Widget, WidgetEditorDisplay, WidgetItem } from '../types/Widget';
import { formatTokens } from '../utils/format-tokens';
import { formatRawOrLabeledValue } from './shared/raw-or-labeled';

export class TokensTotalWidget implements Widget {
  getDefaultColor(): string { return 'cyan'; }
  getDescription(): string { return 'Shows total token count for the current session'; }
  getDisplayName(): string { return 'Tokens Total'; }
  getCategory(): string { return 'Tokens'; }
  getEditorDisplay(_item: WidgetItem): WidgetEditorDisplay { return { displayText: this.getDisplayName() }; }
  render(item: WidgetItem, context: RenderContext, _settings: Settings): string | null {
    if (context.isPreview) return formatRawOrLabeledValue(item, 'Total: ', '30.6k');
    const value = context.data.usage && context.data.usage.input_tokens !== undefined && context.data.usage.output_tokens !== undefined ? context.data.usage.input_tokens + context.data.usage.output_tokens : null;
    return value === null ? null : formatRawOrLabeledValue(item, 'Total: ', formatTokens(value));
  }
  supportsRawValue(): boolean { return true; }
  supportsColors(_item: WidgetItem): boolean { return true; }
}

