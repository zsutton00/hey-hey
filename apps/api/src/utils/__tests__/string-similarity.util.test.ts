import { diceSimilarity } from '../string-similarity.util';

describe('diceSimilarity', () => {
  it('returns 1 for identical strings', () => {
    expect(diceSimilarity('hello', 'hello')).toBe(1);
  });

  it('returns 0 for completely different strings', () => {
    expect(diceSimilarity('abc', 'xyz')).toBe(0);
  });

  it('returns 0 for empty strings', () => {
    expect(diceSimilarity('', 'hello')).toBe(0);
    expect(diceSimilarity('hello', '')).toBe(0);
    expect(diceSimilarity('', '')).toBe(0);
  });

  it('returns a score between 0 and 1 for partial matches', () => {
    const score = diceSimilarity('night', 'nacht');
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });

  it('returns higher scores for more similar strings', () => {
    const highSim = diceSimilarity(
      'authentication flow',
      'authentication issues',
    );
    const lowSim = diceSimilarity('authentication flow', 'database migration');
    expect(highSim).toBeGreaterThan(lowSim);
  });

  it('is symmetric', () => {
    expect(diceSimilarity('hello', 'hallo')).toBe(
      diceSimilarity('hallo', 'hello'),
    );
  });
});
