import Anthropic from '@anthropic-ai/sdk';
import { mapAnthropicError } from './errors';
import type { LlmProvider } from './provider';

/** Uses the caller's own key. The SDK retries 429s and 5xx with backoff (maxRetries). */
export function createAnthropicProvider(): LlmProvider {
  return {
    async verifyKey(apiKey) {
      const client = new Anthropic({ apiKey, maxRetries: 2, timeout: 10_000 });
      try {
        await client.models.list({ limit: 1 });
      } catch (e) {
        throw mapAnthropicError(e);
      }
    },
  };
}
