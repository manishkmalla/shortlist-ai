import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { MAX_RESUMES, MAX_UPLOAD_BYTES } from '@shortlist-ai/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiEvent } from '../lib/http';
import { createFakeObjectStore } from '../lib/fakeObjectStore';
import { createFakeDb } from '../repo/fakeDb';
import { createResumeRepo, type ResumeRepo, type StoredResume } from '../repo/resumeRepo';
import { createResumeService } from '../services/resumeService';
import { route } from './resumes';

const TEXT = 'Alex Example\nSoftware Engineer\nBuilt things at Example Corp from 2020 to 2024.';

function setup() {
  const { db, items } = createFakeDb();
  let n = 0;
  let clock = Date.parse('2026-01-01T00:00:00.000Z');
  const repo = createResumeRepo(db, 't');
  const storage = createFakeObjectStore();
  const svc = createResumeService({
    repo,
    store: storage.store,
    newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
    now: () => new Date((clock += 1000)),
  });
  return {
    svc,
    items,
    repo,
    storage,
    /** Jump the clock forward, for rules that depend on how long ago something happened. */
    advance: (ms: number) => {
      clock += ms;
    },
  };
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

/** Uploads arrive in a later ticket, so tests seed the Resumes an upload would leave behind. */
const seedUpload = async (
  repo: ResumeRepo,
  userId: string,
  n: number,
  overrides: Partial<StoredResume> = {},
) => {
  const resume: StoredResume = {
    id: `00000000-0000-4000-8000-${String(900 + n).padStart(12, '0')}`,
    label: `Upload ${n}`,
    notes: '',
    text: '',
    status: 'processing',
    source: 'upload',
    isDefault: false,
    reviewedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    original: { filename: 'alex-example-cv.pdf', size: 123_456, contentType: 'application/pdf' },
    ...overrides,
  };
  await repo.create(userId, resume);
  return resume;
};

describe('uploads: what a Resume says about its Original and failures', () => {
  it('a pasted resume has no Original and no failure, in the list and when fetched', async () => {
    const { svc } = setup();
    const { id } = await create(svc, 'a');
    const [listed] = await listFor(svc, 'a');
    const fetched = body(await route(event('GET /resumes/{id}', 'a', { id }), svc));
    for (const r of [listed, fetched]) {
      expect(r).toMatchObject({ hasOriginal: false, failureReason: null });
    }
  });

  it('an uploaded resume says it has an Original, and a failed one says why', async () => {
    const { svc, repo } = setup();
    const processing = await seedUpload(repo, 'a', 1);
    const failed = await seedUpload(repo, 'a', 2, {
      status: 'failed',
      failure: {
        code: 'no_readable_text',
        message: 'No text was found. Paste your resume text instead.',
      },
    });
    const list = await listFor(svc, 'a');
    const byId = (id: string) => list.find((r: { id: string }) => r.id === id);
    expect(byId(processing.id)).toMatchObject({
      hasOriginal: true,
      failureReason: null,
      status: 'processing',
    });
    expect(byId(failed.id)).toMatchObject({
      hasOriginal: true,
      status: 'failed',
      failureReason: {
        code: 'no_readable_text',
        message: 'No text was found. Paste your resume text instead.',
      },
    });
  });

  it('never reveals the Original file name or where it is stored', async () => {
    const { svc, repo } = setup();
    const { id } = await seedUpload(repo, 'a', 1, { status: 'ready', text: TEXT });
    const everything = JSON.stringify([
      await route(event('GET /resumes', 'a'), svc),
      await route(event('GET /resumes/{id}', 'a', { id }), svc),
    ]);
    expect(everything).not.toContain('alex-example-cv');
    expect(everything).not.toContain('uploads/');
    expect(everything).not.toContain('contentType');
  });

  it.each(['processing', 'failed'] as const)(
    'refuses to mark a %s resume as reviewed',
    async (status) => {
      const { svc, repo } = setup();
      const { id } = await seedUpload(repo, 'a', 1, { status });
      const r = res(
        await route(event('PUT /resumes/{id}', 'a', { id, body: { reviewed: true } }), svc),
      );
      expect(r.statusCode).toBe(409);
      expect(body(r).error).toMatchObject({ code: 'not_ready' });
      expect(body(r).error.message).toMatch(/not ready.*reviewed/i);
      expect(body(await route(event('GET /resumes/{id}', 'a', { id }), svc)).reviewed).toBe(false);
    },
  );

  it('lets a ready upload be marked reviewed', async () => {
    const { svc, repo } = setup();
    const { id } = await seedUpload(repo, 'a', 1, { status: 'ready', text: TEXT });
    const before = body(await route(event('GET /resumes/{id}', 'a', { id }), svc));
    expect(before.reviewed).toBe(false);
    const r = res(
      await route(event('PUT /resumes/{id}', 'a', { id, body: { reviewed: true } }), svc),
    );
    expect(r.statusCode).toBe(200);
    expect(body(r).reviewed).toBe(true);
  });

  it('a refused review does not change anything else sent with it', async () => {
    const { svc, repo } = setup();
    const { id } = await seedUpload(repo, 'a', 1, { status: 'processing' });
    await route(
      event('PUT /resumes/{id}', 'a', { id, body: { reviewed: true, label: 'Sneaky' } }),
      svc,
    );
    expect(body(await route(event('GET /resumes/{id}', 'a', { id }), svc)).label).toBe('Upload 1');
  });

  it('a copy of an uploaded resume keeps the text but not the Original', async () => {
    const { svc, repo } = setup();
    // A library always has a default, so the source is it: the copy then has no reason to take over.
    const source = await seedUpload(repo, 'a', 1, {
      status: 'ready',
      isDefault: true,
      text: TEXT,
      reviewedAt: '2026-01-01T00:00:00.000Z',
    });
    const r = res(await route(event('POST /resumes/{id}/duplicate', 'a', { id: source.id }), svc));
    expect(r.statusCode).toBe(201);
    expect(body(r)).toMatchObject({
      text: TEXT,
      hasOriginal: false,
      failureReason: null,
      status: 'ready',
      reviewed: true,
      isDefault: false,
    });
    const original = body(await route(event('GET /resumes/{id}', 'a', { id: source.id }), svc));
    expect(original.hasOriginal).toBe(true);
  });

  it.each(['processing', 'failed'] as const)('refuses to duplicate a %s resume', async (status) => {
    const { svc, repo } = setup();
    const source = await seedUpload(repo, 'a', 1, { status });
    const r = res(await route(event('POST /resumes/{id}/duplicate', 'a', { id: source.id }), svc));
    expect(r.statusCode).toBe(409);
    expect(body(r).error.code).toBe('not_ready');
    expect(await listFor(svc, 'a')).toHaveLength(1);
  });

  it.each(['processing'] as const)(
    'refuses to change the text of a %s resume, because that would mark it reviewed',
    async (status) => {
      const { svc, repo } = setup();
      const { id } = await seedUpload(repo, 'a', 1, { status });
      const r = res(
        await route(event('PUT /resumes/{id}', 'a', { id, body: { text: TEXT } }), svc),
      );
      expect(r.statusCode).toBe(409);
      expect(body(r).error.code).toBe('not_ready');
      const after = body(await route(event('GET /resumes/{id}', 'a', { id }), svc));
      expect(after).toMatchObject({ text: '', reviewed: false, status });
    },
  );

  it.each(['processing', 'failed'] as const)(
    'still lets a %s resume be renamed',
    async (status) => {
      const { svc, repo } = setup();
      const { id } = await seedUpload(repo, 'a', 1, { status });
      const r = res(
        await route(
          event('PUT /resumes/{id}', 'a', { id, body: { label: 'Renamed', notes: 'n' } }),
          svc,
        ),
      );
      expect(r.statusCode).toBe(200);
      expect(body(r)).toMatchObject({ label: 'Renamed', notes: 'n', status, reviewed: false });
    },
  );

  it("user B cannot review, edit or duplicate user A's resume that is not ready (it simply does not exist for B)", async () => {
    const { svc, repo } = setup();
    const { id } = await seedUpload(repo, 'a', 1, { status: 'processing' });
    for (const [key, payload] of [
      ['PUT /resumes/{id}', { reviewed: true }],
      ['PUT /resumes/{id}', { text: TEXT }],
      ['POST /resumes/{id}/duplicate', undefined],
    ] as const) {
      const r = res(await route(event(key, 'b', { id, body: payload }), svc));
      expect(r.statusCode).toBe(404);
    }
  });
});

describe('requesting an upload', () => {
  const ask = (svc: Svc, sub: string, payload: unknown) =>
    route(event('POST /resumes/upload-url', sub, { body: payload }), svc);
  const first = '00000000-0000-4000-8000-000000000001';

  it('creates a processing Resume and a short-lived upload signed for the exact size and type', async () => {
    const { svc, storage } = setup();
    const r = res(
      await ask(svc, 'a', {
        filename: 'Alex Example CV.txt',
        size: 2048,
        contentType: 'text/plain',
      }),
    );
    expect(r.statusCode).toBe(201);
    expect(body(r).resume).toMatchObject({
      id: first,
      label: 'Alex Example CV',
      status: 'processing',
      source: 'upload',
      hasOriginal: true,
      reviewed: false,
      isDefault: true,
      textLength: 0,
      failureReason: null,
    });
    expect(body(r).upload).toMatchObject({
      method: 'PUT',
      headers: { 'Content-Type': 'text/plain' },
      expiresInSeconds: 300,
    });
    expect(body(r).upload.url).toMatch(/^https:\/\//);
    expect(storage.uploads).toEqual([
      {
        key: `uploads/a/${first}/Alex-Example-CV.txt`,
        contentType: 'text/plain',
        size: 2048,
        expiresInSeconds: 300,
      },
    ]);
  });

  it('the new Resume shows up in the library as processing', async () => {
    const { svc } = setup();
    await ask(svc, 'a', { filename: 'cv.txt', size: 100 });
    expect(await listFor(svc, 'a')).toMatchObject([
      { label: 'cv', status: 'processing', hasOriginal: true },
    ]);
  });

  it('uses the label the user gave, trimmed, and only the first resume becomes the default', async () => {
    const { svc } = setup();
    await ask(svc, 'a', { filename: 'one.txt', size: 100 });
    const second = body(
      await ask(svc, 'a', { filename: 'two.txt', size: 100, label: '  ML Engineer ' }),
    ).resume;
    expect(second).toMatchObject({ label: 'ML Engineer', isDefault: false });
  });

  it('accepts a missing or empty content type, and an upload of exactly the size limit', async () => {
    const { svc } = setup();
    expect(
      res(await ask(svc, 'a', { filename: 'a.txt', size: 10, contentType: '' })).statusCode,
    ).toBe(201);
    expect(res(await ask(svc, 'a', { filename: 'b.txt', size: MAX_UPLOAD_BYTES })).statusCode).toBe(
      201,
    );
  });

  it.each([
    ['a PDF (not readable yet)', { filename: 'cv.pdf', size: 100 }, 'unsupported_type'],
    ['a Word document (not readable yet)', { filename: 'cv.docx', size: 100 }, 'unsupported_type'],
    ['an executable', { filename: 'cv.exe', size: 100 }, 'unsupported_type'],
    ['a name with no extension', { filename: 'cv', size: 100 }, 'unsupported_type'],
    ['a disguised extension', { filename: 'cv.txt.exe', size: 100 }, 'unsupported_type'],
    [
      'one byte over the size limit',
      { filename: 'cv.txt', size: MAX_UPLOAD_BYTES + 1 },
      'file_too_large',
    ],
    [
      'a content type that does not match the extension',
      { filename: 'cv.txt', size: 100, contentType: 'application/pdf' },
      'type_mismatch',
    ],
    [
      'an HTML content type',
      { filename: 'cv.txt', size: 100, contentType: 'text/html' },
      'type_mismatch',
    ],
  ])('refuses %s with a clear 400 and signs nothing', async (_name, payload, code) => {
    const { svc, storage } = setup();
    const r = res(await ask(svc, 'a', payload));
    expect(r.statusCode).toBe(400);
    expect(body(r).error.code).toBe(code);
    expect(body(r).error.message.length).toBeGreaterThan(10);
    expect(storage.uploads).toHaveLength(0);
    expect(await listFor(svc, 'a')).toHaveLength(0);
  });

  it.each([
    ['no filename', { size: 100 }],
    ['an empty filename', { filename: '', size: 100 }],
    ['a zero size', { filename: 'cv.txt', size: 0 }],
    ['a negative size', { filename: 'cv.txt', size: -5 }],
    ['a fractional size', { filename: 'cv.txt', size: 10.5 }],
    ['a size that is not a number', { filename: 'cv.txt', size: '100' }],
    ['an unknown field (userId)', { filename: 'cv.txt', size: 100, userId: 'b' }],
    ['a blank label', { filename: 'cv.txt', size: 100, label: '   ' }],
    ['an over-long label', { filename: 'cv.txt', size: 100, label: 'x'.repeat(81) }],
  ])('refuses a request with %s', async (_name, payload) => {
    const { svc, storage } = setup();
    expect(res(await ask(svc, 'a', payload)).statusCode).toBe(400);
    expect(storage.uploads).toHaveLength(0);
  });

  it('counts processing and failed resumes towards the ten resume limit', async () => {
    const { svc, repo, storage } = setup();
    for (let i = 0; i < MAX_RESUMES; i++) {
      await seedUpload(repo, 'a', i + 1, { status: i % 2 === 0 ? 'processing' : 'failed' });
    }
    const r = res(await ask(svc, 'a', { filename: 'cv.txt', size: 100 }));
    expect(r.statusCode).toBe(409);
    expect(body(r).error.code).toBe('limit_reached');
    expect(storage.uploads).toHaveLength(0);
  });

  it('never trusts the file name: the key and stored name are sanitised, the label keeps the readable name', async () => {
    const { svc, storage } = setup();
    const r = await ask(svc, 'a', { filename: '../../évil name.txt', size: 100 });
    expect(body(r).resume.label).toBe('évil name');
    expect(storage.uploads[0]!.key).toBe(`uploads/a/${first}/vil-name.txt`);
  });

  it('derives a label of at most 80 characters from a very long name', async () => {
    const { svc } = setup();
    const r = await ask(svc, 'a', { filename: `${'long '.repeat(40)}.txt`, size: 100 });
    expect(body(r).resume.label.length).toBeLessThanOrEqual(80);
    expect(body(r).resume.label.length).toBeGreaterThan(0);
  });

  it('uploads are filed under the caller, and each user sees only their own', async () => {
    const { svc, storage } = setup();
    await ask(svc, 'a', { filename: 'cv.txt', size: 100 });
    await ask(svc, 'b', { filename: 'cv.txt', size: 100 });
    expect(storage.uploads.map((u) => u.key.split('/')[1])).toEqual(['a', 'b']);
    expect(await listFor(svc, 'a')).toHaveLength(1);
    expect(await listFor(svc, 'b')).toHaveLength(1);
  });

  it('does not let a client choose the owner', async () => {
    const { svc, storage } = setup();
    await ask(svc, 'a', { filename: 'cv.txt', size: 100, userId: 'b' });
    expect(storage.uploads).toHaveLength(0);
  });

  it('never logs file names', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => undefined),
    );
    const { svc } = setup();
    await ask(svc, 'a', { filename: 'alex-secret-cv.txt', size: 100 });
    await ask(svc, 'a', { filename: 'alex-secret-cv.exe', size: 100 });
    expect(JSON.stringify(spies.flatMap((s) => s.mock.calls))).not.toContain('alex-secret');
  });
});

