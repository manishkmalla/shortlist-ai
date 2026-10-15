export type MatchLabel = 'Excellent Match' | 'Strong Match' | 'Moderate Match' | 'Stretch Role';

/** Label is derived from the numeric score in code, never taken from the model. */
export function scoreLabel(score: number): MatchLabel {
  if (score >= 80) return 'Excellent Match';
  if (score >= 65) return 'Strong Match';
  if (score >= 50) return 'Moderate Match';
  return 'Stretch Role';
}
