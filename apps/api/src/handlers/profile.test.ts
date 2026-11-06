import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { describe, expect, it, vi } from 'vitest';
import { createFakeObjectStore } from '../lib/fakeObjectStore';
import { originalKey } from '../lib/objectKeys';
import { createUserFiles } from '../lib/userFiles';
import { createFakeDb } from '../repo/fakeDb';
import { createProfileRepo } from '../repo/profileRepo';
import { createProfileService } from '../services/profileService';
import type { ApiEvent } from '../lib/http';
import { route } from './profile';

function setup() {
  const { db, items } = createFakeDb();
  const storage = createFakeObjectStore();
  const repo = createProfileRepo(db, 't');
  const deleteUser = vi.fn().mockResolvedValue(undefined);
  /** Users whose Anthropic key has passed a check. */
  const verified = new Set<string>();
  const svc = createProfileService({
    repo,
    hasVerifiedKey: async (userId) => verified.has(userId),
    identity: { deleteUser },
    files: createUserFiles(storage.store),
    defaultModelId: 'claude-sonnet-5-5',
    now: () => new Date('2026-01-01T00:00:00.000Z'),
  });
  return { svc, deleteUser, repo, verified, items, storage };
}

function event(method: string, sub: string, body?: unknown): ApiEvent {
  return {
    body: body === undefined ? undefined : JSON.stringify(body),
    isBase64Encoded: false,
    requestContext: {
      http: { method },
      authorizer: {
        jwt: { claims: { sub, email: `${sub}@example.com`, name: `User ${sub}` }, scopes: [] },
      },
    },
  } as unknown as ApiEvent;
}

const asResult = (r: unknown) => r as APIGatewayProxyStructuredResultV2;
const parsed = (r: unknown) => JSON.parse(asResult(r).body ?? '{}');

describe('/me', () => {
  it('GET creates a missing profile from the token claims', async () => {
    const { svc } = setup();
    const res = asResult(await route(event('GET', 'a'), svc));
    expect(res.statusCode).toBe(200);
    expect(parsed(res)).toMatchObject({
      name: 'User a',
      email: 'a@example.com',
      onboardingStep: 'welcome',
      onboardingCompletedAt: null,
      modelId: 'claude-sonnet-5-5',
    });
  });

  it('PUT renames only the caller', async () => {
    const { svc } = setup();
    await route(event('GET', 'a'), svc);
    await route(event('GET', 'b'), svc);

    const res = await route(event('PUT', 'a', { name: 'Alex Renamed' }), svc);
    expect(parsed(res).name).toBe('Alex Renamed');
    expect(parsed(await route(event('GET', 'b'), svc)).name).toBe('User b');
  });

  it('PUT ignores identity in the body: unknown fields are rejected', async () => {
    const { svc } = setup();
    await route(event('GET', 'a'), svc);
    const res = asResult(await route(event('PUT', 'a', { name: 'X', userId: 'b' }), svc));
    expect(res.statusCode).toBe(400);
  });

  it.each([
    {},
    { name: '' },
    { name: 'x'.repeat(101) },
    { modelId: 'gpt-4' },
    { modelId: 'claude-opus-4-1' },
    'nope',
  ])('PUT rejects invalid body %j', async (body) => {
    const { svc } = setup();
    await route(event('GET', 'a'), svc);
    expect(asResult(await route(event('PUT', 'a', body), svc)).statusCode).toBe(400);
  });

  it('PUT saves a model from the allow-list, and GET resolves it', async () => {
    const { svc } = setup();
    await route(event('GET', 'a'), svc);
    const res = await route(event('PUT', 'a', { modelId: 'claude-opus-5-5' }), svc);
    expect(parsed(res)).toMatchObject({ name: 'User a', modelId: 'claude-opus-5-5' });
    expect(parsed(await route(event('GET', 'a'), svc)).modelId).toBe('claude-opus-5-5');
  });

  it('a model choice is per user and does not change the default for others', async () => {
    const { svc } = setup();
    await route(event('GET', 'a'), svc);
    await route(event('GET', 'b'), svc);
    await route(event('PUT', 'a', { modelId: 'claude-haiku-5-5' }), svc);
    expect(parsed(await route(event('GET', 'b'), svc)).modelId).toBe('claude-sonnet-5-5');
  });

  it('PUT can change name and model together', async () => {
    const { svc } = setup();
    await route(event('GET', 'a'), svc);
    const res = await route(
      event('PUT', 'a', { name: 'Alex New', modelId: 'claude-opus-5-5' }),
      svc,
    );
    expect(parsed(res)).toMatchObject({ name: 'Alex New', modelId: 'claude-opus-5-5' });
  });

  it('PUT returns 404 when there is no profile', async () => {
    const { svc } = setup();
    expect(asResult(await route(event('PUT', 'a', { name: 'X Y' }), svc)).statusCode).toBe(404);
  });

  it('DELETE removes the caller data and login, leaving others alone', async () => {
    const { svc, deleteUser } = setup();
    await route(event('GET', 'a'), svc);
    await route(event('GET', 'b'), svc);

    expect(asResult(await route(event('DELETE', 'a'), svc)).statusCode).toBe(204);
    expect(deleteUser).toHaveBeenCalledExactlyOnceWith('a');
    expect(parsed(await route(event('GET', 'b'), svc)).name).toBe('User b');
  });

  it('rejects unsupported methods', async () => {
    const { svc } = setup();
    expect(asResult(await route(event('POST', 'a'), svc)).statusCode).toBe(405);
  });
});

