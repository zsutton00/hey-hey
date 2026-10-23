import type { WorkItemGraphParticipationEntry } from 'src/generated';
import {
  hasTaskParticipationEndpoints,
  WorkItemGraphParticipationComposer,
  mergeParticipationEvidence,
} from '../work-item-graph-participation';
import { AgentEdgeEndpointEntityType } from 'src/generated/graphs/model/agentEdgeEndpointEntityType';

const entry = (
  evidenceId: string,
  diagramId: string,
): WorkItemGraphParticipationEntry => ({
  contract: {
    entityType: 'TASK',
    entityId: '11111111-1111-1111-1111-111111111111',
    title: 'Promise',
  },
  sourceDiagram: { entityType: 'TASK', entityId: diagramId, title: 'Diagram' },
  displayedAnchor: {
    entityType: 'TASK',
    entityId: diagramId,
    title: 'Diagram',
  },
  participant: {
    entityType: 'TASK',
    entityId: '22222222-2222-2222-2222-222222222222',
    title: 'Provider boundary',
  },
  responsibility: 'GUARANTEES',
  relationship: {
    evidenceId,
    semanticType: 'GUARANTEES',
    sourceEntityId: '22222222-2222-2222-2222-222222222222',
    sourceEntityType: 'TASK',
    targetEntityId: '11111111-1111-1111-1111-111111111111',
    targetEntityType: 'TASK',
    direction: 'source-to-target',
    label: 'GUARANTEES',
    description: null,
    reason: 'Owns the durable response promise.',
  },
  provenance: [
    {
      queryReference: { entityType: 'TASK', entityId: diagramId },
      pathDiagramIds: [diagramId],
      pathElementIds: ['22222222-2222-2222-2222-222222222222'],
      derived: false,
    },
  ],
});

describe('mergeParticipationEvidence', () => {
  it('deduplicates stable persisted evidence while retaining repeated-path provenance', () => {
    const first = entry(
      '33333333-3333-3333-3333-333333333333',
      '44444444-4444-4444-4444-444444444444',
    );
    const repeated = entry(
      '33333333-3333-3333-3333-333333333333',
      '44444444-4444-4444-4444-444444444444',
    );
    repeated.provenance[0]!.pathDiagramIds.push(
      '55555555-5555-5555-5555-555555555555',
    );

    const result = mergeParticipationEvidence([repeated, first, first]);

    expect(result).toHaveLength(1);
    expect(result[0]?.relationship.reason).toBe(
      'Owns the durable response promise.',
    );
    expect(result[0]?.provenance).toHaveLength(2);
  });

  it('orders distinct evidence by stable edge identity', () => {
    const later = entry(
      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      '44444444-4444-4444-4444-444444444444',
    );
    const earlier = entry(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      '44444444-4444-4444-4444-444444444444',
    );

    expect(
      mergeParticipationEvidence([later, earlier]).map(
        (value) => value.relationship.evidenceId,
      ),
    ).toEqual([earlier.relationship.evidenceId, later.relationship.evidenceId]);
  });
});

describe('hasTaskParticipationEndpoints', () => {
  const persistedEdge = {
    id: '33333333-3333-3333-3333-333333333333',
    sourceNodeId: '22222222-2222-2222-2222-222222222222',
    targetNodeId: '11111111-1111-1111-1111-111111111111',
    type: 'GUARANTEES',
    reasoning: 'Owns the durable response promise.',
    createdAt: '2026-09-15T00:00:00.000Z',
    updatedAt: '2026-09-15T00:00:00.000Z',
  } as const;

  it('accepts historical incident responses whose optional endpoint types are omitted', () => {
    expect(hasTaskParticipationEndpoints(persistedEdge)).toBe(true);
  });

  it('rejects an explicitly non-task endpoint', () => {
    expect(
      hasTaskParticipationEndpoints({
        ...persistedEdge,
        sourceEntityType: AgentEdgeEndpointEntityType.Service,
        targetEntityType: AgentEdgeEndpointEntityType.Task,
      }),
    ).toBe(false);
  });
});

describe('WorkItemGraphParticipationComposer', () => {
  it('rejects criteria outside the bounded authoritative evidence family', async () => {
    const owner = new WorkItemGraphParticipationComposer(
      {} as never,
      {} as never,
    );

    await expect(
      owner.compose(
        '88888888-8888-8888-8888-888888888888' as never,
        '99999999-9999-9999-9999-999999999999' as never,
        '44444444-4444-4444-4444-444444444444',
        ['RELATED_TO'] as never,
        'token',
      ),
    ).rejects.toThrow(
      'incidentRelationshipTypes must contain 1 to 3 unique supported relationship types',
    );
  });

  it('hydrates all displayed placements for a requested Diagram root', async () => {
    const diagramId = '44444444-4444-4444-4444-444444444444';
    const placementId = '22222222-2222-2222-2222-222222222222';
    const siblingId = '66666666-6666-6666-6666-666666666666';
    const serviceId = '77777777-7777-7777-7777-777777777777';
    const contractId = '11111111-1111-1111-1111-111111111111';
    const findMany = jest
      .fn()
      .mockResolvedValueOnce([
        {
          id: diagramId,
          name: 'Peer diagram',
          type: 'DIAGRAM',
          parentTaskId: null,
        },
        {
          id: contractId,
          name: 'Promise',
          type: 'CONTRACT',
          parentTaskId: null,
        },
      ])
      .mockResolvedValueOnce([{ id: serviceId, name: 'Canonical service' }])
      .mockResolvedValueOnce([
        {
          id: placementId,
          name: 'Service placement',
          parentTaskId: diagramId,
          sections: [
            {
              materializedMarkdown: JSON.stringify({
                canonicalReference: {
                  entityType: 'SERVICE',
                  entityId: serviceId,
                },
              }),
            },
          ],
        },
        {
          id: siblingId,
          name: 'Unrelated sibling',
          parentTaskId: diagramId,
          sections: [],
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: serviceId, name: 'Canonical service' }]);
    const edges = { findIncident: jest.fn().mockResolvedValue([]) };
    const owner = new WorkItemGraphParticipationComposer(
      { db: { task: { findMany }, service: { findMany } } } as never,
      edges as never,
    );

    await owner.compose(
      '88888888-8888-8888-8888-888888888888' as never,
      '99999999-9999-9999-9999-999999999999' as never,
      diagramId,
      ['GUARANTEES', 'IMPLEMENTS', 'CONSUMES'],
      'token',
    );

    expect(edges.findIncident).toHaveBeenCalledTimes(1);
    expect([...edges.findIncident.mock.calls[0][2].nodeIds]).toEqual([
      placementId,
      siblingId,
    ]);
    expect([...edges.findIncident.mock.calls[0][2].types]).toEqual([
      'GUARANTEES',
      'IMPLEMENTS',
      'CONSUMES',
    ]);
  });
});
