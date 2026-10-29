import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { MAX_RESUMES } from '@shortlist-ai/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiEvent } from '../lib/http';
import { createFakeDb } from '../repo/fakeDb';
import { createResumeRepo } from '../repo/resumeRepo';
import { createResumeService } from '../services/resumeService';
import { route } from './resumes';

const TEXT = 'Alex Example\nSoftware Engineer\nBuilt things at Example Corp from 2020 to 2024.';

function setup() {
  const { db, items } = createFakeDb();
  let n = 0;
  let clock = Date.parse('2026-01-01T00:00:00.000Z');
  const svc = createResumeService({
    repo: createResumeRepo(db, 't'),
    newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
    now: () => new Date((clock += 1000)),
  });
  return { svc, items };
}

function event(
  routeKey: string,
  sub: string,
  opts: { id?: string; body?: unknown; rawBody?: string } = {},
): ApiEvent {
  const [method] = routeKey.split(' ');
  return {
    routeKey,
    pathParameters: opts.id ? { id: opts.id } : undefined,
    body: opts.rawBody ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)),
    isBase64Encoded: false,
    requestContext: {
      http: { method },
      authorizer: {
        jwt: { claims: { sub, email: `${sub}@example.com`, name: `User ${sub}` }, scopes: [] },
      },
    },
  } as unknown as ApiEvent;
}

const res = (r: unknown) => r as APIGatewayProxyStructuredResultV2;
const body = (r: unknown) => JSON.parse(res(r).body ?? '{}');

type Svc = ReturnType<typeof setup>['svc'];
const create = async (svc: Svc, sub: string, label = 'AI Engineer', text = TEXT) =>
  body(await route(event('POST /resumes', sub, { body: { label, text } }), svc));
const listFor = async (svc: Svc, sub: string) =>
  body(await route(event('GET /resumes', sub), svc)).resumes;

afterEach(() => vi.restoreAllMocks());

describe('create and list', () => {
  it('creates a pasted resume as reviewed and ready, and makes the first one the default', async () => {
    const { svc } = setup();
    const r = res(
      await route(
        event('POST /resumes', 'a', {
          body: { label: ' AI Engineer ', text: TEXT, notes: 'for ML roles' },
        }),
        svc,
      ),
    );
    expect(r.statusCode).toBe(201);
    expect(body(r)).toMatchObject({
      label: 'AI Engineer',
      notes: 'for ML roles',
      text: TEXT,
      status: 'ready',
      source: 'paste',
      isDefault: true,
      reviewed: true,
      textLength: TEXT.length,
      wordCount: 13,
    });
  });

  it('counts words across lines and repeated whitespace, and updates the count on edit', async () => {
    const { svc } = setup();
    const { id } = await create(
      svc,
      'a',
      'Counts',
      'one  two\nthree\t four   five six seven eight nine ten',
    );
    expect((await listFor(svc, 'a'))[0].wordCount).toBe(10);
    const edited = body(
      await route(
        event('PUT /resumes/{id}', 'a', { id, body: { text: `${TEXT} extra words here` } }),
        svc,
      ),
    );
    expect(edited.wordCount).toBe(16);
  });

  it('only the first resume is the default', async () => {
    const { svc } = setup();
    await create(svc, 'a', 'One');
    expect((await create(svc, 'a', 'Two')).isDefault).toBe(false);
  });

  it('the listing has metadata only, never the text', async () => {
    const { svc } = setup();
    await create(svc, 'a');
    const [item] = await listFor(svc, 'a');
    expect(item).toMatchObject({ label: 'AI Engineer', textLength: TEXT.length });
    expect(item).not.toHaveProperty('text');
  });

  it('lists the most recently updated first', async () => {
    const { svc } = setup();
    await create(svc, 'a', 'First');
    await create(svc, 'a', 'Second');
    expect((await listFor(svc, 'a')).map((r: { label: string }) => r.label)).toEqual([
      'Second',
      'First',
    ]);
  });

  it.each([
    ['no label', { text: TEXT }],
    ['blank label', { label: '   ', text: TEXT }],
    ['label too long', { label: 'x'.repeat(81), text: TEXT }],
    ['no text', { label: 'A' }],
    ['text too short', { label: 'A', text: 'hi' }],
    ['text too long', { label: 'A', text: 'x'.repeat(60_001) }],
    ['unknown field', { label: 'A', text: TEXT, userId: 'b' }],
    ['status set by the client', { label: 'A', text: TEXT, status: 'ready' }],
  ])('rejects %s', async (_name, payload) => {
    const { svc } = setup();
    expect(res(await route(event('POST /resumes', 'a', { body: payload }), svc)).statusCode).toBe(
      400,
    );
    expect(await listFor(svc, 'a')).toHaveLength(0);
  });

  it('accepts text at the length limit', async () => {
    const { svc } = setup();
    const r = res(
      await route(
        event('POST /resumes', 'a', { body: { label: 'Long', text: 'x'.repeat(60_000) } }),
        svc,
      ),
    );
    expect(r.statusCode).toBe(201);
  });

  it('rejects an oversized request body', async () => {
    const { svc } = setup();
    const huge = JSON.stringify({ label: 'A', text: 'x'.repeat(300_000) });
    expect(res(await route(event('POST /resumes', 'a', { rawBody: huge }), svc)).statusCode).toBe(
      400,
    );
  });

  it('rejects malformed JSON', async () => {
    const { svc } = setup();
    expect(
      res(await route(event('POST /resumes', 'a', { rawBody: '{nope' }), svc)).statusCode,
    ).toBe(400);
  });
});

