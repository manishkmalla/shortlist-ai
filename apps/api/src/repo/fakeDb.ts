import { BatchWriteCommand, GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { Db } from './db';

type Item = Record<string, unknown> & { pk: string; sk: string };

/** In-memory stand-in for the document client, covering only the commands the repos use. */
export function createFakeDb() {
  const items = new Map<string, Item>();
  const id = (pk: unknown, sk: unknown) => `${String(pk)}|${String(sk)}`;
  const conditionFailed = () => Object.assign(new Error('conditional check failed'), { name: 'ConditionalCheckFailedException' });

  const db = {
    async send(command: unknown) {
      if (command instanceof GetCommand) {
        const k = command.input.Key as Item;
        return { Item: items.get(id(k.pk, k.sk)) };
      }
      if (command instanceof PutCommand) {
        const item = command.input.Item as Item;
        if (command.input.ConditionExpression === 'attribute_not_exists(pk)' && items.has(id(item.pk, item.sk))) {
          throw conditionFailed();
        }
        items.set(id(item.pk, item.sk), { ...item });
        return {};
      }
      if (command instanceof UpdateCommand) {
        const k = command.input.Key as Item;
        const existing = items.get(id(k.pk, k.sk));
        if (!existing) throw conditionFailed();
        const updated = { ...existing, name: command.input.ExpressionAttributeValues?.[':n'] };
        items.set(id(k.pk, k.sk), updated);
        return { Attributes: updated };
      }
      if (command instanceof QueryCommand) {
        const pk = command.input.ExpressionAttributeValues?.[':pk'];
        return { Items: [...items.values()].filter((i) => i.pk === pk) };
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
