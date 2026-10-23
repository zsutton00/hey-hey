import { EdgeToolsProvider } from '../tools/edge-tools.provider';
import { AUTHORING_ROOT_PROOF } from '../tools/authoring-guidance';
import { AgentEdgeClientService } from '../../services/agent-edge-client.service';
import { EntityContextService } from '../../services/entity-context/entity-context.service';
import { GraphsClientService } from '../../services/graphs-client.service';
import { WorkItemTypeRegistryService } from '../../services/tasks/work-item-type-registry.service';
import { createWarmWorkItemTypeRegistry } from '../../../test/setup/work-item-type-registry.fixture';
import type { RelationshipType } from '../../generated/graphs/model/relationshipType';

const ORG_ID = '00000000-0000-4000-8000-000000000001';
const PROJECT_ID = '00000000-0000-4000-8000-000000000003';
const SESSION_ID = '00000000-0000-4000-8000-000000000030';
const SOURCE_NODE = '00000000-0000-4000-8000-000000000040';
const TARGET_NODE = '00000000-0000-4000-8000-000000000050';
const EDGE_ID = '00000000-0000-4000-8000-000000000060';

function makeUser() {
  return {
    userId: 'u1',
    email: 'test@example.com',
    name: 'Test',
    currentOrgId: ORG_ID,
    orgMemberships: [],
    isDevAdmin: false,
    devAdminMode: false,
  };
}

function makeRequest(
  opts: {
    projectId?: string;
    token?: string;
    sessionId?: string | null;
  } = {},
) {
  const sessionId =
    opts.sessionId === null ? undefined : (opts.sessionId ?? SESSION_ID);
  return {
    headers: {
      authorization: opts.token ? `Bearer ${opts.token}` : 'Bearer tok',
      ...(opts.projectId ? { 'x-project-id': opts.projectId } : {}),
      ...(sessionId ? { 'x-agent-session-id': sessionId } : {}),
    },
    cookies: {},
    user: makeUser(),
    ip: '127.0.0.1',
  } as any;
}

