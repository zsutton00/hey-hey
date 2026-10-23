/**
 * Opt-in end-to-end benchmark. It uses rollback-only PostgreSQL fixtures and a
 * real loopback Graph service; Graph edge cleanup runs after every sample.
 */
import { HttpService } from '@nestjs/axios';
import { Logger } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import axios from 'axios';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { AgentEdgesService } from 'src/generated/graphs/api/agentEdges.service';
import { Configuration } from 'src/generated/graphs/configuration';
import { AgentEdgeCategory } from 'src/generated/graphs/model/agentEdgeCategory';
import { AgentEdgeEndpointEntityType } from 'src/generated/graphs/model/agentEdgeEndpointEntityType';
import type { OrganizationId, ProjectId } from 'src/types';
import { AgentEdgeClientService } from '../../agent-edge-client.service';
import {
  type MaterializableEdge,
  PendingEdgeService,
} from '../pending-edge.service';
import { WorkItemChangeSetMaterializerService } from '../work-item-change-set-materializer.service';

function reconciliationStub(completedEffects = new Set<string>()) {
  return {
    guardTaskEffect: jest.fn(
      async (
        _tx: unknown,
        _proposal: unknown,
        materializationId: string,
        taskId: string,
        operationIndex: number,
        _creates: boolean,
        write: () => Promise<unknown>,
      ) => {
        const key = `${materializationId}:${taskId}:${operationIndex}`;
        if (completedEffects.has(key)) return;
        const result = await write();
        completedEffects.add(key);
        return result;
      },
    ),
    recordEdgeEffect: jest.fn(),
    reviewedEdgeBasis: jest.fn().mockResolvedValue({ version: '' }),
    edgeBasis: jest.fn().mockResolvedValue({ version: '' }),
    publishTaskEffects: jest.fn(
      async (
        _tx: unknown,
        _proposal: unknown,
        _materializationId: string,
        write: () => Promise<unknown>,
      ) => write(),
    ),
  } as never;
}

const enabled = process.env.GRAPH_EDGE_MATERIALIZATION_BENCHMARK === '1';
const run = enabled ? describe : describe.skip;
const EDGE_COUNTS = [1, 5, 9, 25];

type Scenario = 'success' | 'mixed-failure';

