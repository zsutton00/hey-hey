import type { RepositoryFeatureEnrichmentRequest } from '@hey-hey/contracts/agent-bridge';
import {
  toOpenApiConversationId,
  toOpenApiProjectId,
  toOpenApiServiceId,
  toOpenApiWorkflowId,
} from '../../shared/api/identifierAdapters';

export const request: RepositoryFeatureEnrichmentRequest = {
  promptType: 'repository_feature_enrichment',
  projectId: toOpenApiProjectId('11111111-1111-4111-8111-111111111111'),
  conversationId: toOpenApiConversationId('22222222-2222-4222-8222-222222222222'),
  workflowId: toOpenApiWorkflowId('33333333-3333-4333-8333-333333333333'),
  workflowNodeId: 'repository-import-feature-enrichment',
  serviceId: toOpenApiServiceId('44444444-4444-4444-8444-444444444444'),
  machineId: '55555555-5555-4555-8555-555555555555',
  provider: 'codex',
  resolvedFrontierModel: 'accepted-model',
  reasoningEffort: 'high',
  fastMode: true,
  materializedFeatureIds: ['66666666-6666-4666-8666-666666666666'],
  analysis: {
    outcome: 'success',
    serviceId: toOpenApiServiceId('44444444-4444-4444-8444-444444444444'),
    provider: 'codex',
    resolvedFrontierModel: 'accepted-model',
    narrative: 'Import capabilities',
    hierarchy: {
      topLevels: [
        {
          id: 'discovery-root',
          name: 'Imports',
          description: 'Import capabilities',
          tag: 'product',
          children: [
            {
              id: 'discovery-review',
              name: 'Review',
              description: 'Review imports',
              tag: 'frontend',
            },
            {
              id: 'discovery-analysis',
              name: 'Analysis',
              description: 'Analyze repositories',
              tag: 'AI',
            },
          ],
        },
      ],
    },
    evidence: [{ path: 'src/import.ts', summary: 'Import behavior' }],
    briefDiscrepancies: [],
  },
};
