import Anthropic from '@anthropic-ai/sdk';
import { LlmError } from './provider';

const messages = {
  invalid_key: 'Your API key is invalid or revoked. Check it in Settings.',
  no_credit: 'Your Anthropic account has no credit. Add credit in the Anthropic console.',
  rate_limited: 'Anthropic is rate limiting this key. Wait a moment and try again.',
  unavailable: 'Could not reach Anthropic. Please try again shortly.',
} as const;

const looksLikeBilling = (message: string) => /credit balance|billing|payment/i.test(message);

/** Maps Anthropic SDK errors to LlmError. Never includes the key or the raw provider message. */
export function mapAnthropicError(e: unknown): LlmError {
  if (e instanceof LlmError) return e;
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
    return new LlmError('invalid_key', messages.invalid_key);
  }
  if (e instanceof Anthropic.RateLimitError) return new LlmError('rate_limited', messages.rate_limited);
  if (e instanceof Anthropic.APIError) {
    // Credit problems come back as 400 (or 402) with a billing message.
    if (e.status === 402 || (e.status === 400 && looksLikeBilling(e.message))) {
      return new LlmError('no_credit', messages.no_credit);
    }
  }
  return new LlmError('unavailable', messages.unavailable);
}
