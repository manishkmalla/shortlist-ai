import { z } from 'zod';

export const onboardingStepSchema = z.enum(['welcome', 'api-key', 'resume', 'done']);
export type OnboardingStep = z.infer<typeof onboardingStepSchema>;

export const profileSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  onboardingStep: onboardingStepSchema,
  /** ISO timestamp, or null until onboarding is finished. */
  onboardingCompletedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type Profile = z.infer<typeof profileSchema>;

export const updateProfileRequestSchema = z.object({ name: z.string().trim().min(1).max(100) }).strict();
export type UpdateProfileRequest = z.infer<typeof updateProfileRequestSchema>;
