import { describe, expect, it } from 'vitest';
import { buildRepositoryFeatureEnrichmentPrompt } from './repository-feature-enrichment-prompt';
import { request } from './repository-feature-enrichment.test-fixture';

describe('Feature intent conversation prompt', () => {
  it('carries created Features and evidence into an unlimited proposal conversation', () => {
    const prompt = buildRepositoryFeatureEnrichmentPrompt(request);
    expect(prompt).toContain(request.materializedFeatureIds[0]);
    expect(prompt).toContain('src/import.ts');
    expect(prompt).toContain('edit_work_item');
    expect(prompt).toContain(
      'never turn an unconfirmed code observation'.replace('never', 'Never'),
    );
    expect(prompt).toContain('There is no round limit');
    expect(prompt).toContain('description and structured requirements together');
    expect(prompt).toContain('The user can still continue');
    expect(prompt).toContain('capture why the product behaves as it does');
    expect(prompt).toContain('Do not conclude that you are out of questions');
    expect(prompt).toContain('entry points');
    expect(prompt).toContain('neighboring capabilities');
  });
});
