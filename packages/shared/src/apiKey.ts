import { z } from 'zod';

/** Anthropic keys start with sk-ant- and are long, url-safe strings. This is a format check only. */
export const anthropicApiKeySchema = z
  .string()
  .trim()
  .min(20, 'That does not look like an Anthropic API key')
  .max(300, 'That does not look like an Anthropic API key')
  .regex(/^sk-ant-[A-Za-z0-9_-]+$/, 'Anthropic API keys start with sk-ant-');

export const putApiKeyRequestSchema = z.object({ apiKey: anthropicApiKeySchema }).strict();
export type PutApiKeyRequest = z.infer<typeof putApiKeyRequestSchema>;

/** The only key information that ever leaves the server. `validatedAt` is null when the key has not passed a check. */
export const apiKeyStatusSchema = z.object({
  configured: z.boolean(),
  lastFour: z.string().length(4).nullable(),
  validatedAt: z.string().datetime().nullable(),
});
export type ApiKeyStatus = z.infer<typeof apiKeyStatusSchema>;