describe('library limit', () => {
  it('allows ten, then refuses with a clear message, and frees a slot after a delete', async () => {
    const { svc } = setup();
    let last = { id: '' };
    for (let i = 0; i < MAX_RESUMES; i++) last = await create(svc, 'a', `R${i}`);
    const r = res(
      await route(event('POST /resumes', 'a', { body: { label: 'Eleventh', text: TEXT } }), svc),
    );
    expect(r.statusCode).toBe(409);
    expect(body(r).error).toMatchObject({ code: 'limit_reached' });
    expect(body(r).error.message).toContain('up to 10 resumes');

    await route(event('DELETE /resumes/{id}', 'a', { id: last.id }), svc);
    expect(
      res(
        await route(event('POST /resumes', 'a', { body: { label: 'Eleventh', text: TEXT } }), svc),
      ).statusCode,
    ).toBe(201);
  });

  it('duplicating at the limit is refused too', async () => {
    const { svc } = setup();
    let first = { id: '' };
    for (let i = 0; i < MAX_RESUMES; i++) {
      const r = await create(svc, 'a', `R${i}`);
      if (i === 0) first = r;
    }
    expect(
      res(await route(event('POST /resumes/{id}/duplicate', 'a', { id: first.id }), svc))
        .statusCode,
    ).toBe(409);
  });

  it("one user's library does not count against another's", async () => {
    const { svc } = setup();
    for (let i = 0; i < MAX_RESUMES; i++) await create(svc, 'a', `R${i}`);
    expect(
      res(await route(event('POST /resumes', 'b', { body: { label: 'Mine', text: TEXT } }), svc))
        .statusCode,
    ).toBe(201);
  });
});

