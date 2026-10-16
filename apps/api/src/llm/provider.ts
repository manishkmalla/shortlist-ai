/** Why a call to the model provider failed, in terms the app can show to a user. */
export type LlmErrorCode = 'invalid_key' | 'no_credit' | 'rate_limited' | 'unavailable';

export class LlmError extends Error {
  constructor(
    public readonly code: LlmErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'LlmError';
  }
}

/** The app talks to models only through this interface. Generation methods join it in Phase 3. */
export interface LlmProvider {
  /** Cheap live call proving the key works. Throws LlmError. */
  verifyKey(apiKey: string): Promise<void>;
}
