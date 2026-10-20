import { describe, expect, it, spyOn } from 'bun:test';
import * as os from 'node:os';
import { CurrentWorkingDirWidget } from '../../src/widgets/CurrentWorkingDir';
import { DEFAULT_SETTINGS } from '../../src/types/Settings';
import type { RenderContext } from '../../src/types/RenderContext';
import type { WidgetItem } from '../../src/types/Widget';

const widget = new CurrentWorkingDirWidget();

function createItem(metadata: Record<string, string> = {}, rawValue = true): WidgetItem {
    return {
        id: 'cwd',
        type: 'current-working-dir',
        rawValue,
        metadata
    };
}

function createContext(cwd?: string, isPreview = false): RenderContext {
    return {
        isPreview,
        terminalWidth: 200,
        now: new Date(),
        data: {
            payload_version: 1,
            session: cwd ? { cwd } : undefined
        }
    };
}

describe('CurrentWorkingDirWidget', () => {
    const home = os.homedir();

    describe('fishStyle', () => {
        it('should replace home directory with ~ and abbreviate middle segments', () => {
            const item = createItem({ fishStyle: 'true' }, true);
            const result = widget.render(
                item,
                createContext(`${home}/Documents/Projects/app`),
                DEFAULT_SETTINGS
            );
            expect(result).toBe('~/D/P/app');
        });

        it('should not abbreviate non-home sibling paths with shared prefix', () => {
            const spy = spyOn(os, 'homedir').mockReturnValue('/Users/al');
            try {
                const item = createItem({ fishStyle: 'true' }, true);
                const result = widget.render(
                    item,
                    createContext('/Users/alex/project'),
                    DEFAULT_SETTINGS
                );
                expect(result).toBe('/Users/a/project');
            } finally {
                spy.mockRestore();
            }
        });
    });

    describe('segments with home abbreviation', () => {
        it('should not count ~ as a segment', () => {
            const item = createItem({ abbreviateHome: 'true', segments: '2' }, true);
            const result = widget.render(
                item,
                createContext(`${home}/Projects/my-project`),
                DEFAULT_SETTINGS
            );
            expect(result).toBe('~/Projects/my-project');
        });

        it('should preview segments on sample path after ~', () => {
            const item = createItem({ abbreviateHome: 'true', segments: '2' }, true);
            expect(widget.render(item, createContext(undefined, true), DEFAULT_SETTINGS)).toBe('~/.../Projects/my-project');
        });
    });
});
