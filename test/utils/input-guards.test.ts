import { describe, expect, it } from 'bun:test';
import { getPlainInput, shouldInsertInput } from '../../src/utils/input-guards';

describe('getPlainInput', () => {
    it('passes bare keypresses through, shifted ones included', () => {
        expect(getPlainInput('d', {})).toBe('d');
        expect(getPlainInput('D', { shift: true })).toBe('D');
        expect(getPlainInput(' ', {})).toBe(' ');
    });

    it('hides the letter while ctrl or alt/option (meta) is held', () => {
        expect(getPlainInput('d', { ctrl: true })).toBe('');
        expect(getPlainInput('d', { meta: true })).toBe('');
        expect(getPlainInput('d', { ctrl: true, meta: true })).toBe('');
    });
});

describe('shouldInsertInput', () => {
    it('allows regular printable input without modifiers', () => {
        expect(shouldInsertInput('a', {})).toBe(true);
        expect(shouldInsertInput('Z', { shift: true })).toBe(true);
        expect(shouldInsertInput(' ', {})).toBe(true);
    });

    it('rejects input when ctrl or meta is held', () => {
        expect(shouldInsertInput('c', { ctrl: true })).toBe(false);
        expect(shouldInsertInput('v', { meta: true })).toBe(false);
    });

    it('rejects control characters', () => {
        expect(shouldInsertInput('\u0000', {})).toBe(false);
        expect(shouldInsertInput('\x1b', {})).toBe(false);
        expect(shouldInsertInput('\x7f', {})).toBe(false);
    });
});
