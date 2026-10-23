import {
  ONBOARDING_NODES,
  REPOSITORY_IMPORT_NODES,
  SHARED_NODES,
} from '../constants';
import { onboardingFlow } from '../templates/onboarding.flow';
import { repositoryImportFlow } from '../templates/repository-import.flow';
import { resolveOnboardingAdditionalContext } from '../../workflows/conversation-flow-compatibility';

describe('repository import workflow isolation', () => {
  it('keeps repository nodes out of onboarding while preserving the intent gate', () => {
    expect(onboardingFlow.nodes[ONBOARDING_NODES.WELCOME]).toEqual({
      nextNode: ONBOARDING_NODES.REPOSITORY_GROUNDING_INTENT,
    });
    expect(
      onboardingFlow.nodes[ONBOARDING_NODES.REPOSITORY_GROUNDING_INTENT],
    ).toMatchObject({
      transitions: {
        yes: { nextNodeId: ONBOARDING_NODES.END },
        no: { nextNodeId: ONBOARDING_NODES.CLARIFY_CONCEPT },
      },
    });
    for (const nodeId of Object.values(REPOSITORY_IMPORT_NODES)) {
      expect(onboardingFlow.nodes[nodeId]).toBeUndefined();
    }
  });

  it('owns analysis, enrichment, review, placement, and finalization', () => {
    expect(repositoryImportFlow.id).toBe('repository-import');
    expect(repositoryImportFlow.startNode).toBe(
      REPOSITORY_IMPORT_NODES.PREREQUISITES,
    );
    expect(
      repositoryImportFlow.nodes[REPOSITORY_IMPORT_NODES.ANALYSIS],
    ).toMatchObject({
      transitions: {
        success: { nextNodeId: REPOSITORY_IMPORT_NODES.GENERATE_FEATURES },
        retryable_failure: { nextNodeId: REPOSITORY_IMPORT_NODES.RECOVERY },
      },
    });
    expect(
      repositoryImportFlow.nodes[REPOSITORY_IMPORT_NODES.ENRICHMENT],
    ).toMatchObject({
      transitions: {
        success: { nextNodeId: REPOSITORY_IMPORT_NODES.GENERATE_FEATURES },
      },
    });
    expect(
      repositoryImportFlow.nodes[REPOSITORY_IMPORT_NODES.GENERATE_FEATURES],
    ).toMatchObject({
      nextNode: REPOSITORY_IMPORT_NODES.ENRICHMENT_CHOICE,
    });
    expect(
      repositoryImportFlow.nodes[SHARED_NODES.GENERATE_FEATURES],
    ).toBeDefined();
    expect(
      repositoryImportFlow.nodes[REPOSITORY_IMPORT_NODES.FINALIZE],
    ).toMatchObject({
      nextNode: REPOSITORY_IMPORT_NODES.FIRST_WORK_QUESTION,
    });
  });

  it('adds only the onboarding intent marker to direct onboarding starts', () => {
    expect(
      resolveOnboardingAdditionalContext({
        flowId: 'onboarding',
        additionalContext: { preserved: true },
      }),
    ).toEqual({
      preserved: true,
      repositoryGroundingIntentRequired: true,
    });
    expect(
      resolveOnboardingAdditionalContext({
        flowId: 'repository-import',
        additionalContext: { repositoryGrounding: { seeded: true } },
      }),
    ).toEqual({ repositoryGrounding: { seeded: true } });
  });
});
