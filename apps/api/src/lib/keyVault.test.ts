import { describe, expect, it } from 'vitest';
import { createFakeKms } from './fakeKms';
import { createKmsKeyVault } from './keyVault';

const SECRET = 'sk-ant-api03-FAKEFAKEFAKEFAKEFAKEFAKE-abcd';

describe('keyVault', () => {
  it('round-trips a secret', async () => {
    const vault = createKmsKeyVault(createFakeKms(), 'key');
    const sealed = await vault.seal('user-a', SECRET);
    expect(await vault.open('user-a', sealed)).toBe(SECRET);
  });

  it('never stores the plaintext', async () => {
    const vault = createKmsKeyVault(createFakeKms(), 'key');
    const sealed = await vault.seal('user-a', SECRET);
    expect(JSON.stringify(sealed)).not.toContain('sk-ant');
    expect(JSON.stringify(sealed)).not.toContain(SECRET);
  });

  it('uses a fresh data key and IV each time', async () => {
    const vault = createKmsKeyVault(createFakeKms(), 'key');
    const a = await vault.seal('user-a', SECRET);
    const b = await vault.seal('user-a', SECRET);
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(a.iv).not.toBe(b.iv);
    expect(a.encryptedDataKey).not.toBe(b.encryptedDataKey);
  });

  it('cannot be opened as a different user', async () => {
    const vault = createKmsKeyVault(createFakeKms(), 'key');
    const sealed = await vault.seal('user-a', SECRET);
    await expect(vault.open('user-b', sealed)).rejects.toThrow();
  });

  it('detects tampering with the ciphertext', async () => {
    const vault = createKmsKeyVault(createFakeKms(), 'key');
    const sealed = await vault.seal('user-a', SECRET);
    const flipped = Buffer.from(sealed.ciphertext, 'base64');
    flipped[0] = flipped[0]! ^ 0xff;
    await expect(vault.open('user-a', { ...sealed, ciphertext: flipped.toString('base64') })).rejects.toThrow();
  });
});
