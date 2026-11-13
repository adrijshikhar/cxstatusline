import { describe, expect, it } from 'bun:test';
import type { WidgetItem } from '../../src/types/Widget';
import {
  hasCustomWidgetColors,
  sanitizeLinesForColorLevel,
} from '../../src/utils/color-sanitize';

describe('color sanitize helpers', () => {
  it('clears separator colors the next mode cannot show, and keeps the rest', () => {
    const lines: WidgetItem[][] = [[
      { id: '1', type: 'separator', color: 'hex:00FF00' },
      { id: '2', type: 'flex-separator', color: 'hex:00FF00' },
      { id: '3', type: 'separator', color: 'ansi256:120' },
      { id: '4', type: 'separator', color: 'red' },
    ]];

    const at256 = sanitizeLinesForColorLevel(lines, 2);
    expect(at256[0]?.map((widget) => widget.color)).toEqual([undefined, undefined, 'ansi256:120', 'red']);

    const atTruecolor = sanitizeLinesForColorLevel(lines, 3);
    expect(atTruecolor[0]?.map((widget) => widget.color)).toEqual(['hex:00FF00', 'hex:00FF00', undefined, 'red']);
  });

  it('resets the separator colors that trigger the reset warning', () => {
    const lines: WidgetItem[][] = [[
      { id: '1', type: 'model' },
      { id: '2', type: 'separator', color: 'hex:00FF00' },
    ]];

    expect(hasCustomWidgetColors(lines)).toBe(true);
    expect(hasCustomWidgetColors(sanitizeLinesForColorLevel(lines, 0))).toBe(false);
  });
});
