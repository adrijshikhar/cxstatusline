import type { RenderContext } from '../types/RenderContext';
import type { Settings } from '../types/Settings';
import type { CustomKeybind, Widget, WidgetEditorDisplay, WidgetItem } from '../types/Widget';
import { getContextWindowMetrics } from '../utils/context-window';
import { formatTokens } from '../utils/format-tokens';
import { formatPercent, resolveNumberFormat } from '../utils/number-format';
import { makeUsageProgressBar } from '../utils/usage';
import { formatRawOrLabeledValue } from './shared/raw-or-labeled';
import { makeSliderBar } from './shared/usage-display';

type DisplayMode = 'progress' | 'progress-short' | 'slider' | 'slider-only';
function getDisplayMode(item: WidgetItem): DisplayMode {
  const mode = item.metadata?.display;
  return mode === 'progress' || mode === 'slider' || mode === 'slider-only' ? mode : 'progress-short';
}
function sliderMode(mode: DisplayMode): boolean { return mode === 'slider' || mode === 'slider-only'; }

export class ContextBarWidget implements Widget {
  getDefaultColor(): string { return 'blue'; }
  getDescription(): string { return 'Shows context usage as a progress bar'; }
  getDisplayName(): string { return 'Context Bar'; }
  getCategory(): string { return 'Context'; }
  getEditorDisplay(item: WidgetItem): WidgetEditorDisplay {
    const mode = getDisplayMode(item);
    const label = mode === 'progress' ? 'long bar' : mode === 'progress-short' ? 'medium bar' : mode === 'slider' ? 'short bar' : 'short bar only';
    return { displayText: this.getDisplayName(), modifierText: '(' + label + ')' };
  }
  handleEditorAction(action: string, item: WidgetItem): WidgetItem | null {
    if (action !== 'toggle-progress') return null;
    const mode = getDisplayMode(item);
    const next = mode === 'progress-short' ? 'progress' : mode === 'progress' ? 'slider' : mode === 'slider' ? 'slider-only' : 'progress-short';
    return { ...item, metadata: { ...(item.metadata ?? {}), display: next } };
  }
  render(item: WidgetItem, context: RenderContext, settings: Settings): string | null {
    const mode = getDisplayMode(item);
    const tokenFormat = resolveNumberFormat('token', item, settings);
    const percentFormat = resolveNumberFormat('percent', item, settings);

    if (context.isPreview) {
      const usedDisplay = formatTokens(50000, tokenFormat, 0);
      const totalDisplay = formatTokens(200000, tokenFormat, 0);
      const percentDisplay = formatPercent(25, percentFormat, 0);
      if (sliderMode(mode)) {
        const slider = makeSliderBar(25);
        const sliderDisplay = mode === 'slider' ? `${slider} ${usedDisplay}/${totalDisplay} (${percentDisplay})` : slider;
        return formatRawOrLabeledValue(item, 'Context: ', sliderDisplay);
      }
      const width = mode === 'progress' ? 32 : 16;
      return formatRawOrLabeledValue(item, 'Context: ', `${makeUsageProgressBar(25, width)} ${usedDisplay}/${totalDisplay} (${percentDisplay})`);
    }
    const metrics = getContextWindowMetrics(context.data);
    const total = metrics.windowSize;
    const used = metrics.contextLengthTokens;
    if (total === null || used === null || total <= 0) return null;
    const percent = Math.max(0, Math.min(100, (used / total) * 100));
    const usedText = formatTokens(used, tokenFormat, 0);
    const totalText = formatTokens(total, tokenFormat, 0);
    const percentText = formatPercent(percent, percentFormat, 0);
    if (sliderMode(mode)) {
      const slider = makeSliderBar(percent);
      const sliderDisplay = mode === 'slider' ? `${slider} ${usedText}/${totalText} (${percentText})` : slider;
      return formatRawOrLabeledValue(item, 'Context: ', sliderDisplay);
    }
    const width = mode === 'progress' ? 32 : 16;
    return formatRawOrLabeledValue(item, 'Context: ', `${makeUsageProgressBar(percent, width)} ${usedText}/${totalText} (${percentText})`);
  }
  getCustomKeybinds(): CustomKeybind[] { return [{ key: 'p', label: '(p)rogress toggle', action: 'toggle-progress' }]; }
  supportsRawValue(): boolean { return true; }
  supportsColors(_item: WidgetItem): boolean { return true; }
  supportsNumberFormat(): boolean { return true; }
}
