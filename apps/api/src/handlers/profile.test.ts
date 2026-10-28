import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { describe, expect, it, vi } from 'vitest';
import { createFakeDb } from '../repo/fakeDb';
import { createProfileRepo } from '../repo/profileRepo';
import { createProfileService } from '../services/profileService';
import type { ApiEvent } from '../lib/http';
import { route } from './profile';

function setup() {
  const { db } = createFakeDb();
  const repo = createProfileRepo(db, 't');
  const deleteUser = vi.fn().mockResolvedValue(undefined);
  /** Users whose Anthropic key has passed a check. */
  const verified = new Set<string>();
  const svc = createProfileService({
    repo,
    hasVerifiedKey: async (userId) => verified.has(userId),
    identity: { deleteUser },
    defaultModelId: 'claude-sonnet-5-5',
    now: () => new Date('2026-01-01T00:00:00.000Z'),
  });
  return { svc, deleteUser, repo, verified };
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
