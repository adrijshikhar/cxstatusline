import { describe, expect, it } from 'bun:test';
import { isExcludedFromProxy } from '../../src/utils/no-proxy';

describe('isExcludedFromProxy', () => {
    it.each([
        ['*'],
        ['api.openai.com'],
        ['openai.com'],
        ['.openai.com'],
        ['*.openai.com'],
        ['API.OpenAI.COM'],
        ['api.openai.com:443'],
        ['localhost, api.openai.com'],
        ['localhost,,openai.com'],
        ['localhost openai.com']
    ])('excludes api.openai.com for NO_PROXY=%j', (noProxy) => {
        expect(isExcludedFromProxy('api.openai.com', { NO_PROXY: noProxy })).toBe(true);
    });

    it.each([
        [''],
        ['localhost'],
        ['example.com'],
        ['pi.openai.com'],
        ['notopenai.com'],
        ['api.openai.com:8443'],
        ['.']
    ])('keeps api.openai.com on the proxy for NO_PROXY=%j', (noProxy) => {
        expect(isExcludedFromProxy('api.openai.com', { NO_PROXY: noProxy })).toBe(false);
    });

    it('reads the lowercase no_proxy too', () => {
        expect(isExcludedFromProxy('api.openai.com', { no_proxy: 'openai.com' })).toBe(true);
    });

    it('excludes nothing when neither variable is set', () => {
        expect(isExcludedFromProxy('api.openai.com', {})).toBe(false);
    });
});
