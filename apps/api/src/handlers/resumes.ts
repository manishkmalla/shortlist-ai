import type { APIGatewayProxyHandlerV2WithJWTAuthorizer } from 'aws-lambda';
import { randomUUID } from 'node:crypto';
import { createResumeRequestSchema, updateResumeRequestSchema } from '@shortlist-ai/shared';
import { errorResponse, identityFrom, json, parseBody, type ApiEvent } from '../lib/http';
import { logger } from '../lib/logger';
import { createDb } from '../repo/db';
import { createResumeRepo } from '../repo/resumeRepo';
import { createResumeService, ResumeError, type ResumeService } from '../services/resumeService';

/** Large enough for the longest allowed resume, even if every character is multi-byte. */
const MAX_BODY_BYTES = 250_000;
const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function service(): ResumeService {
  return createResumeService({
    repo: createResumeRepo(createDb(), process.env.TABLE_NAME ?? ''),
    newId: randomUUID,
  });
}

const notFound = () => errorResponse(404, 'not_found', 'Resume not found.');

/** One function per route in CDK (least-privilege IAM); dispatch is by the route key. */
export async function route(event: ApiEvent, svc: ResumeService) {
  const { userId } = identityFrom(event);
  const id = event.pathParameters?.id;
  if (id !== undefined && !ID_PATTERN.test(id)) return notFound();

  try {
    switch (event.routeKey) {
      case 'GET /resumes':
        return json(200, { resumes: await svc.list(userId) });

      case 'POST /resumes': {
        const body = parseBody(event, createResumeRequestSchema, MAX_BODY_BYTES);
        if (!body) {
          return errorResponse(
            400,
            'invalid_request',
            'Provide a label and the resume text (20 to 60,000 characters).',
          );
        }
        return json(201, await svc.create(userId, body));
      }

      case 'GET /resumes/{id}': {
        const found = await svc.get(userId, id!);
        return found ? json(200, found) : notFound();
      }

      case 'PUT /resumes/{id}': {
        const body = parseBody(event, updateResumeRequestSchema, MAX_BODY_BYTES);
        if (!body)
          return errorResponse(
            400,
            'invalid_request',
            'Check the label, notes and text, then try again.',
          );
        const updated = await svc.update(userId, id!, body);
        return updated ? json(200, updated) : notFound();
      }

      case 'DELETE /resumes/{id}':
        return (await svc.delete(userId, id!)) ? { statusCode: 204 } : notFound();

      case 'POST /resumes/{id}/duplicate':
        return json(201, await svc.duplicate(userId, id!));

      default:
        return errorResponse(405, 'method_not_allowed', 'Method not allowed.');
    }
  } catch (e) {
    if (e instanceof ResumeError)
      return e.code === 'not_found' ? notFound() : errorResponse(409, e.code, e.message);
    throw e;
  }
}

export const handler: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
  try {
    return await route(event, service());
  } catch (e) {
    // Class name only: error messages can echo request data, and resumes are personal.
    logger.error('resume request failed', { error: e instanceof Error ? e.name : 'unknown' });
    return errorResponse(500, 'internal_error', 'Something went wrong.');
  }
};
