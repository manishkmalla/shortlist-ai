import { expect, it } from 'vitest';
import { handler } from './health';

it('returns ok', async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = (await (handler as any)({}, {}, () => undefined)) as { statusCode: number };
  expect(res.statusCode).toBe(200);
});
