import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { z } from 'zod';

export type ApiEvent = APIGatewayProxyEventV2WithJWTAuthorizer;

export const json = (statusCode: number, body: unknown): APIGatewayProxyResultV2 => ({
  statusCode,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  body: JSON.stringify(body),
});

export const errorResponse = (statusCode: number, code: string, message: string) =>
  json(statusCode, { error: { code, message } });

const claimsSchema = z.object({
  sub: z.string().min(1),
  email: z.string().email(),
  name: z.string().min(1).catch(''),
});

/** The caller's identity comes from the verified JWT only, never from the body or path. */
export function identityFrom(event: ApiEvent) {
  const claims = claimsSchema.parse(event.requestContext.authorizer.jwt.claims);
  return { userId: claims.sub, email: claims.email, name: claims.name };
}

/** Parses a JSON body with a Zod schema. Returns null if it is missing, too large or invalid. */
export function parseBody<T>(event: ApiEvent, schema: z.ZodType<T>): T | null {
  if (!event.body || event.body.length > 4_096) return null;
  try {
    const result = schema.safeParse(JSON.parse(event.isBase64Encoded ? atob(event.body) : event.body));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
