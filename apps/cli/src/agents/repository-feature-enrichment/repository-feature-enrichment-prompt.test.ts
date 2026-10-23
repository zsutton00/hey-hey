import { describe, expect, it } from 'vitest';
import type { RepositoryFeatureEnrichmentRequest } from '../../shared/agent-bridge-contract/generated/api';
import { buildRepositoryFeatureEnrichmentPrompt } from './repository-feature-enrichment-prompt';

const state: Omit<RepositoryFeatureEnrichmentRequest, 'reviewedCandidates'> = {
  projectId: '11111111-1111-4111-8111-111111111111',
  conversationId: '22222222-2222-4222-8222-222222222222',
  workflowId: '33333333-3333-4333-8333-333333333333',
  workflowNodeId: 'enrichment',
  serviceId: '44444444-4444-4444-8444-444444444444',
  machineId: '55555555-5555-4555-8555-555555555555',
  provider: 'codex',
  resolvedFrontierModel: 'gpt-6-astra',
  reasoningEffort: 'high',
  completedRounds: 1,
  answerBatches: [{ round: 1, answers: [{ question: 'Who uses this?', answer: 'Operators' }] }],
  analysis: {
    outcome: 'success',
    serviceId: '44444444-4444-4444-8444-444444444444',
    provider: 'codex',
    resolvedFrontierModel: 'gpt-6-astra',
    narrative: 'Baseline',
    hierarchy: {
      topLevels: [
        {
          id: 'root',
          name: 'Imports',
          description: 'Import capabilities',
          tag: 'product',
          children: [
            { id: 'child', name: 'Review', description: 'Review imports', tag: 'frontend' },
          ],
        },
      ],
    },
    evidence: [{ path: 'src/import.ts', summary: 'Import behavior' }],
    briefDiscrepancies: [],
  },
};

const request: RepositoryFeatureEnrichmentRequest = {
  ...state,
  reviewedCandidates: state.analysis.hierarchy,
};

describe('buildRepositoryFeatureEnrichmentPrompt', () => {
  it('renders complete state and bounded evidence-only instructions', () => {
    const prompt = buildRepositoryFeatureEnrichmentPrompt(request);
    expect(prompt).toMatchSnapshot();
  });
});
