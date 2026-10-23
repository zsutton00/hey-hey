import { describe, expect, it } from 'vitest';
import { parseRepositoryPlacementCompletion } from './schemas';

describe('repository placement completion schema', () => {
  it('accepts a root-only placement', () => {
    expect(
      parseRepositoryPlacementCompletion({
        outcome: 'success',
        placements: [
          {
            rootKey: '11111111-1111-4111-8111-111111111111',
            target: { kind: 'PROJECT_ROOT' },
            rationale: 'It is a top-level product concept.',
            confidence: 0.9,
          },
        ],
      }).ok,
    ).toBe(true);
  });

  it('rejects non-Feature target shapes', () => {
    expect(
      parseRepositoryPlacementCompletion({
        outcome: 'success',
        placements: [
          {
            rootKey: '11111111-1111-4111-8111-111111111111',
            target: { kind: 'TASK', featureId: '22222222-2222-4222-8222-222222222222' },
            rationale: 'invalid',
            confidence: 0.5,
          },
        ],
      }).ok,
    ).toBe(false);
  });
});
