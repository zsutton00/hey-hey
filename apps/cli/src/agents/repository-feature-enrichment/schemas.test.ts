import { describe, expect, it } from 'vitest';
import { parseRepositoryFeatureEnrichmentCompletion } from './schemas';

describe('repositoryFeatureEnrichmentCompletionSchema', () => {
  it('accepts bounded questions and typed failures', () => {
    expect(
      parseRepositoryFeatureEnrichmentCompletion({
        outcome: 'questions',
        questionGroup: { questions: ['One?'] },
      }).ok,
    ).toBe(true);
    expect(
      parseRepositoryFeatureEnrichmentCompletion({
        outcome: 'questions',
        questionGroup: { questions: ['One?', 'Two?', 'Three?', 'Four?'] },
      }).ok,
    ).toBe(false);
    expect(
      parseRepositoryFeatureEnrichmentCompletion({
        outcome: 'retryable_failure',
        code: 'provider_timeout',
        message: 'Try again.',
      }).ok,
    ).toBe(true);
    expect(
      parseRepositoryFeatureEnrichmentCompletion({
        outcome: 'terminal_failure',
        code: 'access_denied',
        message: 'Denied.',
      }).ok,
    ).toBe(true);
  });

  it('accepts a complete evidence-backed snapshot', () => {
    expect(
      parseRepositoryFeatureEnrichmentCompletion({
        outcome: 'success',
        serviceId: '44444444-4444-4444-8444-444444444444',
        provider: 'codex',
        resolvedFrontierModel: 'gpt-6-astra',
        narrative: 'Updated analysis.',
        hierarchy: {
          topLevels: [
            {
              id: 'root',
              name: 'Imports',
              description: 'Import capabilities',
              tag: 'product',
              children: [
                {
                  id: 'child',
                  name: 'Review',
                  description: 'Review imports',
                  tag: 'frontend',
                },
              ],
            },
          ],
        },
        evidence: [{ path: 'src/import.ts', summary: 'Import behavior' }],
        briefDiscrepancies: [],
        support: [],
      }).ok,
    ).toBe(true);
  });

  it('rejects a delta-shaped success or an incomplete snapshot', () => {
    expect(
      parseRepositoryFeatureEnrichmentCompletion({
        outcome: 'success',
        changes: [],
        support: [],
        hierarchy: { topLevels: [] },
      }).ok,
    ).toBe(false);
    expect(
      parseRepositoryFeatureEnrichmentCompletion({
        outcome: 'success',
        changes: [],
        support: [],
        provider: 'codex',
      }).ok,
    ).toBe(false);
  });
});
