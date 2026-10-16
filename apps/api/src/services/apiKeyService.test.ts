import { describe, expect, it, vi } from 'vitest';
import { createFakeKms } from '../lib/fakeKms';
import { createKmsKeyVault } from '../lib/keyVault';
import { LlmError, type LlmProvider } from '../llm/provider';
import { createFakeDb } from '../repo/fakeDb';
import { createSecretRepo } from '../repo/secretRepo';
import { createApiKeyService } from './apiKeyService';

const KEY_A = 'sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAA-wxyz';
const KEY_B = 'sk-ant-api03-BBBBBBBBBBBBBBBBBBBBBBBB-1234';

function setup(verify: LlmProvider['verifyKey'] = async () => undefined) {
  const { db, items } = createFakeDb();
  const provider = { verifyKey: vi.fn(verify) };
  const svc = createApiKeyService({
    repo: createSecretRepo(db, 't'),
    vault: createKmsKeyVault(createFakeKms(), 'key'),
    provider,
    now: () => new Date('2026-01-01T00:00:00.000Z'),
  });
  return { svc, provider, items };
}

describe('apiKeyService', () => {
  it('reports not configured before a key is saved', async () => {
    expect(await setup().svc.status('a')).toEqual({ configured: false, lastFour: null, validatedAt: null });
  });

  it('verifies the key live, then stores it encrypted and returns only metadata', async () => {
    const { svc, provider, items } = setup();
    const status = await svc.save('a', KEY_A);
    expect(provider.verifyKey).toHaveBeenCalledWith(KEY_A);
    expect(status).toEqual({ configured: true, lastFour: 'wxyz', validatedAt: '2026-01-01T00:00:00.000Z' });
    expect(JSON.stringify([...items.values()])).not.toContain(KEY_A);
    expect(JSON.stringify([...items.values()])).not.toContain('sk-ant');
  });

  it('stores nothing when live validation fails', async () => {
    const { svc, items } = setup(async () => {
      throw new LlmError('invalid_key', 'bad');
    });
    await expect(svc.save('a', KEY_A)).rejects.toMatchObject({ code: 'invalid_key' });
    expect(items.size).toBe(0);
  });

  it('replaces an existing key', async () => {
    const { svc } = setup();
    await svc.save('a', KEY_A);
    expect((await svc.save('a', KEY_B)).lastFour).toBe('1234');
  });

  it('test re-validates the stored key using the decrypted value', async () => {
    const { svc, provider } = setup();
    await svc.save('a', KEY_A);
    provider.verifyKey.mockClear();
    await svc.test('a');
    expect(provider.verifyKey).toHaveBeenCalledExactlyOnceWith(KEY_A);
  });

  it('test clears validatedAt when the key is rejected, but keeps it saved', async () => {
    const { svc, provider } = setup();
    await svc.save('a', KEY_A);
    provider.verifyKey.mockRejectedValue(new LlmError('invalid_key', 'revoked'));
    await expect(svc.test('a')).rejects.toMatchObject({ code: 'invalid_key' });
    expect(await svc.status('a')).toEqual({ configured: true, lastFour: 'wxyz', validatedAt: null });
  });

  it('test leaves validatedAt alone on a transient failure', async () => {
    const { svc, provider } = setup();
    await svc.save('a', KEY_A);
    provider.verifyKey.mockRejectedValue(new LlmError('rate_limited', 'slow down'));
    await expect(svc.test('a')).rejects.toMatchObject({ code: 'rate_limited' });
    expect((await svc.status('a')).validatedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('test without a saved key is an error', async () => {
    await expect(setup().svc.test('a')).rejects.toMatchObject({ code: 'invalid_key' });
  });

  it('remove deletes the key', async () => {
    const { svc } = setup();
    await svc.save('a', KEY_A);
    await svc.remove('a');
    expect((await svc.status('a')).configured).toBe(false);
  });

  it('user A cannot see, test or remove user B key', async () => {
    const { svc, provider } = setup();
    await svc.save('b', KEY_B);
    provider.verifyKey.mockClear();

    expect(await svc.status('a')).toEqual({ configured: false, lastFour: null, validatedAt: null });
    await expect(svc.test('a')).rejects.toBeInstanceOf(LlmError);
    expect(provider.verifyKey).not.toHaveBeenCalled();
    await svc.remove('a');
    expect((await svc.status('b')).lastFour).toBe('1234');
  });
});
