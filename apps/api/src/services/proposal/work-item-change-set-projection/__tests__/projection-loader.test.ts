import type { GroupReservedEntity } from '../../proposal-group-authoring.service';
import { AxiosError, AxiosHeaders } from 'axios';
import type { Logger } from '@nestjs/common';
import type {
  WorkItemChangeSetOperation,
  WorkItemChangeSetValidationRequest,
} from 'src/generated';
import type { AgentEdge } from 'src/generated/graphs';
import type { AnyTransactionClient } from 'src/prisma/prisma.service';
import type { OrganizationId, ProjectId } from 'src/types';
import type { AgentEdgeClientService } from '../../../agent-edge-client.service';
import { ProjectionLoader, type GraphAgentEdge } from '../projection-loader';
import {
  createLoadedData,
  planProjection,
  type AnyProjectionRule,
  type Load,
} from '../projection-rule';
import type { ProjectedNode, ProjectionState } from '../projection-state';
import { deriveRequestFacts } from '../request-facts';
import type { WorkItemTypeRegistryService } from '../../../tasks/work-item-type-registry.service';

const ORG = 'org-1' as OrganizationId;
const PROJECT = 'project-1' as ProjectId;
const TASK = '11111111-1111-4111-8111-111111111111';
const DOC = '22222222-2222-4222-8222-222222222222';
const LIVE = {
  organizationId: ORG,
  projectId: PROJECT,
  archivedAt: null,
  status: { not: 'ARCHIVED' },
};
const TASK_INCLUDE = {
  sections: { orderBy: { order: 'asc' } },
  serviceRelations: { select: { serviceId: true } },
};

function emptyState(): ProjectionState {
  return {
    nodes: new Map(),
    relationships: new Map(),
    identityLabels: {},
    issues: [],
    warnings: [],
    layoutEntries: new Map(),
    deletedLayoutRoots: new Set(),
    unavailableWorkItemIds: new Set(),
  };
}

function node(id: string, type: string, parentId?: string): ProjectedNode {
  return {
    identity: { refType: 'existing', id },
    label: id,
    type,
    name: id,
    parent: parentId ? { refType: 'existing', id: parentId } : undefined,
    sections: [],
    deleted: false,
  } as unknown as ProjectedNode;
}

function edge(
  id: string,
  source: string,
  target: string,
  type = 'DEPENDS_ON',
): GraphAgentEdge {
  return {
    id,
    type,
    sourceNodeId: source,
    targetNodeId: target,
    sourceEntityType: 'TASK',
    targetEntityType: 'TASK',
  } as unknown as AgentEdge;
}

function setup(params: {
  reservedEntities?: readonly GroupReservedEntity[];
  operations?: WorkItemChangeSetOperation[];
  nodes?: ProjectedNode[];
}) {
  const request = {
    root: { refType: 'existing', id: 'root' },
    operations: params.operations ?? [],
  } as unknown as WorkItemChangeSetValidationRequest;
  const state = emptyState();
  for (const value of params.nodes ?? [])
    state.nodes.set(`existing:${(value.identity as { id: string }).id}`, value);
  const db = {
    task: { findMany: jest.fn(), findFirst: jest.fn() },
    service: { findMany: jest.fn() },
    designDoc: { findMany: jest.fn() },
  };
  const agentEdgeClient = { get: jest.fn(), findIncident: jest.fn() };
  const writer = { writeTasks: jest.fn(), writeEdge: jest.fn() };
  const logger = { warn: jest.fn(), debug: jest.fn() };
  const loaded = createLoadedData();
  const facts = deriveRequestFacts(request, state);
  const loader = new ProjectionLoader({
    organizationId: ORG,
    projectId: PROJECT,
    reservedEntities: params.reservedEntities,
    db: db as unknown as AnyTransactionClient,
    agentEdgeClient: agentEdgeClient as unknown as AgentEdgeClientService,
    tokenFactory: () => 'token',
    request,
    facts,
    state,
    loaded,
    writer,
    logger: logger as unknown as Logger,
  });
  return { db, agentEdgeClient, writer, logger, loaded, loader };
}

