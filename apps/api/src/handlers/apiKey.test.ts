import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeKms } from '../lib/fakeKms';
import type { ApiEvent } from '../lib/http';
import { createKmsKeyVault } from '../lib/keyVault';
import { LlmError, type LlmProvider } from '../llm/provider';
import { createFakeDb } from '../repo/fakeDb';
import { createSecretRepo } from '../repo/secretRepo';
import { createApiKeyService } from '../services/apiKeyService';
import { route } from './apiKey';

const KEY = 'sk-ant-api03-SUPERSECRETVALUE0123456789-wxyz';

function setup(verify: LlmProvider['verifyKey'] = async () => undefined) {
  const { db } = createFakeDb();
  const svc = createApiKeyService({
    repo: createSecretRepo(db, 't'),
    vault: createKmsKeyVault(createFakeKms(), 'key'),
    provider: { verifyKey: vi.fn(verify) },
    now: () => new Date('2026-01-01T00:00:00.000Z'),
  });
  return svc;
}

function event(method: string, sub: string, opts: { path?: string; body?: unknown } = {}): ApiEvent {
  const path = opts.path ?? '/settings/api-key';
  return {
    rawPath: path,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    isBase64Encoded: false,
    requestContext: {
      http: { method, path },
      authorizer: { jwt: { claims: { sub, email: `${sub}@example.com`, name: `User ${sub}` }, scopes: [] } },
    },
  } as unknown as ApiEvent;
}

const res = (r: unknown) => r as APIGatewayProxyStructuredResultV2;
const body = (r: unknown) => JSON.parse(res(r).body ?? '{}');

afterEach(() => vi.restoreAllMocks());

describe('/settings/api-key', () => {
  it('GET reports not configured, then the status after saving', async () => {
    const svc = setup();
    expect(body(await route(event('GET', 'a'), svc))).toEqual({ configured: false, lastFour: null, validatedAt: null });
    await route(event('PUT', 'a', { body: { apiKey: KEY } }), svc);
    expect(body(await route(event('GET', 'a'), svc))).toEqual({
      configured: true,
      lastFour: 'wxyz',
      validatedAt: '2026-01-01T00:00:00.000Z',
    });
  });

  it('the key never appears in any response', async () => {
    const svc = setup();
    const responses = [
      await route(event('PUT', 'a', { body: { apiKey: KEY } }), svc),
      await route(event('GET', 'a'), svc),
      await route(event('POST', 'a', { path: '/settings/api-key/test' }), svc),
    ];
    for (const r of responses) {
      expect(JSON.stringify(r)).not.toContain('SUPERSECRET');
      expect(JSON.stringify(r)).not.toContain(KEY);
    }
  });

  it('the key never appears in logs, including on failures', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => undefined),
    );
    const svc = setup(async () => {
      throw new LlmError('invalid_key', 'Your API key is invalid or revoked.');
    });
    await route(event('PUT', 'a', { body: { apiKey: KEY } }), svc);
    await route(event('PUT', 'a', { body: { apiKey: 'not-a-key' } }), svc);
    const logged = JSON.stringify(spies.flatMap((s) => s.mock.calls));
    expect(logged).not.toContain('SUPERSECRET');
    expect(logged).not.toContain(KEY);
  });

  it.each([{}, { apiKey: '' }, { apiKey: 'sk-openai-123456789012345678901' }, { apiKey: KEY, userId: 'b' }, 'x'])(
    'PUT rejects a bad body %j with 400',
    async (b) => {
      const r = res(await route(event('PUT', 'a', { body: b }), setup()));
      expect(r.statusCode).toBe(400);
      expect(body(r).error.code).toBe('invalid_key_format');
    },
  );

  it.each([
    ['invalid_key', 400, 'invalid_api_key', 'invalid or revoked'],
    ['no_credit', 402, 'no_credit', 'Add credit'],
    ['rate_limited', 429, 'rate_limited', 'rate limiting'],
    ['unavailable', 502, 'unavailable', 'Could not reach'],
  ] as const)('maps %s to HTTP %i with a friendly message', async (code, status, apiCode, text) => {
    const svc = setup(async () => {
      throw new LlmError(code, `${text} - friendly`);
    });
    const r = res(await route(event('PUT', 'a', { body: { apiKey: KEY } }), svc));
    expect(r.statusCode).toBe(status);
    expect(body(r).error.code).toBe(apiCode);
    expect(body(r).error.message).toContain(text);
  });

  it('a failed save stores nothing', async () => {
    const svc = setup(async () => {
      throw new LlmError('invalid_key', 'bad');
    });
    await route(event('PUT', 'a', { body: { apiKey: KEY } }), svc);
    expect(body(await route(event('GET', 'a'), svc)).configured).toBe(false);
  });

  it('POST /test re-checks the stored key', async () => {
    const svc = setup();
    await route(event('PUT', 'a', { body: { apiKey: KEY } }), svc);
    const r = res(await route(event('POST', 'a', { path: '/settings/api-key/test' }), svc));
    expect(r.statusCode).toBe(200);
    expect(body(r).configured).toBe(true);
  });

  it('DELETE removes the key (204)', async () => {
    const svc = setup();
    await route(event('PUT', 'a', { body: { apiKey: KEY } }), svc);
    expect(res(await route(event('DELETE', 'a'), svc)).statusCode).toBe(204);
    expect(body(await route(event('GET', 'a'), svc)).configured).toBe(false);
  });

  it('identity comes from the token: user B sees nothing of user A', async () => {
    const svc = setup();
    await route(event('PUT', 'a', { body: { apiKey: KEY } }), svc);
    expect(body(await route(event('GET', 'b'), svc)).configured).toBe(false);
    expect(res(await route(event('POST', 'b', { path: '/settings/api-key/test' }), svc)).statusCode).toBe(400);
    await route(event('DELETE', 'b'), svc);
    expect(body(await route(event('GET', 'a'), svc)).configured).toBe(true);
  });

  it('rejects unsupported methods', async () => {
    expect(res(await route(event('PATCH', 'a'), setup())).statusCode).toBe(405);
  });
});
