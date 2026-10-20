import { describe, expect, it } from 'bun:test';
import { resolveExecutable } from '../../src/utils/executable-path';

function windows(files: string[], env: NodeJS.ProcessEnv = { Path: 'C:\\Windows\\System32;C:\\Program Files\\Git\\cmd' }) {
    const present = new Set(files.map(file => file.toLowerCase()));
    return {
        platform: 'win32' as const,
        env,
        isFile: (candidate: string) => present.has(candidate.toLowerCase())
    };
}

describe('resolveExecutable', () => {
    it('leaves names alone outside Windows, where only PATH is searched', () => {
        expect(resolveExecutable('git', { platform: 'darwin', env: {}, isFile: () => false })).toBe('git');
        expect(resolveExecutable('git', { platform: 'linux', env: {}, isFile: () => false })).toBe('git');
    });

    it('finds a program on PATH with the extensions Windows runs directly', () => {
        expect(resolveExecutable('git', windows(['C:\\Program Files\\Git\\cmd\\git.exe']))).toBe('C:\\Program Files\\Git\\cmd\\git.exe');
        expect(resolveExecutable('tool', windows(['C:\\Windows\\System32\\tool.com']))).toBe('C:\\Windows\\System32\\tool.com');
    });

    it('keeps an explicit extension', () => {
        expect(resolveExecutable('chcp.com', windows(['C:\\Windows\\System32\\chcp.com']))).toBe('C:\\Windows\\System32\\chcp.com');
    });

    it('takes the first match in PATH order', () => {
        const lookup = windows(['C:\\Windows\\System32\\git.exe', 'C:\\Program Files\\Git\\cmd\\git.exe']);

        expect(resolveExecutable('git', lookup)).toBe('C:\\Windows\\System32\\git.exe');
    });

    // The point: a git.exe in the current directory must never be the one that runs
    it.each([
        ['"."', '.;C:\\Program Files\\Git\\cmd'],
        ['an empty entry', ';C:\\Program Files\\Git\\cmd'],
        ['a relative entry', 'tools;C:\\Program Files\\Git\\cmd']
    ])('skips %s in PATH', (_label, pathValue) => {
        const lookup = windows(['.\\git.exe', 'git.exe', 'tools\\git.exe', 'C:\\Program Files\\Git\\cmd\\git.exe'], { Path: pathValue });

        expect(resolveExecutable('git', lookup)).toBe('C:\\Program Files\\Git\\cmd\\git.exe');
    });

    it('throws when the program is missing from PATH', () => {
        expect(() => resolveExecutable('missing', windows([]))).toThrow('missing was not found on PATH');
    });
});
