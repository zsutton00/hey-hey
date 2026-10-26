import { randomUUID } from 'node:crypto';
import {
  materializeFutureRevision,
  parseFutureRevisionAuthoring,
  type FutureRevisionMaterializerPorts,
  type FutureTarget,
} from '../future-revision-materializer';
import { stageFutureRevision } from '../future-revision';
import {
  graphChangeSet,
  graphContentBasis,
  remapGraphProjection,
} from '../future-graph';
import {
  WorkItemChangeSetProjectorService,
  rootChildrenView,
} from '../work-item-change-set-projector.service';
import { WorkItemParentageValidator } from '../../tasks/work-item-parentage-validator.service';
import { createWarmWorkItemTypeRegistryWithCustomTypes } from '../../../../test/setup/work-item-type-registry.fixture';
import type {
  FutureRevisionContent,
  FutureRevisionUpdate,
  WorkItemGraphLayoutValue,
} from 'src/generated';
import type { OrganizationId, ProjectId } from 'src/types';

describe('future Diagram graph round trip through the generic projector', () => {
  const organizationId = randomUUID() as OrganizationId;
  const projectId = '22222222-2222-4222-8222-222222222222' as ProjectId;
  const rootId = randomUUID();
  const unchangedId = randomUUID();
  const removedId = randomUUID();
  const futureId = randomUUID();
  const oldEdgeId = randomUUID();
  const root = { refType: 'existing', id: rootId } as const;
  const unchanged = { refType: 'existing', id: unchangedId } as const;
  const removed = { refType: 'existing', id: removedId } as const;
  const added = { refType: 'temporary', tempId: 'new-element' } as const;
  const target: FutureTarget = {
    organizationId,
    projectId,
    targetEntityType: 'TASK',
    targetEntityId: rootId,
  };

  async function setup() {
    const relationship = {
      edgeType: 'RELATED_TO' as const,
      category: 'meta' as const,
      sourceEndpoint: {
        role: 'graphNode' as const,
        entityTypes: ['TASK' as const],
        workItemTypeKeys: ['DIAGRAM_ELEMENT'],
      },
      targetEndpoint: {
        role: 'graphNode' as const,
        entityTypes: ['TASK' as const],
        workItemTypeKeys: ['DIAGRAM_ELEMENT'],
      },
      metadataSchemaRef: '#/components/schemas/RelationshipMetadata',
    };
    const registry = await createWarmWorkItemTypeRegistryWithCustomTypes([
      {
        typeKey: 'DIAGRAM',
        projectId,
        capabilities: {
          requiresParent: false,
          graph: {
            nodeChildType: 'DIAGRAM_ELEMENT',
            layout: {
              sectionKey: 'graphLayout',
              schemaRef: 'WorkItemGraphLayoutValue',
            },
            groups: {
              sectionKey: 'diagramGroups',
              schemaRef: '#/components/schemas/DiagramGroupsValue',
            },
            readableRelationships: [relationship],
            editableRelationships: [relationship],
            rendererKey: 'work-item-graph',
            editorKey: 'work-item-graph-editor',
            supportedActions: [
              'createNode',
              'updateNode',
              'deleteNode',
              'createRelationship',
              'deleteRelationship',
              'replaceLayout',
            ],
          },
        },
        sectionDefinitions: [
          {
            key: 'diagramMetadata',
            label: 'Diagram',
            kind: 'json',
            schemaRef: '#/components/schemas/DiagramMetadata',
          },
          {
            key: 'graphLayout',
            label: 'Layout',
            kind: 'json',
            schemaRef: '#/components/schemas/WorkItemGraphLayoutValue',
          },
          {
            key: 'diagramGroups',
            label: 'Groups',
            kind: 'json',
            schemaRef: '#/components/schemas/DiagramGroupsValue',
          },
        ],
      },
      {
        typeKey: 'DIAGRAM_ELEMENT',
        projectId,
        allowedParentTypes: ['DIAGRAM'],
        sectionDefinitions: [
          {
            key: 'diagramElementMetadata',
            label: 'Role',
            kind: 'json',
            schemaRef: '#/components/schemas/DiagramElementMetadata',
            diagramElementPolicy: {
              roles: [
                { key: 'GENERIC', label: 'Element', notation: 'box' },
                { key: 'DIAGRAM_REFERENCE', label: 'Diagram', notation: 'box' },
              ],
              referenceTargets: [
                { entityType: 'TASK', workItemTypeKeys: ['DIAGRAM_ELEMENT'] },
              ],
            },
          },
        ],
      },
    ]);
    const task = (
      id: string,
      name: string,
      type: string,
      parentTaskId: string | null,
      sections: Array<{ key: string; materializedMarkdown: string }> = [],
    ) => ({
      id,
      organizationId,
      projectId,
      name,
      type,
      parentTaskId,
      status: 'ACTIVE',
      source: 'user',
      archivedAt: null,
      tag: null,
      serviceRelations: [],
      sections,
    });
    const rows = [
      task(rootId, 'Architecture', 'DIAGRAM', null, [
        {
          key: 'diagramMetadata',
          materializedMarkdown: JSON.stringify({
            kind: 'GENERAL',
            level: 'OVERVIEW',
          }),
        },
      ]),
      task(unchangedId, 'Keep', 'DIAGRAM_ELEMENT', rootId, [
        {
          key: 'diagramElementMetadata',
          materializedMarkdown: JSON.stringify({ role: 'GENERIC' }),
        },
      ]),
      task(removedId, 'Remove', 'DIAGRAM_ELEMENT', rootId, [
        {
          key: 'diagramElementMetadata',
          materializedMarkdown: JSON.stringify({ role: 'GENERIC' }),
        },
      ]),
    ];
    let storedFuture: Record<string, unknown> | null = null;
    const history: Record<string, unknown>[] = [];
    const db = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      task: {
        findMany: jest.fn(async ({ where }) =>
          rows.filter(
            (row) =>
              (!where.id ||
                (typeof where.id === 'string'
                  ? row.id === where.id
                  : where.id.in?.includes(row.id))) &&
              (!where.parentTaskId ||
                row.parentTaskId === where.parentTaskId) &&
              (!where.name || row.name === where.name),
          ),
        ),
        findFirst: jest.fn(
          async ({ where }) => rows.find((row) => row.id === where.id) ?? null,
        ),
      },
      service: { findMany: jest.fn().mockResolvedValue([]) },
      proposal: { findMany: jest.fn().mockResolvedValue([]) },
      proposalFuture: {
        findFirst: jest.fn(async () => storedFuture),
        create: jest.fn(async ({ data }) => {
          storedFuture = {
            dependencies: [],
            history: [],
            ...JSON.parse(JSON.stringify(data)),
          };
          return storedFuture;
        }),
        updateMany: jest.fn(async ({ data }) => {
          Object.assign(storedFuture!, JSON.parse(JSON.stringify(data)));
          return { count: 1 };
        }),
      },
      proposalFutureRevision: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn(async ({ data }) => {
          history.push(JSON.parse(JSON.stringify(data)));
        }),
      },
      proposalFutureDependency: {
        deleteMany: jest.fn(),
        createMany: jest.fn(),
      },
      workItemChangeSetMaterialization: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
    };
    const oldEdge = {
      id: oldEdgeId,
      sourceNodeId: unchangedId,
      targetNodeId: removedId,
      type: 'RELATED_TO',
      category: 'meta',
    };
    const edges = {
      findIncident: jest.fn().mockResolvedValue([oldEdge]),
      get: jest.fn().mockResolvedValue(oldEdge),
    };
    const projector = new WorkItemChangeSetProjectorService(
      { db } as never,
      registry,
      new WorkItemParentageValidator(registry),
      edges as never,
      () => 'test',
    );
    const baselineGraph = await projector.project({
      organizationId,
      projectId,
      request: { root, operations: [] },
      view: rootChildrenView,
    });
    const live: FutureRevisionContent = {
      id: rootId,
      organizationId,
      projectId,
      name: 'Architecture',
      type: 'DIAGRAM',
      status: 'ACTIVE',
      source: 'user',
      sections: rows[0]!.sections.map((section, order) => ({
        ...section,
        id: randomUUID(),
        order,
        materializedProposalId: randomUUID(),
      })),
      graph: baselineGraph,
    };
    const ports: FutureRevisionMaterializerPorts = {
      readLiveContent: async () => live,
      readLiveRevision: async () => 'baseline',
      renderTaskSections: (_project, _type, sections) =>
        sections.map((section) => ({
          key: section.key,
          content:
            typeof section.content === 'string'
              ? section.content
              : JSON.stringify(section.content),
        })),
      renderRequirementOps: async () => {
        throw new Error('Not a Feature');
      },
      projectGraph: async (_target, basis, request) => {
        const projection = await projector.project({
          organizationId,
          projectId,
          request,
          basis,
          view: rootChildrenView,
        });
        expect(projection.issues).toEqual([]);
        return projection;
      },
    };
    const materialize = async (
      changes: unknown,
      expectedRevision = 0,
    ): Promise<FutureRevisionUpdate> => {
      const input = parseFutureRevisionAuthoring(
        {
          operation: 'REVISE',
          futureId,
          expectedRevision,
          ...(expectedRevision === 0
            ? { baseline: { kind: 'LIVE' }, dependencies: [] }
            : {}),
          changes,
        },
        'TASK',
      );
      const mutation = await materializeFutureRevision(
        db as never,
        ports,
        target,
        input,
      );
      if (mutation.operation !== 'REVISE') throw new Error('Expected revision');
      return mutation;
    };
    const stage = async (mutation: FutureRevisionUpdate) =>
      stageFutureRevision(db as never, registry, {
        id: randomUUID(),
        organizationId,
        projectId,
        targetEntityId: rootId,
        targetEntityType: 'TASK',
        action: 'VERSIONED_UPDATE',
        updates: mutation,
      } as never);
    return {
      rows,
      live,
      db,
      baselineGraph,
      projector,
      materialize,
      stage,
      history,
      stored: () => storedFuture,
    };
  }

  it('stages a future from database nodes with null tags without violating the output contract', async () => {
    const h = await setup();
    const liveBefore = structuredClone(h.rows);
    const mutation = await h.materialize({ name: 'Updated architecture' });

    for (const content of [mutation.baseline.content, mutation.result]) {
      if (!('type' in content) || !content.graph)
        throw new Error('Expected captured Diagram graph');
      for (const node of [
        content.graph.projectedRoot,
        ...content.graph.children,
      ]) {
        expect(node).not.toHaveProperty('tag');
      }
    }
    await h.stage(mutation);
    expect(h.stored()).toMatchObject({ outcome: 'STAGED', revision: 1 });
    expect(h.rows).toEqual(liveBefore);
  });

  it('persists a complete non-live graph and refines a temporary create without losing its baseline or unchanged identities', async () => {
    const h = await setup();
    const liveBefore = structuredClone(h.rows);
    const first = await h.materialize({
      operations: [
        {
          op: 'relationship.delete',
          ref: { refType: 'existing', id: oldEdgeId },
        },
        { op: 'workItem.update', ref: unchanged, name: 'Renamed' },
        { op: 'workItem.delete', ref: removed },
        {
          op: 'workItem.create',
          ref: added,
          parent: root,
          type: 'DIAGRAM_ELEMENT',
          name: 'New',
        },
        {
          op: 'section.replace',
          ref: added,
          key: 'diagramElementMetadata',
          content: {
            role: 'GENERIC',
            canonicalReference: { entityType: 'TASK', entityId: unchangedId },
          },
        },
        {
          op: 'relationship.create',
          ref: { refType: 'temporary', tempId: 'new-link' },
          source: unchanged,
          target: added,
          edgeType: 'RELATED_TO',
          category: 'meta',
        },
        {
          op: 'layout.replace',
          root,
          sectionKey: 'graphLayout',
          entries: [
            { node: unchanged, position: { x: 10, y: 20 } },
            { node: added, position: { x: 90, y: 20 } },
          ],
        },
        {
          op: 'section.replace',
          ref: root,
          key: 'diagramGroups',
          content: {
            schemaVersion: 'diagram-groups.v1',
            groups: [
              {
                id: 'boundary',
                label: 'Owned',
                meaning: 'VISUAL_ASSOCIATION',
                members: [
                  { kind: 'persistedWorkItem', workItemId: unchangedId },
                  { kind: 'temporaryWorkItem', temporaryRef: added.tempId },
                ],
              },
            ],
          },
        },
      ],
    });
    await h.stage(first);
    expect(h.rows).toEqual(liveBefore);
    expect(h.stored()?.result).toEqual(first.result);
    expect(h.history).toHaveLength(1);
    h.rows[1]!.name = 'Concurrent live name';
    const second = await h.materialize(
      {
        operations: [
          { op: 'workItem.update', ref: added, name: 'Refined new' },
        ],
      },
      1,
    );
    await h.stage(second);
    expect(second.futureId).toBe(first.futureId);
    expect(second.baseline).toEqual(first.baseline);
    expect(h.rows[1]!.name).toBe('Concurrent live name');
    expect(h.history).toHaveLength(2);
    expect(
      second.graphChangeSet!.operations.filter(
        (op) => op.op === 'workItem.create',
      ),
    ).toEqual([expect.objectContaining({ ref: added, name: 'Refined new' })]);
    if (!('type' in second.result)) throw new Error('Expected work item');
    const after = second.result.graph!;
    expect(
      after.children.find(
        (node) =>
          node.identity.refType === 'existing' &&
          node.identity.id === unchangedId,
      ),
    ).toMatchObject({ name: 'Renamed', identity: unchanged });
    const replay = await h.projector.project({
      organizationId,
      projectId,
      request: second.graphChangeSet!,
      basis: h.baselineGraph,
      view: rootChildrenView,
    });
    expect(replay.issues).toEqual([]);
    expect(graphContentBasis(replay)).toEqual(graphContentBasis(after));
    const mapped = remapGraphProjection(
      after,
      { 'temporary:new-element': randomUUID() },
      { 'temporary:new-link': randomUUID() },
    );
    expect(
      mapped.children.every((node) => node.identity.refType === 'existing'),
    ).toBe(true);
    expect(mapped.children).toHaveLength(2);
    expect(
      (
        mapped.sections.find((section) => section.key === 'graphLayout')!
          .content as WorkItemGraphLayoutValue
      ).nodes.every((node) => node.node.kind === 'persistedWorkItem'),
    ).toBe(true);
    expect(graphChangeSet(h.baselineGraph, after)).toEqual(
      second.graphChangeSet,
    );
  });

  it('preserves explicit LOOP relationships without adding a direction the generic authoring contract rejects', async () => {
    const h = await setup();
    const after = structuredClone(h.baselineGraph);
    after.incidentRelationships.push({
      identity: { refType: 'temporary', tempId: 'loop' },
      label: 'LOOP',
      edgeType: 'LOOP',
      category: 'flow',
      source: unchanged,
      target: unchanged,
      predicate: 'retry',
      deleted: false,
    });
    const request = graphChangeSet(h.baselineGraph, after);
    expect(request.operations).toContainEqual({
      op: 'relationship.create',
      ref: { refType: 'temporary', tempId: 'loop' },
      source: unchanged,
      target: unchanged,
      edgeType: 'LOOP',
      category: 'flow',
      predicate: 'retry',
    });
    expect(() =>
      parseFutureRevisionAuthoring(
        {
          operation: 'REVISE',
          futureId,
          expectedRevision: 0,
          changes: { operations: request.operations },
          dependencies: [],
        },
        'TASK',
      ),
    ).not.toThrow();
  });

  it('rejects a graph edit to an unrelated canonical work item', async () => {
    const h = await setup();
    await expect(
      h.materialize({
        operations: [
          {
            op: 'workItem.update',
            ref: { refType: 'existing', id: randomUUID() },
            name: 'Wrong owner',
          },
        ],
      }),
    ).rejects.toThrow('within the selected graph');
    expect(h.stored()).toBeNull();
  });

  it('accepts the reported existing Diagram element update through authoring validation', async () => {
    const h = await setup();
    const mutation = await h.materialize({
      operations: [
        { op: 'workItem.update', ref: unchanged, name: 'Updated element' },
      ],
    });
    expect(mutation.graphChangeSet!.operations).toContainEqual({
      op: 'workItem.update',
      ref: unchanged,
      name: 'Updated element',
    });
    expect(h.rows[1]!.name).toBe('Keep');
  });

  it('rehydrates written Diagram metadata equal to the reviewed graph whether supplied as an object or JSON text', async () => {
    const h = await setup();
    const reviewed = await h.projector.project({
      organizationId,
      projectId,
      request: {
        root,
        operations: [
          {
            op: 'section.replace',
            ref: root,
            key: 'diagramMetadata',
            content: { kind: 'PROCESS', level: 'OVERVIEW' },
          },
          {
            op: 'section.replace',
            ref: unchanged,
            key: 'diagramElementMetadata',
            content: JSON.stringify({ role: 'DIAGRAM_REFERENCE' }),
          },
        ],
      },
      view: rootChildrenView,
    });

    // Materialization persists structured sections as JSON text.
    h.rows[0]!.sections[0]!.materializedMarkdown = JSON.stringify({
      kind: 'PROCESS',
      level: 'OVERVIEW',
    });
    h.rows[1]!.sections[0]!.materializedMarkdown = JSON.stringify({
      role: 'DIAGRAM_REFERENCE',
    });
    const rehydrated = await h.projector.project({
      organizationId,
      projectId,
      request: { root, operations: [] },
      view: rootChildrenView,
    });

    expect(graphContentBasis(rehydrated)).toEqual(graphContentBasis(reviewed));
    expect(
      rehydrated.projectedRoot.sections.find(
        (section) => section.key === 'diagramMetadata',
      )?.content,
    ).toEqual({ kind: 'PROCESS', level: 'OVERVIEW' });
  });
});
