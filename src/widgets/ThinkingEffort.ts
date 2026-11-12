import { getColorLevelString } from '../types/ColorLevel';
import type { RenderContext } from '../types/RenderContext';
import type { Settings } from '../types/Settings';
import type { CustomKeybind, Widget, WidgetEditorDisplay, WidgetItem } from '../types/Widget';
import { makeModifierText } from './shared/editor-display';
import {
    THINKING_EFFORT_DEFAULT_COLOR,
    THINKING_EFFORT_LABEL,
    cycleBracketStyle,
    formatThinkingEffort,
    getBracketStyle,
    isLevelColorsEnabled,
    setLevelColorsEnabled,
    type EffortDisplay,
    type TranscriptThinkingEffort
} from './shared/effort-style';

const CYCLE_BRACKETS_ACTION = 'cycle-brackets';
const TOGGLE_LEVEL_COLORS_ACTION = 'toggle-level-colors';

function toEffortDisplay(raw: string | undefined): EffortDisplay | null {
    if (!raw) return null;
    const lower = raw.toLowerCase();
    const isKnown = lower === 'low' || lower === 'medium' || lower === 'high' || lower === 'xhigh' || lower === 'max';
    return isKnown
        ? { text: raw, level: lower as TranscriptThinkingEffort }
        : { text: raw, level: null };
}

export class ThinkingEffortWidget implements Widget {
  getDefaultColor(): string { return THINKING_EFFORT_DEFAULT_COLOR; }
  getDescription(): string { return 'Displays the current thinking effort level'; }
  getDisplayName(): string { return 'Thinking Effort'; }
  getCategory(): string { return 'Core'; }
  getEditorDisplay(item: WidgetItem): WidgetEditorDisplay {
    const modifiers: string[] = [];
    const brackets = getBracketStyle(item);
    if (brackets) {
      modifiers.push(`brackets ${brackets}`);
    }
    if (isLevelColorsEnabled(item)) {
      modifiers.push('level colors');
    }
    return {
      displayText: this.getDisplayName(),
      modifierText: makeModifierText(modifiers)
    };
  }
  getLabelPrefix(): string { return THINKING_EFFORT_LABEL; }
  handleEditorAction(action: string, item: WidgetItem): WidgetItem | null {
    if (action === CYCLE_BRACKETS_ACTION) {
      return cycleBracketStyle(item);
    }
    if (action === TOGGLE_LEVEL_COLORS_ACTION) {
      return setLevelColorsEnabled(item, !isLevelColorsEnabled(item));
    }
    return null;
  }
  colorsOnlyItsRuns(item: WidgetItem): boolean {
    return isLevelColorsEnabled(item);
  }
  render(item: WidgetItem, context: RenderContext, settings: Settings): string | null {
    const rawEffort = context.isPreview ? 'high' : context.data.model?.reasoning;
    const display = toEffortDisplay(rawEffort);
    if (!display) return null;

    const colorLevel = getColorLevelString(settings.colorLevel);
    const colorsDisabled = settings.colorLevel === 0;
    return formatThinkingEffort(item, display, { colorLevel, colorsDisabled });
  }
  getCustomKeybinds(): CustomKeybind[] {
    return [
      { key: 'b', label: '(b)rackets', action: CYCLE_BRACKETS_ACTION },
      { key: 'c', label: '(c)olors', action: TOGGLE_LEVEL_COLORS_ACTION }
    ];
  }
  supportsRawValue(): boolean { return true; }
  supportsColors(_item: WidgetItem): boolean { return true; }
}

