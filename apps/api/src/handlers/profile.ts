import type { APIGatewayProxyHandlerV2WithJWTAuthorizer } from 'aws-lambda';
import { modelIdSchema, updateProfileRequestSchema } from '@shortlist-ai/shared';
import { createIdentityAdmin } from '../lib/identity';
import { errorResponse, identityFrom, json, parseBody, type ApiEvent } from '../lib/http';
import { logger } from '../lib/logger';
import { createDb } from '../repo/db';
import { createProfileRepo } from '../repo/profileRepo';
import { createSecretRepo } from '../repo/secretRepo';
import { createProfileService, OnboardingError, type ProfileService } from '../services/profileService';

function service(): ProfileService {
  const db = createDb();
  const table = process.env.TABLE_NAME ?? '';
  const secrets = createSecretRepo(db, table);
  return createProfileService({
    repo: createProfileRepo(db, table),
    hasVerifiedKey: async (userId) => Boolean((await secrets.get(userId))?.validatedAt),
    identity: createIdentityAdmin(process.env.USER_POOL_ID ?? ''),
    // Config, not code. Fails fast if DEFAULT_MODEL_ID is missing or not on the allow-list.
    defaultModelId: modelIdSchema.parse(process.env.DEFAULT_MODEL_ID),
  });
}

/** Routes are split per function in CDK for least-privilege IAM; the dispatch lives here. */
export async function route(event: ApiEvent, svc: ProfileService) {
  const me = identityFrom(event);
  switch (event.requestContext.http.method) {
    case 'GET':
      return json(200, await svc.getOrCreate(me));
    case 'PUT': {
      const body = parseBody(event, updateProfileRequestSchema);
      if (!body) {
        return errorResponse(400, 'invalid_request', 'Provide a name (1 to 100 characters), a supported model or an onboarding step.');
      }
      try {
        const updated = await svc.update(me.userId, body);
        return updated ? json(200, updated) : errorResponse(404, 'not_found', 'Profile not found.');
      } catch (e) {
        if (e instanceof OnboardingError) return errorResponse(409, e.code, e.message);
        throw e;
      }
    }
    case 'DELETE':
      await svc.deleteAccount(me.userId);
      logger.info('account deleted', { userId: me.userId });
      return { statusCode: 204 };
    default:
      return errorResponse(405, 'method_not_allowed', 'Method not allowed.');
  }
}

export const handler: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
  try {
    return await route(event, service());
  } catch (e) {
    logger.error('profile request failed', { error: e instanceof Error ? e.name : 'unknown' });
    return errorResponse(500, 'internal_error', 'Something went wrong.');
  }
};