describe('get, update, delete', () => {
  it('returns the full resume with its text', async () => {
    const { svc } = setup();
    const { id } = await create(svc, 'a');
    expect(body(await route(event('GET /resumes/{id}', 'a', { id }), svc))).toMatchObject({
      id,
      text: TEXT,
    });
  });

  it('updates label and notes without touching the text', async () => {
    const { svc } = setup();
    const { id } = await create(svc, 'a');
    const r = await route(
      event('PUT /resumes/{id}', 'a', { id, body: { label: 'ML Engineer', notes: 'v2' } }),
      svc,
    );
    expect(body(r)).toMatchObject({ label: 'ML Engineer', notes: 'v2', text: TEXT });
  });

  it('editing the text updates the length and marks it reviewed', async () => {
    const { svc } = setup();
    const { id } = await create(svc, 'a');
    const newText = `${TEXT}\nAdded a new line of experience.`;
    const r = body(
      await route(event('PUT /resumes/{id}', 'a', { id, body: { text: newText } }), svc),
    );
    expect(r).toMatchObject({ text: newText, textLength: newText.length, reviewed: true });
  });

  it.each([
    ['empty body', {}],
    ['clearing the default flag', { isDefault: false }],
    ['setting status', { status: 'failed' }],
    ['setting the owner', { userId: 'b' }],
    ['text too long', { text: 'x'.repeat(60_001) }],
    ['blank label', { label: ' ' }],
  ])('rejects an update with %s', async (_name, payload) => {
    const { svc } = setup();
    const { id } = await create(svc, 'a');
    expect(
      res(await route(event('PUT /resumes/{id}', 'a', { id, body: payload }), svc)).statusCode,
    ).toBe(400);
  });

  it('deleting returns 204 and removes it', async () => {
    const { svc } = setup();
    const { id } = await create(svc, 'a');
    expect(res(await route(event('DELETE /resumes/{id}', 'a', { id }), svc)).statusCode).toBe(204);
    expect(res(await route(event('GET /resumes/{id}', 'a', { id }), svc)).statusCode).toBe(404);
  });

  it('returns 404 for a resume that does not exist', async () => {
    const { svc } = setup();
    const missing = '00000000-0000-4000-8000-0000000000ff';
    for (const [key, extra] of [
      ['GET /resumes/{id}', {}],
      ['PUT /resumes/{id}', { body: { label: 'X' } }],
      ['DELETE /resumes/{id}', {}],
      ['POST /resumes/{id}/duplicate', {}],
    ] as const) {
      expect(res(await route(event(key, 'a', { id: missing, ...extra }), svc)).statusCode).toBe(
        404,
      );
    }
  });

  it('treats a malformed id as not found', async () => {
    const { svc } = setup();
    for (const id of ['abc', '../PROFILE', 'RESUME#1', '00000000-0000-4000-8000-00000000000g']) {
      expect(res(await route(event('GET /resumes/{id}', 'a', { id }), svc)).statusCode).toBe(404);
    }
  });
});

describe('user isolation', () => {
  it("user B cannot read, change, duplicate or delete user A's resume", async () => {
    const { svc } = setup();
    const { id } = await create(svc, 'a', 'Private');

    expect(await listFor(svc, 'b')).toHaveLength(0);
    expect(res(await route(event('GET /resumes/{id}', 'b', { id }), svc)).statusCode).toBe(404);
    expect(
      res(await route(event('PUT /resumes/{id}', 'b', { id, body: { label: 'Hacked' } }), svc))
        .statusCode,
    ).toBe(404);
    expect(
      res(await route(event('PUT /resumes/{id}', 'b', { id, body: { isDefault: true } }), svc))
        .statusCode,
    ).toBe(404);
    expect(
      res(await route(event('POST /resumes/{id}/duplicate', 'b', { id }), svc)).statusCode,
    ).toBe(404);
    expect(res(await route(event('DELETE /resumes/{id}', 'b', { id }), svc)).statusCode).toBe(404);

    const still = body(await route(event('GET /resumes/{id}', 'a', { id }), svc));
    expect(still).toMatchObject({ label: 'Private', text: TEXT });
    expect(await listFor(svc, 'b')).toHaveLength(0);
  });

  it('a default change for one user does not touch another', async () => {
    const { svc } = setup();
    await create(svc, 'a', 'A1');
    const a2 = await create(svc, 'a', 'A2');
    await create(svc, 'b', 'B1');
    await route(event('PUT /resumes/{id}', 'a', { id: a2.id, body: { isDefault: true } }), svc);
    const b = await listFor(svc, 'b');
    expect(b).toHaveLength(1);
    expect(b[0].isDefault).toBe(true);
  });
});

