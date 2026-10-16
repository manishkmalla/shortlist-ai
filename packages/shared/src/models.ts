import { z } from 'zod';

/** Models a user may pick in Settings. IDs are exact API model IDs. Update when the lineup changes. */
export const MODEL_OPTIONS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', description: 'Most capable. Best quality, highest cost.' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', description: 'Balanced quality and cost.' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', description: 'Fastest and cheapest. Good for quick drafts.' },
] as const;

export type ModelId = (typeof MODEL_OPTIONS)[number]['id'];

export const modelIdSchema = z.enum(MODEL_OPTIONS.map((m) => m.id) as [ModelId, ...ModelId[]]);
