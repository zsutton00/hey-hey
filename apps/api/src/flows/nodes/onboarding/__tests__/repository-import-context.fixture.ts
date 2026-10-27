import { createMockFlowContext } from '../../../../utils/testUtils';
import type { RepositoryImportFlowContext } from '../../../../types/flow-internal.types';

export const makeRepositoryImportContext = (): RepositoryImportFlowContext => {
  const state = createMockFlowContext({
    flowId: 'repository-import',
  }) as RepositoryImportFlowContext;
  state.repositoryGrounding = {
    prerequisites: {
      serviceId: '44444444-4444-4444-8444-444444444444',
      machineId: '55555555-5555-4555-8555-555555555555',
      entryMode: 'existing_project',
    },
    analysisConfiguration: {
      provider: 'codex',
      resolvedFrontierModel: 'accepted-model',
      reasoningEffort: 'high',
      fastMode: true,
    },
  } as RepositoryImportFlowContext['repositoryGrounding'];
  state.repositoryGroundingBaseline = {
    outcome: 'success',
    serviceId: '44444444-4444-4444-8444-444444444444',
    provider: 'codex',
    resolvedFrontierModel: 'accepted-model',
    narrative: 'Imports',
    evidence: [{ path: 'src/import.ts', summary: 'Imports' }],
    briefDiscrepancies: [],
    hierarchy: {
      topLevels: [
        {
          id: 'discovery-root',
          name: 'Imports',
          description: 'Imports',
          tag: 'product',
          children: [
            {
              id: 'discovery-child-a',
              name: 'Review',
              description: 'Review',
              tag: 'frontend',
            },
            {
              id: 'discovery-child-b',
              name: 'Analysis',
              description: 'Analysis',
              tag: 'AI',
            },
          ],
        },
      ],
    },
  };
  state.repositoryImportMaterializedFeatureIds = [
    '66666666-6666-4666-8666-666666666666',
  ];
  return state;
};