describe('default resume', () => {
  const defaults = (list: { isDefault: boolean }[]) => list.filter((r) => r.isDefault).length;

  it('choosing a new default clears the old one, leaving exactly one', async () => {
    const { svc } = setup();
    const one = await create(svc, 'a', 'One');
    const two = await create(svc, 'a', 'Two');
    const r = body(
      await route(event('PUT /resumes/{id}', 'a', { id: two.id, body: { isDefault: true } }), svc),
    );
    expect(r.isDefault).toBe(true);
    const list = await listFor(svc, 'a');
    expect(defaults(list)).toBe(1);
    expect(list.find((x: { id: string }) => x.id === one.id).isDefault).toBe(false);
  });

  it('setting the existing default again is harmless', async () => {
    const { svc } = setup();
    const one = await create(svc, 'a', 'One');
    await create(svc, 'a', 'Two');
    await route(event('PUT /resumes/{id}', 'a', { id: one.id, body: { isDefault: true } }), svc);
    expect(defaults(await listFor(svc, 'a'))).toBe(1);
  });

  it('deleting the default promotes the most recently updated remaining resume', async () => {
    const { svc } = setup();
    const one = await create(svc, 'a', 'One');
    await create(svc, 'a', 'Two');
    const three = await create(svc, 'a', 'Three');
    await route(event('DELETE /resumes/{id}', 'a', { id: one.id }), svc);
    const list = await listFor(svc, 'a');
    expect(defaults(list)).toBe(1);
    expect(list.find((x: { id: string }) => x.id === three.id).isDefault).toBe(true);
  });

  it('deleting a non-default leaves the default alone', async () => {
    const { svc } = setup();
    const one = await create(svc, 'a', 'One');
    const two = await create(svc, 'a', 'Two');
    await route(event('DELETE /resumes/{id}', 'a', { id: two.id }), svc);
    const [only] = await listFor(svc, 'a');
    expect(only).toMatchObject({ id: one.id, isDefault: true });
  });

  it('deleting the last resume leaves an empty library, and the next one becomes the default', async () => {
    const { svc } = setup();
    const one = await create(svc, 'a', 'One');
    await route(event('DELETE /resumes/{id}', 'a', { id: one.id }), svc);
    expect(await listFor(svc, 'a')).toHaveLength(0);
    expect((await create(svc, 'a', 'Fresh')).isDefault).toBe(true);
  });
});

describe('duplicate', () => {
  it('copies the text and notes under a new id, labelled as a copy and not default', async () => {
    const { svc } = setup();
    const src = await create(svc, 'a', 'AI Engineer');
    const r = res(await route(event('POST /resumes/{id}/duplicate', 'a', { id: src.id }), svc));
    expect(r.statusCode).toBe(201);
    expect(body(r)).toMatchObject({ label: 'AI Engineer (copy)', text: TEXT, isDefault: false });
    expect(body(r).id).not.toBe(src.id);
    expect(await listFor(svc, 'a')).toHaveLength(2);
  });

  it('keeps a long label within the 80 character limit', async () => {
    const { svc } = setup();
    const src = await create(svc, 'a', 'x'.repeat(80));
    const copy = body(await route(event('POST /resumes/{id}/duplicate', 'a', { id: src.id }), svc));
    expect(copy.label.length).toBeLessThanOrEqual(80);
    expect(copy.label.endsWith('(copy)')).toBe(true);
  });
});

describe('privacy', () => {
  it('never logs resume text', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => undefined),
    );
    const { svc } = setup();
    const { id } = await create(svc, 'a');
    await route(event('PUT /resumes/{id}', 'a', { id, body: { text: 'too short' } }), svc);
    await route(event('GET /resumes/{id}', 'b', { id }), svc);
    expect(JSON.stringify(spies.flatMap((s) => s.mock.calls))).not.toContain('Example Corp');
  });

  it('rejects unsupported routes', async () => {
    const { svc } = setup();
    expect(res(await route(event('PATCH /resumes', 'a'), svc)).statusCode).toBe(405);
  });
});
