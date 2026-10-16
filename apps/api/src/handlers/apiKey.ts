import type { APIGatewayProxyHandlerV2WithJWTAuthorizer } from 'aws-lambda';
import { KMSClient } from '@aws-sdk/client-kms';
import { putApiKeyRequestSchema } from '@shortlist-ai/shared';
import { errorResponse, identityFrom, json, parseBody, type ApiEvent } from '../lib/http';
import { createKmsKeyVault } from '../lib/keyVault';
import { logger } from '../lib/logger';
import { createAnthropicProvider } from '../llm/anthropicProvider';
import { LlmError, type LlmErrorCode } from '../llm/provider';
import { createDb } from '../repo/db';
import { createSecretRepo } from '../repo/secretRepo';
import { createApiKeyService, type ApiKeyService } from '../services/apiKeyService';

function service(): ApiKeyService {
  return createApiKeyService({
    repo: createSecretRepo(createDb(), process.env.TABLE_NAME ?? ''),
    vault: createKmsKeyVault(new KMSClient({}), process.env.KEY_ID ?? ''),
    provider: createAnthropicProvider(),
  });
}

const statusFor: Record<LlmErrorCode, number> = {
  invalid_key: 400,
  no_credit: 402,
  rate_limited: 429,
  unavailable: 502,
};

/** Routes are split per function in CDK for least-privilege IAM; dispatch lives here. */
export async function route(event: ApiEvent, svc: ApiKeyService) {
  const { userId } = identityFrom(event);
  const { method } = event.requestContext.http;
  const isTest = event.rawPath.endsWith('/test');

  try {
    if (method === 'GET') return json(200, await svc.status(userId));
    if (method === 'PUT') {
      const body = parseBody(event, putApiKeyRequestSchema);
      if (!body) {
        return errorResponse(400, 'invalid_key_format', 'Enter a valid Anthropic API key (it starts with sk-ant-).');
      }
      return json(200, await svc.save(userId, body.apiKey));
    }
    if (method === 'POST' && isTest) return json(200, await svc.test(userId));
    if (method === 'DELETE') {
      await svc.remove(userId);
      return { statusCode: 204 };
    }
    return errorResponse(405, 'method_not_allowed', 'Method not allowed.');
  } catch (e) {
    if (e instanceof LlmError) {
      logger.info('api key check failed', { userId, reason: e.code });
      return errorResponse(statusFor[e.code], e.code === 'invalid_key' ? 'invalid_api_key' : e.code, e.message);
    }
    throw e;
  }
}

export const handler: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
  try {
    return await route(event, service());
  } catch (e) {
    // Log the error class only. Messages can echo request data.
    logger.error('api key request failed', { error: e instanceof Error ? e.name : 'unknown' });
    return errorResponse(500, 'internal_error', 'Something went wrong.');
  }
};