describe('ProjectionLoader', () => {
  it('parent loads the reparent target through the supplied db', async () => {
    const { db, loader, writer } = setup({
      operations: [
        {
          op: 'workItem.update',
          ref: { refType: 'existing', id: 'task' },
          parent: { refType: 'existing', id: 'new-stage' },
        },
      ] as WorkItemChangeSetOperation[],
      nodes: [node('task', 'STANDARD', 'old-stage')],
    });
    db.task.findMany.mockResolvedValue([{ id: 'new-stage' }]);

    await loader.load({ kind: 'parent', of: 'existing:task' });

    expect(db.task.findMany).toHaveBeenCalledWith({
      where: { id: 'new-stage', ...LIVE },
      include: TASK_INCLUDE,
    });
    expect(writer.writeTasks).toHaveBeenCalledWith([{ id: 'new-stage' }]);
  });

  it('parent skips a parent that is already hydrated', async () => {
    const { db, loader } = setup({
      nodes: [node('task', 'STANDARD', 'root'), node('root', 'FEATURE')],
    });
    await loader.load({ kind: 'parent', of: 'existing:task' });
    expect(db.task.findMany).not.toHaveBeenCalled();
  });

  it('ancestorsToRoot walks skeleton rows until the request root', async () => {
    const { db, loader, loaded } = setup({
      nodes: [node('grandchild', 'STANDARD', 'child')],
    });
    db.task.findFirst.mockImplementation(
      ({ where }: { where: { id: string } }) =>
        Promise.resolve(
          where.id === 'child'
            ? { id: 'child', type: 'FEATURE', parentTaskId: 'root' }
            : { id: 'root', type: 'FEATURE', parentTaskId: 'top' },
        ),
    );

    await loader.load({ kind: 'ancestorsToRoot', of: 'existing:grandchild' });

    expect(db.task.findFirst).toHaveBeenCalledWith({
      where: { id: 'child', ...LIVE },
      select: { id: true, type: true, parentTaskId: true },
    });
    expect(db.task.findFirst).toHaveBeenCalledTimes(2);
    expect(loaded.ancestors.get('existing:grandchild')).toEqual([
      { id: 'child', type: 'FEATURE', parent: 'existing:root' },
      { id: 'root', type: 'FEATURE', parent: 'existing:top' },
    ]);
  });

  it('children loads live children of an existing node', async () => {
    const { db, loader } = setup({});
    db.task.findMany.mockResolvedValue([]);
    await loader.load({ kind: 'children', of: 'existing:root' });
    expect(db.task.findMany).toHaveBeenCalledWith({
      where: { parentTaskId: 'root', ...LIVE },
      include: TASK_INCLUDE,
    });
  });

  it('siblingsNamed filters children by exact name', async () => {
    const { db, loader } = setup({});
    db.task.findMany.mockResolvedValue([]);
    await loader.load({
      kind: 'siblingsNamed',
      parent: 'existing:root',
      name: 'Billing',
    });
    expect(db.task.findMany).toHaveBeenCalledWith({
      where: { parentTaskId: 'root', name: 'Billing', ...LIVE },
      include: TASK_INCLUDE,
    });
  });

  it('edgeById finds an edge whose endpoints are not hydrated, and loads them', async () => {
    const { agentEdgeClient, db, loader, writer, loaded } = setup({
      nodes: [node('untouched-a', 'STANDARD')],
    });
    const found = edge('e1', 'untouched-a', 'untouched-b', 'RELATED_TO');
    agentEdgeClient.get.mockResolvedValue(found);
    const endpoint = { id: 'untouched-b' };
    db.task.findMany.mockResolvedValue([endpoint]);

    await loader.load({ kind: 'edgeById', ref: 'existing:e1' });

    expect(agentEdgeClient.get).toHaveBeenCalledWith(
      ORG,
      PROJECT,
      'e1',
      'token',
    );
    expect(agentEdgeClient.findIncident).not.toHaveBeenCalled();
    expect(writer.writeEdge).toHaveBeenCalledWith(found);
    expect(db.task.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['untouched-b'] }, ...LIVE },
      include: TASK_INCLUDE,
    });
    expect(writer.writeTasks).toHaveBeenCalledWith([endpoint]);
    expect(loaded.missingEdges.size).toBe(0);
  });

  it('edgeById records a 404 as missing', async () => {
    const { agentEdgeClient, loader, loaded } = setup({});
    agentEdgeClient.get.mockRejectedValue(
      new AxiosError('not found', '404', undefined, undefined, {
        status: 404,
        statusText: 'Not Found',
        data: {},
        headers: {},
        config: { headers: new AxiosHeaders() },
      }),
    );
    await loader.load({ kind: 'edgeById', ref: 'existing:gone' });
    expect(loaded.missingEdges.has('existing:gone')).toBe(true);
  });

  it('incidentEdges is scoped to the given node and edge types and records far endpoints', async () => {
    const { agentEdgeClient, db, loader, loaded, writer } = setup({});
    agentEdgeClient.findIncident.mockResolvedValue([edge('e1', 'a', 'b')]);
    db.task.findMany.mockResolvedValue([
      {
        id: 'b',
        type: 'STANDARD',
        parentTaskId: 'stage',
        parentTask: { type: 'PLAN_STAGE' },
      },
    ]);
    await loader.load({
      kind: 'incidentEdges',
      of: 'existing:a',
      edgeTypes: ['DEPENDS_ON'],
    });
    expect(agentEdgeClient.findIncident).toHaveBeenCalledWith(
      ORG,
      PROJECT,
      { nodeIds: new Set(['a']), types: new Set(['DEPENDS_ON']) },
      'token',
    );
    expect(writer.writeEdge).toHaveBeenCalledTimes(1);
    expect(db.task.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['b'] }, ...LIVE },
      select: {
        id: true,
        type: true,
        parentTaskId: true,
        parentTask: { select: { type: true } },
      },
    });
    expect(loaded.incidentEdges.get('existing:a')).toEqual(['existing:e1']);
    expect(loaded.edgeEndpoints.get('existing:b')).toEqual({
      id: 'b',
      type: 'STANDARD',
      parent: 'existing:stage',
      parentType: 'PLAN_STAGE',
    });
  });

  it('dependsOnClosure follows outgoing DEPENDS_ON and loads skeletons only', async () => {
    const { agentEdgeClient, db, loader, loaded, writer } = setup({});
    agentEdgeClient.findIncident
      .mockResolvedValueOnce([edge('e1', 'a', 'b'), edge('e0', 'z', 'a')])
      .mockResolvedValueOnce([edge('e2', 'b', 'a')]);
    db.task.findMany.mockResolvedValue([
      { id: 'a', type: 'STANDARD', parentTaskId: 's' },
      { id: 'b', type: 'STANDARD', parentTaskId: null },
    ]);

    await loader.load({
      kind: 'dependsOnClosure',
      from: ['existing:a'],
      edges: [],
    });

    expect(agentEdgeClient.findIncident).toHaveBeenNthCalledWith(
      2,
      ORG,
      PROJECT,
      { nodeIds: new Set(['b']), types: new Set(['DEPENDS_ON']) },
      'token',
    );
    expect(db.task.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['a', 'b'] }, ...LIVE },
      select: { id: true, type: true, parentTaskId: true },
    });
    expect(loaded.closureEdges.map((value) => value.id)).toEqual(['e1', 'e2']);
    expect(loaded.closureNodes.get('existing:a')).toEqual({
      id: 'a',
      type: 'STANDARD',
      parent: 'existing:s',
    });
    expect(writer.writeTasks).not.toHaveBeenCalled();
  });

  it('planStages loads stages and the DEPENDS_ON edges between them', async () => {
    const { agentEdgeClient, db, loader, writer } = setup({});
    db.task.findMany.mockResolvedValue([{ id: 's1' }, { id: 's2' }]);
    agentEdgeClient.findIncident.mockResolvedValue([
      edge('chain', 's1', 's2'),
      edge('out', 's1', 'elsewhere'),
    ]);

    await loader.load({ kind: 'planStages', plan: 'existing:plan' });

    expect(db.task.findMany).toHaveBeenCalledWith({
      where: { parentTaskId: 'plan', type: 'PLAN_STAGE', ...LIVE },
      include: TASK_INCLUDE,
    });
    expect(writer.writeEdge).toHaveBeenCalledTimes(1);
    expect(writer.writeEdge).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'chain' }),
    );
  });

  it.each([false, true])(
    'resolves reserved screen targets only with group context: %s',
    async (grouped) => {
      const { db, loader, loaded } = setup({
        reservedEntities: grouped
          ? [
              { entityId: TASK, entityType: 'TASK', workItemType: 'mockup' },
              { entityId: DOC, entityType: 'TASK', workItemType: 'mockup' },
            ]
          : undefined,
        operations: [
          {
            op: 'section.replace',
            ref: { refType: 'temporary', tempId: 'el' },
            key: 'diagramElementMetadata',
            content: {
              role: 'SCREEN',
              canonicalReference: { entityType: 'TASK', entityId: TASK },
            },
          },
        ],
      });
      db.task.findMany.mockResolvedValue([]);
      await loader.load({ kind: 'diagramTargets', of: ['temporary:el'] });
      expect(loaded.diagramTargets.get(TASK)).toEqual(
        grouped ? { entityType: 'TASK', type: 'mockup' } : undefined,
      );
      expect(loaded.diagramTargets.has(DOC)).toBe(false);
    },
  );

  it('diagramTargets resolves canonical references written by the request', async () => {
    const { db, loader, loaded } = setup({
      operations: [
        {
          op: 'section.replace',
          ref: { refType: 'temporary', tempId: 'el' },
          key: 'diagramElementMetadata',
          content: {
            role: 'X',
            canonicalReference: { entityType: 'TASK', entityId: 't1' },
          },
        },
        {
          op: 'section.replace',
          ref: { refType: 'temporary', tempId: 'svc-el' },
          key: 'diagramElementMetadata',
          content: JSON.stringify({
            canonicalReference: { entityType: 'SERVICE', entityId: 'svc' },
          }),
        },
      ] as WorkItemChangeSetOperation[],
    });
    db.task.findMany.mockResolvedValue([{ id: 't1', type: 'FEATURE' }]);
    db.service.findMany.mockResolvedValue([{ id: 'svc' }]);

    await loader.load({
      kind: 'diagramTargets',
      of: ['temporary:el', 'temporary:svc-el'],
    });

    expect(db.task.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['t1'] }, ...LIVE },
      select: { id: true, type: true },
    });
    expect(db.service.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['svc'] }, ...LIVE },
      select: { id: true },
    });
    expect(loaded.diagramTargets.get('t1')).toEqual({
      entityType: 'TASK',
      type: 'FEATURE',
    });
    expect(loaded.diagramTargets.get('svc')).toEqual({
      entityType: 'SERVICE',
    });
  });

  it('services loads live project services', async () => {
    const { db, loader, loaded } = setup({});
    db.service.findMany.mockResolvedValue([{ id: 's1' }]);
    await loader.load({ kind: 'services', ids: ['s2', 's1', 's1'] });
    expect(db.service.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['s1', 's2'] }, ...LIVE },
      select: { id: true },
    });
    expect([...loaded.services]).toEqual(['s1']);
  });

  it('requirementCitations loads cited tasks and design docs across the organization', async () => {
    const { db, loader, loaded } = setup({
      operations: [
        {
          op: 'section.replace',
          ref: { refType: 'existing', id: 'feature' },
          key: 'requirements',
          content: {
            records: [
              {
                id: '77777777-7777-4777-8777-777777777777',
                statement: 'A requirement',
                designedBy: [
                  { entityType: 'DESIGN_DOC', entityId: DOC, entityTitle: 'D' },
                ],
                fulfilledBy: [
                  { entityType: 'TASK', entityId: TASK, entityTitle: 'T' },
                ],
                contracts: [],
              },
            ],
          },
        },
      ] as WorkItemChangeSetOperation[],
    });
    db.task.findMany.mockResolvedValue([
      { id: TASK, projectId: PROJECT, type: 'STANDARD' },
    ]);
    db.designDoc.findMany.mockResolvedValue([{ id: DOC, projectId: 'other' }]);

    await loader.load({
      kind: 'requirementCitations',
      feature: 'existing:feature',
      records: [
        {
          id: '77777777-7777-4777-8777-777777777777',
          statement: 'A requirement',
          designedBy: [
            { entityType: 'DESIGN_DOC', entityId: DOC, entityTitle: 'D' },
          ],
          fulfilledBy: [
            { entityType: 'TASK', entityId: TASK, entityTitle: 'T' },
          ],
          contracts: [],
        },
      ],
    });

    expect(db.task.findMany).toHaveBeenCalledWith({
      where: { id: { in: [TASK] }, organizationId: ORG, archivedAt: null },
      select: { id: true, projectId: true, type: true },
    });
    expect(db.designDoc.findMany).toHaveBeenCalledWith({
      where: { id: { in: [DOC] }, organizationId: ORG, archivedAt: null },
      select: { id: true, projectId: true },
    });
    expect(loaded.requirementCitations.get(DOC)).toEqual({
      entityType: 'DESIGN_DOC',
      projectId: 'other',
    });
  });

  it('warns when a single load returns more than 200 nodes', async () => {
    const { db, loader, logger } = setup({});
    db.task.findMany.mockResolvedValue(
      Array.from({ length: 201 }, (_, index) => ({ id: `c${index}` })),
    );
    const counts = await loader.loadAll([
      { kind: 'children', of: 'existing:root' },
    ]);
    expect(counts.children).toEqual({ loads: 1, nodes: 201, edges: 0 });
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });
});

describe('planProjection', () => {
  it('evaluates triggers without I/O and deduplicates loads', () => {
    const facts = deriveRequestFacts(
      {
        root: { refType: 'existing', id: 'root' },
        operations: [],
      } as unknown as WorkItemChangeSetValidationRequest,
      emptyState(),
    );
    const parentLoad: Load = { kind: 'parent', of: 'existing:x' };
    const rule = (id: string, active: boolean): AnyProjectionRule => ({
      id,
      appliesTo: () => (active ? { id } : null),
      loads: () => [parentLoad, { kind: 'services', ids: ['b', 'a'] }],
      check: jest.fn(),
    });

    const plan = planProjection({
      rules: [rule('one', true), rule('off', false), rule('two', true)],
      facts,
      registry: {} as WorkItemTypeRegistryService,
      projectId: PROJECT,
    });

    expect(plan.active.map(({ rule: value }) => value.id)).toEqual([
      'one',
      'two',
    ]);
    expect(plan.loads).toEqual([
      parentLoad,
      { kind: 'services', ids: ['b', 'a'] },
    ]);
  });
});
