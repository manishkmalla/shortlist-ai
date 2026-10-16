import type { ModelId, Profile, StoredProfile, UpdateProfileRequest } from '@shortlist-ai/shared';
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

export function createProfileService(deps: {
  repo: ProfileRepo;
  identity: IdentityAdmin;
  /** From config (DEFAULT_MODEL_ID). Used until the user picks a model. */
  defaultModelId: ModelId;
  now?: () => Date;
}) {
  const now = deps.now ?? (() => new Date());

  const resolve = (p: StoredProfile): Profile => ({ ...p, modelId: p.modelId ?? deps.defaultModelId });

  const newProfile = (d: NewUserDetails): StoredProfile => ({
    name: (d.name || d.email).slice(0, 100),
    email: d.email,
    onboardingStep: 'welcome',
    onboardingCompletedAt: null,
    createdAt: now().toISOString(),
  });

  return {
    /** Idempotent. Used by the post-confirmation trigger and as a self-heal in getOrCreate. */
    async createProfile(d: NewUserDetails): Promise<Profile> {
      return resolve(await deps.repo.createIfMissing(d.userId, newProfile(d)));
    },

    /** The trigger can fail without blocking sign-up, so GET /me creates a missing profile. */
    async getOrCreate(d: NewUserDetails): Promise<Profile> {
      const stored = (await deps.repo.get(d.userId)) ?? (await deps.repo.createIfMissing(d.userId, newProfile(d)));
      return resolve(stored);
    },

    async update(userId: string, patch: UpdateProfileRequest): Promise<Profile | null> {
      const stored = await deps.repo.update(userId, patch);
      return stored ? resolve(stored) : null;
    },

    /** Data first, then the login. If the second step fails the user can retry. */
    async deleteAccount(userId: string): Promise<void> {
      await deps.repo.deleteAll(userId);
      await deps.identity.deleteUser(userId);
    },
  };
}

export type ProfileService = ReturnType<typeof createProfileService>;
