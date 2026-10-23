import { performance } from 'node:perf_hooks';
import { mergeMap, of, throwError, timer } from 'rxjs';
import { AgentEdgeEndpointEntityType } from 'src/generated/graphs/model/agentEdgeEndpointEntityType';
import { AgentEdgeType } from 'src/generated/graphs/model/agentEdgeType';
import type { CreateAgentEdgeDto } from 'src/generated/graphs/model/createAgentEdgeDto';
import type { OrganizationId, ProjectId } from 'src/types';
import {
  AGENT_EDGE_BATCH_SIZE,
  AgentEdgeClientService,
} from '../agent-edge-client.service';

const GRAPH_LATENCY_MS = 2;
const EDGE_COUNTS = [1, 10, 50, 51, 100];

type Scenario = 'success' | 'mixed-failure';

interface Measurement {
  scenario: Scenario;
  edgeCount: number;
  serialRequests: number;
  batchRequests: number;
  serialElapsedMs: number;
  batchElapsedMs: number;
}

interface GenericChangeSetMeasurement {
  edgeCount: number;
  serialRequests: number;
  batchRequests: number;
  serialElapsedMs: number;
  batchElapsedMs: number;
}

describe('proposal edge materialization benchmark', () => {
  it('records serial and bounded-batch request counts and elapsed time', async () => {
    const measurements: Measurement[] = [];
    for (const scenario of ['success', 'mixed-failure'] as const) {
      for (const edgeCount of EDGE_COUNTS) {
        measurements.push(await measureScenario(scenario, edgeCount));
      }
    }

    for (const measurement of measurements) {
      expect(measurement.serialRequests).toBe(measurement.edgeCount);
      expect(measurement.batchRequests).toBe(
        Math.ceil(measurement.edgeCount / AGENT_EDGE_BATCH_SIZE),
      );
    }

    console.table(measurements);
  });

  it('records generic change-set create and publication verification costs', async () => {
    const measurements: GenericChangeSetMeasurement[] = [];
    for (const edgeCount of EDGE_COUNTS) {
      measurements.push(await measureGenericChangeSet(edgeCount));
    }

    for (const measurement of measurements) {
      expect(measurement.serialRequests).toBe(measurement.edgeCount * 4);
      expect(measurement.batchRequests).toBe(
        Math.ceil(measurement.edgeCount / AGENT_EDGE_BATCH_SIZE) * 2,
      );
    }

    console.table(measurements);
  });
});

async function measureGenericChangeSet(
  edgeCount: number,
): Promise<GenericChangeSetMeasurement> {
  const dtos = createDtos('success', edgeCount);
  const serialEdges = new Map<string, ReturnType<typeof edgeFor>>();
  const serialTransport = {
    getAgentEdge: jest.fn((_org: string, _project: string, edgeId: string) =>
      timer(GRAPH_LATENCY_MS).pipe(
        mergeMap(() => {
          const edge = serialEdges.get(edgeId);
          return edge
            ? of({ data: edge })
            : throwError(() => ({ response: { status: 404 } }));
        }),
      ),
    ),
    createAgentEdge: jest.fn(
      (_org: string, _project: string, dto: CreateAgentEdgeDto) =>
        timer(GRAPH_LATENCY_MS).pipe(
          mergeMap(() => {
            const edge = edgeFor(dto);
            serialEdges.set(dto.id!, edge);
            return of({ data: edge });
          }),
        ),
    ),
  };
  const serialClient = new AgentEdgeClientService(
    serialTransport as never,
    createPrisma() as never,
  );
  const serialStarted = performance.now();
  for (const dto of dtos) {
    try {
      await serialClient.get(
        'org-1' as OrganizationId,
        'project-1' as ProjectId,
        dto.id!,
        'token-1',
      );
    } catch {
      // A missing edge is the expected precondition for a new relationship.
    }
    await serialClient.create(
      'org-1' as OrganizationId,
      'project-1' as ProjectId,
      dto,
      'token-1',
    );
    await serialClient.get(
      'org-1' as OrganizationId,
      'project-1' as ProjectId,
      dto.id!,
      'token-1',
    );
  }
  for (const dto of dtos) {
    await serialClient.get(
      'org-1' as OrganizationId,
      'project-1' as ProjectId,
      dto.id!,
      'token-1',
    );
  }
  const serialElapsedMs = performance.now() - serialStarted;

  const batchEdges = new Map<string, ReturnType<typeof edgeFor>>();
  const batchTransport = {
    createAgentEdgesBatch: jest.fn(
      (
        _org: string,
        _project: string,
        request: { edges: CreateAgentEdgeDto[] },
      ) =>
        timer(GRAPH_LATENCY_MS).pipe(
          mergeMap(() => {
            const results = request.edges.map((dto, index) => {
              const edge = edgeFor(dto);
              batchEdges.set(dto.id!, edge);
              return { index, success: true, edge };
            });
            return of({ data: { results } });
          }),
        ),
    ),
    findIncidentAgentEdges: jest.fn(() =>
      timer(GRAPH_LATENCY_MS).pipe(
        mergeMap(() => of({ data: [...batchEdges.values()] })),
      ),
    ),
  };
  const batchClient = new AgentEdgeClientService(
    batchTransport as never,
    createPrisma() as never,
  );
  const batchStarted = performance.now();
  await batchClient.createBatch(
    'org-1' as OrganizationId,
    'project-1' as ProjectId,
    dtos,
    'token-1',
  );
  for (let offset = 0; offset < dtos.length; offset += AGENT_EDGE_BATCH_SIZE) {
    const chunk = dtos.slice(offset, offset + AGENT_EDGE_BATCH_SIZE);
    await batchClient.findIncident(
      'org-1' as OrganizationId,
      'project-1' as ProjectId,
      {
        nodeIds: new Set(
          chunk.flatMap((dto) => [dto.sourceNodeId, dto.targetNodeId]),
        ),
        types: new Set(chunk.map((dto) => dto.type)),
      },
      'token-1',
    );
  }
  const batchElapsedMs = performance.now() - batchStarted;

  return {
    edgeCount,
    serialRequests:
      serialTransport.getAgentEdge.mock.calls.length +
      serialTransport.createAgentEdge.mock.calls.length,
    batchRequests:
      batchTransport.createAgentEdgesBatch.mock.calls.length +
      batchTransport.findIncidentAgentEdges.mock.calls.length,
    serialElapsedMs: Number(serialElapsedMs.toFixed(2)),
    batchElapsedMs: Number(batchElapsedMs.toFixed(2)),
  };
}

