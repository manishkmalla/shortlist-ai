import {
  BatchWriteCommand,
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import type { Db } from './db';

type Item = Record<string, unknown> & { pk: string; sk: string };

/** In-memory stand-in for the document client, covering only the commands the repos use. */
export function createFakeDb() {
  const items = new Map<string, Item>();
  const id = (pk: unknown, sk: unknown) => `${String(pk)}|${String(sk)}`;
  const conditionFailed = () =>
    Object.assign(new Error('conditional check failed'), {
      name: 'ConditionalCheckFailedException',
    });

  const db = {
    async send(command: unknown) {
      if (command instanceof GetCommand) {
        const k = command.input.Key as Item;
        return { Item: items.get(id(k.pk, k.sk)) };
      }
      if (command instanceof PutCommand) {
        const item = command.input.Item as Item;
        if (
          command.input.ConditionExpression === 'attribute_not_exists(pk)' &&
          items.has(id(item.pk, item.sk))
        ) {
          throw conditionFailed();
        }
        items.set(id(item.pk, item.sk), { ...item });
        return {};
      }
      if (command instanceof DeleteCommand) {
        const k = command.input.Key as Item;
        items.delete(id(k.pk, k.sk));
        return {};
      }
      if (command instanceof UpdateCommand) {
        const k = command.input.Key as Item;
        const existing = items.get(id(k.pk, k.sk));
        if (!existing) throw conditionFailed();
        const updated: Item = { ...existing };
        for (const [ref, attr] of Object.entries(command.input.ExpressionAttributeNames ?? {})) {
          updated[attr] = command.input.ExpressionAttributeValues?.[`:${ref.slice(1)}`];
        }
        items.set(id(k.pk, k.sk), updated);
        return { Attributes: updated };
      }
      if (command instanceof QueryCommand) {
        const pk = command.input.ExpressionAttributeValues?.[':pk'];
        const prefix = command.input.ExpressionAttributeValues?.[':prefix'] as string | undefined;
        return {
          Items: [...items.values()].filter(
            (i) => i.pk === pk && (!prefix || i.sk.startsWith(prefix)),
          ),
        };
      }
      if (command instanceof TransactWriteCommand) {
        // All-or-nothing: check every condition before applying any update.
        const updates = (command.input.TransactItems ?? []).map((t) => t.Update!);
        for (const u of updates) {
          const k = u.Key as Item;
          if (!items.has(id(k.pk, k.sk))) {
            throw Object.assign(new Error('transaction cancelled'), {
              name: 'TransactionCanceledException',
            });
          }
        }
        for (const u of updates) {
          const k = u.Key as Item;
          const next: Item = { ...items.get(id(k.pk, k.sk))! };
          for (const [ref, attr] of Object.entries(u.ExpressionAttributeNames ?? {})) {
            next[attr] = u.ExpressionAttributeValues?.[`:${ref.slice(1)}`];
          }
          items.set(id(k.pk, k.sk), next);
        }
        return {};
      }
      if (command instanceof BatchWriteCommand) {
        for (const reqs of Object.values(command.input.RequestItems ?? {})) {
          for (const r of reqs) {
            const k = r.DeleteRequest?.Key as Item;
            items.delete(id(k.pk, k.sk));
          }
        }
        return {};
      }
      throw new Error('FakeDb: unsupported command');
    },
  } as unknown as Db;

  return { db, items };
}
