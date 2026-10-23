import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { TaskService } from '../task.service';
import { WorkItemTypeRegistryService } from '../work-item-type-registry.service';
import { WorkItemParentageValidator } from '../work-item-parentage-validator.service';
import { WorkItemGraphParticipationComposer } from '../work-item-graph-participation';
import { WorkItemChangeSetMaterializerService } from '../../proposal/work-item-change-set-materializer.service';
import { WorkItemChangeSetProjectorService } from '../../proposal/work-item-change-set-projector.service';
import { normalizeDiagramChangeSet } from '../../proposal/diagram-change-set-compatibility';
import { workItemChangeSetValidationRequestSchema } from '../../proposal/work-item-change-set.schema';
import type { OrganizationId, ProjectId, TaskId } from '../../../types';
import type { CreateTaskDto } from '../../../generated';

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

const describeDatabase =
  process.env.RUN_DIAGRAM_DB_TESTS === '1' ? describe : describe.skip;

describeDatabase('Diagram migrated PostgreSQL boundaries', () => {
  const prisma = new PrismaService();
  const organizationId = randomUUID() as OrganizationId;
  const projectId = randomUUID() as ProjectId;
  let tasks: TaskService;
  let registry: WorkItemTypeRegistryService;
  let materializer: WorkItemChangeSetMaterializerService;
  const ids: string[] = [];
  const external = {
    publishInTransaction: jest.fn().mockResolvedValue(null),
    publish: jest.fn(),
    rollUpDirectPlanChild: jest.fn().mockResolvedValue([]),
  };

  beforeAll(async () => {
    await prisma.$connect();
    const database = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
      'SELECT current_database() AS name',
    );
    expect(database[0]?.name).toMatch(/^hey_hey_wt_/);
    await prisma.organization.create({
      data: {
        id: organizationId,
        name: 'Diagram integration fixture',
        slug: `diagram-test-${organizationId}`,
      },
    });
    await prisma.project.create({
      data: {
        id: projectId,
        organizationId,
        name: 'Diagram integration fixture',
      },
    });
    registry = new WorkItemTypeRegistryService(prisma, {} as never);
    await registry.refresh();
    const edges = { findIncident: jest.fn().mockResolvedValue([]) };
    tasks = new TaskService(
      prisma,
      external as never,
      {} as never,
      external as never,
      {} as never,
      {} as never,
      registry,
      new WorkItemParentageValidator(registry),
      new WorkItemGraphParticipationComposer(prisma, edges as never),
    );
    const projector = new WorkItemChangeSetProjectorService(
      prisma,
      registry,
      new WorkItemParentageValidator(registry),
      edges as never,
      (() => '') as never,
    );
    materializer = new WorkItemChangeSetMaterializerService(
      prisma,
      projector,
      tasks,
      edges as never,
      external as never,
      (() => '') as never,
      reconciliationStub(),
      registry,
      {} as never,
      { extractAndValidate: async () => [] } as never,
    );
  }, 30000);

  afterAll(async () => {
    await prisma.proposal.deleteMany({ where: { projectId } });
    await prisma.service.deleteMany({ where: { organizationId } });
    await prisma.taskSectionHistory.deleteMany({
      where: { taskId: { in: ids } },
    });
    await prisma.taskSection.deleteMany({ where: { taskId: { in: ids } } });
    await prisma.task.deleteMany({
      where: { id: { in: ids }, type: 'DIAGRAM_ELEMENT' },
    });
    await prisma.task.deleteMany({ where: { id: { in: ids } } });
    await prisma.project.deleteMany({ where: { id: projectId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.$disconnect();
  });

  async function create(input: CreateTaskDto) {
    const task = await prisma.$transaction((tx) =>
      tasks.createInTransaction(tx, organizationId, null, input, projectId),
    );
    ids.push(task.id);
    return task;
  }
  async function metadata(id: string, key: string) {
    const section = await prisma.taskSection.findFirstOrThrow({
      where: { taskId: id, key },
    });
    return JSON.parse(section.materializedMarkdown!);
  }

  it('loads persisted canonical definitions and persists explicit creation defaults', async () => {
    const migration = await prisma.$queryRaw<
      Array<{ success: boolean }>
    >`SELECT success FROM flyway_schema_history WHERE version = '2026.09.12.1'`;
    expect(migration).toEqual([{ success: true }]);
    const definitions = await prisma.workItemTypeTemplate.findMany({
      where: { typeKey: { in: ['DIAGRAM', 'DIAGRAM_ELEMENT'] } },
    });
    const rootDefinition = definitions.find(
      (definition) => definition.typeKey === 'DIAGRAM',
    );
    for (const edgeType of ['GUARANTEES', 'IMPLEMENTS', 'CONSUMES']) {
      expect(JSON.stringify(rootDefinition?.graphConfiguration)).toContain(
        edgeType,
      );
    }
    expect(
      await prisma.workItemType.count({
        where: { typeKey: { in: ['DIAGRAM', 'DIAGRAM_ELEMENT'] } },
      }),
    ).toBe(
      await prisma.workItemType.count({
        where: { typeKey: { in: ['workflow', 'workflow_step'] } },
      }),
    );
    expect(
      await prisma.workItemTypeTemplate.count({
        where: { typeKey: { in: ['DIAGRAM', 'DIAGRAM_ELEMENT'] } },
      }),
    ).toBe(2);
    expect(
      registry
        .getSectionDefinitions('DIAGRAM_ELEMENT', projectId)
        .find((s) => s.key === 'diagramElementMetadata')?.diagramElementPolicy
        ?.roles,
    ).toEqual(
      expect.arrayContaining([
        { key: 'AGENT', label: 'Agent', notation: 'box' },
        { key: 'PERSON', label: 'Person', notation: 'person' },
        { key: 'START', label: 'Start', notation: 'box' },
        { key: 'END', label: 'End', notation: 'box' },
      ]),
    );
    const root = await create({ name: 'Defaults', type: 'DIAGRAM' });
    const element = await create({
      name: 'Defaults child',
      type: 'DIAGRAM_ELEMENT',
      parentTaskId: root.id,
    });
    expect(await metadata(root.id, 'diagramMetadata')).toEqual({
      kind: 'GENERAL',
      level: 'OVERVIEW',
    });
    expect(await metadata(element.id, 'diagramElementMetadata')).toEqual({
      role: 'GENERIC',
    });
  });

  it.each([
    { roles: ['GENERIC'] },
    { roles: ['START'] },
    { roles: ['END'] },
    { roles: ['START', 'START', 'END', 'END'] },
  ])(
    'preserves optional and multiple markers on isolated elements: $roles',
    async ({ roles }) => {
      const root = await create({ name: 'Process scope', type: 'DIAGRAM' });
      for (const role of roles) {
        const label =
          role === 'START'
            ? 'User requests generation'
            : role === 'END'
              ? 'Request cancelled'
              : 'Review request';
        const element = await create({
          name: label,
          type: 'DIAGRAM_ELEMENT',
          parentTaskId: root.id,
          sections: [
            {
              key: 'diagramElementMetadata',
              content: JSON.stringify({ role }),
            },
          ],
        });
        const reopened = await tasks.findOne(
          organizationId,
          element.id as TaskId,
        );
        expect(reopened?.name).toBe(label);
        expect(await metadata(element.id, 'diagramElementMetadata')).toEqual({
          role,
        });
      }
    },
  );

  it.each(['DIAGRAM_REFERENCE', 'AGENT', 'START', 'END'])(
    'preserves %s through review serialization, materialization and recovery postconditions',
    async (role) => {
      const root = await create({ name: 'Reference root', type: 'DIAGRAM' });
      const target = await create({
        name: 'Reference target',
        type: 'DIAGRAM',
      });
      const element = await create({
        name: 'Reference child',
        type: 'DIAGRAM_ELEMENT',
        parentTaskId: root.id,
      });
      const content = {
        role,
        ...(role === 'DIAGRAM_REFERENCE'
          ? { canonicalReference: { entityType: 'TASK', entityId: target.id } }
          : {}),
      };
      const request = workItemChangeSetValidationRequestSchema.parse(
        JSON.parse(
          JSON.stringify({
            root: { refType: 'existing', id: root.id },
            operations: [
              {
                op: 'section.replace',
                ref: { refType: 'existing', id: element.id },
                key: 'diagramElementMetadata',
                content,
              },
            ],
          }),
        ),
      );
      const params = { proposalId: randomUUID(), organizationId, projectId };
      await prisma.proposal.create({
        data: {
          id: params.proposalId,
          organizationId,
          projectId,
          action: 'UPDATE',
          status: 'APPROVED',
          targetEntityId: root.id,
          targetEntityType: 'TASK',
          requestorId: randomUUID(),
          updates: JSON.parse(JSON.stringify(request)),
        },
      });
      const mappings = {
        workItems: { [`existing:${element.id}`]: element.id },
        relationships: {},
      };
      // Simulate interruption after a section write commits but before its
      // checkpoint completes. Retry must inspect the persisted postcondition.
      const originalApply = (materializer as any).applyOperation.bind(
        materializer,
      );
      const interruption = jest
        .spyOn(materializer as any, 'applyOperation')
        .mockImplementationOnce(async (...args: unknown[]) => {
          await originalApply(...args);
          throw new Error(
            'Injected interruption after committed section write',
          );
        });
      await expect(
        materializer.materializeApprovedChangeSet(params),
      ).rejects.toThrow('Injected interruption');
      interruption.mockRestore();
      expect(
        (await materializer.materializeApprovedChangeSet(params)).status,
      ).toBe('PUBLISHED');
      expect(await metadata(element.id, 'diagramElementMetadata')).toEqual(
        content,
      );
      expect(
        await (materializer as any).verifyOperationPostcondition(
          params,
          request.operations[0],
          mappings,
        ),
      ).toBe(true);
      await expect(
        prisma.$transaction((tx) =>
          tasks.updateInTransaction(
            tx,
            organizationId,
            null,
            element.id as TaskId,
            {
              sections: [
                {
                  key: 'diagramElementMetadata',
                  content: JSON.stringify({ role: 'DIAGRAM_REFERENCE' }),
                },
              ],
            },
          ),
        ),
      ).rejects.toThrow();
      await prisma.$transaction((tx) =>
        tasks.updateInTransaction(
          tx,
          organizationId,
          null,
          element.id as TaskId,
          {
            sections: [
              {
                key: 'diagramElementMetadata',
                content: JSON.stringify({ role: 'GENERIC' }),
              },
            ],
          },
        ),
      );
      expect(await metadata(element.id, 'diagramElementMetadata')).toEqual({
        role: 'GENERIC',
      });
      await prisma.task.update({
        where: { id: target.id },
        data: { status: 'ARCHIVED' },
      });
      expect(
        await tasks.findOne(organizationId, target.id as TaskId),
      ).toBeNull();
      await expect(
        create({
          name: 'Archived target',
          type: 'DIAGRAM_ELEMENT',
          parentTaskId: root.id,
          sections: [
            {
              key: 'diagramElementMetadata',
              content: JSON.stringify({
                role: 'DIAGRAM_REFERENCE',
                canonicalReference: { entityType: 'TASK', entityId: target.id },
              }),
            },
          ],
        }),
      ).rejects.toThrow();
    },
  );

  it('rejects invalid levels, parentage and Diagram targets without the reference role', async () => {
    await expect(
      create({
        name: 'Invalid',
        type: 'DIAGRAM',
        sections: [
          {
            key: 'diagramMetadata',
            content: JSON.stringify({ kind: 'GENERAL', level: 'CODE' }),
          },
        ],
      }),
    ).rejects.toThrow();
    await expect(
      create({ name: 'Orphan', type: 'DIAGRAM_ELEMENT' }),
    ).rejects.toThrow();
    const root = await create({
      name: 'Invalid reference root',
      type: 'DIAGRAM',
    });
    await expect(
      create({
        name: 'Invalid role',
        type: 'DIAGRAM_ELEMENT',
        parentTaskId: root.id,
        sections: [
          {
            key: 'diagramElementMetadata',
            content: JSON.stringify({
              role: 'GENERIC',
              canonicalReference: { entityType: 'TASK', entityId: root.id },
            }),
          },
        ],
      }),
    ).rejects.toThrow();
  });

  it('round-trips Service references and rejects inaccessible targets and undeclared roles', async () => {
    const root = await create({ name: 'Service root', type: 'DIAGRAM' });
    const service = await prisma.service.create({
      data: { name: 'Fixture service', organizationId, projectId, tags: [] },
    });
    const content = {
      role: 'SOFTWARE_SYSTEM',
      canonicalReference: { entityType: 'SERVICE', entityId: service.id },
    };
    const element = await create({
      name: 'Service element',
      type: 'DIAGRAM_ELEMENT',
      parentTaskId: root.id,
      sections: [
        { key: 'diagramElementMetadata', content: JSON.stringify(content) },
      ],
    });
    expect(await metadata(element.id, 'diagramElementMetadata')).toEqual(
      content,
    );
    const read = await tasks.findOne(organizationId, element.id as TaskId);
    expect(
      JSON.parse(
        read!.sections!.find(
          (section) => section.key === 'diagramElementMetadata',
        )!.materializedMarkdown!,
      ),
    ).toEqual(content);
    await expect(
      create({
        name: 'Unregistered role',
        type: 'DIAGRAM_ELEMENT',
        parentTaskId: root.id,
        sections: [
          {
            key: 'diagramElementMetadata',
            content: JSON.stringify({ role: 'PRESENTATION_ONLY' }),
          },
        ],
      }),
    ).rejects.toThrow('effective type definition');
    await prisma.service.update({
      where: { id: service.id },
      data: { projectId: null },
    });
    await expect(
      create({
        name: 'Wrong scope',
        type: 'DIAGRAM_ELEMENT',
        parentTaskId: root.id,
        sections: [
          { key: 'diagramElementMetadata', content: JSON.stringify(content) },
        ],
      }),
    ).rejects.toThrow('unavailable in this project');
  });

  it('normalizes historical review vocabulary without rewriting original evidence', async () => {
    const historical = workItemChangeSetValidationRequestSchema.parse({
      root: { refType: 'temporary', tempId: 'root' },
      operations: [
        {
          op: 'workItem.create',
          ref: { refType: 'temporary', tempId: 'root' },
          type: 'workflow',
          name: 'Historical review',
        },
      ],
    });
    const evidence = JSON.stringify(historical);
    const proposal = await prisma.proposal.create({
      data: {
        organizationId,
        projectId,
        action: 'CREATE',
        status: 'APPROVED',
        targetEntityId: randomUUID(),
        targetEntityType: 'TASK',
        requestorId: randomUUID(),
        updates: JSON.parse(evidence),
      },
    });
    const result = await materializer.materializeApprovedChangeSet({
      proposalId: proposal.id,
      organizationId,
      projectId,
    });
    expect(result.status).toBe('PUBLISHED');
    if (!result.rootWorkItemId) throw new Error('Missing materialized root');
    ids.push(result.rootWorkItemId);
    const root = await prisma.task.findUniqueOrThrow({
      where: { id: result.rootWorkItemId },
    });
    expect(root.type).toBe('DIAGRAM');
    expect(await metadata(root.id, 'diagramMetadata')).toEqual({
      kind: 'GENERAL',
      level: 'OVERVIEW',
    });
    expect(JSON.stringify(historical)).toBe(evidence);
    expect(
      (await prisma.proposal.findUniqueOrThrow({ where: { id: proposal.id } }))
        .updates,
    ).toEqual(historical);
    const recovered = await materializer.materializeApprovedChangeSet({
      proposalId: proposal.id,
      organizationId,
      projectId,
    });
    expect(recovered.rootWorkItemId).toBe(root.id);
    const intent =
      await prisma.workItemChangeSetMaterialization.findUniqueOrThrow({
        where: { proposalId: proposal.id },
        include: { checkpoints: true },
      });
    expect(intent.operationSet).toEqual(normalizeDiagramChangeSet(historical));
    expect(
      intent.checkpoints.every(
        (checkpoint) => checkpoint.status === 'COMPLETED',
      ),
    ).toBe(true);
  });

  it('round-trips nested groups, prunes deleted placements and leaves layout untouched', async () => {
    const root = await create({
      name: 'Multi-cloud deployment',
      type: 'DIAGRAM',
    });
    const east = await create({
      name: 'Checkout API',
      type: 'DIAGRAM_ELEMENT',
      parentTaskId: root.id,
    });
    const west = await create({
      name: 'Checkout API',
      type: 'DIAGRAM_ELEMENT',
      parentTaskId: root.id,
    });
    const layout = JSON.stringify({
      schemaVersion: 'work-item-graph-layout.v1',
      nodes: [
        {
          node: { kind: 'persistedWorkItem', workItemId: east.id },
          position: { x: 0, y: 0 },
        },
        {
          node: { kind: 'persistedWorkItem', workItemId: west.id },
          position: { x: 400, y: 0 },
        },
      ],
    });
    const write = (key: string, content: string) =>
      prisma.$transaction((tx) =>
        tasks.applySectionUpdatesInTransaction(
          tx,
          organizationId,
          root.id as TaskId,
          [{ key, content }],
        ),
      );
    await write('graphLayout', layout);
    const member = (workItemId: string) => ({
      kind: 'persistedWorkItem',
      workItemId,
    });
    const groups = {
      schemaVersion: 'diagram-groups.v1',
      groups: [
        {
          id: 'aws',
          label: 'AWS',
          meaning: 'DEPLOYMENT_BOUNDARY',
          members: [],
        },
        {
          id: 'east',
          label: 'us-east-1',
          meaning: 'DEPLOYMENT_BOUNDARY',
          parentGroupId: 'aws',
          members: [member(east.id)],
        },
        {
          id: 'west',
          label: 'us-west-2',
          meaning: 'DEPLOYMENT_BOUNDARY',
          parentGroupId: 'aws',
          members: [member(west.id)],
        },
      ],
    };
    await write('diagramGroups', JSON.stringify(groups));
    expect(await metadata(root.id, 'diagramGroups')).toEqual(groups);

    await expect(
      write(
        'diagramGroups',
        JSON.stringify({
          ...groups,
          groups: [
            {
              id: 'g',
              label: 'G',
              meaning: 'STRUCTURAL_BOUNDARY',
              members: [member(randomUUID())],
            },
          ],
        }),
      ),
    ).rejects.toThrow(/not an element of this Diagram/);

    await prisma.$transaction((tx) =>
      tasks.removeInTransaction(tx, organizationId, west.id as TaskId),
    );
    const pruned = await metadata(root.id, 'diagramGroups');
    expect(
      pruned.groups.find((group: { id: string }) => group.id === 'west')
        .members,
    ).toEqual([]);
    expect(await metadata(root.id, 'graphLayout')).toEqual(JSON.parse(layout));
  });
});
