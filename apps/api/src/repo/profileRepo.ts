import {
  BatchWriteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { profileSchema, type Profile } from '@shortlist-ai/shared';
import type { Db } from './db';
import { PROFILE_SK, userPk } from './keys';

export interface ProfileRepo {
  get(userId: string): Promise<Profile | null>;
  /** Creates the profile only if none exists. Returns the stored profile either way. */
  createIfMissing(userId: string, profile: Profile): Promise<Profile>;
  updateName(userId: string, name: string): Promise<Profile | null>;
  /** Removes every item under the user's partition. */
  deleteAll(userId: string): Promise<void>;
}

export function createProfileRepo(db: Db, tableName: string): ProfileRepo {
  const key = (userId: string) => ({ pk: userPk(userId), sk: PROFILE_SK });

  const parse = (item: Record<string, unknown> | undefined): Profile | null => {
    if (!item) return null;
    // Zod drops the pk/sk key attributes.
    return profileSchema.parse(item);
  };

  const repo: ProfileRepo = {
    async get(userId) {
      const out = await db.send(new GetCommand({ TableName: tableName, Key: key(userId) }));
      return parse(out.Item);
    },

    async createIfMissing(userId, profile) {
      try {
        await db.send(
          new PutCommand({
            TableName: tableName,
            Item: { ...key(userId), ...profile },
            ConditionExpression: 'attribute_not_exists(pk)',
          }),
        );
        return profile;
      } catch (e) {
        if (e instanceof Error && e.name === 'ConditionalCheckFailedException') {
          const existing = await repo.get(userId);
          if (existing) return existing;
        }
        throw e;
      }
    },

    async updateName(userId, name) {
      try {
        const out = await db.send(
          new UpdateCommand({
            TableName: tableName,
            Key: key(userId),
            UpdateExpression: 'SET #n = :n',
            ConditionExpression: 'attribute_exists(pk)',
            ExpressionAttributeNames: { '#n': 'name' },
            ExpressionAttributeValues: { ':n': name },
            ReturnValues: 'ALL_NEW',
          }),
        );
        return parse(out.Attributes);
      } catch (e) {
        if (e instanceof Error && e.name === 'ConditionalCheckFailedException') return null;
        throw e;
      }
    },

    async deleteAll(userId) {
      let startKey: Record<string, unknown> | undefined;
      do {
        const page = await db.send(
          new QueryCommand({
            TableName: tableName,
            KeyConditionExpression: 'pk = :pk',
            ExpressionAttributeValues: { ':pk': userPk(userId) },
            ProjectionExpression: 'pk, sk',
            ExclusiveStartKey: startKey,
          }),
        );
        const items = page.Items ?? [];
        for (let i = 0; i < items.length; i += 25) {
          const batch = items.slice(i, i + 25);
          await db.send(
            new BatchWriteCommand({
              RequestItems: {
                [tableName]: batch.map((it) => ({ DeleteRequest: { Key: { pk: it.pk, sk: it.sk } } })),
              },
            }),
          );
        }
        startKey = page.LastEvaluatedKey;
      } while (startKey);
    },
  };
  return repo;
}
