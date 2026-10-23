import type {
  RepositoryGroundingSuccess,
  RepositoryFeatureEnrichmentSuccess,
} from '../../../generated';
import { type FeatureGenerationResponse } from '../../utils/shared-schemas';

/**
 * Translate the already-bounded repository result into the existing feature
 * generation input. This is intentionally a pure projection: it does not read
 * the repository, call a provider, or create proposals.
 */
export function mapRepositoryGroundingSuccessToFeatureGeneration(
  completion: RepositoryGroundingSuccess,
): FeatureGenerationResponse {
  const validatedCompletion = completion;

  if (validatedCompletion.narrative.trim().length === 0) {
    throw new Error('Repository-grounding success is missing its narrative.');
  }

  if (validatedCompletion.hierarchy.topLevels.length === 0) {
    throw new Error(
      'Repository-grounding success is missing its top-level feature hierarchy.',
    );
  }

  for (const topLevel of validatedCompletion.hierarchy.topLevels) {
    if (
      topLevel.name.trim().length === 0 ||
      topLevel.description.trim().length === 0
    ) {
      throw new Error(
        'Repository-grounding success contains an incomplete top-level feature.',
      );
    }
    if (topLevel.children.length < 2) {
      throw new Error(
        'Repository-grounding success must provide at least two children for every top-level feature.',
      );
    }
    for (const child of topLevel.children) {
      if (
        child.name.trim().length === 0 ||
        child.description.trim().length === 0
      ) {
        throw new Error(
          'Repository-grounding success contains an incomplete child feature.',
        );
      }
    }
  }

  return {
    type: 'FEATURES',
    response:
      'Based on the bounded repository analysis, here is a feature proposal for review.',
    detectedIntent: 'feature_generation_complete',
    intentConfidence: 1,
    narrative: validatedCompletion.narrative,
    topLevels: validatedCompletion.hierarchy.topLevels.map((topLevel) => ({
      candidateId: topLevel.id,
      name: topLevel.name,
      description: topLevel.description,
      tag: topLevel.tag,
      priority: 'medium',
      reasoning: topLevel.description,
      influences: [],
      children: topLevel.children.map((child) => ({
        candidateId: child.id,
        name: child.name,
        description: child.description,
        tag: child.tag,
        priority: 'medium',
        reasoning: child.description,
        influences: [],
      })),
    })),
  } satisfies FeatureGenerationResponse;
}

export function mapRepositoryEnrichmentToGroundingPresentation(
  completion: RepositoryGroundingSuccess | RepositoryFeatureEnrichmentSuccess,
): RepositoryGroundingSuccess {
  return {
    outcome: 'success',
    serviceId: completion.serviceId,
    provider: completion.provider,
    resolvedFrontierModel: completion.resolvedFrontierModel,
    narrative: completion.narrative,
    hierarchy: completion.hierarchy,
    evidence: completion.evidence,
    briefDiscrepancies: completion.briefDiscrepancies,
  } satisfies RepositoryGroundingSuccess;
}
