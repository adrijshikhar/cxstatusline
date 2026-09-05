import type { RenderContext } from '../types/RenderContext';
import type { Settings } from '../types/Settings';
import type { CustomKeybind, Widget, WidgetEditorDisplay, WidgetItem } from '../types/Widget';
import { calculateContextPercentageMetrics } from '../utils/context-percentage';
import { getContextInverseModifierText, handleContextInverseAction, isContextInverse } from './shared/context-inverse';
import { cycleContextSliderMode, getContextSliderKeybinds, getContextSliderMode, getContextSliderModifierText, renderContextSlider } from './shared/context-slider';
import { formatRawOrLabeledValue } from './shared/raw-or-labeled';

export class ContextPercentageWidget implements Widget {
  getDefaultColor(): string { return 'blue'; }
  getDescription(): string { return 'Shows percentage of context window used or remaining'; }
  getDisplayName(): string { return 'Context %'; }
  getCategory(): string { return 'Context'; }
  getEditorDisplay(item: WidgetItem): WidgetEditorDisplay {
    const modifiers = [getContextInverseModifierText(item), getContextSliderModifierText(item)].filter((value): value is string => value !== undefined);
    return { displayText: this.getDisplayName(), modifierText: modifiers.length ? '(' + modifiers.map(value => value.replace(/^\(|\)$/g, '')).join(', ') + ')' : undefined };
  }
  handleEditorAction(action: string, item: WidgetItem): WidgetItem | null {
    if (action === 'toggle-slider') return cycleContextSliderMode(item);
    return handleContextInverseAction(action, item);
  }
  render(item: WidgetItem, context: RenderContext, _settings: Settings): string | null {
    const metrics = context.isPreview ? { usedPercentage: 9.3 } : calculateContextPercentageMetrics(context);
    if (!metrics) return null;
    const percentage = isContextInverse(item) ? 100 - metrics.usedPercentage : metrics.usedPercentage;
    const slider = renderContextSlider(getContextSliderMode(item), percentage);
    return formatRawOrLabeledValue(item, isContextInverse(item) ? 'Ctx Left: ' : 'Ctx Used: ', slider ?? percentage.toFixed(1) + '%');
  }
  getCustomKeybinds(): CustomKeybind[] { return [{ key: 'u', label: '(u)sed/remaining', action: 'toggle-inverse' }, ...getContextSliderKeybinds()]; }
  supportsRawValue(): boolean { return true; }
  supportsColors(_item: WidgetItem): boolean { return true; }
}

