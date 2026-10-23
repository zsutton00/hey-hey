import { of, throwError } from 'rxjs';
import { AgentEdgeClientService } from '../../agent-edge-client.service';
import { PlanDependenciesService } from '../plan-dependencies.service';
import { orderPlanStages } from '../order-plan-stages';
import { buildPlanResearchContext } from '../build-plan-research-context';

const edge = (sourceNodeId: string, targetNodeId: string, extra = {}) => ({
  id: sourceNodeId + targetNodeId,
  sourceNodeId,
  targetNodeId,
  sourceEntityType: 'TASK',
  targetEntityType: 'TASK',
  type: 'DEPENDS_ON',
  ...extra,
});

describe('Plan dependency provider imports', () => {
  it.each([
    '../plan-dependencies.service',
    '../../proposal/pending-edge.service',
    '../../tasks/plan-hierarchy-rollup.service',
  ])('resolves Nest providers when %s loads first', async (entryPoint) => {
    await jest.isolateModulesAsync(async () => {
      require(entryPoint);
      const { Test } = require('@nestjs/testing');
      const {
        PlanDependenciesService: Dependencies,
      } = require('../plan-dependencies.service');
      const {
        PlanHierarchyRollupService: Rollup,
      } = require('../../tasks/plan-hierarchy-rollup.service');
      const {
        AgentEdgeClientService: EdgeClient,
      } = require('../../agent-edge-client.service');
      const {
        SERVICE_TOKEN_FACTORY,
      } = require('../../proposal/pending-edge.service');
      const edges = { findIncident: jest.fn().mockResolvedValue([]) };
      const tokenFactory = jest.fn().mockReturnValue('service-token');
      const module = await Test.createTestingModule({
        providers: [
          Dependencies,
          Rollup,
          { provide: EdgeClient, useValue: edges },
          { provide: SERVICE_TOKEN_FACTORY, useValue: tokenFactory },
        ],
      }).compile();
      try {
        expect(Reflect.getMetadata('design:paramtypes', Rollup)).toEqual([
          Dependencies,
        ]);
        expect(module.get(Rollup)).toBeInstanceOf(Rollup);
        await expect(
          module.get(Dependencies).outgoing('org', 'project', ['stage']),
        ).resolves.toEqual([]);
        expect(tokenFactory).toHaveBeenCalledWith('org', 'project');
        expect(edges.findIncident).toHaveBeenCalledWith(
          'org',
          'project',
          { nodeIds: new Set(['stage']), types: new Set(['DEPENDS_ON']) },
          'service-token',
        );
      } finally {
        await module.close();
      }
    });
  });
});

describe('Graph plan dependencies', () => {
  const stages = ['later', 'first'].map((id, index) => ({
    id,
    createdAt: new Date(index),
    type: 'PLAN_STAGE',
    name: id,
    status: 'BACKLOG',
    sections: [],
  }));
  function setup(edges = [edge('later', 'first')]) {
    const transport = {
      findIncidentAgentEdges: jest.fn().mockReturnValue(of({ data: edges })),
    };
    const graph = new PlanDependenciesService(
      new AgentEdgeClientService(transport as any, {} as any),
      () => 'token',
    );
    return { graph, transport };
  }

  it('uses the generated incident endpoint and filters direction, type and endpoint kinds', async () => {
    const { graph, transport } = setup([
      edge('later', 'first'),
      edge('outside', 'later'),
      edge('later', 'doc', { targetEntityType: 'DESIGN_DOC' }),
      edge('later', 'other', { type: 'RELATED_TO' }),
    ]);
    expect(await graph.outgoing('org', 'project', ['later'])).toEqual([
      edge('later', 'first'),
    ]);
    const request = transport.findIncidentAgentEdges.mock.calls[0]!;
    expect(request.slice(0, 3)).toEqual([
      'org',
      'project',
      { nodeIds: new Set(['later']), types: new Set(['DEPENDS_ON']) },
    ]);
    const serialized = request[3].config.transformRequest[0](request[2]);
    expect(JSON.parse(serialized)).toEqual({
      nodeIds: ['later'],
      types: ['DEPENDS_ON'],
    });
  });

  it('orders prerequisites first, ignoring dependencies outside the stage set', async () => {
    const { graph } = setup([
      edge('later', 'first'),
      edge('first', 'external'),
    ]);
    expect(
      (await orderPlanStages(graph, 'org', 'project', stages)).map((s) => s.id),
    ).toEqual(['first', 'later']);
  });

  it('keeps deterministic timestamp/identity ordering for disconnected stages', async () => {
    const { graph } = setup([]);
    const sameTime = ['z', 'a'].map((id) => ({ id, createdAt: new Date(0) }));
    expect(
      (await orderPlanStages(graph, 'org', 'project', sameTime)).map(
        (s) => s.id,
      ),
    ).toEqual(['a', 'z']);
  });

  it('surfaces Graph failures and cycles', async () => {
    const { graph, transport } = setup([
      edge('later', 'first'),
      edge('first', 'later'),
    ]);
    await expect(
      orderPlanStages(graph, 'org', 'project', stages),
    ).rejects.toThrow('cycle');
    transport.findIncidentAgentEdges.mockReturnValue(
      throwError(() => new Error('Graph unavailable')),
    );
    await expect(
      orderPlanStages(graph, 'org', 'project', stages),
    ).rejects.toThrow('Graph unavailable');
  });

  it('uses Graph ordering for research sequence numbers', async () => {
    const { graph } = setup();
    const db = {
      task: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({
            id: 'plan',
            projectId: 'project',
            name: 'Plan',
            status: 'ACTIVE',
            sections: [{ key: 'outcome', materializedMarkdown: 'Ship it' }],
          })
          .mockResolvedValueOnce({
            id: 'later',
            type: 'PLAN_STAGE',
            parentTaskId: 'plan',
          }),
        findMany: jest.fn().mockResolvedValue(stages),
      },
    };
    const result = await buildPlanResearchContext(
      db as any,
      graph,
      'org',
      'plan',
      { taskId: 'later' },
    );
    expect(result.planStage).toMatchObject({ id: 'later', sequenceOrder: 2 });
  });
});
