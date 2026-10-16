import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { authClient } from '../features/auth/authClient';
import { ApiError, apiRequest } from './api';

vi.mock('../features/auth/authClient', () => ({ authClient: { idToken: vi.fn() } }));

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubEnv('VITE_API_URL', 'https://api.example.test');
  vi.stubGlobal('fetch', fetchMock);
  vi.mocked(authClient.idToken).mockResolvedValue('id-token');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

const reply = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status });

describe('apiRequest', () => {
  it('sends the ID token and validates the response', async () => {
    fetchMock.mockResolvedValue(reply(200, { ok: true }));
    const out = await apiRequest('/me', { schema: z.object({ ok: z.boolean() }) });
    expect(out).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.example.test/me');
    expect(init.headers.authorization).toBe('Bearer id-token');
  });

  it('rejects a response that does not match the schema', async () => {
    fetchMock.mockResolvedValue(reply(200, { ok: 'yes' }));
    await expect(apiRequest('/me', { schema: z.object({ ok: z.boolean() }) })).rejects.toThrow();
  });

  it('turns API error bodies into ApiError', async () => {
    fetchMock.mockResolvedValue(reply(400, { error: { code: 'invalid_request', message: 'Bad name.' } }));
    await expect(apiRequest('/me', { method: 'PUT', body: { name: '' } })).rejects.toMatchObject({
      status: 400,
      code: 'invalid_request',
      message: 'Bad name.',
    });
  });

  it('uses a generic message for unexpected error bodies', async () => {
    fetchMock.mockResolvedValue(reply(502));
    const err = await apiRequest('/me').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).message).toBe('Something went wrong. Please try again.');
  });

  it('does not call the API without a session', async () => {
    vi.mocked(authClient.idToken).mockResolvedValue(null);
    await expect(apiRequest('/me')).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns nothing for a 204', async () => {
    fetchMock.mockResolvedValue(reply(204));
    await expect(apiRequest('/me', { method: 'DELETE' })).resolves.toBeUndefined();
  });
});
