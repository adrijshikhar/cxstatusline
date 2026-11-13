import { describe, expect, it } from 'bun:test';
import { renderStatusLine } from '../src/utils/renderer';
import { stripSgrCodes } from '../src/utils/ansi';
import { DEFAULT_SETTINGS } from '../src/types/Settings';
import type { RenderContext } from '../src/types/RenderContext';
import type { WidgetItem } from '../src/types/Widget';

const mockContext: RenderContext = {
    data: { payload_version: 1 },
    now: new Date('2026-09-03T12:00:00Z'),
    terminalWidth: 80,
    isPreview: false
};

const T = (id: string, text: string): WidgetItem => ({ id, type: 'custom-text', customText: text });

describe('adjacent separators and empty widgets', () => {
    it.each([
        { label: 'two spaces', characters: [' ', ' '], expected: 'A  B' },
        { label: 'two pipes', characters: ['|', '|'], expected: 'A |  | B' },
        { label: 'a space then a pipe', characters: [' ', '|'], expected: 'A  | B' },
        { label: 'a glyph between spaces', characters: [' ', '•', ' '], expected: 'A • B' }
    ])('keeps separators placed next to each other between visible widgets: $label', ({ characters, expected }) => {
        const separators = characters.map((character, i): WidgetItem => ({ id: `sep-${i}`, type: 'separator', character }));
        const widgets = [T('a', 'A'), ...separators, T('b', 'B')];
        const out = stripSgrCodes(renderStatusLine(widgets, DEFAULT_SETTINGS, mockContext));
        expect(out).toBe(expected);
    });

    it('keeps a run of separators with a visible one as the boundary around an empty widget', () => {
        const space1: WidgetItem = { id: 'space1', type: 'separator', character: ' ' };
        const bullet: WidgetItem = { id: 'bullet', type: 'separator', character: '•' };
        const space2: WidgetItem = { id: 'space2', type: 'separator', character: ' ' };
        const pipe: WidgetItem = { id: 'pipe', type: 'separator', character: '|' };
        // 'b' renders empty
        const widgets = [T('a', 'A'), space1, bullet, space2, T('b', ''), pipe, T('c', 'C')];
        const out = stripSgrCodes(renderStatusLine(widgets, DEFAULT_SETTINGS, mockContext));
        expect(out).toBe('A • C');
    });

    it('replaces a run of spacing before an empty widget with the whole run after it', () => {
        const space1: WidgetItem = { id: 'space1', type: 'separator', character: ' ' };
        const space2: WidgetItem = { id: 'space2', type: 'separator', character: ' ' };
        const space3: WidgetItem = { id: 'space3', type: 'separator', character: ' ' };
        const pipe: WidgetItem = { id: 'pipe', type: 'separator', character: '|' };
        // 'b' renders empty
        const widgets = [T('a', 'A'), space1, space2, T('b', ''), space3, pipe, T('c', 'C')];
        const out = stripSgrCodes(renderStatusLine(widgets, DEFAULT_SETTINGS, mockContext));
        expect(out).toBe('A  | C');
    });
});
