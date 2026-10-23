import { describe, expect, it } from 'vitest';
import { buildRepositoryPlacementPrompt } from './repository-placement-prompt';
import type { RepositoryPlacementPromptPayload } from './types';

const payload = {
  projectId: '11111111-1111-4111-8111-111111111111',
  conversationId: '22222222-2222-4222-8222-222222222222',
  workflowId: '33333333-3333-4333-8333-333333333333',
  workflowNodeId: 'placement',
  serviceId: '44444444-4444-4444-8444-444444444444',
  machineId: '55555555-5555-4555-8555-555555555555',
  provider: 'codex',
  resolvedFrontierModel: 'gpt-5.6-sol',
  reasoningEffort: 'high',
  candidates: [
    {
      rootKey: '66666666-6666-4666-8666-666666666666',
      name: 'Reporting',
      description: 'Reporting capability',
      tag: 'product',
      children: [],
    },
  ],
  instructions: [
    {
      rootKey: '66666666-6666-4666-8666-666666666666',
      instruction: 'Select one parent.',
    },
  ],
} satisfies RepositoryPlacementPromptPayload;

describe('repository placement prompt', () => {
  it('keeps discovery bounded and project state immutable', () => {
    const prompt = buildRepositoryPlacementPrompt(payload);
    expect(prompt).toContain('unified_search and get_context');
    expect(prompt).toContain('immutable');
    expect(prompt).toContain('Never target a proposed child');
  });
});
