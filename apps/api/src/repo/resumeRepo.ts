import {
  GetCommand,
  PutCommand,
  QueryCommand,
  DeleteCommand,
  TransactWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { resumeSourceSchema, resumeStatusSchema } from '@shortlist-ai/shared';
import { z } from 'zod';
import type { Db } from './db';
import { userPk } from './keys';

const RESUME_PREFIX = 'RESUME#';

/** What is stored. `reviewedAt` is null until the user accepts the text. */
export const storedResumeSchema = z.object({
  id: z.string().uuid(),
  label: z.string(),
  notes: z.string(),
  text: z.string(),
  status: resumeStatusSchema,
  source: resumeSourceSchema,
  isDefault: z.boolean(),
  reviewedAt: z.string().datetime().nullable(),
  parentResumeId: z.string().uuid().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type StoredResume = z.infer<typeof storedResumeSchema>;

export type ResumePatch = Partial<
  Pick<StoredResume, 'label' | 'notes' | 'text' | 'reviewedAt' | 'updatedAt'>
>;

export interface ResumeRepo {
  list(userId: string): Promise<StoredResume[]>;
  get(userId: string, id: string): Promise<StoredResume | null>;
  create(userId: string, resume: StoredResume): Promise<void>;
  /** Returns null if the resume does not exist for this user. */
  update(userId: string, id: string, patch: ResumePatch): Promise<StoredResume | null>;
  /** Atomically makes `id` the default and clears the flag on `clearIds`. False if any item is missing. */
  setDefault(userId: string, id: string, clearIds: string[], updatedAt: string): Promise<boolean>;
  delete(userId: string, id: string): Promise<void>;
}

export function createResumeRepo(db: Db, tableName: string): ResumeRepo {
  const key = (userId: string, id: string) => ({ pk: userPk(userId), sk: `${RESUME_PREFIX}${id}` });
  const isConditionFailure = (e: unknown) =>
    e instanceof Error &&
    (e.name === 'ConditionalCheckFailedException' || e.name === 'TransactionCanceledException');

  return {
    async list(userId) {
      const items: StoredResume[] = [];
      let startKey: Record<string, unknown> | undefined;
      do {
        const page = await db.send(
          new QueryCommand({
            TableName: tableName,
            KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
            ExpressionAttributeValues: { ':pk': userPk(userId), ':prefix': RESUME_PREFIX },
            ExclusiveStartKey: startKey,
          }),
        );
        for (const item of page.Items ?? []) items.push(storedResumeSchema.parse(item));
        startKey = page.LastEvaluatedKey;
      } while (startKey);
      return items;
    },

    async get(userId, id) {
      const out = await db.send(new GetCommand({ TableName: tableName, Key: key(userId, id) }));
      return out.Item ? storedResumeSchema.parse(out.Item) : null;
    },

    async create(userId, resume) {
      await db.send(
        new PutCommand({
          TableName: tableName,
          Item: { ...key(userId, resume.id), ...resume },
          ConditionExpression: 'attribute_not_exists(pk)',
        }),
      );
    },

    async update(userId, id, patch) {
      const fields = Object.entries(patch).filter(([, v]) => v !== undefined);
      try {
        const out = await db.send(
          new UpdateCommand({
            TableName: tableName,
            Key: key(userId, id),
            UpdateExpression: `SET ${fields.map(([k]) => `#${k} = :${k}`).join(', ')}`,
            ConditionExpression: 'attribute_exists(pk)',
            ExpressionAttributeNames: Object.fromEntries(fields.map(([k]) => [`#${k}`, k])),
            ExpressionAttributeValues: Object.fromEntries(fields.map(([k, v]) => [`:${k}`, v])),
            ReturnValues: 'ALL_NEW',
          }),
        );
        return out.Attributes ? storedResumeSchema.parse(out.Attributes) : null;
      } catch (e) {
        if (isConditionFailure(e)) return null;
        throw e;
      }
    },

    async setDefault(userId, id, clearIds, updatedAt) {
      const flag = (itemId: string, value: boolean) => ({
        Update: {
          TableName: tableName,
          Key: key(userId, itemId),
          UpdateExpression: 'SET #isDefault = :isDefault, #updatedAt = :updatedAt',
          ConditionExpression: 'attribute_exists(pk)',
          ExpressionAttributeNames: { '#isDefault': 'isDefault', '#updatedAt': 'updatedAt' },
          ExpressionAttributeValues: { ':isDefault': value, ':updatedAt': updatedAt },
        },
      });
      try {
        await db.send(
          new TransactWriteCommand({
            TransactItems: [...clearIds.map((c) => flag(c, false)), flag(id, true)],
          }),
        );
        return true;
      } catch (e) {
        if (isConditionFailure(e)) return false;
        throw e;
      }
    },

    async delete(userId, id) {
      await db.send(new DeleteCommand({ TableName: tableName, Key: key(userId, id) }));
    },
  };
}
