import { describe, expect, it } from 'vitest';
import type {
  FullEntityContextDto,
  ContextRelatedEntityDto,
  ContextProposalSummaryDto,
} from '../../shared/api/generated';
import { contextCandidates } from './context-candidates';

// Representative canonical rows from the task's loaded context, with overlapping routes.
const context = {
  entityId: 'focal',
  entityType: 'TASK',
  displayName: 'Convert candidates',
  createdAt: '2026-11-01T08:18:47.553Z',
  relatedEntities: [
    {
      entityId: 'design',
      entityType: 'DESIGN_DOC',
      displayName: 'Neighbourhood',
      status: 'READY',
      relationship: 'derives-from',
      source: 'agent',
      reasoning: 'Implements the candidate shape.',
    },
    {
      entityId: 'design',
      entityType: 'DESIGN_DOC',
      displayName: 'Neighbourhood',
      status: 'READY',
      relationship: 'mentions',
      source: 'system',
    },
    {
      entityId: 'focal',
      entityType: 'TASK',
      displayName: 'Convert candidates',
      relationship: 'mentions',
      source: 'system',
    },
  ] satisfies [ContextRelatedEntityDto, ...ContextRelatedEntityDto[]],
  featureHierarchy: [
    {
      id: 'parent',
      name: 'Project Assistant',
      relationshipType: 'structural',
      relationship: 'ancestor',
      distance: 1,
      description: 'Bootstrap research agent.',
    },
    {
      id: 'peer',
      name: 'Context',
      relationshipType: 'DEPENDS_ON',
      source: 'agent',
      direction: 'inbound',
      reasoning: 'Uses this projection.',
    },
    { id: 'peer', name: 'Context', relationshipType: 'PROPOSED_TOGETHER' },
  ],
  proposals: [
    {
      id: 'proposal',
      organizationId: 'org',
      projectId: 'project',
      type: 'SINGLE',
      action: 'UPDATE',
      status: 'APPROVED',
      targetEntityId: 'focal',
      targetEntityType: 'TASK',
      title: 'Convert candidates',
      eli5: 'Pure converters for Jev.',
      requestorId: 'user',
      requiredApprovals: 1,
      approvals: [],
      changes: [],
      createdAt: '2026-11-01T08:18:47.553Z',
      updatedAt: '2026-11-01T08:18:47.553Z',
      influences: [
        {
          entityId: 'design',
          entityType: 'DESIGN_DOC',
          entityTitle: 'Neighbourhood',
          reasoning: 'Origin material.',
          reasonType: 'derived',
        },
        {
          entityId: 'design',
          entityType: 'DESIGN_DOC',
          entityTitle: 'Neighbourhood',
          reasoning: 'Conversation origin.',
          reasonType: 'origin',
        },
      ],
    },
  ] satisfies [ContextProposalSummaryDto],
  agentSessions: [
    {
      entityId: 'session',
      entityType: 'AGENT_SESSION',
      displayName: 'Prior run',
      status: 'IN_PROGRESS',
    },
  ],
} satisfies FullEntityContextDto;

describe('contextCandidates', () => {
  it('excludes reports from related entries, proposal targets and influences', () => {
    const result = contextCandidates({
      ...context,
      relatedEntities: [
        ...context.relatedEntities,
        {
          entityId: 'related-report',
          entityType: 'REPORT',
          displayName: 'Prior report',
          relationship: 'related-to',
          source: 'system',
        },
      ],
      proposals: [
        ...context.proposals,
        {
          ...context.proposals[0],
          id: 'report-proposal',
          targetEntityId: 'target-report',
          targetEntityType: 'REPORT',
          influences: [
            {
              entityId: 'influence-report',
              entityType: 'REPORT',
              entityTitle: 'Prior report',
              reasoning: 'Prior findings.',
              reasonType: 'derived',
            },
          ],
        },
      ],
    });

    expect(result).toEqual(contextCandidates(context));
  });

  it('merges routes without losing labels, reasons, purposes or original positions', () => {
    const original = structuredClone(context);
    const result = contextCandidates(context);
    expect(result.map(({ id }) => id)).toEqual(['parent', 'peer', 'design']);
    expect(result.find(({ id }) => id === 'design')).toEqual({
      id: 'design',
      type: 'DESIGN_DOC',
      title: 'Neighbourhood',
      status: 'READY',
      relationships: [
        {
          label: 'derives-from',
          source: 'agent',
          provenance: { section: 'relatedEntities', position: 0 },
        },
        {
          label: 'mentions',
          source: 'system',
          provenance: { section: 'relatedEntities', position: 1 },
        },
        {
          label: 'derived',
          source: 'agent',
          provenance: {
            section: 'proposals',
            proposalId: 'proposal',
            role: 'influence',
            position: 0,
          },
        },
        {
          label: 'origin',
          source: 'system',
          provenance: {
            section: 'proposals',
            proposalId: 'proposal',
            role: 'influence',
            position: 1,
          },
        },
      ],
      context: {
        reasoning: ['Implements the candidate shape.', 'Origin material.', 'Conversation origin.'],
        proposalPurpose: ['Pure converters for Jev.'],
      },
    });
    expect(result[0]).toMatchObject({
      id: 'parent',
      context: { truncatedDescription: ['Bootstrap research agent.'] },
      relationships: [
        {
          label: 'ancestor',
          source: 'system',
          provenance: { section: 'featureHierarchy', position: 0 },
        },
      ],
    });
    expect(result[1]?.relationships).toMatchObject([
      { label: 'DEPENDS_ON', source: 'agent', direction: 'inbound' },
      { label: 'PROPOSED_TOGETHER', source: 'system' },
    ]);
    expect(context).toEqual(original);
  });

  it('preserves proposal targets without borrowing proposal status or inventing optional context', () => {
    const proposal: ContextProposalSummaryDto = { ...context.proposals[0] };
    delete proposal.eli5;
    const result = contextCandidates({
      ...context,
      featureHierarchy: [],
      relatedEntities: [],
      proposals: [{ ...proposal, targetEntityId: 'target', influences: [] }],
    });
    expect(result).toEqual([
      {
        id: 'target',
        type: 'TASK',
        title: 'Convert candidates',
        relationships: [
          {
            label: 'proposal-target',
            source: 'system',
            provenance: { section: 'proposals', proposalId: 'proposal', role: 'target' },
          },
        ],
      },
    ]);
    expect(
      contextCandidates({ ...context, featureHierarchy: [], relatedEntities: [], proposals: [] }),
    ).toEqual([]);
  });

  it('does not resurrect archived entities or sessions through proposal influences', () => {
    const result = contextCandidates({
      ...context,
      relatedEntities: [{ ...context.relatedEntities[0], status: 'ARCHIVED' }],
      proposals: [
        {
          ...context.proposals[0],
          influences: [
            {
              entityId: 'session',
              entityType: 'AGENT_SESSION',
              entityTitle: 'Run',
              reasoning: 'Prior run',
              reasonType: 'derived',
            },
            ...context.proposals[0].influences,
          ],
        },
      ],
    });
    expect(result.map(({ id }) => id)).toEqual(['parent', 'peer']);
  });
});
