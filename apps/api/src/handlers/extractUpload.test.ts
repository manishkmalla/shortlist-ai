import type { S3Event } from 'aws-lambda';
import { MAX_RESUME_TEXT_CHARS, MAX_UPLOAD_BYTES } from '@shortlist-ai/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeObjectStore } from '../lib/fakeObjectStore';
import { originalKey } from '../lib/objectKeys';
import { createFakeDb } from '../repo/fakeDb';
import { createResumeRepo, type StoredResume } from '../repo/resumeRepo';
import { createExtractionService } from '../services/extractionService';
import { processUploadEvent } from './extractUpload';

const RESUME_ID = '00000000-0000-4000-8000-000000000001';
const OTHER_ID = '00000000-0000-4000-8000-000000000002';
const bytes = (s: string) => new TextEncoder().encode(s);

const CV = [
  'ALEX EXAMPLE',
  'alex@example.com | Perth WA',
  '',
  'PROFESSIONAL SUMMARY',
  'Software engineer with eight years of experience building web applications at Example Corp.',
].join('\n');

function setup() {
  const { db } = createFakeDb();
  const repo = createResumeRepo(db, 't');
  const storage = createFakeObjectStore();
  const service = createExtractionService({
    repo,
    store: storage.store,
    now: () => new Date('2026-02-01T00:00:00.000Z'),
  });

  /** A Resume as request-upload leaves it, plus the file the browser then puts in storage. */
  const upload = async (
    file: Uint8Array,
    over: {
      userId?: string;
      id?: string;
      filename?: string;
      skipFile?: boolean;
      resume?: Partial<StoredResume>;
    } = {},
  ) => {
    const userId = over.userId ?? 'a';
    const id = over.id ?? RESUME_ID;
    const filename = over.filename ?? 'cv.txt';
    const key = originalKey(userId, id, filename);
    await repo.create(userId, {
      id,
      label: 'cv',
      notes: '',
      text: '',
      status: 'processing',
      source: 'upload',
      isDefault: true,
      reviewedAt: null,
      original: { filename, size: file.byteLength, contentType: 'text/plain' },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      ...over.resume,
    });
    if (!over.skipFile) await storage.store.put(key, file, 'text/plain');
    return { userId, id, key };
  };

  const eventFor = (...keys: string[]): S3Event =>
    ({
      Records: keys.map((key) => ({
        eventName: 'ObjectCreated:Put',
        s3: {
          bucket: { name: 'uploads' },
          object: { key: encodeURIComponent(key).replaceAll('%2F', '/') },
        },
      })),
    }) as unknown as S3Event;

  const process = (...keys: string[]) => processUploadEvent(eventFor(...keys), service);
  const resume = async (userId = 'a', id = RESUME_ID) => repo.get(userId, id);
  return { upload, process, resume, storage, repo };
}

afterEach(() => vi.restoreAllMocks());

describe('reading an uploaded text file', () => {
  it('stores the text, marks the Resume ready and still unreviewed, and keeps the Original', async () => {
    const { upload, process, resume, storage } = setup();
    const { key } = await upload(bytes(CV));
    await process(key);
    expect(await resume()).toMatchObject({
      status: 'ready',
      text: CV,
      reviewedAt: null,
      updatedAt: '2026-02-01T00:00:00.000Z',
    });
    expect((await resume())?.failure).toBeUndefined();
    expect(await storage.store.head(key)).not.toBeNull();
  });

  it('removes a byte order mark and uses plain line endings', async () => {
    const { upload, process, resume } = setup();
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...bytes(CV.replaceAll('\n', '\r\n'))]);
    const { key } = await upload(withBom);
    await process(key);
    expect((await resume())?.text).toBe(CV);
  });

  it('keeps non-ASCII letters in a UTF-8 file', async () => {
    const { upload, process, resume } = setup();
    const text = `${CV}\nSkills: Zürich, São Paulo, 東京`;
    const { key } = await upload(bytes(text));
    await process(key);
    expect((await resume())?.text).toBe(text);
  });
});