describe('reviewing an uploaded resume', () => {
  const ready = (repo: ResumeRepo, n = 1) =>
    seedUpload(repo, 'a', n, { status: 'ready', text: TEXT });

  it('starts out needing review', async () => {
    const { svc, repo } = setup();
    const { id } = await ready(repo);
    expect(body(await route(event('GET /resumes/{id}', 'a', { id }), svc))).toMatchObject({
      status: 'ready',
      reviewed: false,
    });
  });

  it('confirming marks it reviewed and changes nothing else', async () => {
    const { svc, repo } = setup();
    const { id } = await ready(repo);
    const r = body(
      await route(event('PUT /resumes/{id}', 'a', { id, body: { reviewed: true } }), svc),
    );
    expect(r).toMatchObject({
      reviewed: true,
      text: TEXT,
      label: 'Upload 1',
      status: 'ready',
      hasOriginal: true,
    });
  });

  it('confirming twice is harmless', async () => {
    const { svc, repo } = setup();
    const { id } = await ready(repo);
    await route(event('PUT /resumes/{id}', 'a', { id, body: { reviewed: true } }), svc);
    const again = res(
      await route(event('PUT /resumes/{id}', 'a', { id, body: { reviewed: true } }), svc),
    );
    expect(again.statusCode).toBe(200);
    expect(body(again).reviewed).toBe(true);
  });

  it('editing and saving the text also marks it reviewed', async () => {
    const { svc, repo } = setup();
    const { id } = await ready(repo);
    const fixed = `${TEXT}\nFixed a line the parser got wrong.`;
    const r = body(
      await route(event('PUT /resumes/{id}', 'a', { id, body: { text: fixed } }), svc),
    );
    expect(r).toMatchObject({ reviewed: true, text: fixed });
  });

  it('renaming alone does not count as reviewing', async () => {
    const { svc, repo } = setup();
    const { id } = await ready(repo);
    const r = body(
      await route(event('PUT /resumes/{id}', 'a', { id, body: { label: 'ML Engineer' } }), svc),
    );
    expect(r).toMatchObject({ label: 'ML Engineer', reviewed: false });
  });

  it('only the owner can confirm it', async () => {
    const { svc, repo } = setup();
    const { id } = await ready(repo);
    expect(
      res(await route(event('PUT /resumes/{id}', 'b', { id, body: { reviewed: true } }), svc))
        .statusCode,
    ).toBe(404);
    expect(body(await route(event('GET /resumes/{id}', 'a', { id }), svc)).reviewed).toBe(false);
  });

  it('a pasted resume is reviewed from the start', async () => {
    const { svc } = setup();
    const { id } = await create(svc, 'a');
    expect(body(await route(event('GET /resumes/{id}', 'a', { id }), svc)).reviewed).toBe(true);
  });
});

