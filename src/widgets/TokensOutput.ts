import type { RenderContext } from '../types/RenderContext';
import type { Settings } from '../types/Settings';
import type { Widget, WidgetEditorDisplay, WidgetItem } from '../types/Widget';
import { formatTokens } from '../utils/format-tokens';
import { resolveNumberFormat } from '../utils/number-format';
import { formatRawOrLabeledValue } from './shared/raw-or-labeled';

export class TokensOutputWidget implements Widget {
  getDefaultColor(): string { return 'white'; }
  getDescription(): string { return 'Shows output token count for the current session'; }
  getDisplayName(): string { return 'Tokens Output'; }
  getCategory(): string { return 'Tokens'; }
  getEditorDisplay(_item: WidgetItem): WidgetEditorDisplay { return { displayText: this.getDisplayName() }; }
  render(item: WidgetItem, context: RenderContext, settings: Settings): string | null {
    const format = resolveNumberFormat('token', item, settings);
    if (context.isPreview) return formatRawOrLabeledValue(item, 'Out: ', formatTokens(3400, format));
    const value = context.data.usage?.output_tokens ?? null;
    return value === null ? null : formatRawOrLabeledValue(item, 'Out: ', formatTokens(value, format));
  }
  supportsRawValue(): boolean { return true; }
  supportsColors(_item: WidgetItem): boolean { return true; }
  supportsNumberFormat(): boolean { return true; }
}