describe('text files that cannot be read', () => {
  const fails = async (
    file: Uint8Array,
    code: string,
    messagePart: RegExp,
    filename = 'cv.txt',
  ) => {
    const { upload, process, resume, storage } = setup();
    const { key } = await upload(file, { filename });
    await process(key);
    const r = await resume();
    expect(r?.status).toBe('failed');
    expect(r?.failure?.code).toBe(code);
    expect(r?.failure?.message).toMatch(messagePart);
    expect(r?.text).toBe('');
    // The Original is kept so the user can download it and use Fix.
    expect(await storage.store.head(key)).not.toBeNull();
  };

  it('a file saved in a legacy encoding (Latin-1)', async () => {
    await fails(
      new Uint8Array([...bytes('Jos'), 0xe9, ...bytes(` Example\n${CV}`)]),
      'unsupported_encoding',
      /UTF-8/,
    );
  });

  it('a UTF-16 file', async () => {
    const utf16 = new Uint8Array([0xff, 0xfe, ...[...CV].flatMap((c) => [c.charCodeAt(0), 0])]);
    await fails(utf16, 'unsupported_encoding', /UTF-8/);
  });

  it('a binary file (an image) renamed to .txt', async () => {
    const png = new Uint8Array([
      0x89,
      0x50,
      0x4e,
      0x47,
      0x0d,
      0x0a,
      0x1a,
      0x0a,
      0,
      0,
      0,
      0x0d,
      0x49,
      0x48,
      0x44,
      0x52,
      ...new Array(64).fill(7),
    ]);
    await fails(png, 'wrong_type', /does not look like a text file/);
  });

  it('a PDF renamed to .txt', async () => {
    await fails(bytes(`%PDF-1.4\n${CV}\n%%EOF`), 'wrong_type', /does not look like a text file/);
  });

  it('a Word document or other zip renamed to .txt', async () => {
    await fails(
      new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...bytes(CV)]),
      'wrong_type',
      /does not look like a text file/,
    );
  });

  it('an empty or near-empty file', async () => {
    await fails(bytes(''), 'no_readable_text', /Paste your resume text instead/);
    await fails(bytes('   \n\n  hi  \n'), 'no_readable_text', /Paste your resume text instead/);
  });

  it('text over the length limit, saying how long it was', async () => {
    const long = 'a'.repeat(MAX_RESUME_TEXT_CHARS + 1);
    await fails(bytes(long), 'text_too_long', /60,001 characters.*60,000/);
  });

  it('text exactly at the limit is accepted', async () => {
    const { upload, process, resume } = setup();
    const { key } = await upload(bytes('a'.repeat(MAX_RESUME_TEXT_CHARS)));
    await process(key);
    expect((await resume())?.status).toBe('ready');
  });

  it('a file over the size limit is refused without being read', async () => {
    const { upload, process, resume, storage } = setup();
    const { key } = await upload(new Uint8Array(MAX_UPLOAD_BYTES + 1).fill(97));
    const read = vi.spyOn(storage.store, 'read');
    await process(key);
    expect((await resume())?.failure?.code).toBe('file_too_large');
    expect(read).not.toHaveBeenCalled();
  });
});

describe('events that must not change anything', () => {
  it('a repeated event does nothing: later edits are not overwritten', async () => {
    const { upload, process, resume, repo } = setup();
    const { key } = await upload(bytes(CV));
    await process(key);
    await repo.update('a', RESUME_ID, {
      text: 'The user edited this text afterwards.',
      updatedAt: '2026-03-01T00:00:00.000Z',
    });
    await process(key);
    expect((await resume())?.text).toBe('The user edited this text afterwards.');
    expect((await resume())?.updatedAt).toBe('2026-03-01T00:00:00.000Z');
  });

  it('a Resume that was already failed or ready is left alone', async () => {
    const { upload, process, resume } = setup();
    const { key } = await upload(bytes(CV), {
      resume: { status: 'failed', failure: { code: 'corrupt', message: 'x' } },
    });
    await process(key);
    expect(await resume()).toMatchObject({
      status: 'failed',
      text: '',
      failure: { code: 'corrupt' },
    });
  });

  it('an event for a Resume that no longer exists removes the orphaned file', async () => {
    const { process, storage } = setup();
    const key = originalKey('a', OTHER_ID, 'cv.txt');
    await storage.store.put(key, bytes(CV), 'text/plain');
    await process(key);
    expect(await storage.store.head(key)).toBeNull();
  });

  it("a file filed under one user cannot complete another user's Resume", async () => {
    const { upload, process, resume, storage } = setup();
    await upload(bytes(CV), { userId: 'b', id: RESUME_ID });
    const forged = originalKey('a', RESUME_ID, 'cv.txt');
    await storage.store.put(
      forged,
      bytes('Attacker supplied text that should never appear anywhere.'),
      'text/plain',
    );
    await process(forged);
    expect(await resume('b')).toMatchObject({ status: 'processing', text: '' });
    expect(await storage.store.head(forged)).toBeNull();
  });

  it('a key that is not shaped like an Original is ignored and left in place', async () => {
    const { process, storage } = setup();
    await storage.store.put('uploads/loose-file.txt', bytes(CV));
    await process('uploads/loose-file.txt');
    expect(await storage.store.head('uploads/loose-file.txt')).not.toBeNull();
  });

  it('an event whose file is not there yet changes nothing', async () => {
    const { upload, process, resume } = setup();
    const { key } = await upload(bytes(CV), { skipFile: true });
    await process(key);
    expect(await resume()).toMatchObject({ status: 'processing', text: '' });
  });

  it('one bad record does not stop the others in the same event', async () => {
    const { upload, process, resume } = setup();
    const bad = await upload(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0, 1, 2]), {
      id: OTHER_ID,
      filename: 'bad.txt',
    });
    const good = await upload(bytes(CV));
    await process(bad.key, good.key);
    expect((await resume('a', OTHER_ID))?.status).toBe('failed');
    expect((await resume())?.status).toBe('ready');
  });
});

describe('privacy', () => {
  it('never logs file names or resume text', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => undefined),
    );
    const { upload, process } = setup();
    const ok = await upload(bytes(CV), { filename: 'alex-secret-cv.txt' });
    const bad = await upload(bytes(`%PDF-1.4 ${CV}`), {
      id: OTHER_ID,
      filename: 'alex-secret-bad.txt',
    });
    await process(ok.key, bad.key);
    const logged = JSON.stringify(spies.flatMap((s) => s.mock.calls));
    expect(logged).not.toContain('alex-secret');
    expect(logged).not.toContain('Example Corp');
    expect(logged).not.toContain('alex@example.com');
  });
});
