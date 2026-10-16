import type { Profile } from '@shortlist-ai/shared';
import type { ProfileRepo } from '../repo/profileRepo';

/** Removes the Cognito account. Implemented in lib/identity.ts. */
export interface IdentityAdmin {
  deleteUser(userId: string): Promise<void>;
}

export interface NewUserDetails {
  userId: string;
  email: string;
  name: string;
}

export function createProfileService(deps: { repo: ProfileRepo; identity: IdentityAdmin; now?: () => Date }) {
  const now = deps.now ?? (() => new Date());

  const newProfile = (d: NewUserDetails): Profile => ({
    name: (d.name || d.email).slice(0, 100),
    email: d.email,
    onboardingStep: 'welcome',
    onboardingCompletedAt: null,
    createdAt: now().toISOString(),
  });

  return {
    /** Idempotent. Used by the post-confirmation trigger and as a self-heal in getOrCreate. */
    createProfile: (d: NewUserDetails) => deps.repo.createIfMissing(d.userId, newProfile(d)),

    /** The trigger can fail without blocking sign-up, so GET /me creates a missing profile. */
    async getOrCreate(d: NewUserDetails): Promise<Profile> {
      return (await deps.repo.get(d.userId)) ?? deps.repo.createIfMissing(d.userId, newProfile(d));
    },

    updateName: (userId: string, name: string) => deps.repo.updateName(userId, name),

    /** Data first, then the login. If the second step fails the user can retry. */
    async deleteAccount(userId: string): Promise<void> {
      await deps.repo.deleteAll(userId);
      await deps.identity.deleteUser(userId);
    },
  };
}

export type ProfileService = ReturnType<typeof createProfileService>;