describe('deleting a resume removes its Original', () => {
  const upload = async (
    svc: Svc,
    storage: ReturnType<typeof setup>['storage'],
    sub: string,
    name = 'cv.txt',
  ) => {
    const started = body(
      await route(
        event('POST /resumes/upload-url', sub, { body: { filename: name, size: 20 } }),
        svc,
      ),
    );
    const { key } = storage.uploads[storage.uploads.length - 1]!;
    await storage.store.put(key, new TextEncoder().encode('resume text here'), 'text/plain');
    return { id: started.resume.id as string, key };
  };
  const remove = (svc: Svc, sub: string, id: string) =>
    route(event('DELETE /resumes/{id}', sub, { id }), svc);

  it('deletes the file together with the resume', async () => {
    const { svc, storage } = setup();
    const { id, key } = await upload(svc, storage, 'a');
    expect(res(await remove(svc, 'a', id)).statusCode).toBe(204);
    expect(await storage.store.head(key)).toBeNull();
    expect(res(await route(event('GET /resumes/{id}', 'a', { id }), svc)).statusCode).toBe(404);
  });

  it("leaves the user's other files, and other users' files, alone", async () => {
    const { svc, storage } = setup();
    const one = await upload(svc, storage, 'a', 'one.txt');
    const two = await upload(svc, storage, 'a', 'two.txt');
    const theirs = await upload(svc, storage, 'b', 'one.txt');
    await remove(svc, 'a', one.id);
    expect(await storage.store.head(one.key)).toBeNull();
    expect(await storage.store.head(two.key)).not.toBeNull();
    expect(await storage.store.head(theirs.key)).not.toBeNull();
  });

  it('works when the file was never uploaded', async () => {
    const { svc, storage } = setup();
    const started = body(
      await route(
        event('POST /resumes/upload-url', 'a', { body: { filename: 'cv.txt', size: 20 } }),
        svc,
      ),
    );
    expect(storage.objects.size).toBe(0);
    expect(res(await remove(svc, 'a', started.resume.id)).statusCode).toBe(204);
  });

  it('a pasted resume has no file, and deleting it does not touch storage', async () => {
    const { svc, storage } = setup();
    const { id } = await create(svc, 'a');
    const spy = vi.spyOn(storage.store, 'delete');
    expect(res(await remove(svc, 'a', id)).statusCode).toBe(204);
    expect(spy).not.toHaveBeenCalled();
  });

  it('another user cannot delete it, and the file stays', async () => {
    const { svc, storage } = setup();
    const { id, key } = await upload(svc, storage, 'a');
    expect(res(await remove(svc, 'b', id)).statusCode).toBe(404);
    expect(await storage.store.head(key)).not.toBeNull();
    expect(res(await route(event('GET /resumes/{id}', 'a', { id }), svc)).statusCode).toBe(200);
  });

  it('if the file cannot be removed, the resume stays and a retry finishes the job', async () => {
    const { svc, storage } = setup();
    const { id, key } = await upload(svc, storage, 'a');
    vi.spyOn(storage.store, 'delete').mockRejectedValueOnce(new Error('storage down'));
    await expect(remove(svc, 'a', id)).rejects.toThrow('storage down');
    expect(res(await route(event('GET /resumes/{id}', 'a', { id }), svc)).statusCode).toBe(200);
    expect(await storage.store.head(key)).not.toBeNull();

    expect(res(await remove(svc, 'a', id)).statusCode).toBe(204);
    expect(await storage.store.head(key)).toBeNull();
  });

  it('deleting the default upload still promotes another resume', async () => {
    const { svc, storage } = setup();
    const first = await upload(svc, storage, 'a', 'one.txt');
    const second = await create(svc, 'a', 'Second');
    await remove(svc, 'a', first.id);
    expect((await listFor(svc, 'a'))[0]).toMatchObject({ id: second.id, isDefault: true });
  });
});

