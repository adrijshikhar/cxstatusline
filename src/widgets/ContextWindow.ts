import type { RenderContext } from '../types/RenderContext';
import type { Settings } from '../types/Settings';
import type { Widget, WidgetEditorDisplay, WidgetItem } from '../types/Widget';
import { getContextWindowSize } from '../utils/context-window';
import { getContextConfig, getModelContextIdentifier } from '../utils/model-context';
import { formatTokens } from '../utils/format-tokens';
import { resolveNumberFormat } from '../utils/number-format';

export class ContextWindowWidget implements Widget {
  getDefaultColor(): string { return 'brightBlack'; }
  getDescription(): string { return 'Shows the total context window size for the current model'; }
  getDisplayName(): string { return 'Context Window'; }
  getCategory(): string { return 'Context'; }
  getEditorDisplay(_item: WidgetItem): WidgetEditorDisplay { return { displayText: this.getDisplayName() }; }
  render(item: WidgetItem, context: RenderContext, settings: Settings): string | null {
    const format = resolveNumberFormat('token', item, settings);
    let total = context.isPreview ? 200000 : getContextWindowSize(context.data);
    if (total === null) total = getContextConfig(getModelContextIdentifier(context.data.model)).maxTokens;
    if (total <= 0) return null;
    return item.rawValue ? formatTokens(total, format) : 'Win: ' + formatTokens(total, format);
  }
  supportsRawValue(): boolean { return true; }
  supportsColors(_item: WidgetItem): boolean { return true; }
  supportsNumberFormat(): boolean { return true; }
}
