import { DeleteCommand, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { z } from 'zod';
import type { Db } from './db';
import { userPk } from './keys';

const SECRET_SK = 'SECRET#anthropic';

const storedSchema = z.object({
  ciphertext: z.string(),
  iv: z.string(),
  tag: z.string(),
  encryptedDataKey: z.string(),
  lastFour: z.string().length(4),
  validatedAt: z.string().datetime().nullable(),
});
export type StoredKey = z.infer<typeof storedSchema>;

export interface SecretRepo {
  get(userId: string): Promise<StoredKey | null>;
  put(userId: string, key: StoredKey): Promise<void>;
  delete(userId: string): Promise<void>;
}

export function createSecretRepo(db: Db, tableName: string): SecretRepo {
  const key = (userId: string) => ({ pk: userPk(userId), sk: SECRET_SK });
  return {
    async get(userId) {
      const out = await db.send(new GetCommand({ TableName: tableName, Key: key(userId) }));
      return out.Item ? storedSchema.parse(out.Item) : null;
    },
    async put(userId, stored) {
      await db.send(new PutCommand({ TableName: tableName, Item: { ...key(userId), ...stored } }));
    },
    async delete(userId) {
      await db.send(new DeleteCommand({ TableName: tableName, Key: key(userId) }));
    },
  };
}
