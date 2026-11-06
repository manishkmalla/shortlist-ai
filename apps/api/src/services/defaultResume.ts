import type { ResumeRepo } from '../repo/resumeRepo';

/**
 * Called when a Resume has just become ready (pasted, copied, fixed, or finished being read). If the user's default
 * Resume is not ready (failed, or still processing) this one takes over, so the user is never left with a default
 * they cannot use. A default that is ready is never changed, and the new Resume being the default already is a no-op.
 * Returns true when this Resume became the default. Afterwards there is exactly one default.
 */
export async function claimDefaultIfNotReady(
  repo: ResumeRepo,
  userId: string,
  resumeId: string,
  stamp: string,
): Promise<boolean> {
  const others = (await repo.list(userId)).filter((r) => r.isDefault && r.id !== resumeId);
  const alreadyDefault = (await repo.get(userId, resumeId))?.isDefault === true;
  if (alreadyDefault || others.some((r) => r.status === 'ready')) return false;
  return repo.setDefault(
    userId,
    resumeId,
    others.map((r) => r.id),
    stamp,
  );
}