describe('fixing a failed upload by pasting text', () => {
  const failed = (repo: ResumeRepo, n = 1, over: Partial<StoredResume> = {}) =>
    seedUpload(repo, 'a', n, {
      status: 'failed',
      failure: { code: 'no_readable_text', message: 'No readable text was found in this file.' },
      ...over,
    });
  const fix = (svc: Svc, id: string, payload: unknown, sub = 'a') =>
    route(event('PUT /resumes/{id}', sub, { id, body: payload }), svc);

  it('turns it into a normal, reviewed resume and keeps the Original', async () => {
    const { svc, repo, storage } = setup();
    const { id } = await failed(repo);
    await storage.store.put(`uploads/a/${id}/alex-example-cv.pdf`, new Uint8Array([1, 2, 3]));
    const r = res(await fix(svc, id, { text: TEXT }));
    expect(r.statusCode).toBe(200);
    expect(body(r)).toMatchObject({
      status: 'ready',
      text: TEXT,
      reviewed: true,
      failureReason: null,
      hasOriginal: true,
      wordCount: 13,
    });
    expect(await storage.store.head(`uploads/a/${id}/alex-example-cv.pdf`)).not.toBeNull();
    expect(body(await route(event('GET /resumes/{id}', 'a', { id }), svc))).toMatchObject({
      status: 'ready',
      failureReason: null,
    });
  });

  it('can rename and fix in one go', async () => {
    const { svc, repo } = setup();
    const { id } = await failed(repo);
    const r = body(await fix(svc, id, { label: 'AI Engineer', text: TEXT }));
    expect(r).toMatchObject({ label: 'AI Engineer', status: 'ready' });
  });

  it.each([
    ['too short', 'hi'],
    ['too long', 'x'.repeat(60_001)],
  ])('refuses text that is %s and leaves it failed', async (_name, text) => {
    const { svc, repo } = setup();
    const { id } = await failed(repo);
    expect(res(await fix(svc, id, { text })).statusCode).toBe(400);
    expect(body(await route(event('GET /resumes/{id}', 'a', { id }), svc))).toMatchObject({
      status: 'failed',
      text: '',
    });
  });

  it('confirming alone does not fix it: text is required', async () => {
    const { svc, repo } = setup();
    const { id } = await failed(repo);
    const r = res(await fix(svc, id, { reviewed: true }));
    expect(r.statusCode).toBe(409);
    expect(body(r).error.code).toBe('not_ready');
  });

  it('a fixed resume works like any other: it can be copied', async () => {
    const { svc, repo } = setup();
    const { id } = await failed(repo);
    await fix(svc, id, { text: TEXT });
    expect(
      res(await route(event('POST /resumes/{id}/duplicate', 'a', { id }), svc)).statusCode,
    ).toBe(201);
  });

  it('another user cannot fix it, and it stays failed', async () => {
    const { svc, repo } = setup();
    const { id } = await failed(repo);
    expect(res(await fix(svc, id, { text: TEXT }, 'b')).statusCode).toBe(404);
    expect(body(await route(event('GET /resumes/{id}', 'a', { id }), svc)).status).toBe('failed');
  });

  it('a resume that is ready is edited as before (no change to normal editing)', async () => {
    const { svc } = setup();
    const { id } = await create(svc, 'a');
    const edited = `${TEXT}\nMore detail.`;
    expect(body(await fix(svc, id, { text: edited }))).toMatchObject({
      text: edited,
      status: 'ready',
    });
  });
});

