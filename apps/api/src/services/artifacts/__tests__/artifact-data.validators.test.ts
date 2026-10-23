import { ArtifactDataValidators } from '../artifact-data.validators';
import { InitiativeArtifactData } from '../../../generated';

describe('ArtifactDataValidators', () => {
  const validators = new ArtifactDataValidators();

  it('accepts INITIATIVE_ORIGINAL artifact data', () => {
    const data: InitiativeArtifactData = {
      type: 'INITIATIVE_ORIGINAL',
      confidence: 0.5,
      reasoning: 'original reasoning',
      content: '{"initiativeId":"test"}',
    };

    expect(() => validators.validateArtifactData(data)).not.toThrow();
  });

  it('accepts INITIATIVE_REFINED artifact data', () => {
    const data: InitiativeArtifactData = {
      type: 'INITIATIVE_REFINED',
      confidence: 0.9,
      reasoning: 'refinement reasoning',
      content: '{"initiativeId":"test"}',
    };

    expect(() => validators.validateArtifactData(data)).not.toThrow();
  });
});
