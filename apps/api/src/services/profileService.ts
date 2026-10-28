import type { ModelId, Profile, StoredProfile, UpdateProfileRequest } from '@shortlist-ai/shared';
import type { ProfilePatch, ProfileRepo } from '../repo/profileRepo';

/** Removes the Cognito account. Implemented in lib/identity.ts. */
export interface IdentityAdmin {
  deleteUser(userId: string): Promise<void>;
}

export interface NewUserDetails {
  userId: string;
  email: string;
  name: string;
}

/** Why a profile update was refused. The handler maps these to HTTP 409. */
export class OnboardingError extends Error {
  constructor(
    public readonly code: 'api_key_required' | 'already_onboarded',
    message: string,
  ) {
    super(message);
    this.name = 'OnboardingError';
  }
}

const ONBOARDING_VERSION = 1;

export function createProfileService(deps: {
  repo: ProfileRepo;
  identity: IdentityAdmin;
  /** True when the user has an Anthropic key that passed its last check. */
  hasVerifiedKey: (userId: string) => Promise<boolean>;
  /** From config (DEFAULT_MODEL_ID). Used until the user picks a model. */
  defaultModelId: ModelId;
  now?: () => Date;
}) {
  const now = deps.now ?? (() => new Date());

  const resolve = (p: StoredProfile): Profile => ({
    name: p.name,
    email: p.email,
    onboardingStep: p.onboardingStep,
    onboardingCompletedAt: p.onboardingCompletedAt,
    modelId: p.modelId ?? deps.defaultModelId,
    createdAt: p.createdAt,
  });

  const newProfile = (d: NewUserDetails): StoredProfile => ({
    name: (d.name || d.email).slice(0, 100),
    email: d.email,
    onboardingStep: 'welcome',
    onboardingCompletedAt: null,
    onboardingVersion: ONBOARDING_VERSION,
    createdAt: now().toISOString(),
  });

  /** Accounts created before onboarding existed: finished if they already have a verified key. */
  const migrateLegacy = async (userId: string, stored: StoredProfile): Promise<StoredProfile> => {
    if (stored.onboardingVersion !== undefined) return stored;
    const verified = !stored.onboardingCompletedAt && (await deps.hasVerifiedKey(userId));
    const migrated = await deps.repo.update(
      userId,
      verified
        ? {
            onboardingStep: 'done',
            onboardingCompletedAt: now().toISOString(),
            onboardingVersion: ONBOARDING_VERSION,
          }
        : { onboardingVersion: ONBOARDING_VERSION },
    );
    return migrated ?? stored;
  };

  return {
    /** Idempotent. Used by the post-confirmation trigger and as a self-heal in getOrCreate. */
    async createProfile(d: NewUserDetails): Promise<Profile> {
      return resolve(await deps.repo.createIfMissing(d.userId, newProfile(d)));
    },

    /** The trigger can fail without blocking sign-up, so GET /me creates a missing profile. */
    async getOrCreate(d: NewUserDetails): Promise<Profile> {
      const stored =
        (await deps.repo.get(d.userId)) ??
        (await deps.repo.createIfMissing(d.userId, newProfile(d)));
      return resolve(await migrateLegacy(d.userId, stored));
    },

    /**
     * Onboarding rules live here, not in the client:
     * - finished users cannot re-enter onboarding
     * - `resume` and `done` need a verified API key
     * - reaching `done` stamps the completion time
     */
    async update(userId: string, patch: UpdateProfileRequest): Promise<Profile | null> {
      const change: ProfilePatch = { name: patch.name, modelId: patch.modelId };
      if (patch.onboardingStep) {
        const current = await deps.repo.get(userId);
        if (!current) return null;
        if (current.onboardingCompletedAt) {
          throw new OnboardingError('already_onboarded', 'Onboarding is already complete.');
        }
        if (patch.onboardingStep !== 'welcome' && patch.onboardingStep !== 'api-key') {
          if (!(await deps.hasVerifiedKey(userId))) {
            throw new OnboardingError(
              'api_key_required',
              'Add and verify your Anthropic API key first.',
            );
          }
        }
        change.onboardingStep = patch.onboardingStep;
        if (patch.onboardingStep === 'done') change.onboardingCompletedAt = now().toISOString();
      }
      const stored = await deps.repo.update(userId, change);
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