describe('an upload that never finished', () => {
  const MINUTE = 60_000;
  const stuck = (repo: ResumeRepo) => seedUpload(repo, 'a', 1, { status: 'processing' });
  const get = async (svc: Svc, id: string) =>
    body(await route(event('GET /resumes/{id}', 'a', { id }), svc));

  it('is still processing after fourteen minutes', async () => {
    const { svc, repo, advance } = setup();
    const { id } = await stuck(repo);
    advance(14 * MINUTE);
    expect(await get(svc, id)).toMatchObject({ status: 'processing', failureReason: null });
  });

  it('shows as failed after sixteen minutes, in the list and when fetched', async () => {
    const { svc, repo, advance } = setup();
    const { id } = await stuck(repo);
    advance(16 * MINUTE);
    const fetched = await get(svc, id);
    const [listed] = await listFor(svc, 'a');
    for (const r of [fetched, listed]) {
      expect(r.status).toBe('failed');
      expect(r.failureReason.code).toBe('upload_incomplete');
      expect(r.failureReason.message).toMatch(/did not finish/i);
    }
  });

  it('can then be fixed by pasting text', async () => {
    const { svc, repo, advance } = setup();
    const { id } = await stuck(repo);
    advance(16 * MINUTE);
    const r = res(await route(event('PUT /resumes/{id}', 'a', { id, body: { text: TEXT } }), svc));
    expect(r.statusCode).toBe(200);
    expect(body(r)).toMatchObject({ status: 'ready', reviewed: true, failureReason: null });
    advance(60 * MINUTE);
    expect((await get(svc, id)).status).toBe('ready');
  });

  it('can be deleted, and still counts towards the limit until then', async () => {
    const { svc, repo, advance } = setup();
    for (let i = 1; i < MAX_RESUMES; i++) await create(svc, 'a', `R${i}`);
    const { id } = await stuck(repo);
    advance(16 * MINUTE);
    expect(
      res(
        await route(
          event('POST /resumes', 'a', { body: { label: 'One too many', text: TEXT } }),
          svc,
        ),
      ).statusCode,
    ).toBe(409);
    expect(res(await route(event('DELETE /resumes/{id}', 'a', { id }), svc)).statusCode).toBe(204);
    expect(
      res(
        await route(
          event('POST /resumes', 'a', { body: { label: 'Now there is room', text: TEXT } }),
          svc,
        ),
      ).statusCode,
    ).toBe(201);
  });

  it('cannot be confirmed as reviewed or copied, like any other failed upload', async () => {
    const { svc, repo, advance } = setup();
    const { id } = await stuck(repo);
    advance(16 * MINUTE);
    expect(
      res(await route(event('PUT /resumes/{id}', 'a', { id, body: { reviewed: true } }), svc))
        .statusCode,
    ).toBe(409);
    expect(
      res(await route(event('POST /resumes/{id}/duplicate', 'a', { id }), svc)).statusCode,
    ).toBe(409);
  });

  it('never affects resumes that are not processing, however old they are', async () => {
    const { svc, repo, advance } = setup();
    const pasted = await create(svc, 'a', 'Pasted');
    const ready = await seedUpload(repo, 'a', 2, { status: 'ready', text: TEXT });
    advance(365 * 24 * 60 * MINUTE);
    expect((await get(svc, pasted.id)).status).toBe('ready');
    expect((await get(svc, ready.id)).status).toBe('ready');
  });

  it('is only visible to its owner', async () => {
    const { svc, repo, advance } = setup();
    const { id } = await stuck(repo);
    advance(16 * MINUTE);
    expect(
      res(await route(event('PUT /resumes/{id}', 'b', { id, body: { text: TEXT } }), svc))
        .statusCode,
    ).toBe(404);
    expect(await listFor(svc, 'b')).toEqual([]);
  });
});