run('real Graph edge materialization benchmark', () => {
  it('measures both proposal materializers with real Graph persistence', async () => {
    const databaseUrl = process.env.PROJECT_DATABASE_URL;
    const graphUrl = process.env.GRAPH_SERVICE_URL;
    const token = process.env.GRAPH_EDGE_MATERIALIZATION_BENCHMARK_TOKEN;
    if (!databaseUrl || !graphUrl || !token) {
      throw new Error(
        'Set PROJECT_DATABASE_URL, GRAPH_SERVICE_URL and GRAPH_EDGE_MATERIALIZATION_BENCHMARK_TOKEN.',
      );
    }
    for (const url of [databaseUrl, graphUrl]) {
      if (
        !['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname)
      ) {
        throw new Error('Benchmark dependencies must be loopback services.');
      }
    }

    Logger.overrideLogger(false);
    const prismaClient = new PrismaClient({
      log: [{ emit: 'event', level: 'query' }],
    });
    let databaseStatements = 0;
    prismaClient.$on('query', () => databaseStatements++);
    const measurements: Array<Record<string, string | number>> = [];
    const rollback = new Error('benchmark rollback');
    try {
      await prismaClient.$transaction(
        async (tx) => {
          const organizationId = randomUUID() as OrganizationId;
          const projectId = randomUUID() as ProjectId;
          await tx.organization.create({
            data: {
              id: organizationId,
              name: 'Graph benchmark',
              slug: randomUUID(),
            },
          });
          await tx.project.create({
            data: { id: projectId, organizationId, name: 'Graph benchmark' },
          });

          const prisma = rollbackOnlyPrisma(tx);
          const graphApi = new AgentEdgesService(
            new HttpService(axios.create()),
            new Configuration({ basePath: graphUrl }),
          );
          const graphClient = new AgentEdgeClientService(
            graphApi,
            prisma as never,
          );
          const pending = new PendingEdgeService(
            prisma as never,
            graphClient,
            {} as never,
            () => token,
          );
          const materializer = new WorkItemChangeSetMaterializerService(
            prisma as never,
            {} as never,
            {} as never,
            graphClient,
            {} as never,
            () => token,
            reconciliationStub(),
            {} as any,
            pending,
            { extractAndValidate: async () => [] } as never,
          );

          for (const scenario of ['success', 'mixed-failure'] as const) {
            for (const edgeCount of EDGE_COUNTS) {
              measurements.push(
                await measurePending({
                  pending,
                  graphClient,
                  organizationId,
                  projectId,
                  scenario,
                  edgeCount,
                  token,
                }),
              );
              measurements.push(
                await measureChangeSet({
                  tx,
                  prismaStatements: () => databaseStatements,
                  materializer,
                  graphClient,
                  organizationId,
                  projectId,
                  scenario,
                  edgeCount,
                  token,
                }),
              );
            }
          }
          throw rollback;
        },
        { timeout: 180000 },
      );
    } catch (error) {
      if (error !== rollback) throw error;
    } finally {
      await prismaClient.$disconnect();
    }

    console.table(measurements);
    expect(measurements).toHaveLength(EDGE_COUNTS.length * 4);
  }, 200000);
});

async function measurePending(params: {
  pending: PendingEdgeService;
  graphClient: AgentEdgeClientService;
  organizationId: OrganizationId;
  projectId: ProjectId;
  scenario: Scenario;
  edgeCount: number;
  token: string;
}): Promise<Record<string, string | number>> {
  const edges = benchmarkEdges(params.scenario, params.edgeCount);
  const timingLog = captureTiming(
    params.pending as never,
    'Proposal edge materialization timing',
  );
  const startedAt = performance.now();
  try {
    await params.pending.materializeEdges(
      params.organizationId,
      params.projectId,
      edges,
      null,
    );
  } catch (error) {
    if (params.scenario === 'success') throw error;
  }
  const totalElapsedMs = performance.now() - startedAt;
  const timing = requiredTiming(timingLog);
  await cleanupEdges(params, edges);
  return {
    path: 'pending-edge',
    scenario: params.scenario,
    edgeCount: params.edgeCount,
    graphRequests: Math.ceil(params.edgeCount / 50),
    graphTransactions: params.edgeCount,
    graphStatements: params.edgeCount * 2,
    checkpointTransactions: 0,
    graphElapsedMs: rounded(timing.graphRequestElapsedMs),
    checkpointElapsedMs: 0,
    totalElapsedMs: rounded(totalElapsedMs),
  };
}

async function measureChangeSet(params: {
  tx: Prisma.TransactionClient;
  prismaStatements: () => number;
  materializer: WorkItemChangeSetMaterializerService;
  graphClient: AgentEdgeClientService;
  organizationId: OrganizationId;
  projectId: ProjectId;
  scenario: Scenario;
  edgeCount: number;
  token: string;
}): Promise<Record<string, string | number>> {
  const materializationId = randomUUID();
  const proposalId = randomUUID();
  const claimToken = randomUUID();
  const revision = randomUUID();
  const edges = benchmarkEdges(params.scenario, params.edgeCount);
  const operations = edges.map((edge, index) => ({
    op: 'relationship.create' as const,
    ref: { refType: 'temporary' as const, tempId: `edge-${index}` },
    source: { refType: 'existing' as const, id: edge.sourceEntityId },
    target: { refType: 'existing' as const, id: edge.targetEntityId },
    edgeType: 'RELATED_TO' as const,
    category: AgentEdgeCategory.Meta,
    reasoning: edge.description,
  }));
  const mappings = {
    workItems: Object.fromEntries(
      edges.flatMap((edge) => [
        [`existing:${edge.sourceEntityId}`, edge.sourceEntityId],
        [`existing:${edge.targetEntityId}`, edge.targetEntityId],
      ]),
    ),
    relationships: Object.fromEntries(
      edges.map((edge, index) => [`temporary:edge-${index}`, edge.id!]),
    ),
  };
  await params.tx.proposal.create({
    data: {
      id: proposalId,
      organizationId: params.organizationId,
      projectId: params.projectId,
      action: 'CREATE',
      status: 'APPROVED',
      targetEntityId: edges[0]!.sourceEntityId,
      targetEntityType: 'TASK',
      updates: {},
      requestorId: randomUUID(),
    },
  });
  const prepared = await params.tx.workItemChangeSetMaterialization.create({
    data: {
      id: materializationId,
      proposalId,
      organizationId: params.organizationId,
      projectId: params.projectId,
      validationRevision: revision,
      status: 'APPLYING',
      operationSet: { root: operations[0]!.source, operations },
      workItemIdMappings: mappings.workItems,
      relationshipIdMappings: mappings.relationships,
      priorProjection: {},
      priorProjectionRevision: revision,
      claimToken,
      checkpoints: {
        create: operations.map((operation, operationIndex) => ({
          operationIndex,
          operationKind: operation.op,
          validationRevision: revision,
        })),
      },
    },
    include: { checkpoints: true },
  });
  const entries = operations.map((operation, index) => ({
    operation,
    index,
    checkpoint: prepared.checkpoints[index]!,
  }));
  const timingLog = captureTiming(
    params.materializer as never,
    'Generic relationship batch materialization timing',
  );
  const databaseBefore = params.prismaStatements();
  const startedAt = performance.now();
  try {
    await (params.materializer as any).applyRelationshipCreateBatch(
      {
        proposalId,
        organizationId: params.organizationId,
        projectId: params.projectId,
      },
      prepared,
      entries,
      mappings,
      claimToken,
    );
  } catch (error) {
    if (params.scenario === 'success') throw error;
  }
  const totalElapsedMs = performance.now() - startedAt;
  const checkpointStatements = params.prismaStatements() - databaseBefore;
  const timing = requiredTiming(timingLog);
  await cleanupEdges(params, edges);
  return {
    path: 'work-item-change-set',
    scenario: params.scenario,
    edgeCount: params.edgeCount,
    graphRequests: Math.ceil(params.edgeCount / 50),
    graphTransactions: params.edgeCount,
    graphStatements: params.edgeCount * 2,
    checkpointTransactions:
      params.edgeCount +
      (params.edgeCount - timing.failureCount) +
      (timing.failureCount > 0 ? 1 : 0),
    checkpointStatements,
    graphElapsedMs: rounded(timing.graphRequestElapsedMs),
    checkpointElapsedMs: rounded(timing.checkpointPersistenceElapsedMs),
    totalElapsedMs: rounded(totalElapsedMs),
  };
}

function benchmarkEdges(
  scenario: Scenario,
  edgeCount: number,
): MaterializableEdge[] {
  const successfulIds: string[] = [];
  return Array.from({ length: edgeCount }, (_, index) => {
    const conflict =
      scenario === 'mixed-failure' && index > 0 && index % 4 === 0;
    const id = conflict ? successfulIds[index - 1]! : randomUUID();
    if (!conflict) successfulIds[index] = id;
    return {
      id,
      sourceEntityId: randomUUID(),
      sourceEntityType: AgentEdgeEndpointEntityType.Task,
      targetEntityId: randomUUID(),
      targetEntityType: AgentEdgeEndpointEntityType.Task,
      edgeType: 'RELATED_TO',
      description: `benchmark-${index}-${randomUUID()}`,
    };
  });
}

async function cleanupEdges(
  params: {
    graphClient: AgentEdgeClientService;
    organizationId: OrganizationId;
    projectId: ProjectId;
    token: string;
  },
  edges: MaterializableEdge[],
): Promise<void> {
  for (const id of new Set(edges.map((edge) => edge.id!))) {
    try {
      await params.graphClient.delete(
        params.organizationId,
        params.projectId,
        id,
        'benchmark cleanup',
        params.token,
      );
    } catch {
      // A deterministic conflicting entry may not have created this identity.
    }
  }
}

function rollbackOnlyPrisma(tx: Prisma.TransactionClient) {
  return {
    db: new Proxy(tx, {
      get(target, key) {
        return key === '$transaction'
          ? async (
              callback: (db: Prisma.TransactionClient) => Promise<unknown>,
            ) => callback(tx)
          : Reflect.get(target, key);
      },
    }),
  };
}

function captureTiming(target: { logger: Logger }, message: string) {
  const captured: { value: Record<string, number> } = { value: {} };
  jest.spyOn(target.logger, 'log').mockImplementation((text, details) => {
    if (text === message) captured.value = details as Record<string, number>;
  });
  return captured;
}

function requiredTiming(captured: { value: Record<string, number> }): Record<
  string,
  number
> & {
  failureCount: number;
  graphRequestElapsedMs: number;
  checkpointPersistenceElapsedMs: number;
} {
  const { value } = captured;
  if (
    value.failureCount === undefined ||
    value.graphRequestElapsedMs === undefined
  ) {
    throw new Error('Materialization timing instrumentation was not emitted.');
  }
  return {
    ...value,
    failureCount: value.failureCount,
    graphRequestElapsedMs: value.graphRequestElapsedMs,
    checkpointPersistenceElapsedMs: value.checkpointPersistenceElapsedMs ?? 0,
  };
}

function rounded(value: number): number {
  return Number(value.toFixed(3));
}
