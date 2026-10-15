import { describe, expect, it } from 'vitest';
import { scoreLabel } from './score';

describe('scoreLabel', () => {
  it.each([
    [100, 'Excellent Match'],
    [80, 'Excellent Match'],
    [79, 'Strong Match'],
    [65, 'Strong Match'],
    [64, 'Moderate Match'],
    [50, 'Moderate Match'],
    [49, 'Stretch Role'],
    [0, 'Stretch Role'],
  ])('%i -> %s', (score, label) => {
    expect(scoreLabel(score)).toBe(label);
  });
});
