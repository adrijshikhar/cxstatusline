import type { RenderContext } from '../types/RenderContext';
import type { Settings } from '../types/Settings';
import type { Widget, WidgetEditorDisplay, WidgetItem } from '../types/Widget';
import { getContextWindowContextLengthTokens } from '../utils/context-window';
import { formatTokens } from '../utils/format-tokens';
import { resolveNumberFormat } from '../utils/number-format';

export class ContextLengthWidget implements Widget {
  getDefaultColor(): string { return 'brightBlack'; }
  getDescription(): string { return 'Shows the current context window size in tokens'; }
  getDisplayName(): string { return 'Context Length'; }
  getCategory(): string { return 'Context'; }
  getEditorDisplay(_item: WidgetItem): WidgetEditorDisplay { return { displayText: this.getDisplayName() }; }
  render(item: WidgetItem, context: RenderContext, settings: Settings): string | null {
    const format = resolveNumberFormat('token', item, settings);
    const value = context.isPreview ? 18600 : getContextWindowContextLengthTokens(context.data);
    if (value === null) return null;
    return item.rawValue ? formatTokens(value, format) : 'Ctx: ' + formatTokens(value, format);
  }
  supportsRawValue(): boolean { return true; }
  supportsColors(_item: WidgetItem): boolean { return true; }
  supportsNumberFormat(): boolean { return true; }
}
