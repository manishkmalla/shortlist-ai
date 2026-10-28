import { z } from 'zod';
import { modelIdSchema } from './models';

export const onboardingStepSchema = z.enum(['welcome', 'api-key', 'resume', 'done']);
export type OnboardingStep = z.infer<typeof onboardingStepSchema>;

/** What the API returns. `modelId` is always resolved (the user's choice, or the configured default). */
export const profileSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  onboardingStep: onboardingStepSchema,
  /** ISO timestamp, or null until onboarding is finished. */
  onboardingCompletedAt: z.string().datetime().nullable(),
  modelId: modelIdSchema,
  createdAt: z.string().datetime(),
});
export type Profile = z.infer<typeof profileSchema>;

/** What is stored. `modelId` is absent until the user picks one. */
export const storedProfileSchema = profileSchema.extend({
  modelId: modelIdSchema.optional(),
  /** Set on profiles created after onboarding existed. Older profiles lack it and are migrated on read. */
  onboardingVersion: z.number().int().optional(),
});
export type StoredProfile = z.infer<typeof storedProfileSchema>;

export const updateProfileRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    modelId: modelIdSchema.optional(),
    /** Completion is set by the server when this becomes `done`; clients cannot send a timestamp. */
    onboardingStep: onboardingStepSchema.optional(),
  })
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'Provide a field to update' });
export type UpdateProfileRequest = z.infer<typeof updateProfileRequestSchema>;
