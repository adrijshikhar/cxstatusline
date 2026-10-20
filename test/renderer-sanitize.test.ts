import { describe, expect, it } from 'bun:test';
import type { RenderContext } from '../src/types/RenderContext';
import { DEFAULT_SETTINGS } from '../src/types/Settings';
import type { WidgetItem } from '../src/types/Widget';
import { preRenderAllWidgets } from '../src/utils/renderer';

const context: RenderContext = { data: { payload_version: 1 }, now: new Date(), isPreview: false, terminalWidth: 200 };

describe('preRenderAllWidgets', () => {
    it('drops control sequences from widget output before measuring it', () => {
        const widget: WidgetItem = { id: 'text', type: 'custom-text', customText: 'safe\x1b]52;c;ZWNobyBwd25lZA==\x07\x1b[2J text' };

        const [line = []] = preRenderAllWidgets([[widget]], DEFAULT_SETTINGS, context);

        expect(line[0]?.content).toBe('safe text');
        expect(line[0]?.plainLength).toBe('safe text'.length);
    });
});