function makeEdge(overrides: Record<string, any> = {}) {
  return {
    id: EDGE_ID,
    sourceNodeId: SOURCE_NODE,
    targetNodeId: TARGET_NODE,
    type: 'RELATED_TO' as RelationshipType,
    reasoning: 'These tasks address the same domain',
    createdBySessionId: SESSION_ID,
    lastModifiedBySessionId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const mockClient = {
  create: jest.fn(),
  get: jest.fn(),
  list: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
} as unknown as jest.Mocked<AgentEdgeClientService>;

const mockEntityContextService = {
  getEdges: jest.fn(),
} as unknown as jest.Mocked<EntityContextService>;

const mockEntityRegistryService = {
  getEntitiesByIds: jest.fn(),
};

function createProvider(): EdgeToolsProvider {
  return new EdgeToolsProvider(
    mockClient,
    mockEntityContextService,
    mockEntityRegistryService as any,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockEntityRegistryService.getEntitiesByIds.mockResolvedValue([
    { entityId: SOURCE_NODE, entityType: 'TASK' },
    { entityId: TARGET_NODE, entityType: 'TASK' },
  ]);
});

describe('create_edge', () => {
  const validParams = {
    sourceNodeId: SOURCE_NODE,
    targetNodeId: TARGET_NODE,
    type: 'RELATED_TO' as const,
    reasoning: 'These tasks address the same domain',
    authoringRootProof: AUTHORING_ROOT_PROOF,
  };

  it('creates an edge and returns the result', async () => {
    const edge = makeEdge();
    mockClient.create.mockResolvedValue(edge);

    const provider = createProvider();
    const result = await provider.createEdge(
      validParams,
      {} as any,
      makeRequest({ projectId: PROJECT_ID }),
    );

    expect(result).toEqual({
      id: EDGE_ID,
      sourceNodeId: SOURCE_NODE,
      targetNodeId: TARGET_NODE,
      type: 'RELATED_TO',
      reasoning: 'These tasks address the same domain',
      createdBySessionId: SESSION_ID,
    });

    expect(mockClient.create).toHaveBeenCalledWith(
      ORG_ID,
      PROJECT_ID,
      {
        sourceNodeId: SOURCE_NODE,
        sourceEntityType: 'TASK',
        targetNodeId: TARGET_NODE,
        targetEntityType: 'TASK',
        type: 'RELATED_TO',
        reasoning: 'These tasks address the same domain',
        createdBySessionId: SESSION_ID,
      },
      'tok',
    );
  });

  it('returns error when no auth', async () => {
    const provider = createProvider();
    const result = await provider.createEdge(
      validParams,
      {} as any,
      { headers: {}, cookies: {}, user: undefined } as any,
    );

    expect(result).toEqual(expect.objectContaining({ isError: true }));
  });

  it('returns error when no projectId', async () => {
    const provider = createProvider();
    const result = await provider.createEdge(
      validParams,
      {} as any,
      makeRequest(),
    );

    expect(result).toEqual(expect.objectContaining({ isError: true }));
  });

  it('returns error on service failure', async () => {
    mockClient.create.mockRejectedValue(new Error('Graph service down'));

    const provider = createProvider();
    const result = await provider.createEdge(
      validParams,
      {} as any,
      makeRequest({ projectId: PROJECT_ID }),
    );

    expect(result).toEqual(expect.objectContaining({ isError: true }));
  });

  it('returns error when endpoint entity metadata cannot be resolved', async () => {
    mockEntityRegistryService.getEntitiesByIds.mockResolvedValue([
      { entityId: SOURCE_NODE, entityType: 'TASK' },
    ]);

    const provider = createProvider();
    const result = await provider.createEdge(
      validParams,
      {} as any,
      makeRequest({ projectId: PROJECT_ID }),
    );

    expect(result).toEqual(expect.objectContaining({ isError: true }));
    expect(mockClient.create).not.toHaveBeenCalled();
  });
});

describe('update_edge', () => {
  it('updates an edge type and reasoning', async () => {
    const updated = makeEdge({
      type: 'DEPENDS_ON',
      reasoning: 'Refined understanding',
      lastModifiedBySessionId: SESSION_ID,
    });
    mockClient.update.mockResolvedValue(updated);

    const provider = createProvider();
    const result = await provider.updateEdge(
      {
        edgeId: EDGE_ID,
        type: 'DEPENDS_ON' as const,
        reasoning: 'Refined understanding',
        authoringRootProof: AUTHORING_ROOT_PROOF,
      },
      {} as any,
      makeRequest({ projectId: PROJECT_ID }),
    );

    expect(result).toEqual({
      id: EDGE_ID,
      type: 'DEPENDS_ON',
      reasoning: 'Refined understanding',
      lastModifiedBySessionId: SESSION_ID,
    });
  });

  it('returns error when no update fields provided', async () => {
    const provider = createProvider();
    const result = await provider.updateEdge(
      { edgeId: EDGE_ID },
      {} as any,
      makeRequest({ projectId: PROJECT_ID }),
    );

    expect(result).toEqual(expect.objectContaining({ isError: true }));
    expect(mockClient.update).not.toHaveBeenCalled();
  });

  it('returns error on service failure', async () => {
    mockClient.update.mockRejectedValue(new Error('Not found'));

    const provider = createProvider();
    const result = await provider.updateEdge(
      {
        edgeId: EDGE_ID,
        type: 'DEPENDS_ON' as const,
        authoringRootProof: AUTHORING_ROOT_PROOF,
      },
      {} as any,
      makeRequest({ projectId: PROJECT_ID }),
    );

    expect(result).toEqual(expect.objectContaining({ isError: true }));
  });
});

describe('delete_edge', () => {
  it('deletes an edge', async () => {
    mockClient.delete.mockResolvedValue(undefined);

    const provider = createProvider();
    const result = await provider.deleteEdge(
      { edgeId: EDGE_ID, authoringRootProof: AUTHORING_ROOT_PROOF },
      {} as any,
      makeRequest({ projectId: PROJECT_ID }),
    );

    expect(result).toEqual({ deleted: true, edgeId: EDGE_ID });
    expect(mockClient.delete).toHaveBeenCalledWith(
      ORG_ID,
      PROJECT_ID,
      EDGE_ID,
      'tok',
      undefined,
    );
  });

  it('passes reason when provided', async () => {
    mockClient.delete.mockResolvedValue(undefined);

    const provider = createProvider();
    await provider.deleteEdge(
      {
        edgeId: EDGE_ID,
        reason: 'Incorrect connection',
        authoringRootProof: AUTHORING_ROOT_PROOF,
      },
      {} as any,
      makeRequest({ projectId: PROJECT_ID }),
    );

    expect(mockClient.delete).toHaveBeenCalledWith(
      ORG_ID,
      PROJECT_ID,
      EDGE_ID,
      'tok',
      'Incorrect connection',
    );
  });

  it('returns error on service failure', async () => {
    mockClient.delete.mockRejectedValue(new Error('Not found'));

    const provider = createProvider();
    const result = await provider.deleteEdge(
      { edgeId: EDGE_ID, authoringRootProof: AUTHORING_ROOT_PROOF },
      {} as any,
      makeRequest({ projectId: PROJECT_ID }),
    );

    expect(result).toEqual(expect.objectContaining({ isError: true }));
  });
});

describe('get_edges', () => {
  const SEED_A = '00000000-0000-4000-8000-0000000000a1';
  const SEED_NOEDGE = '00000000-0000-4000-8000-0000000000a2';
  const STALE = '00000000-0000-4000-8000-0000000000a3';
  const OTHER_TASK = '00000000-0000-4000-8000-0000000000b1';
  const OTHER_DOC = '00000000-0000-4000-8000-0000000000b2';

  let registry: WorkItemTypeRegistryService;
  beforeAll(async () => {
    registry = await createWarmWorkItemTypeRegistry();
  });

  function node(
    entityId: string,
    entityType: string,
    name: string,
    properties: Record<string, unknown> = {},
  ) {
    return {
      entityId,
      entityType,
      displayName: name,
      ...properties,
    };
  }

  function agentLinkedRel(overrides: Record<string, any> = {}) {
    return {
      id: 'rel-agent',
      type: 'AGENT_LINKED' as RelationshipType,
      sourceNodeId: SEED_A,
      targetNodeId: OTHER_TASK,
      properties: {
        id: 'edge-1',
        type: 'DEPENDS_ON',
        reasoning: 'A depends on the other task',
        createdBySessionId: SESSION_ID,
      },
      createdAt: '2026-01-02T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
      ...overrides,
    };
  }

  function influencesRel(overrides: Record<string, any> = {}) {
    return {
      id: 'rel-influence',
      type: 'INFLUENCES' as RelationshipType,
      sourceNodeId: OTHER_DOC,
      targetNodeId: SEED_A,
      properties: { reasonType: 'EVIDENCE' },
      createdAt: '2026-01-03T00:00:00.000Z',
      updatedAt: '2026-01-03T00:00:00.000Z',
      ...overrides,
    };
  }

  // Build a provider whose EntityContextService runs for real against a
  // mocked readIncidentEdges, so the full get_edges contract (endpoint
  // resolution, typed+influence co-existence, ordering, stale-ID
  // isolation) is exercised end to end.
  function providerWithIncidentEdges(
    readIncidentEdges: jest.Mock,
  ): EdgeToolsProvider {
    const graphsClient = {
      readIncidentEdges,
    } as unknown as GraphsClientService;
    const ctxService = new EntityContextService(
      { outgoing: jest.fn().mockResolvedValue([]) } as any,
      {} as any,
      graphsClient,
      registry,
      {} as any,
    );
    return new EdgeToolsProvider(
      mockClient,
      ctxService,
      mockEntityRegistryService as any,
    );
  }

  it('keys edges by entity, co-locates typed + influence edges in one bucket, ordered deterministically', async () => {
    const readIncidentEdges = jest.fn().mockResolvedValue({
      groups: [
        {
          seedEntityId: SEED_A,
          endpoints: [
            node(OTHER_TASK, 'TASK', 'Other Task', { taskType: 'CONTRACT' }),
            node(OTHER_DOC, 'DESIGN_DOC', 'Design Two'),
          ],
          relationships: [agentLinkedRel(), influencesRel()],
          neighborTotal: 2,
        },
      ],
    });

    const provider = providerWithIncidentEdges(readIncidentEdges);
    const result = (await provider.getEdges(
      { entities: [{ entityType: 'TASK', entityId: SEED_A }] },
      {} as any,
      makeRequest({ projectId: PROJECT_ID }),
    )) as { edgesByEntity: Record<string, any[]> };

    // 'in' sorts before 'out', so the inbound INFLUENCES edge comes first;
    // reasonType appears only on the influence edge.
    expect(result.edgesByEntity[SEED_A]).toEqual([
      {
        direction: 'in',
        edgeType: 'INFLUENCES',
        otherEndpoint: {
          entityType: 'DESIGN_DOC',
          entityId: OTHER_DOC,
          displayName: 'Design Two',
        },
        createdAt: '2026-01-03T00:00:00.000Z',
        reasonType: 'EVIDENCE',
      },
      {
        direction: 'out',
        edgeType: 'DEPENDS_ON',
        otherEndpoint: {
          entityType: 'TASK',
          entityId: OTHER_TASK,
          displayName: 'Other Task',
          taskType: 'CONTRACT',
        },
        createdAt: '2026-01-02T00:00:00.000Z',
      },
    ]);
    const typedEdge = result.edgesByEntity[SEED_A]?.[1];
    expect(typedEdge && 'reasonType' in typedEdge).toBe(false);
  });

  it('returns workflow-step Contract dependencies from either seeded endpoint', async () => {
    const dependency = agentLinkedRel({
      id: 'rel-contract-dependency',
      type: 'DEPENDS_ON' as RelationshipType,
      properties: {
        id: 'edge-contract-dependency',
        reasoning: 'The workflow step enforces the Contract',
      },
      createdAt: '2026-01-06T00:00:00.000Z',
      updatedAt: '2026-01-06T00:00:00.000Z',
    });
    const readIncidentEdges = jest.fn().mockResolvedValue({
      groups: [
        {
          seedEntityId: SEED_A,
          endpoints: [
            node(
              OTHER_TASK,
              'TASK',
              'Effective entity prompt template boundary',
              { taskType: 'CONTRACT' },
            ),
          ],
          relationships: [dependency],
          neighborTotal: 1,
        },
        {
          seedEntityId: OTHER_TASK,
          endpoints: [node(SEED_A, 'TASK', 'Expose effective template')],
          relationships: [dependency],
          neighborTotal: 1,
        },
      ],
    });

    const provider = providerWithIncidentEdges(readIncidentEdges);
    const result = (await provider.getEdges(
      {
        entities: [
          { entityType: 'workflow_step', entityId: SEED_A },
          { entityType: 'CONTRACT', entityId: OTHER_TASK },
        ],
      },
      {} as any,
      makeRequest({ projectId: PROJECT_ID }),
    )) as { edgesByEntity: Record<string, any[]> };

    expect(result.edgesByEntity).toEqual({
      [SEED_A]: [
        {
          direction: 'out',
          edgeType: 'DEPENDS_ON',
          otherEndpoint: {
            entityType: 'TASK',
            entityId: OTHER_TASK,
            displayName: 'Effective entity prompt template boundary',
            taskType: 'CONTRACT',
          },
          createdAt: '2026-01-06T00:00:00.000Z',
        },
      ],
      [OTHER_TASK]: [
        {
          direction: 'in',
          edgeType: 'DEPENDS_ON',
          otherEndpoint: {
            entityType: 'TASK',
            entityId: SEED_A,
            displayName: 'Expose effective template',
          },
          createdAt: '2026-01-06T00:00:00.000Z',
        },
      ],
    });
    expect(readIncidentEdges).toHaveBeenCalledTimes(1);
    expect(readIncidentEdges).toHaveBeenCalledWith(
      ORG_ID,
      PROJECT_ID,
      expect.objectContaining({
        seedEntityIds: [SEED_A, OTHER_TASK],
        relationshipTypes: expect.arrayContaining([
          'DEPENDS_ON',
          'INFLUENCES',
          'PROPOSED_TOGETHER',
        ]),
      }),
      'tok',
    );
  });

  it('surfaces workflow fulfillment and flow edge types through direct edge reads', async () => {
    const fulfilledRel = agentLinkedRel({
      id: 'rel-fulfilled',
      targetNodeId: OTHER_TASK,
      properties: {
        id: 'edge-fulfilled',
        type: 'FULFILLED_BY',
        reasoning: 'Workflow step implementation lives here',
      },
      createdAt: '2026-01-04T00:00:00.000Z',
      updatedAt: '2026-01-04T00:00:00.000Z',
    });
    const flowRel = agentLinkedRel({
      id: 'rel-flow',
      targetNodeId: OTHER_DOC,
      properties: {
        id: 'edge-flow',
        type: 'CONDITIONAL',
        reasoning: 'Predicate routes to this workflow step',
        createdBySessionId: SESSION_ID,
      },
      createdAt: '2026-01-05T00:00:00.000Z',
      updatedAt: '2026-01-05T00:00:00.000Z',
    });
    const readIncidentEdges = jest.fn().mockResolvedValue({
      groups: [
        {
          seedEntityId: SEED_A,
          endpoints: [
            node(OTHER_TASK, 'TASK', 'Implementation Task'),
            node(OTHER_DOC, 'TASK', 'Branch Step'),
          ],
          relationships: [fulfilledRel, flowRel],
          neighborTotal: 2,
        },
      ],
    });

    const provider = providerWithIncidentEdges(readIncidentEdges);
    const result = (await provider.getEdges(
      { entities: [{ entityType: 'TASK', entityId: SEED_A }] },
      {} as any,
      makeRequest({ projectId: PROJECT_ID }),
    )) as { edgesByEntity: Record<string, any[]> };

    expect(result.edgesByEntity[SEED_A]).toEqual([
      expect.objectContaining({
        edgeType: 'CONDITIONAL',
        otherEndpoint: expect.objectContaining({
          entityId: OTHER_DOC,
          displayName: 'Branch Step',
        }),
      }),
      expect.objectContaining({
        edgeType: 'FULFILLED_BY',
        otherEndpoint: expect.objectContaining({
          entityId: OTHER_TASK,
          displayName: 'Implementation Task',
        }),
      }),
    ]);
  });

  it('drops malformed edge relationships without dropping the seed bucket', async () => {
    const readIncidentEdges = jest.fn().mockResolvedValue({
      groups: [
        {
          seedEntityId: SEED_A,
          endpoints: [node(OTHER_TASK, 'TASK', 'Other Task')],
          relationships: [
            agentLinkedRel({
              id: undefined,
              properties: {
                type: 'DEPENDS_ON',
                reasoning: 'Missing id is malformed',
                createdBySessionId: SESSION_ID,
              },
            }),
          ],
          neighborTotal: 1,
        },
      ],
    });

    const provider = providerWithIncidentEdges(readIncidentEdges);
    const result = (await provider.getEdges(
      { entities: [{ entityType: 'TASK', entityId: SEED_A }] },
      {} as any,
      makeRequest({ projectId: PROJECT_ID }),
    )) as { edgesByEntity: Record<string, any[]> };

    expect(result.edgesByEntity).toEqual({ [SEED_A]: [] });
  });

  it('returns an empty array for a no-edge seed and for an unknown/stale id without poisoning the batch', async () => {
    const readIncidentEdges = jest.fn().mockResolvedValue({
      groups: [
        {
          seedEntityId: SEED_A,
          endpoints: [node(OTHER_TASK, 'TASK', 'Other Task')],
          relationships: [agentLinkedRel()],
          neighborTotal: 1,
        },
        // SEED_NOEDGE exists in the graph but has no incident edges.
        {
          seedEntityId: SEED_NOEDGE,
          endpoints: [],
          relationships: [],
          neighborTotal: 0,
        },
        // STALE returns no group at all.
      ],
    });

    const provider = providerWithIncidentEdges(readIncidentEdges);
    const result = (await provider.getEdges(
      {
        entities: [
          { entityType: 'TASK', entityId: SEED_A },
          { entityType: 'TASK', entityId: SEED_NOEDGE },
          { entityType: 'TASK', entityId: STALE },
        ],
      },
      {} as any,
      makeRequest({ projectId: PROJECT_ID }),
    )) as { edgesByEntity: Record<string, any[]> };

    expect(Object.keys(result.edgesByEntity).sort()).toEqual(
      [SEED_A, SEED_NOEDGE, STALE].sort(),
    );
    expect(result.edgesByEntity[SEED_A]).toHaveLength(1);
    expect(result.edgesByEntity[SEED_NOEDGE]).toEqual([]);
    expect(result.edgesByEntity[STALE]).toEqual([]);
  });

  it('errors clearly when more than ten entities are requested', async () => {
    const provider = createProvider();
    const entities = Array.from({ length: 11 }, (_, i) => ({
      entityType: 'TASK',
      entityId: `00000000-0000-4000-8000-0000000001${String(i).padStart(2, '0')}`,
    }));

    const result = await provider.getEdges(
      { entities },
      {} as any,
      makeRequest({ projectId: PROJECT_ID }),
    );

    expect(result).toEqual(expect.objectContaining({ isError: true }));
    expect(mockEntityContextService.getEdges).not.toHaveBeenCalled();
  });

  describe('response size budget', () => {
    const seeds = Array.from({ length: 4 }, (_, i) => ({
      entityType: 'TASK',
      entityId: `00000000-0000-4000-8000-0000000002${String(i).padStart(2, '0')}`,
    }));

    function bucket(edgeCount: number) {
      return Array.from({ length: edgeCount }, (_, i) => ({
        direction: 'out' as const,
        edgeType: 'RELATED_TO' as const,
        otherEndpoint: {
          entityType: 'TASK',
          entityId: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
          displayName: 'x'.repeat(100),
        },
        createdAt: '2026-01-01T00:00:00.000Z',
      }));
    }

    async function read(
      sizes: number[],
      requested: typeof seeds = seeds.slice(0, sizes.length),
    ) {
      mockEntityContextService.getEdges.mockResolvedValue(
        Object.fromEntries(
          requested.map(({ entityId }, i) => [entityId, bucket(sizes[i]!)]),
        ),
      );
      const result = (await createProvider().getEdges(
        { entities: requested },
        {} as any,
        makeRequest({ projectId: PROJECT_ID }),
      )) as {
        edgesByEntity: Record<string, unknown[]>;
        omittedEntities: Record<string, unknown>[];
      };
      return { result, length: JSON.stringify(result).length };
    }

    it('returns every seed whole and lists no omissions when under budget', async () => {
      const { result } = await read([2, 0, 3]);
      expect(Object.keys(result.edgesByEntity)).toEqual(
        seeds.slice(0, 3).map((seed) => seed.entityId),
      );
      expect(result.omittedEntities).toEqual([]);
    });

    it('names every seed that does not fit and keeps the rest out of edgesByEntity', async () => {
      const { result, length } = await read([60, 60, 60, 1]);
      expect(length).toBeLessThanOrEqual(32_000);
      expect(Object.keys(result.edgesByEntity)).toEqual([seeds[0]!.entityId]);
      expect(result.omittedEntities).toEqual(
        seeds.slice(1).map(({ entityType, entityId }) => ({
          omitted: true,
          reason: 'SIZE_BUDGET',
          entityType,
          entityId,
        })),
      );

      const retry = await read([60, 60, 1], seeds.slice(1));
      expect(Object.keys(retry.result.edgesByEntity)).toEqual([
        seeds[1]!.entityId,
      ]);
      expect(retry.result.omittedEntities).toHaveLength(2);
    });

    it('returns an oversized first seed whole and omits the rest', async () => {
      const { result } = await read([300, 1]);
      expect(result.edgesByEntity[seeds[0]!.entityId]).toHaveLength(300);
      expect(result.omittedEntities).toHaveLength(1);
    });

    it('does not mistake an omitted seed for one with no edges', async () => {
      const { result } = await read([200, 0]);
      expect(result.edgesByEntity[seeds[1]!.entityId]).toBeUndefined();
      expect(result.omittedEntities.map((o) => o['entityId'])).toEqual([
        seeds[1]!.entityId,
      ]);
    });
  });

  it('returns error when no auth', async () => {
    const provider = createProvider();
    const result = await provider.getEdges(
      { entities: [{ entityType: 'TASK', entityId: SEED_A }] },
      {} as any,
      { headers: {}, cookies: {}, user: undefined } as any,
    );

    expect(result).toEqual(expect.objectContaining({ isError: true }));
  });
});
