import type { RenderContext } from '../types/RenderContext';
import type { Settings } from '../types/Settings';
import type {
    CustomKeybind,
    HideableState,
    Widget,
    WidgetEditorDisplay,
    WidgetItem
} from '../types/Widget';

import {
    getCacheHitRate,
    getCacheTokens
} from './shared/cache-metrics';
import {
    getCacheScopeKeybind,
    getCacheScopeModifierText,
    handleCacheScopeAction,
    isCacheSessionScope
} from './shared/cache-scope';
import { getHideKeybind, getHideModifierText, isHideStateEnabled, ZERO_HIDEABLE_STATE } from './shared/hideable';
import { makeModifierText } from './shared/editor-display';
import { formatRawOrLabeledValue } from './shared/raw-or-labeled';

export class CacheHitRateWidget implements Widget {
    getDefaultColor(): string { return 'green'; }
    getDescription(): string { return 'Shows prompt cache hit rate (cache reads vs cache writes)'; }
    getDisplayName(): string { return 'Cache Hit Rate'; }
    getCategory(): string { return 'Cache'; }
    getHideableStates(): HideableState[] { return [ZERO_HIDEABLE_STATE]; }
    getEditorDisplay(item: WidgetItem): WidgetEditorDisplay {
        const modifiers = [getCacheScopeModifierText(item), getHideModifierText(item, this.getHideableStates())].filter((value): value is string => value !== undefined);
        return { displayText: this.getDisplayName(), modifierText: makeModifierText(modifiers) };
    }

    handleEditorAction(action: string, item: WidgetItem): WidgetItem | null {
        return handleCacheScopeAction(action, item);
    }

    render(item: WidgetItem, context: RenderContext, settings: Settings): string | null {
        if (context.isPreview) {
            return formatRawOrLabeledValue(item, 'Cache Hit: ', '87.0%');
        }

        const hideWhenEmpty = isHideStateEnabled(item, ZERO_HIDEABLE_STATE);
        const tokens = getCacheTokens(context, isCacheSessionScope(item));
        if (!tokens) {
            return hideWhenEmpty ? null : formatRawOrLabeledValue(item, 'Cache Hit: ', 'n/a');
        }

        const hitRate = getCacheHitRate(tokens);
        if (hitRate === null) {
            return hideWhenEmpty ? null : formatRawOrLabeledValue(item, 'Cache Hit: ', '0.0%');
        }

        if (hitRate === 0 && hideWhenEmpty) {
            return null;
        }

        return formatRawOrLabeledValue(item, 'Cache Hit: ', `${hitRate.toFixed(1)}%`);
    }

    getCustomKeybinds(item?: WidgetItem): CustomKeybind[] {
        return [getCacheScopeKeybind(), getHideKeybind()];
    }

    supportsRawValue(): boolean { return true; }
    supportsColors(item: WidgetItem): boolean { return true; }
}