describe('onboarding', () => {
  const step = (sub: string, onboardingStep: string) => event('PUT', sub, { onboardingStep });

  it('a new profile starts at welcome and exposes no internal fields', async () => {
    const { svc } = setup();
    const p = parsed(await route(event('GET', 'a'), svc));
    expect(p).toMatchObject({ onboardingStep: 'welcome', onboardingCompletedAt: null });
    expect(p).not.toHaveProperty('onboardingVersion');
  });

  it('allows welcome and api-key without a key', async () => {
    const { svc } = setup();
    await route(event('GET', 'a'), svc);
    expect(parsed(await route(step('a', 'api-key'), svc)).onboardingStep).toBe('api-key');
    expect(parsed(await route(step('a', 'welcome'), svc)).onboardingStep).toBe('welcome');
  });

  it.each(['resume', 'done'])('refuses %s without a verified key', async (target) => {
    const { svc } = setup();
    await route(event('GET', 'a'), svc);
    const res = asResult(await route(step('a', target), svc));
    expect(res.statusCode).toBe(409);
    expect(parsed(res).error.code).toBe('api_key_required');
    expect(parsed(await route(event('GET', 'a'), svc)).onboardingStep).toBe('welcome');
  });

  it('with a verified key, resume then done completes onboarding and stamps the time', async () => {
    const { svc, verified } = setup();
    await route(event('GET', 'a'), svc);
    verified.add('a');
    expect(parsed(await route(step('a', 'resume'), svc))).toMatchObject({
      onboardingStep: 'resume',
      onboardingCompletedAt: null,
    });
    const done = parsed(await route(step('a', 'done'), svc));
    expect(done).toMatchObject({
      onboardingStep: 'done',
      onboardingCompletedAt: '2026-01-01T00:00:00.000Z',
    });
  });

  it('can skip straight from api-key to done once the key is verified', async () => {
    const { svc, verified } = setup();
    await route(event('GET', 'a'), svc);
    verified.add('a');
    expect(parsed(await route(step('a', 'done'), svc)).onboardingCompletedAt).not.toBeNull();
  });

  it('finished users cannot re-enter onboarding, but can still edit their profile', async () => {
    const { svc, verified } = setup();
    await route(event('GET', 'a'), svc);
    verified.add('a');
    await route(step('a', 'done'), svc);
    const res = asResult(await route(step('a', 'welcome'), svc));
    expect(res.statusCode).toBe(409);
    expect(parsed(res).error.code).toBe('already_onboarded');
    expect(parsed(await route(event('PUT', 'a', { name: 'Alex New' }), svc)).name).toBe('Alex New');
  });

  it('clients cannot set the completion time or an unknown step', async () => {
    const { svc, verified } = setup();
    await route(event('GET', 'a'), svc);
    verified.add('a');
    for (const body of [
      { onboardingCompletedAt: '2026-01-01T00:00:00.000Z' },
      { onboardingStep: 'finished' },
    ]) {
      expect(asResult(await route(event('PUT', 'a', body), svc)).statusCode).toBe(400);
    }
  });

  it("another user's verified key does not unlock onboarding", async () => {
    const { svc, verified } = setup();
    await route(event('GET', 'a'), svc);
    await route(event('GET', 'b'), svc);
    verified.add('a');
    expect(asResult(await route(step('b', 'done'), svc)).statusCode).toBe(409);
  });

  it('PUT with no profile returns 404 for an onboarding step', async () => {
    const { svc } = setup();
    expect(asResult(await route(step('a', 'api-key'), svc)).statusCode).toBe(404);
  });
});

