import type { APIGatewayProxyHandlerV2WithJWTAuthorizer } from 'aws-lambda';
import { updateProfileRequestSchema } from '@shortlist-ai/shared';
import { createIdentityAdmin } from '../lib/identity';
import { errorResponse, identityFrom, json, parseBody, type ApiEvent } from '../lib/http';
import { logger } from '../lib/logger';
import { createDb } from '../repo/db';
import { createProfileRepo } from '../repo/profileRepo';
import { createProfileService, type ProfileService } from '../services/profileService';

function service(): ProfileService {
  return createProfileService({
    repo: createProfileRepo(createDb(), process.env.TABLE_NAME ?? ''),
    identity: createIdentityAdmin(process.env.USER_POOL_ID ?? ''),
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
      if (!body) return errorResponse(400, 'invalid_request', 'Provide a name between 1 and 100 characters.');
      const updated = await svc.updateName(me.userId, body.name);
      return updated ? json(200, updated) : errorResponse(404, 'not_found', 'Profile not found.');
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
