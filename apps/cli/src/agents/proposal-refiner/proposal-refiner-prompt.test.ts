import { describe, it, expect } from 'vitest';
import { buildProposalRefinerPrompt } from './proposal-refiner-prompt';
import type { ProposalRefinerPromptInput } from './types';

const makeInput = (
  overrides?: Partial<ProposalRefinerPromptInput>,
): ProposalRefinerPromptInput => ({
  proposal: {
    id: 'prop-abc-123',
    action: 'UPDATE',
    status: 'PENDING',
    targetEntityId: 'task-xyz-789',
    targetEntityType: 'TASK',
    updates: {
      title: 'Implement JWT rotation',
      description: 'Add automatic JWT rotation with configurable intervals.',
    },
    influences: [
      {
        entityId: 'dd-auth-456',
        entityType: 'DESIGN_DOC',
        reasoning: 'Auth design doc specifies rotation requirements',
        reasonType: 'derived',
      },
    ],
    approvals: [{ userId: 'user-1', decision: 'APPROVED', createdAt: '2026-04-10T12:00:00Z' }],
  },
  ...overrides,
});

describe('buildProposalRefinerPrompt', () => {
  it('includes proposal details in the prompt', () => {
    const result = buildProposalRefinerPrompt(makeInput());
    expect(result).toContain('prop-abc-123');
    expect(result).toContain('UPDATE');
    expect(result).toContain('PENDING');
    expect(result).toContain('task-xyz-789');
    expect(result).toContain('TASK');
  });

  it('includes proposed changes as JSON', () => {
    const result = buildProposalRefinerPrompt(makeInput());
    expect(result).toContain('Implement JWT rotation');
    expect(result).toContain('automatic JWT rotation');
  });

  it('includes influences', () => {
    const result = buildProposalRefinerPrompt(makeInput());
    expect(result).toContain('dd-auth-456');
    expect(result).toContain('DESIGN_DOC');
    expect(result).toContain('Auth design doc specifies rotation requirements');
    expect(result).toContain('Current Influences');
  });

  it('includes approval history', () => {
    const result = buildProposalRefinerPrompt(makeInput());
    expect(result).toContain('Approval History');
    expect(result).toContain('APPROVED');
  });

  it('includes update_proposal usage instructions with proposal ID', () => {
    const result = buildProposalRefinerPrompt(makeInput());
    expect(result).toContain('update_proposal');
    expect(result).toContain('prop-abc-123');
    expect(result).toContain('full replacement');
  });

  it('includes context section when relatedEntities are provided', () => {
    const result = buildProposalRefinerPrompt(
      makeInput({
        relatedEntities: [
          {
            displayName: 'Auth Service',
            entityType: 'SERVICE',
            entityId: 'svc-123',
            status: 'ACTIVE',
            relationship: 'related-to',
            reasoning: 'Authored by an agent during edge discovery',
          },
        ],
      }),
    );
    expect(result).toContain('## CONTEXT');
    expect(result).toContain('Auth Service');
    expect(result).toContain('[related-to]');
    expect(result).toContain('Authored by an agent during edge discovery');
  });

  it('omits context section when no relatedEntities, agentSessions, or proposals', () => {
    const result = buildProposalRefinerPrompt(makeInput());
    expect(result).not.toContain('## CONTEXT');
  });

  it('includes proposal history in context when provided', () => {
    const result = buildProposalRefinerPrompt(
      makeInput({
        proposals: [
          {
            id: 'prop-old-111',
            organizationId: 'org-1',
            projectId: 'proj-1',
            type: 'SINGLE' as const,
            action: 'CREATE' as const,
            status: 'APPROVED' as const,
            targetEntityId: 'task-xyz-789',
            targetEntityType: 'TASK' as const,
            updates: {},
            requestorId: 'user-1',
            approvals: [],
            requiredApprovals: 1,
            outOfDateStatus: 'NOT_APPLICABLE',
            reviewedFuture: null,
            createdAt: '2026-04-01T00:00:00Z',
            updatedAt: '2026-04-01T00:00:00Z',
          },
        ],
      }),
    );
    expect(result).toContain('Other proposals on this entity');
    expect(result).toContain('CREATE');
  });

  it('handles proposal with no influences or approvals', () => {
    const result = buildProposalRefinerPrompt(
      makeInput({
        proposal: {
          id: 'prop-minimal',
          action: 'CREATE',
          status: 'PENDING',
          targetEntityId: 'feat-1',
          targetEntityType: 'FEATURE',
          updates: { title: 'New feature' },
        },
      }),
    );
    expect(result).toContain('prop-minimal');
    expect(result).toContain('New feature');
    expect(result).not.toContain('Current Influences');
    expect(result).not.toContain('Approval History');
  });

  it('includes understanding proposal context section', () => {
    const result = buildProposalRefinerPrompt(makeInput());
    expect(result).toContain('Understanding Proposal Context');
    expect(result).toContain('get_full_entity');
  });

  it('does not re-embed ambient platform context — it rides on the additional system prompt', () => {
    const result = buildProposalRefinerPrompt(makeInput());
    expect(result).not.toContain('## Platform Context');
    expect(result).not.toContain('## Entity References (MANDATORY)');
    expect(result).not.toContain('## Link Discovery and Pruning');
  });

  it('includes behavior rules', () => {
    const result = buildProposalRefinerPrompt(makeInput());
    expect(result).toContain('BEHAVIOR — STRICT RULES');
    expect(result).toContain('Never respond with just an acknowledgement');
    expect(result).toContain('No auto-approval');
  });

  it('omits the structural-correction reflection rule', () => {
    const result = buildProposalRefinerPrompt(makeInput());
    expect(result).not.toContain('## Structural-Correction Reflection');
  });
});

it('snapshots the complete reconciliation prompt, including semantic choices and review-only submission', () => {
  const input = makeInput();
  input.proposal.reconciliation = {
    status: 'AGENT_FIX_REQUIRED',
    conflictingPaths: ['/sections/description'],
    currentBases: [
      {
        entityType: 'TASK',
        entityId: '10000000-0000-4000-8000-000000000001',
        version: 'current',
        content: { name: 'Current task', sections: { description: 'Intervening decision' } },
      },
    ],
    interveningProposals: [],
    overlaps: [],
    revisions: [],
  };
  expect(buildProposalRefinerPrompt(input)).toMatchSnapshot();
});