describe('accounts created before onboarding existed', () => {
  const legacy = {
    name: 'Old User',
    email: 'old@example.com',
    onboardingStep: 'welcome' as const,
    onboardingCompletedAt: null,
    createdAt: '2025-01-01T00:00:00.000Z',
  };

  it('with a verified key they are treated as already onboarded, once', async () => {
    const { svc, repo, verified } = setup();
    await repo.createIfMissing('a', legacy);
    verified.add('a');
    const first = parsed(await route(event('GET', 'a'), svc));
    expect(first).toMatchObject({
      onboardingStep: 'done',
      onboardingCompletedAt: '2026-01-01T00:00:00.000Z',
    });
    verified.delete('a');
    expect(parsed(await route(event('GET', 'a'), svc)).onboardingCompletedAt).toBe(
      '2026-01-01T00:00:00.000Z',
    );
  });

  it('without a key they go through the wizard', async () => {
    const { svc, repo } = setup();
    await repo.createIfMissing('a', legacy);
    expect(parsed(await route(event('GET', 'a'), svc))).toMatchObject({
      onboardingStep: 'welcome',
      onboardingCompletedAt: null,
    });
  });

  it('a legacy user who adds a key later is not auto-completed mid-wizard', async () => {
    const { svc, repo, verified } = setup();
    await repo.createIfMissing('a', legacy);
    await route(event('GET', 'a'), svc);
    verified.add('a');
    expect(parsed(await route(event('GET', 'a'), svc)).onboardingCompletedAt).toBeNull();
  });
});

