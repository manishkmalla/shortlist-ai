import { DecryptCommand, GenerateDataKeyCommand, type KMSClient } from '@aws-sdk/client-kms';
import { randomBytes } from 'node:crypto';

/** In-memory KMS that, like the real one, refuses to decrypt under a different encryption context. */
export function createFakeKms(): Pick<KMSClient, 'send'> {
  const keys = new Map<string, { plaintext: Buffer; context: string }>();
  return {
    async send(command: unknown) {
      if (command instanceof GenerateDataKeyCommand) {
        const plaintext = randomBytes(32);
        const blob = randomBytes(24);
        keys.set(blob.toString('hex'), {
          plaintext,
          context: JSON.stringify(command.input.EncryptionContext),
        });
        return { Plaintext: Uint8Array.from(plaintext), CiphertextBlob: Uint8Array.from(blob) };
      }
      if (command instanceof DecryptCommand) {
        const entry = keys.get(Buffer.from(command.input.CiphertextBlob as Uint8Array).toString('hex'));
        if (!entry || entry.context !== JSON.stringify(command.input.EncryptionContext)) {
          throw Object.assign(new Error('InvalidCiphertextException'), { name: 'InvalidCiphertextException' });
        }
        return { Plaintext: Uint8Array.from(entry.plaintext) };
      }
      throw new Error('FakeKms: unsupported command');
    },
  } as unknown as Pick<KMSClient, 'send'>;
}
