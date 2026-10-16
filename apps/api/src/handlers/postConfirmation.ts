import type { PostConfirmationTriggerHandler } from 'aws-lambda';
import { logger } from '../lib/logger';
import { createDb } from '../repo/db';
import { createProfileRepo } from '../repo/profileRepo';
import { createProfileService } from '../services/profileService';

/**
 * Creates the profile after a user verifies their email. A failure here must not block
 * sign-up, so errors are logged and swallowed; GET /me creates a missing profile later.
 */
export const handler: PostConfirmationTriggerHandler = async (event) => {
  if (event.triggerSource !== 'PostConfirmation_ConfirmSignUp') return event;
  const { sub, email, name } = event.request.userAttributes;
  if (!sub || !email) return event;
  try {
    const svc = createProfileService({
      repo: createProfileRepo(createDb(), process.env.TABLE_NAME ?? ''),
      identity: { deleteUser: () => Promise.reject(new Error('not supported')) },
    });
    await svc.createProfile({ userId: sub, email, name: name ?? '' });
    logger.info('profile created', { userId: sub });
  } catch (e) {
    logger.error('profile creation failed', { userId: sub, error: e instanceof Error ? e.name : 'unknown' });
  }
  return event;
};
