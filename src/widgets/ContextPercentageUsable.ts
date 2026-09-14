import type { RenderContext } from '../types/RenderContext';
import type { Settings } from '../types/Settings';
import type { CustomKeybind, Widget, WidgetEditorDisplay, WidgetItem } from '../types/Widget';
import { getContextWindowMetrics } from '../utils/context-window';
import { getContextConfig, getModelContextIdentifier } from '../utils/model-context';
import { formatPercent, resolveNumberFormat } from '../utils/number-format';
import { getContextInverseModifierText, handleContextInverseAction, isContextInverse } from './shared/context-inverse';
import { cycleContextSliderMode, getContextSliderKeybinds, getContextSliderMode, getContextSliderModifierText, renderContextSlider } from './shared/context-slider';
import { formatRawOrLabeledValue } from './shared/raw-or-labeled';

export class ContextPercentageUsableWidget implements Widget {
  getDefaultColor(): string { return 'green'; }
  getDescription(): string { return 'Shows percentage of usable context window used or remaining'; }
  getDisplayName(): string { return 'Context % (usable)'; }
  getCategory(): string { return 'Context'; }
  getEditorDisplay(item: WidgetItem): WidgetEditorDisplay {
    const modifiers = [getContextInverseModifierText(item), getContextSliderModifierText(item)].filter((value): value is string => value !== undefined);
    return { displayText: this.getDisplayName(), modifierText: modifiers.length ? '(' + modifiers.map(value => value.replace(/^\(|\)$/g, '')).join(', ') + ')' : undefined };
  }
  handleEditorAction(action: string, item: WidgetItem): WidgetItem | null {
    if (action === 'toggle-slider') return cycleContextSliderMode(item);
    return handleContextInverseAction(action, item);
  }
  render(item: WidgetItem, context: RenderContext, settings: Settings): string | null {
    const format = resolveNumberFormat('percent', item, settings);
    const metrics = context.isPreview ? { contextLengthTokens: 18_560, windowSize: 200_000 } : getContextWindowMetrics(context.data);
    if (metrics.contextLengthTokens === null) return null;
    const config = getContextConfig(getModelContextIdentifier(context.data.model), metrics.windowSize);
    const used = Math.min(100, metrics.contextLengthTokens / config.usableTokens * 100);
    const percentage = isContextInverse(item) ? 100 - used : used;
    const slider = renderContextSlider(getContextSliderMode(item), percentage, format);
    return formatRawOrLabeledValue(item, isContextInverse(item) ? 'Ctx(u) Left: ' : 'Ctx(u) Used: ', slider ?? formatPercent(percentage, format));
  }
  getCustomKeybinds(): CustomKeybind[] { return [{ key: 'u', label: '(u)sed/remaining', action: 'toggle-inverse' }, ...getContextSliderKeybinds()]; }
  supportsRawValue(): boolean { return true; }
  supportsColors(_item: WidgetItem): boolean { return true; }
  supportsNumberFormat(): boolean { return true; }
}