describe('the default resume when it is not ready', () => {
  const MINUTE = 60_000;
  const defaults = async (svc: Svc) =>
    (await listFor(svc, 'a')).filter((r: { isDefault: boolean }) => r.isDefault);
  const failedDefault = (repo: ResumeRepo) =>
    seedUpload(repo, 'a', 1, {
      status: 'failed',
      isDefault: true,
      failure: { code: 'wrong_type', message: 'This file does not look like a text file.' },
    });

  it('a pasted resume takes over from a failed default, leaving exactly one default', async () => {
    const { svc, repo } = setup();
    const old = await failedDefault(repo);
    const added = await create(svc, 'a', 'Pasted');
    expect(added.isDefault).toBe(true);
    const now = await defaults(svc);
    expect(now).toHaveLength(1);
    expect(now[0].id).toBe(added.id);
    expect(body(await route(event('GET /resumes/{id}', 'a', { id: old.id }), svc)).isDefault).toBe(
      false,
    );
  });

  it('a pasted resume takes over from a default that is still being read, or never finished', async () => {
    const { svc, repo, advance } = setup();
    await seedUpload(repo, 'a', 1, { status: 'processing', isDefault: true });
    advance(20 * MINUTE);
    const added = await create(svc, 'a', 'Pasted');
    expect(added.isDefault).toBe(true);
    expect(await defaults(svc)).toHaveLength(1);
  });

  it('a default that is ready is never taken over', async () => {
    const { svc } = setup();
    const first = await create(svc, 'a', 'First');
    const second = await create(svc, 'a', 'Second');
    expect(second.isDefault).toBe(false);
    expect((await defaults(svc))[0].id).toBe(first.id);
  });

  it('fixing another failed upload makes it the default when the default is failed', async () => {
    const { svc, repo } = setup();
    await failedDefault(repo);
    const other = await seedUpload(repo, 'a', 2, {
      status: 'failed',
      failure: { code: 'corrupt', message: 'The file could not be read.' },
    });
    const r = body(
      await route(event('PUT /resumes/{id}', 'a', { id: other.id, body: { text: TEXT } }), svc),
    );
    expect(r).toMatchObject({ status: 'ready', isDefault: true });
    const now = await defaults(svc);
    expect(now).toHaveLength(1);
    expect(now[0].id).toBe(other.id);
  });

  it('fixing the default itself keeps it the default', async () => {
    const { svc, repo } = setup();
    const old = await failedDefault(repo);
    const r = body(
      await route(event('PUT /resumes/{id}', 'a', { id: old.id, body: { text: TEXT } }), svc),
    );
    expect(r).toMatchObject({ status: 'ready', isDefault: true });
    expect(await defaults(svc)).toHaveLength(1);
  });

  it('fixing a failed upload does not disturb a default that is ready', async () => {
    const { svc, repo } = setup();
    const ready = await create(svc, 'a', 'Ready');
    const failed = await seedUpload(repo, 'a', 2, {
      status: 'failed',
      failure: { code: 'corrupt', message: 'The file could not be read.' },
    });
    const r = body(
      await route(event('PUT /resumes/{id}', 'a', { id: failed.id, body: { text: TEXT } }), svc),
    );
    expect(r.isDefault).toBe(false);
    expect((await defaults(svc))[0].id).toBe(ready.id);
  });

  it('starting an upload does not change the default: only a ready resume can take over', async () => {
    const { svc, repo } = setup();
    const old = await failedDefault(repo);
    const started = body(
      await route(
        event('POST /resumes/upload-url', 'a', { body: { filename: 'new.txt', size: 50 } }),
        svc,
      ),
    );
    expect(started.resume.isDefault).toBe(false);
    expect((await defaults(svc))[0].id).toBe(old.id);
  });

  it("another user's default is never touched", async () => {
    const { svc, repo } = setup();
    await failedDefault(repo);
    const theirs = await create(svc, 'b', 'Theirs');
    await create(svc, 'a', 'Mine');
    const b = await listFor(svc, 'b');
    expect(b).toHaveLength(1);
    expect(b[0]).toMatchObject({ id: theirs.id, isDefault: true });
  });
});

