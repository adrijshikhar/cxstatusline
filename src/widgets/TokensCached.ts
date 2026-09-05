import type { RenderContext } from '../types/RenderContext';
import type { Settings } from '../types/Settings';
import type { Widget, WidgetEditorDisplay, WidgetItem } from '../types/Widget';
import { formatTokens } from '../utils/format-tokens';
import { formatRawOrLabeledValue } from './shared/raw-or-labeled';

export class TokensCachedWidget implements Widget {
  getDefaultColor(): string { return 'cyan'; }
  getDescription(): string { return 'Shows cached token count for the current session'; }
  getDisplayName(): string { return 'Tokens Cached'; }
  getCategory(): string { return 'Tokens'; }
  getEditorDisplay(_item: WidgetItem): WidgetEditorDisplay { return { displayText: this.getDisplayName() }; }
  render(item: WidgetItem, context: RenderContext, _settings: Settings): string | null {
    if (context.isPreview) return formatRawOrLabeledValue(item, 'Cached: ', '12k');
    const value = context.data.usage?.cached_input_tokens ?? null;
    return value === null ? null : formatRawOrLabeledValue(item, 'Cached: ', formatTokens(value));
  }
  supportsRawValue(): boolean { return true; }
  supportsColors(_item: WidgetItem): boolean { return true; }
}

