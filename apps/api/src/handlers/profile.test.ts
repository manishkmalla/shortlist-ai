import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { describe, expect, it, vi } from 'vitest';
import { createFakeDb } from '../repo/fakeDb';
import { createProfileRepo } from '../repo/profileRepo';
import { createProfileService } from '../services/profileService';
import type { ApiEvent } from '../lib/http';
import { route } from './profile';

function setup() {
  const { db } = createFakeDb();
  const deleteUser = vi.fn().mockResolvedValue(undefined);
  const svc = createProfileService({
    repo: createProfileRepo(db, 't'),
    identity: { deleteUser },
    defaultModelId: 'claude-sonnet-5-5',
    now: () => new Date('2026-01-01T00:00:00.000Z'),
  });
  return { svc, deleteUser };
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

  it.each([{}, { name: '' }, { name: 'x'.repeat(101) }, { modelId: 'gpt-4' }, { modelId: 'claude-opus-4-1' }, 'nope'])('PUT rejects invalid body %j', async (body) => {
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
    const res = await route(event('PUT', 'a', { name: 'Alex New', modelId: 'claude-opus-5-5' }), svc);
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