describe('consistency of what the user sees', () => {
  const MINUTE = 60_000;

  it('renaming an upload that never finished still reports it as failed', async () => {
    const { svc, repo, advance } = setup();
    const { id } = await seedUpload(repo, 'a', 1, { status: 'processing' });
    advance(16 * MINUTE);
    const r = body(
      await route(event('PUT /resumes/{id}', 'a', { id, body: { label: 'Renamed' } }), svc),
    );
    expect(r).toMatchObject({ label: 'Renamed', status: 'failed' });
    expect(r.failureReason.code).toBe('upload_incomplete');
  });

  it('deleting the default prefers a resume that is ready over a newer one that is not', async () => {
    const { svc, repo } = setup();
    const doomed = await create(svc, 'a', 'Default');
    const ready = await create(svc, 'a', 'Ready but older');
    await seedUpload(repo, 'a', 3, {
      status: 'failed',
      updatedAt: '2030-01-01T00:00:00.000Z',
      failure: { code: 'corrupt', message: 'The file could not be read.' },
    });
    await route(event('DELETE /resumes/{id}', 'a', { id: doomed.id }), svc);
    const defaults = (await listFor(svc, 'a')).filter((r: { isDefault: boolean }) => r.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0].id).toBe(ready.id);
  });

  it('deleting the default when nothing else is ready still leaves one default', async () => {
    const { svc, repo } = setup();
    const doomed = await create(svc, 'a', 'Default');
    const failed = await seedUpload(repo, 'a', 2, {
      status: 'failed',
      failure: { code: 'corrupt', message: 'The file could not be read.' },
    });
    await route(event('DELETE /resumes/{id}', 'a', { id: doomed.id }), svc);
    const defaults = (await listFor(svc, 'a')).filter((r: { isDefault: boolean }) => r.isDefault);
    expect(defaults.map((r: { id: string }) => r.id)).toEqual([failed.id]);
  });

  it('a fix that loses a race with the file being read is refused, with its own error, and changes nothing', async () => {
    const { svc, repo } = setup();
    // Stored as ready (the file was just read), but the page the user fixed from still saw it as failed.
    const { id } = await seedUpload(repo, 'a', 1, { status: 'ready', text: TEXT });
    const staleView = (await repo.get('a', id))!;
    vi.spyOn(repo, 'get').mockResolvedValueOnce({
      ...staleView,
      status: 'failed',
      text: '',
      failure: { code: 'corrupt', message: 'The file could not be read.' },
    });
    const r = res(
      await route(
        event('PUT /resumes/{id}', 'a', {
          id,
          body: { text: 'Pasted text that is long enough to count.' },
        }),
        svc,
      ),
    );
    expect(r.statusCode).toBe(409);
    expect(body(r).error.code).toBe('conflict');
    expect(body(r).error.message).toMatch(/changed while you were saving/i);
    expect(body(await route(event('GET /resumes/{id}', 'a', { id }), svc))).toMatchObject({
      status: 'ready',
      text: TEXT,
    });
  });
});