async function measureScenario(
  scenario: Scenario,
  edgeCount: number,
): Promise<Measurement> {
  const dtos = createDtos(scenario, edgeCount);
  const serialTransport = {
    createAgentEdge: jest.fn(
      (_org: string, _project: string, dto: CreateAgentEdgeDto) => {
        const response = { data: edgeFor(dto) };
        return shouldFail(dto)
          ? timer(GRAPH_LATENCY_MS).pipe(
              mergeMap(() => throwError(() => new Error('mixed failure'))),
            )
          : timer(GRAPH_LATENCY_MS).pipe(mergeMap(() => of(response)));
      },
    ),
  };
  const serialClient = new AgentEdgeClientService(
    serialTransport as never,
    createPrisma() as never,
  );
  const serialStarted = performance.now();
  for (const dto of dtos) {
    try {
      await serialClient.create(
        'org-1' as OrganizationId,
        'project-1' as ProjectId,
        dto,
        'token-1',
      );
    } catch {
      // Existing materialization records the failure and continues serially.
    }
  }
  const serialElapsedMs = performance.now() - serialStarted;

  const batchTransport = {
    createAgentEdgesBatch: jest.fn(
      (
        _org: string,
        _project: string,
        request: { edges: CreateAgentEdgeDto[] },
      ) =>
        timer(GRAPH_LATENCY_MS).pipe(
          mergeMap(() =>
            of({
              data: {
                results: request.edges.map(
                  (dto: CreateAgentEdgeDto, index: number) =>
                    shouldFail(dto)
                      ? { index, success: false, error: 'mixed failure' }
                      : { index, success: true, edge: edgeFor(dto) },
                ),
              },
            }),
          ),
        ),
    ),
  };
  const batchClient = new AgentEdgeClientService(
    batchTransport as never,
    createPrisma() as never,
  );
  const batchStarted = performance.now();
  await batchClient.createBatch(
    'org-1' as OrganizationId,
    'project-1' as ProjectId,
    dtos,
    'token-1',
  );
  const batchElapsedMs = performance.now() - batchStarted;

  return {
    scenario,
    edgeCount,
    serialRequests: serialTransport.createAgentEdge.mock.calls.length,
    batchRequests: batchTransport.createAgentEdgesBatch.mock.calls.length,
    serialElapsedMs: Number(serialElapsedMs.toFixed(2)),
    batchElapsedMs: Number(batchElapsedMs.toFixed(2)),
  };
}

function createDtos(
  scenario: Scenario,
  edgeCount: number,
): CreateAgentEdgeDto[] {
  return Array.from({ length: edgeCount }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    sourceNodeId: `00000000-0000-4000-9000-${String(index).padStart(12, '0')}`,
    sourceEntityType: AgentEdgeEndpointEntityType.Task,
    targetNodeId: `00000000-0000-4000-a000-${String(index).padStart(12, '0')}`,
    targetEntityType: AgentEdgeEndpointEntityType.Task,
    type: AgentEdgeType.RelatedTo,
    reasoning:
      scenario === 'mixed-failure' && index % 4 === 0
        ? `fail-${index}`
        : `success-${index}`,
  }));
}

function shouldFail(dto: CreateAgentEdgeDto): boolean {
  return dto.reasoning.startsWith('fail-');
}

function edgeFor(dto: CreateAgentEdgeDto) {
  return {
    id: dto.id,
    sourceNodeId: dto.sourceNodeId,
    sourceEntityType: dto.sourceEntityType,
    targetNodeId: dto.targetNodeId,
    targetEntityType: dto.targetEntityType,
    type: dto.type,
    reasoning: dto.reasoning,
    createdAt: '2026-09-21T00:00:00.000Z',
    updatedAt: '2026-09-21T00:00:00.000Z',
  };
}

function createPrisma() {
  const tx = {
    task: { findMany: jest.fn().mockResolvedValue([]) },
    workItemTypeCascadeExecution: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
    workItemChangeSetMaterialization: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
  return {
    db: {
      ...tx,
      $transaction: jest.fn(
        async (callback: (transaction: typeof tx) => unknown) => callback(tx),
      ),
    },
  };
}
