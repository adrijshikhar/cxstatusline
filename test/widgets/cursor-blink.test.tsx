import { describe, expect, it } from 'bun:test';
import React from 'react';
import { render } from 'ink';
import { PassThrough } from 'node:stream';
import { renderTextWithCursor } from '../../src/widgets/shared/text-cursor';
import { BlinkingCursor } from '../../src/widgets/shared/BlinkingCursor';
import { useCursorBlink } from '../../src/widgets/shared/cursor-blink';

describe('renderTextWithCursor', () => {
    it('renders cursor at end of text with visible toggle', () => {
        const text = 'hello';
        const visible = renderTextWithCursor({ text, cursor: 5 }, true);
        expect(visible).toBe('hello\x1b[7m \x1b[27m');

        const hidden = renderTextWithCursor({ text, cursor: 5 }, false);
        expect(hidden).toBe('hello ');
    });

    it('renders cursor within text with visible toggle', () => {
        const text = 'ab';
        const visible = renderTextWithCursor({ text, cursor: 1 }, true);
        expect(visible).toBe('a\x1b[7mb\x1b[27m');

        const hidden = renderTextWithCursor({ text, cursor: 1 }, false);
        expect(hidden).toBe('ab');
    });

    it('renders empty text with visible toggle', () => {
        expect(renderTextWithCursor({ text: '', cursor: 0 }, true)).toBe('\x1b[7m \x1b[27m');
        expect(renderTextWithCursor({ text: '', cursor: 0 }, false)).toBe(' ');
    });
});

describe('BlinkingCursor', () => {
    it('renders text with inverse prop', () => {
        const stdout = new PassThrough() as PassThrough & { columns: number; rows: number };
        stdout.columns = 80;
        stdout.rows = 24;
        let output = '';
        stdout.on('data', (chunk: Buffer) => { output += chunk.toString(); });
        const instance = render(<BlinkingCursor inverse>X</BlinkingCursor>, {
            stdout: stdout as unknown as NodeJS.WriteStream,
            stderr: new PassThrough() as unknown as NodeJS.WriteStream,
            debug: true,
            exitOnCtrlC: false,
            patchConsole: false
        });
        instance.unmount();
        instance.cleanup();
        expect(output).toContain('X');
    });

    it('renders text with background color when not inverse', () => {
        const stdout = new PassThrough() as PassThrough & { columns: number; rows: number };
        stdout.columns = 80;
        stdout.rows = 24;
        let output = '';
        stdout.on('data', (chunk: Buffer) => { output += chunk.toString(); });
        const instance = render(<BlinkingCursor>Y</BlinkingCursor>, {
            stdout: stdout as unknown as NodeJS.WriteStream,
            stderr: new PassThrough() as unknown as NodeJS.WriteStream,
            debug: true,
            exitOnCtrlC: false,
            patchConsole: false
        });
        instance.unmount();
        instance.cleanup();
        expect(output).toContain('Y');
    });
});

describe('useCursorBlink', () => {
    function BlinkProbe({ onValue }: { onValue: (val: boolean) => void }) {
        const visible = useCursorBlink();
        onValue(visible);
        return null;
    }

    it('initializes visible to true and unmounts cleanly', () => {
        let seenValue: boolean | undefined;
        const instance = render(<BlinkProbe onValue={(val) => { seenValue = val; }} />, {
            stdout: new PassThrough() as unknown as NodeJS.WriteStream,
            stderr: new PassThrough() as unknown as NodeJS.WriteStream,
            debug: true,
            exitOnCtrlC: false,
            patchConsole: false
        });
        expect(seenValue).toBe(true);
        instance.unmount();
        instance.cleanup();
    });
});
