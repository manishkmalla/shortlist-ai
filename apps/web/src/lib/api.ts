import { z } from 'zod';
import { authClient } from '../features/auth/authClient';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const errorBodySchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) });

interface RequestOptions<T> {
  method?: 'GET' | 'PUT' | 'DELETE';
  body?: unknown;
  /** Validates the response body. Omit for endpoints that return 204. */
  schema?: z.ZodType<T>;
}

/** Calls the API with the user's ID token. Responses are validated, never trusted. */
export async function apiRequest<T = void>(path: string, opts: RequestOptions<T> = {}): Promise<T> {
  const baseUrl = import.meta.env.VITE_API_URL;
  if (!baseUrl) throw new Error('Missing VITE_API_URL. See apps/web/.env.example.');
  const token = await authClient.idToken();
  if (!token) throw new ApiError(401, 'unauthenticated', 'Please sign in again.');

  const res = await fetch(`${baseUrl}${path}`, {
    method: opts.method ?? 'GET',
    headers: {
      authorization: `Bearer ${token}`,
      ...(opts.body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });

  if (!res.ok) {
    const parsed = errorBodySchema.safeParse(await res.json().catch(() => null));
    throw parsed.success
      ? new ApiError(res.status, parsed.data.error.code, parsed.data.error.message)
      : new ApiError(res.status, 'unknown', 'Something went wrong. Please try again.');
  }
  if (!opts.schema) return undefined as T;
  return opts.schema.parse(await res.json());
}
