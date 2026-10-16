import type { ApiKeyStatus } from '@shortlist-ai/shared';
import type { KeyVault } from '../lib/keyVault';
import { LlmError, type LlmProvider } from '../llm/provider';
import type { SecretRepo, StoredKey } from '../repo/secretRepo';

const NOT_CONFIGURED: ApiKeyStatus = { configured: false, lastFour: null, validatedAt: null };

const toStatus = (k: StoredKey): ApiKeyStatus => ({
  configured: true,
  lastFour: k.lastFour,
  validatedAt: k.validatedAt,
});

export function createApiKeyService(deps: {
  repo: SecretRepo;
  vault: KeyVault;
  provider: LlmProvider;
  now?: () => Date;
}) {
  const now = deps.now ?? (() => new Date());

  return {
    async status(userId: string): Promise<ApiKeyStatus> {
      const stored = await deps.repo.get(userId);
      return stored ? toStatus(stored) : NOT_CONFIGURED;
    },

    /** Verifies the key with a live call first; nothing is stored if that fails. */
    async save(userId: string, apiKey: string): Promise<ApiKeyStatus> {
      await deps.provider.verifyKey(apiKey);
      const sealed = await deps.vault.seal(userId, apiKey);
      const stored: StoredKey = { ...sealed, lastFour: apiKey.slice(-4), validatedAt: now().toISOString() };
      await deps.repo.put(userId, stored);
      return toStatus(stored);
    },

    /** Re-checks the stored key. A rejected key stays saved but loses its `validatedAt`. */
    async test(userId: string): Promise<ApiKeyStatus> {
      const stored = await deps.repo.get(userId);
      if (!stored) throw new LlmError('invalid_key', 'No API key is saved yet.');
      const apiKey = await deps.vault.open(userId, stored);
      try {
        await deps.provider.verifyKey(apiKey);
      } catch (e) {
        if (e instanceof LlmError && e.code === 'invalid_key') {
          await deps.repo.put(userId, { ...stored, validatedAt: null });
        }
        throw e;
      }
      const updated = { ...stored, validatedAt: now().toISOString() };
      await deps.repo.put(userId, updated);
      return toStatus(updated);
    },

    async remove(userId: string): Promise<void> {
      await deps.repo.delete(userId);
    },
  };
}

export type ApiKeyService = ReturnType<typeof createApiKeyService>;
