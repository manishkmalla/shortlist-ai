import type { PostConfirmationTriggerEvent } from 'aws-lambda';
import { describe, expect, it } from 'vitest';
import { handler } from './postConfirmation';

const event = (source: string, attrs: Record<string, string>) =>
  ({ triggerSource: source, request: { userAttributes: attrs }, response: {} }) as unknown as PostConfirmationTriggerEvent;

const call = (e: PostConfirmationTriggerEvent) => handler(e, {} as never, () => undefined);

describe('post-confirmation trigger', () => {
  it('returns the event unchanged for forgot-password confirmations', async () => {
    const e = event('PostConfirmation_ConfirmForgotPassword', { sub: 'a', email: 'a@example.com' });
    expect(await call(e)).toBe(e);
  });

  it('never throws, even when the table write fails', async () => {
    // No TABLE_NAME or AWS credentials in tests: the write fails and must be swallowed.
    const e = event('PostConfirmation_ConfirmSignUp', { sub: 'a', email: 'a@example.com', name: 'Alex Example' });
    await expect(call(e)).resolves.toBe(e);
  });
});
