import { of, throwError } from 'rxjs';
import { AgentEdgeType } from 'src/generated/graphs/model/agentEdgeType';
import { AgentEdgeCategory } from 'src/generated/graphs/model/agentEdgeCategory';
import { AgentEdgeDirection } from 'src/generated/graphs/model/agentEdgeDirection';
import { AgentEdgeEndpointEntityType } from 'src/generated/graphs/model/agentEdgeEndpointEntityType';
import type { CreateAgentEdgeDto } from 'src/generated/graphs/model/createAgentEdgeDto';
import type { AgentEdgesService } from 'src/generated/graphs/api/agentEdges.service';
import type { PrismaService } from 'src/prisma/prisma.service';
import { BadRequestException } from '@nestjs/common';
import { OrganizationId, ProjectId } from 'src/types';
import {
  AGENT_EDGE_BATCH_SIZE,
  AgentEdgeClientService,
} from '../agent-edge-client.service';

describe('AgentEdgeClientService', () => {
  it('creates bounded batches and preserves global input correlation', async () => {
    const generatedService = {
      createAgentEdgesBatch: jest.fn(
        (
          _org: string,
          _project: string,
          request: { edges: CreateAgentEdgeDto[] },
        ) =>
          of({
            data: {
              results: request.edges.map((dto, index: number) => ({
                index,
                success: true,
                edge: { id: dto.id },
              })),
            },
          }),
      ),
    };
    const prisma = createPrisma();
    const service = new AgentEdgeClientService(
      generatedService as unknown as AgentEdgesService,
      prisma as unknown as PrismaService,
    );
    const dtos = Array.from(
      { length: AGENT_EDGE_BATCH_SIZE + 1 },
      (_, index) => ({
        id: `edge-${index}`,
        sourceNodeId: `source-${index}`,
        sourceEntityType: AgentEdgeEndpointEntityType.Task,
        targetNodeId: `target-${index}`,
        targetEntityType: AgentEdgeEndpointEntityType.Task,
        type: AgentEdgeType.RelatedTo,
        reasoning: `edge ${index}`,
      }),
    );

    const results = await service.createBatch(
      'org-1' as OrganizationId,
      'project-1' as ProjectId,
      dtos,
      'token-1',
    );

    expect(generatedService.createAgentEdgesBatch).toHaveBeenCalledTimes(2);
    expect(
      generatedService.createAgentEdgesBatch.mock.calls[0]![2].edges,
    ).toHaveLength(AGENT_EDGE_BATCH_SIZE);
    expect(
      generatedService.createAgentEdgesBatch.mock.calls[1]![2].edges,
    ).toHaveLength(1);
    expect(results).toHaveLength(AGENT_EDGE_BATCH_SIZE + 1);
    expect(results.at(-1)).toEqual(
      expect.objectContaining({
        index: AGENT_EDGE_BATCH_SIZE,
        success: true,
      }),
    );
    expect(prisma.db.$transaction).toHaveBeenCalledTimes(1);
  });

  it('returns failed outcomes for every entry in an ambiguous transport failure', async () => {
    const generatedService = {
      createAgentEdgesBatch: jest
        .fn()
        .mockReturnValue(throwError(() => new Error('Graph timeout'))),
    };
    const service = new AgentEdgeClientService(
      generatedService as unknown as AgentEdgesService,
      createPrisma() as unknown as PrismaService,
    );
    const dto = {
      sourceNodeId: 'source-1',
      sourceEntityType: AgentEdgeEndpointEntityType.Task,
      targetNodeId: 'target-1',
      targetEntityType: AgentEdgeEndpointEntityType.Task,
      type: AgentEdgeType.RelatedTo,
      reasoning: 'related',
    };

    await expect(
      service.createBatch(
        'org-1' as OrganizationId,
        'project-1' as ProjectId,
        [dto, { ...dto, sourceNodeId: 'source-2' }],
        'token-1',
      ),
    ).resolves.toEqual([
      { index: 0, success: false, error: 'Graph timeout' },
      { index: 1, success: false, error: 'Graph timeout' },
    ]);
  });

  it('rejects an ambiguous batch acknowledgement as failed outcomes', async () => {
    const generatedService = {
      createAgentEdgesBatch: jest.fn().mockReturnValue(
        of({
          data: {
            results: [{ index: 1, success: true, edge: { id: 'edge-1' } }],
          },
        }),
      ),
    };
    const service = new AgentEdgeClientService(
      generatedService as unknown as AgentEdgesService,
      createPrisma() as unknown as PrismaService,
    );

    await expect(
      service.createBatch(
        'org-1' as OrganizationId,
        'project-1' as ProjectId,
        [
          {
            sourceNodeId: 'source-1',
            sourceEntityType: AgentEdgeEndpointEntityType.Task,
            targetNodeId: 'target-1',
            targetEntityType: AgentEdgeEndpointEntityType.Task,
            type: AgentEdgeType.RelatedTo,
            reasoning: 'related',
          },
        ],
        'token-1',
      ),
    ).resolves.toEqual([
      {
        index: 0,
        success: false,
        error:
          'Graph batch response results were not correlated in input order.',
      },
    ]);
  });

  it.each([
    {
      name: 'STANDARD',
      relationship: {
        type: AgentEdgeType.Standard,
        category: AgentEdgeCategory.Flow,
        direction: AgentEdgeDirection.Forward,
      },
    },
    {
      name: 'CONDITIONAL',
      relationship: {
        type: AgentEdgeType.Conditional,
        category: AgentEdgeCategory.Flow,
        direction: AgentEdgeDirection.Backward,
        predicate: 'approved',
      },
    },
    {
      name: 'LOOP without predicate',
      relationship: {
        type: AgentEdgeType.Loop,
        category: AgentEdgeCategory.Flow,
      },
    },
    {
      name: 'LOOP with predicate',
      relationship: {
        type: AgentEdgeType.Loop,
        category: AgentEdgeCategory.Flow,
        predicate: 'retryCount < 3',
      },
    },
  ])(
    'accepts a contract-valid $name graph relationship',
    async ({ relationship }) => {
      const generatedService = {
        createAgentEdge: jest
          .fn()
          .mockReturnValue(of({ data: { id: 'edge-1' } })),
      };
      const service = new AgentEdgeClientService(
        generatedService as any,
        createPrisma() as any,
      );

      await expect(
        service.create(
          'org-1' as OrganizationId,
          'project-1' as ProjectId,
          {
            sourceNodeId: 'source-1',
            sourceEntityType: AgentEdgeEndpointEntityType.Task,
            targetNodeId: 'target-1',
            targetEntityType: AgentEdgeEndpointEntityType.Task,
            reasoning: 'Valid graph relationship',
            ...relationship,
          } as any,
          'token-1',
        ),
      ).resolves.toEqual({ id: 'edge-1' });

      expect(generatedService.createAgentEdge).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    {
      name: 'STANDARD without direction',
      relationship: {
        type: AgentEdgeType.Standard,
        category: AgentEdgeCategory.Flow,
      },
      field: 'direction',
    },
    {
      name: 'STANDARD with predicate',
      relationship: {
        type: AgentEdgeType.Standard,
        category: AgentEdgeCategory.Flow,
        direction: AgentEdgeDirection.Forward,
        predicate: 'approved',
      },
      field: 'predicate',
    },
    {
      name: 'CONDITIONAL without direction',
      relationship: {
        type: AgentEdgeType.Conditional,
        category: AgentEdgeCategory.Flow,
        predicate: 'approved',
      },
      field: 'direction',
    },
    {
      name: 'CONDITIONAL without predicate',
      relationship: {
        type: AgentEdgeType.Conditional,
        category: AgentEdgeCategory.Flow,
        direction: AgentEdgeDirection.Forward,
      },
      field: 'predicate',
    },
    {
      name: 'LOOP with direction',
      relationship: {
        type: AgentEdgeType.Loop,
        category: AgentEdgeCategory.Flow,
        direction: AgentEdgeDirection.Forward,
      },
      field: 'direction',
    },
    {
      name: 'LOOP with nullable direction',
      relationship: {
        type: AgentEdgeType.Loop,
        category: AgentEdgeCategory.Flow,
        direction: null,
      },
      field: 'direction',
    },
    {
      name: 'flow relationship without flow category',
      relationship: {
        type: AgentEdgeType.Loop,
      },
      field: 'category',
    },
  ])(
    'rejects $name before the Graph request',
    async ({ relationship, field }) => {
      const generatedService = {
        createAgentEdge: jest.fn(),
      };
      const service = new AgentEdgeClientService(
        generatedService as any,
        createPrisma() as any,
      );

      await expect(
        service.create(
          'org-1' as OrganizationId,
          'project-1' as ProjectId,
          {
            sourceNodeId: 'source-1',
            sourceEntityType: AgentEdgeEndpointEntityType.Task,
            targetNodeId: 'target-1',
            targetEntityType: AgentEdgeEndpointEntityType.Task,
            reasoning: 'Invalid graph relationship',
            ...relationship,
          } as any,
          'token-1',
        ),
      ).rejects.toThrow(`CreateAgentEdgeDto.${field}`);

      expect(generatedService.createAgentEdge).not.toHaveBeenCalled();
    },
  );

  it('rejects create requests missing endpoint entity types before calling graph service', async () => {
    const generatedService = {
      createAgentEdge: jest.fn(),
    };
    const service = new AgentEdgeClientService(
      generatedService as any,
      createPrisma() as any,
    );

    await expect(
      service.create(
        'org-1' as OrganizationId,
        'project-1' as ProjectId,
        {
          sourceNodeId: 'source-1',
          targetNodeId: 'target-1',
          type: AgentEdgeType.DependsOn,
          reasoning: 'Needs the dependency first',
        } as any,
        'token-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(generatedService.createAgentEdge).not.toHaveBeenCalled();
  });

  it('serializes incident edge Set request fields as JSON arrays', async () => {
    const generatedService = {
      findIncidentAgentEdges: jest.fn().mockReturnValue(of({ data: [] })),
    };
    const service = new AgentEdgeClientService(
      generatedService as any,
      createPrisma() as any,
    );
    const request = {
      nodeIds: new Set(['node-1']),
      types: new Set([AgentEdgeType.DependsOn]),
    };

    await service.findIncident(
      'org-1' as OrganizationId,
      'project-1' as ProjectId,
      request,
      'token-1',
    );

    const call = generatedService.findIncidentAgentEdges.mock.calls[0];
    expect(call).toEqual([
      'org-1',
      'project-1',
      request,
      expect.objectContaining({
        config: expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer token-1',
          }),
          transformRequest: expect.any(Array),
        }),
      }),
    ]);

    const transformRequest = call[3].config.transformRequest[0];
    expect(transformRequest(request)).toBe(
      JSON.stringify({ nodeIds: ['node-1'], types: ['DEPENDS_ON'] }),
    );
  });

  it('rejects reconnect updates missing endpoint entity types before calling graph service', async () => {
    const generatedService = {
      updateAgentEdge: jest.fn(),
    };
    const service = new AgentEdgeClientService(
      generatedService as any,
      createPrisma() as any,
    );

    await expect(
      service.update(
        'org-1' as OrganizationId,
        'project-1' as ProjectId,
        'edge-1',
        {
          sourceNodeId: 'source-2',
          lastModifiedBySessionId: 'session-1',
        },
        'token-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(generatedService.updateAgentEdge).not.toHaveBeenCalled();
  });

  it('passes reconnect endpoints and metadata through generated update calls', async () => {
    const response = {
      id: 'edge-1',
      sourceNodeId: 'source-2',
      sourceEntityType: AgentEdgeEndpointEntityType.Task,
      targetNodeId: 'target-2',
      targetEntityType: AgentEdgeEndpointEntityType.Task,
      type: AgentEdgeType.RelatedTo,
      reasoning: 'Updated edge',
      metadata: { lane: 'secondary' },
      createdAt: '2026-07-13T00:00:00.000Z',
      updatedAt: '2026-07-13T00:00:00.000Z',
    };
    const generatedService = {
      updateAgentEdge: jest.fn().mockReturnValue(of({ data: response })),
    };
    const service = new AgentEdgeClientService(
      generatedService as any,
      createPrisma() as any,
    );
    const dto = {
      sourceNodeId: 'source-2',
      sourceEntityType: AgentEdgeEndpointEntityType.Task,
      targetNodeId: 'target-2',
      targetEntityType: AgentEdgeEndpointEntityType.Task,
      type: AgentEdgeType.RelatedTo,
      metadata: { lane: 'secondary' },
      reasoning: 'Updated edge',
      lastModifiedBySessionId: 'session-1',
    };

    await expect(
      service.update(
        'org-1' as OrganizationId,
        'project-1' as ProjectId,
        'edge-1',
        dto,
        'token-1',
      ),
    ).resolves.toEqual(response);

    expect(generatedService.updateAgentEdge).toHaveBeenCalledWith(
      'org-1',
      'project-1',
      'edge-1',
      dto,
      undefined,
      expect.objectContaining({
        config: expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer token-1',
          }),
        }),
      }),
    );
  });

  it('allows direct Graph writes that touch a non-published materialization', async () => {
    const generatedService = {
      createAgentEdge: jest.fn().mockReturnValue(
        of({
          data: {
            id: 'edge-1',
            sourceNodeId: 'source-1',
            targetNodeId: 'target-1',
            type: AgentEdgeType.RelatedTo,
          },
        }),
      ),
    };
    const prisma = createPrisma();
    prisma.db.workItemChangeSetMaterialization.findMany.mockResolvedValue([
      {
        id: 'materialization-1',
        affectedWorkItemIds: ['source-1'],
        affectedRelationshipIds: ['edge-1'],
      },
    ]);
    const service = new AgentEdgeClientService(
      generatedService as any,
      prisma as any,
    );

    await expect(
      service.create(
        'org-1' as OrganizationId,
        'project-1' as ProjectId,
        {
          id: 'edge-1',
          sourceNodeId: 'source-1',
          sourceEntityType: AgentEdgeEndpointEntityType.Task,
          targetNodeId: 'target-1',
          targetEntityType: AgentEdgeEndpointEntityType.Task,
          type: AgentEdgeType.RelatedTo,
          reasoning: 'conflicting write',
        },
        'token-1',
      ),
    ).resolves.toEqual(expect.objectContaining({ id: 'edge-1' }));
    expect(generatedService.createAgentEdge).toHaveBeenCalledTimes(1);
    expect(
      prisma.db.workItemChangeSetMaterialization.findMany,
    ).not.toHaveBeenCalled();
  });

  it('allows the active materialization owner through later queued Graph fences', async () => {
    const generatedService = {
      createAgentEdge: jest.fn().mockReturnValue(
        of({
          data: {
            id: 'edge-1',
            sourceNodeId: 'source-1',
            targetNodeId: 'target-1',
            type: AgentEdgeType.RelatedTo,
          },
        }),
      ),
    };
    const prisma = createPrisma();
    prisma.db.workItemChangeSetMaterialization.findMany.mockResolvedValue([
      {
        id: 'materialization-1',
        status: 'APPLYING',
        affectedWorkItemIds: ['source-1'],
        affectedRelationshipIds: ['edge-1'],
      },
      {
        id: 'materialization-2',
        status: 'PREPARED',
        affectedWorkItemIds: ['source-1'],
        affectedRelationshipIds: ['edge-1'],
      },
    ]);
    const service = new AgentEdgeClientService(
      generatedService as any,
      prisma as any,
    );

    await expect(
      service.create(
        'org-1' as OrganizationId,
        'project-1' as ProjectId,
        {
          id: 'edge-1',
          sourceNodeId: 'source-1',
          sourceEntityType: AgentEdgeEndpointEntityType.Task,
          targetNodeId: 'target-1',
          targetEntityType: AgentEdgeEndpointEntityType.Task,
          type: AgentEdgeType.RelatedTo,
          reasoning: 'owned materialization write',
        },
        'token-1',
        'materialization-1',
      ),
    ).resolves.toEqual(expect.objectContaining({ id: 'edge-1' }));
  });

  it('rejects new incident edges while a custom type cascade is pending', async () => {
    const generatedService = { createAgentEdge: jest.fn() };
    const prisma = createPrisma();
    prisma.db.task.findMany.mockResolvedValue([{ type: 'CUSTOM' }]);
    prisma.db.workItemTypeCascadeExecution.findFirst.mockResolvedValue({
      typeKey: 'CUSTOM',
    });
    const service = new AgentEdgeClientService(
      generatedService as any,
      prisma as any,
    );

    await expect(
      service.create(
        'org-1' as OrganizationId,
        'project-1' as ProjectId,
        {
          sourceNodeId: 'source-1',
          sourceEntityType: AgentEdgeEndpointEntityType.Task,
          targetNodeId: 'target-1',
          targetEntityType: AgentEdgeEndpointEntityType.Task,
          type: AgentEdgeType.RelatedTo,
          reasoning: 'blocked during cascade',
        },
        'token-1',
      ),
    ).rejects.toThrow("work-item type 'CUSTOM'");
    expect(generatedService.createAgentEdge).not.toHaveBeenCalled();
  });

  it('allows direct writes in a caller-owned preflight transaction', async () => {
    const prisma = createPrisma();
    prisma.db.workItemChangeSetMaterialization.findMany.mockResolvedValue([
      {
        id: 'materialization-1',
        affectedWorkItemIds: ['source-1'],
        affectedRelationshipIds: [],
      },
    ]);
    const service = new AgentEdgeClientService({} as any, prisma as any);

    await expect(
      (service as any).assertGraphWriteAllowed(
        prisma.db as any,
        'org-1' as OrganizationId,
        'project-1' as ProjectId,
        ['source-1', 'target-1'],
      ),
    ).resolves.toBeUndefined();

    expect(
      prisma.db.workItemChangeSetMaterialization.findMany,
    ).not.toHaveBeenCalled();
    expect(prisma.db.$transaction).not.toHaveBeenCalled();
  });
  it('commits the preflight transaction before starting the Graph request', async () => {
    const events: string[] = [];
    const generatedService = {
      createAgentEdge: jest.fn().mockImplementation(() => {
        events.push('graph-request');
        return of({ data: { id: 'edge-1' } });
      }),
    };
    const prisma = createPrisma();
    (prisma.db.$transaction as jest.Mock).mockImplementation(
      async (callback: (transaction: unknown) => unknown) => {
        const result = await callback(prisma.db);
        events.push('transaction-committed');
        return result;
      },
    );
    const service = new AgentEdgeClientService(
      generatedService as any,
      prisma as any,
    );

    await service.create(
      'org-1' as OrganizationId,
      'project-1' as ProjectId,
      {
        id: 'edge-1',
        sourceNodeId: 'source-1',
        sourceEntityType: AgentEdgeEndpointEntityType.Task,
        targetNodeId: 'target-1',
        targetEntityType: AgentEdgeEndpointEntityType.Task,
        type: AgentEdgeType.RelatedTo,
        reasoning: 'post-commit publication',
      },
      'token-1',
    );

    expect(events).toEqual(['transaction-committed', 'graph-request']);
  });
});

function createPrisma() {
  const db = {
    $queryRaw: jest.fn().mockResolvedValue([{ pg_advisory_xact_lock: null }]),
    workItemChangeSetMaterialization: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    task: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    workItemTypeCascadeExecution: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
  };
  return {
    db: {
      ...db,
      $transaction: jest.fn(async (callback) => callback(db)),
    },
  };
}