describe('deleting an account removes the uploaded files too', () => {
  const RESUME = '00000000-0000-4000-8000-000000000001';
  const OTHER = '00000000-0000-4000-8000-000000000002';
  const del = (sub: string) => event('DELETE', sub);
  const put = (
    storage: ReturnType<typeof setup>['storage'],
    userId: string,
    id: string,
    name = 'cv.txt',
  ) => storage.store.put(originalKey(userId, id, name), new TextEncoder().encode('resume text'));

  it("removes every one of the user's files, but nothing that belongs to anyone else", async () => {
    const { svc, storage } = setup();
    await route(event('GET', 'a'), svc);
    await route(event('GET', 'b'), svc);
    await put(storage, 'a', RESUME);
    await put(storage, 'a', OTHER, 'second.txt');
    await put(storage, 'b', RESUME);
    expect(asResult(await route(del('a'), svc)).statusCode).toBe(204);
    expect(await storage.store.list('uploads/a/')).toEqual([]);
    expect(await storage.store.list('uploads/b/')).toHaveLength(1);
    expect(parsed(await route(event('GET', 'b'), svc)).name).toBe('User b');
  });

  it('does not match another user whose id starts the same way', async () => {
    const { svc, storage } = setup();
    await route(event('GET', 'a'), svc);
    await put(storage, 'a', RESUME);
    await put(storage, 'ab', RESUME);
    await route(del('a'), svc);
    expect(await storage.store.list('uploads/ab/')).toHaveLength(1);
  });

  it('works for a user who never uploaded anything', async () => {
    const { svc } = setup();
    await route(event('GET', 'a'), svc);
    expect(asResult(await route(del('a'), svc)).statusCode).toBe(204);
  });

  it('goes in order: files first, then the data, then the login', async () => {
    const { svc, storage, items, deleteUser } = setup();
    await route(event('GET', 'a'), svc);
    await put(storage, 'a', RESUME);
    // What is left at the moment each step runs.
    const left = () => ({ files: storage.objects.size, data: items.size });
    const atFirstFileDelete: { files: number; data: number }[] = [];
    const atLoginDelete: { files: number; data: number }[] = [];
    const realDelete = storage.store.delete.bind(storage.store);
    vi.spyOn(storage.store, 'delete').mockImplementation(async (key) => {
      atFirstFileDelete.push(left());
      await realDelete(key);
    });
    deleteUser.mockImplementation(async () => {
      atLoginDelete.push(left());
    });
    await route(del('a'), svc);
    expect(atFirstFileDelete).toEqual([{ files: 1, data: 1 }]); // data still there while files go
    expect(atLoginDelete).toEqual([{ files: 0, data: 0 }]); // everything else gone before the login
  });

  it('if removing the data fails, the login is left alone and a retry finishes the job', async () => {
    const { svc, storage, repo, deleteUser } = setup();
    await route(event('GET', 'a'), svc);
    await put(storage, 'a', RESUME);
    vi.spyOn(repo, 'deleteAll').mockRejectedValueOnce(new Error('database down'));
    await expect(route(del('a'), svc)).rejects.toThrow('database down');
    expect(deleteUser).not.toHaveBeenCalled();
    expect(asResult(await route(del('a'), svc)).statusCode).toBe(204);
    expect(deleteUser).toHaveBeenCalledOnce();
  });

  it('if removing the files fails, nothing else is touched and a retry finishes the job', async () => {
    const { svc, storage, deleteUser } = setup();
    await route(event('GET', 'a'), svc);
    await put(storage, 'a', RESUME);
    vi.spyOn(storage.store, 'delete').mockRejectedValueOnce(new Error('storage down'));
    await expect(route(del('a'), svc)).rejects.toThrow('storage down');
    expect(deleteUser).not.toHaveBeenCalled();
    expect(parsed(await route(event('GET', 'a'), svc)).name).toBe('User a');
    expect(await storage.store.list('uploads/a/')).toHaveLength(1);

    expect(asResult(await route(del('a'), svc)).statusCode).toBe(204);
    expect(await storage.store.list('uploads/a/')).toEqual([]);
    expect(deleteUser).toHaveBeenCalledOnce();
  });

  it('if removing the login fails after the rest is gone, a retry still succeeds', async () => {
    const { svc, storage, deleteUser } = setup();
    await route(event('GET', 'a'), svc);
    await put(storage, 'a', RESUME);
    deleteUser.mockRejectedValueOnce(new Error('cognito down'));
    await expect(route(del('a'), svc)).rejects.toThrow('cognito down');
    expect(asResult(await route(del('a'), svc)).statusCode).toBe(204);
    expect(deleteUser).toHaveBeenCalledTimes(2);
  });

  it('removes files that are no longer tied to any Resume record', async () => {
    const { svc, storage } = setup();
    await route(event('GET', 'a'), svc);
    await put(storage, 'a', '00000000-0000-4000-8000-0000000000aa', 'stray.txt');
    await route(del('a'), svc);
    expect(await storage.store.list('uploads/')).toEqual([]);
  });
});
