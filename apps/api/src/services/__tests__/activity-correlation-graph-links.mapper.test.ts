import { ActivityCorrelationLinkType, EntityType } from 'src/generated';
import type { SearchResponse } from 'src/generated/graphs';
import { buildGraphLinkedEntitiesBySeed } from '../activity-correlation-graph-links.mapper';

describe('activity-correlation-graph-links.mapper', () => {
  it('groups linked entities by seed when seedResults are provided', () => {
    const seeds = [
      { entityId: 'task-1', entityType: EntityType.Task },
      { entityId: 'task-2', entityType: EntityType.Task },
    ];

    const response: SearchResponse = {
      results: [
        // Flat results are intentionally mixed; grouped results should drive mapping.
        {
          entityId: 'task-1-child',
          entityType: 'TASK' as any,
          node: { id: 'node-task-1-child' } as any,
          path: {
            depth: 1,
            nodeIds: ['node-task-1', 'node-task-1-child'],
            segments: [
              {
                type: 'HAS_TASK',
                direction: 'OUTGOING',
                sourceNodeId: 'node-task-1',
                targetNodeId: 'node-task-1-child',
              } as any,
            ],
          },
        },
        {
          entityId: 'task-2-child',
          entityType: 'TASK' as any,
          node: { id: 'node-task-2-child' } as any,
          path: {
            depth: 1,
            nodeIds: ['node-task-2', 'node-task-2-child'],
            segments: [
              {
                type: 'HAS_TASK',
                direction: 'OUTGOING',
                sourceNodeId: 'node-task-2',
                targetNodeId: 'node-task-2-child',
              } as any,
            ],
          },
        },
      ],
      seedResults: [
        {
          seedNodeId: 'node-task-1',
          results: [
            {
              entityId: 'task-1',
              entityType: 'TASK' as any,
              node: { id: 'node-task-1' } as any,
              path: {
                depth: 0,
                nodeIds: ['node-task-1'],
                segments: [],
              },
            },
            {
              entityId: 'task-1-child',
              entityType: 'TASK' as any,
              node: {
                id: 'node-task-1-child',
                properties: { status: 'ACTIVE' },
                updatedAt: '2026-03-01T10:10:00.000Z',
              } as any,
              path: {
                depth: 1,
                nodeIds: ['node-task-1', 'node-task-1-child'],
                segments: [
                  {
                    type: 'HAS_TASK',
                    direction: 'OUTGOING',
                    sourceNodeId: 'node-task-1',
                    targetNodeId: 'node-task-1-child',
                  } as any,
                ],
              },
            },
          ],
          relationships: [],
          totalElements: 2,
          totalPages: 1,
          page: 0,
          size: 2,
        },
        {
          seedNodeId: 'node-task-2',
          results: [
            {
              entityId: 'task-2',
              entityType: 'TASK' as any,
              node: { id: 'node-task-2' } as any,
              path: {
                depth: 0,
                nodeIds: ['node-task-2'],
                segments: [],
              },
            },
            {
              entityId: 'task-2-child',
              entityType: 'TASK' as any,
              node: {
                id: 'node-task-2-child',
                properties: { status: 'BACKLOG' },
                updatedAt: '2026-03-01T10:11:00.000Z',
              } as any,
              path: {
                depth: 1,
                nodeIds: ['node-task-2', 'node-task-2-child'],
                segments: [
                  {
                    type: 'HAS_TASK',
                    direction: 'OUTGOING',
                    sourceNodeId: 'node-task-2',
                    targetNodeId: 'node-task-2-child',
                  } as any,
                ],
              },
            },
          ],
          relationships: [],
          totalElements: 2,
          totalPages: 1,
          page: 0,
          size: 2,
        },
      ],
      relationships: [],
      totalElements: 4,
      totalPages: 1,
      page: 0,
      size: 4,
    };

    const linkedBySeed = buildGraphLinkedEntitiesBySeed(seeds, response);
    const seedOne = linkedBySeed.get('TASK:task-1') ?? [];
    const seedTwo = linkedBySeed.get('TASK:task-2') ?? [];

    expect(seedOne).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityId: 'task-1',
          entityType: EntityType.Task,
          linkType: ActivityCorrelationLinkType.Self,
        }),
        expect.objectContaining({
          entityId: 'task-1-child',
          entityType: EntityType.Task,
          linkType: ActivityCorrelationLinkType.Child,
          status: 'ACTIVE',
          updatedAt: '2026-03-01T10:10:00.000Z',
        }),
      ]),
    );
    expect(seedOne.some((linked) => linked.entityId === 'task-2-child')).toBe(
      false,
    );

    expect(seedTwo).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityId: 'task-2',
          entityType: EntityType.Task,
          linkType: ActivityCorrelationLinkType.Self,
        }),
        expect.objectContaining({
          entityId: 'task-2-child',
          entityType: EntityType.Task,
          linkType: ActivityCorrelationLinkType.Child,
          status: 'BACKLOG',
          updatedAt: '2026-03-01T10:11:00.000Z',
        }),
      ]),
    );
    expect(seedTwo.some((linked) => linked.entityId === 'task-1-child')).toBe(
      false,
    );
  });

  it('treats HAS_AGENT_SESSION as a hierarchical child link', () => {
    const seeds = [{ entityId: 'task-1', entityType: EntityType.Task }];

    const response: SearchResponse = {
      results: [],
      seedResults: [
        {
          seedNodeId: 'node-task-1',
          results: [
            {
              entityId: 'task-1',
              entityType: 'TASK' as any,
              node: { id: 'node-task-1' } as any,
              path: {
                depth: 0,
                nodeIds: ['node-task-1'],
                segments: [],
              },
            },
            {
              entityId: 'agent-session-1',
              entityType: 'AGENT_SESSION' as any,
              node: { id: 'node-session-1' } as any,
              path: {
                depth: 1,
                nodeIds: ['node-task-1', 'node-session-1'],
                segments: [
                  {
                    type: 'HAS_AGENT_SESSION',
                    direction: 'OUTGOING',
                    sourceNodeId: 'node-task-1',
                    targetNodeId: 'node-session-1',
                  } as any,
                ],
              },
            },
          ],
          relationships: [],
          totalElements: 2,
          totalPages: 1,
          page: 0,
          size: 2,
        },
      ],
      relationships: [],
      totalElements: 2,
      totalPages: 1,
      page: 0,
      size: 2,
    };

    const linkedBySeed = buildGraphLinkedEntitiesBySeed(seeds, response);
    expect(linkedBySeed.get('TASK:task-1')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityId: 'agent-session-1',
          entityType: EntityType.AgentSession,
          linkType: ActivityCorrelationLinkType.Child,
        }),
      ]),
    );
  });
});
