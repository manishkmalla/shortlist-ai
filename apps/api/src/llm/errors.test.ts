import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { mapAnthropicError } from './errors';

const api = (status: number, message: string) =>
  Anthropic.APIError.generate(status, { type: 'error', error: { type: 'x', message } }, message, new Headers());

describe('mapAnthropicError', () => {
  it.each([
    [401, 'invalid x-api-key', 'invalid_key'],
    [403, 'forbidden', 'invalid_key'],
    [429, 'rate limited', 'rate_limited'],
    [402, 'billing', 'no_credit'],
    [400, 'Your credit balance is too low to access the Anthropic API.', 'no_credit'],
    [500, 'boom', 'unavailable'],
    [529, 'overloaded', 'unavailable'],
  ])('maps HTTP %i to a friendly code', (status, message, code) => {
    expect(mapAnthropicError(api(status, message)).code).toBe(code);
  });

  it('does not treat an unrelated 400 as a credit problem', () => {
    expect(mapAnthropicError(api(400, 'messages: field required')).code).toBe('unavailable');
  });

  it('treats unknown failures as unavailable', () => {
    expect(mapAnthropicError(new Error('ECONNRESET')).code).toBe('unavailable');
  });

  it('never leaks the provider message into the user message', () => {
    const mapped = mapAnthropicError(api(401, 'invalid key sk-ant-SECRETVALUE'));
    expect(mapped.message).not.toContain('SECRETVALUE');
    expect(mapped.message).toContain('invalid or revoked');
  });
});
