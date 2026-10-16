import { DecryptCommand, GenerateDataKeyCommand, type KMSClient } from '@aws-sdk/client-kms';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/** What is stored for a secret. Useless without KMS access to `encryptedDataKey`. */
export interface SealedSecret {
  ciphertext: string;
  iv: string;
  tag: string;
  encryptedDataKey: string;
}

export interface KeyVault {
  seal(userId: string, plaintext: string): Promise<SealedSecret>;
  open(userId: string, sealed: SealedSecret): Promise<string>;
}

const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64');

/**
 * Envelope encryption: KMS makes a one-off data key, AES-256-GCM encrypts the secret with it,
 * and only the KMS-encrypted copy of the data key is stored. The KMS encryption context and
 * the GCM auth data both bind the ciphertext to the user, so it cannot be opened for anyone else.
 */
export function createKmsKeyVault(kms: Pick<KMSClient, 'send'>, keyId: string): KeyVault {
  return {
    async seal(userId, plaintext) {
      const dk = await kms.send(
        new GenerateDataKeyCommand({ KeyId: keyId, KeySpec: 'AES_256', EncryptionContext: { userId } }),
      );
      if (!dk.Plaintext || !dk.CiphertextBlob) throw new Error('KMS returned no data key');
      const dataKey = Buffer.from(dk.Plaintext);
      try {
        const iv = randomBytes(12);
        const cipher = createCipheriv('aes-256-gcm', dataKey, iv);
        cipher.setAAD(Buffer.from(userId));
        const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
        return {
          ciphertext: b64(ciphertext),
          iv: b64(iv),
          tag: b64(cipher.getAuthTag()),
          encryptedDataKey: b64(dk.CiphertextBlob),
        };
      } finally {
        dataKey.fill(0);
      }
    },

    async open(userId, sealed) {
      const out = await kms.send(
        new DecryptCommand({
          KeyId: keyId,
          CiphertextBlob: Buffer.from(sealed.encryptedDataKey, 'base64'),
          EncryptionContext: { userId },
        }),
      );
      if (!out.Plaintext) throw new Error('KMS returned no plaintext');
      const dataKey = Buffer.from(out.Plaintext);
      try {
        const decipher = createDecipheriv('aes-256-gcm', dataKey, Buffer.from(sealed.iv, 'base64'));
        decipher.setAAD(Buffer.from(userId));
        decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'));
        return Buffer.concat([decipher.update(Buffer.from(sealed.ciphertext, 'base64')), decipher.final()]).toString(
          'utf8',
        );
      } finally {
        dataKey.fill(0);
      }
    },
  };
}
