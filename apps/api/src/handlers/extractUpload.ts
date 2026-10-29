import type { S3Event, S3Handler } from 'aws-lambda';
import { logger } from '../lib/logger';
import { createS3ObjectStore } from '../lib/s3ObjectStore';
import { createDb } from '../repo/db';
import { createResumeRepo } from '../repo/resumeRepo';
import { createExtractionService, type ExtractionService } from '../services/extractionService';

/** S3 sends keys URL-encoded, with spaces as plus signs. */
const decodeKey = (raw: string) => decodeURIComponent(raw.replace(/\+/g, ' '));

/**
 * Reads each uploaded file named in the event. One bad record never stops the others. Logs ids, sizes and
 * outcomes only: never file names or text.
 */
export async function processUploadEvent(event: S3Event, svc: ExtractionService) {
  for (const record of event.Records) {
    try {
      const result = await svc.extract(decodeKey(record.s3.object.key));
      logger.info('upload processed', {
        outcome: result.outcome,
        userId: result.userId,
        resumeId: result.resumeId,
        size: result.size,
        reason: result.reason,
      });
    } catch (e) {
      logger.error('upload processing failed', { error: e instanceof Error ? e.name : 'unknown' });
    }
  }
}

export const handler: S3Handler = async (event) => {
  await processUploadEvent(
    event,
    createExtractionService({
      repo: createResumeRepo(createDb(), process.env.TABLE_NAME ?? ''),
      store: createS3ObjectStore(process.env.BUCKET_NAME ?? ''),
    }),
  );
};
