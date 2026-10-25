import { AxiosError, AxiosHeaders } from 'axios';
import { PlanSubmissionAdmissionService } from '../../plan/plan-submission-admission.service';
import { PrismaService } from '../../../prisma/prisma.service';
import type {
  WorkItemChangeSetOperation,
  WorkItemChangeSetValidationRequest,
} from '../../../generated';
import type { OrganizationId, ProjectId } from '../../../types';
import {
  rootChildrenView,
  WorkItemChangeSetProjectorService,
} from '../work-item-change-set-projector.service';
import { createWarmWorkItemTypeRegistryWithCustomTypes } from '../../../../test/setup/work-item-type-registry.fixture';
import { WorkItemParentageValidator } from '../../tasks/work-item-parentage-validator.service';
import { EntityType } from '../../../generated/model/entityType';

const organizationId = '11111111-1111-4111-8111-111111111111' as OrganizationId;
const projectId = '22222222-2222-4222-8222-222222222222' as ProjectId;

function graphCapability(
  nodeType: string,
  metadataSchemaRef = '#/components/schemas/RelationshipMetadata',
) {
  const relationshipDeclaration = {
    edgeType: 'RELATED_TO' as const,
    category: 'meta' as const,
    sourceEndpoint: {
      role: 'graphNode' as const,
      entityTypes: ['TASK' as const],
      workItemTypeKeys: [nodeType],
    },
    targetEndpoint: {
      role: 'graphNode' as const,
      entityTypes: ['TASK' as const],
      workItemTypeKeys: [nodeType],
    },
    metadataSchemaRef,
  };
  const conditionalRelationshipDeclaration = {
    ...relationshipDeclaration,
    edgeType: 'CONDITIONAL' as const,
    category: 'flow' as const,
    direction: {
      required: true,
      allowedDirections: ['forward' as const],
      predicateRequired: true,
    },
  };

  return {
    nodeChildType: nodeType,
    layout: {
      sectionKey: 'graphLayout',
      schemaRef: 'WorkItemGraphLayoutValue',
    },
    layoutPreference: {
      sectionKey: 'graphLayoutPreference',
      schemaRef: 'WorkItemGraphLayoutPreferenceValue',
    },
    groups: {
      sectionKey: 'diagramGroups',
      schemaRef: '#/components/schemas/DiagramGroupsValue',
    },
    readableRelationships: [
      relationshipDeclaration,
      conditionalRelationshipDeclaration,
    ],
    editableRelationships: [
      relationshipDeclaration,
      conditionalRelationshipDeclaration,
    ],
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
  };
}

async function createProjector(
  metadataSchemaRef = '#/components/schemas/RelationshipMetadata',
  alphaNodeParentEntityTypes?: EntityType[],
) {
  const mockAgentEdgeClient = {
    findIncident: jest.fn().mockResolvedValue([]),
    // Resolves by id against whatever the test serves from findIncident.
    get: jest.fn(
      async (organization: string, project: string, edgeId: string) => {
        const everything = { has: () => true };
        const edges = (await mockAgentEdgeClient.findIncident(
          organization,
          project,
          { nodeIds: everything, types: everything },
        )) as Array<{ id: string }>;
        const found = edges.find((candidate) => candidate.id === edgeId);
        if (found) return found;
        throw new AxiosError('not found', '404', undefined, undefined, {
          status: 404,
          statusText: 'Not Found',
          data: {},
          headers: {},
          config: { headers: new AxiosHeaders() },
        });
      },
    ),
  };
  const prisma = {
    db: {
      task: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      service: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      proposal: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    },
  } as unknown as PrismaService;
  const registry = await createWarmWorkItemTypeRegistryWithCustomTypes([
    {
      typeKey: 'STANDARD',
      projectId,
      allowedParentTypes: ['FEATURE', 'STANDARD', 'PLAN_STAGE'],
      capabilities: { requiresParent: true },
      sectionDefinitions: [
        { key: 'description', label: 'Description', kind: 'markdown' },
        {
          key: 'acceptanceCriteria',
          label: 'Acceptance Criteria',
          kind: 'markdown',
        },
      ],
    },
    {
      typeKey: 'PLAN',
      projectId,
      allowedParentTypes: ['FEATURE'],
      capabilities: { requiresParent: true },
      sectionDefinitions: [
        { key: 'outcome', label: 'Outcome', kind: 'markdown' },
        { key: 'description', label: 'Description', kind: 'markdown' },
        {
          key: 'planConfiguration',
          label: 'Plan configuration',
          kind: 'json',
          schemaRef: '#/components/schemas/PlanConfigurationV1',
        },
      ],
    },
    {
      typeKey: 'PLAN_STAGE',
      projectId,
      allowedParentTypes: ['PLAN'],
      capabilities: { requiresParent: true },
      sectionDefinitions: [
        { key: 'description', label: 'Description', kind: 'markdown' },
      ],
    },
    {
      typeKey: 'CUSTOM_WORK_ITEM',
      projectId,
      allowedParentTypes: ['FEATURE'],
      sectionDefinitions: [
        { key: 'description', label: 'Description', kind: 'markdown' },
      ],
      capabilities: { requiresParent: true },
    },
    {
      typeKey: 'GRAPH_ALPHA',
      projectId,
      sectionDefinitions: graphSectionDefinitions(),
      capabilities: {
        requiresParent: false,
        graph: graphCapability('GRAPH_ALPHA_NODE', metadataSchemaRef),
      },
    },
    {
      typeKey: 'GRAPH_ALPHA_NODE',
      projectId,
      sectionDefinitions: [
        {
          key: 'diagramElementMetadata',
          label: 'Element metadata',
          kind: 'json',
          schemaRef: '#/components/schemas/DiagramElementMetadata',
        },
      ],
      allowedParentTypes: ['GRAPH_ALPHA'],
      allowedParentEntityTypes: alphaNodeParentEntityTypes,
      capabilities: {
        requiresParent: true,
      },
    },
    {
      typeKey: 'GRAPH_BETA',
      projectId,
      sectionDefinitions: graphSectionDefinitions(),
      capabilities: {
        requiresParent: false,
        graph: graphCapability('GRAPH_BETA_NODE', metadataSchemaRef),
      },
    },
    {
      typeKey: 'GRAPH_BETA_NODE',
      projectId,
      allowedParentTypes: ['GRAPH_BETA'],
      capabilities: {
        requiresParent: true,
      },
    },
    {
      typeKey: 'HTML_CSS_TYPE',
      projectId,
      sectionDefinitions: [
        { key: 'preview', label: 'Preview', kind: 'html/css' },
      ],
      capabilities: { requiresParent: false },
    },
    {
      typeKey: 'STRUCTURED_MOCKUP_TYPE',
      projectId,
      sectionDefinitions: [
        {
          key: 'mockup',
          label: 'Mockup',
          kind: 'structured-mockup',
        },
      ],
      capabilities: { requiresParent: false },
    },
  ]);
  return {
    projector: new WorkItemChangeSetProjectorService(
      prisma,
      registry,
      new WorkItemParentageValidator(registry),
      mockAgentEdgeClient as any,
      () => 'service-token',
    ),
    prisma,
    mockAgentEdgeClient,
  };
}

function validAlphaOperations(): WorkItemChangeSetOperation[] {
  return [
    {
      op: 'workItem.create',
      ref: { refType: 'temporary', tempId: 'root' },
      name: 'Alpha graph',
      type: 'GRAPH_ALPHA',
    },
    {
      op: 'workItem.create',
      ref: { refType: 'temporary', tempId: 'node-a' },
      name: 'Node A',
      type: 'GRAPH_ALPHA_NODE',
      parent: { refType: 'temporary', tempId: 'root' },
    },
    {
      op: 'workItem.create',
      ref: { refType: 'temporary', tempId: 'node-b' },
      name: 'Node B',
      type: 'GRAPH_ALPHA_NODE',
      parent: { refType: 'temporary', tempId: 'root' },
    },
    {
      op: 'section.replace',
      ref: { refType: 'temporary', tempId: 'root' },
      key: 'description',
      content: 'Graph root',
    },
    {
      op: 'relationship.create',
      ref: { refType: 'temporary', tempId: 'rel-a-b' },
      source: { refType: 'temporary', tempId: 'node-a' },
      target: { refType: 'temporary', tempId: 'node-b' },
      edgeType: 'RELATED_TO',
      category: 'meta',
    },
    {
      op: 'layout.replace',
      root: { refType: 'temporary', tempId: 'root' },
      sectionKey: 'graphLayout',
      entries: [
        {
          node: { refType: 'temporary', tempId: 'node-a' },
          position: { x: 0, y: 0 },
        },
        {
          node: { refType: 'temporary', tempId: 'node-b' },
          position: { x: 10, y: 0 },
        },
      ],
    },
  ];
}

function request(
  operations: WorkItemChangeSetOperation[],
): WorkItemChangeSetValidationRequest {
  return {
    root: { refType: 'temporary', tempId: 'root' },
    operations,
    layoutBoundary: [
      { refType: 'temporary', tempId: 'node-a' },
      { refType: 'temporary', tempId: 'node-b' },
    ],
  };
}

describe('WorkItemChangeSetProjectorService', () => {
  it.each(['START', 'END'])(
    'preserves explicit %s metadata alongside identities, relationships and positions',
    async (role) => {
      const { projector } = await createProjector();
      const operations = validAlphaOperations();
      operations.push({
        op: 'section.replace',
        ref: { refType: 'temporary', tempId: 'node-a' },
        key: 'diagramElementMetadata',
        content: { role },
      });
      const projected = await projector.project({
        organizationId,
        projectId,
        request: request(operations),
      });
      expect(projected.children).toEqual(
        expect.arrayContaining([expect.objectContaining({ name: 'Node A' })]),
      );
      expect(projected.incidentRelationships).toHaveLength(1);
      expect(
        projected.children.find((child) => child.name === 'Node A')?.sections,
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            key: 'diagramElementMetadata',
            content: { role },
          }),
        ]),
      );
      expect(projected.sections).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            key: 'graphLayout',
            content: expect.objectContaining({
              nodes: expect.arrayContaining([
                expect.objectContaining({ position: { x: 10, y: 0 } }),
              ]),
            }),
          }),
        ]),
      );
    },
  );
  it('projects a structured mockup document and rejects unsupported components', async () => {
    const { projector } = await createProjector();
    const root = {
      op: 'workItem.create' as const,
      ref: { refType: 'temporary' as const, tempId: 'root' },
      name: 'Structured mockup',
      type: 'STRUCTURED_MOCKUP_TYPE',
    };
    const document = {
      schemaVersion: 'work-item-structured-mockup.v3',
      revision: 1,
      annotations: [],
      content: [
        {
          type: 'button',
          props: {
            id: 'primary-action',
            label: 'Continue',
            width: { mode: 'fit' },
            height: { mode: 'content' },
          },
        },
      ],
    };
    const project = (content: unknown) =>
      projector.project({
        organizationId,
        projectId,
        request: {
          root: root.ref,
          layoutBoundary: [],
          operations: [
            root,
            { op: 'section.replace', ref: root.ref, key: 'mockup', content },
          ],
        },
      });

    const valid = await project(document);
    const invalid = await project({
      ...document,
      content: [{ type: 'video', props: { id: 'unsupported' } }],
    });

    expect(valid.valid).toBe(true);
    expect(valid.projectedRoot.sections).toEqual([
      { key: 'mockup', content: document },
    ]);
    expect(invalid.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'invalid_structured_mockup_section' }),
      ]),
    );
  });

  it('projects valid HTML/CSS source and rejects malformed section shapes', async () => {
    const { projector } = await createProjector();
    const createRoot = {
      op: 'workItem.create' as const,
      ref: { refType: 'temporary' as const, tempId: 'root' },
      name: 'HTML/CSS work item',
      type: 'HTML_CSS_TYPE',
    };
    const baseRequest = {
      root: { refType: 'temporary' as const, tempId: 'root' },
      layoutBoundary: [],
    };

    const valid = await projector.project({
      organizationId,
      projectId,
      request: {
        ...baseRequest,
        operations: [
          createRoot,
          {
            op: 'section.replace',
            ref: createRoot.ref,
            key: 'preview',
            content: { html: '<main>Preview</main>', css: '' },
          },
        ],
      },
    });
    const invalid = await projector.project({
      organizationId,
      projectId,
      request: {
        ...baseRequest,
        operations: [
          createRoot,
          {
            op: 'section.replace',
            ref: createRoot.ref,
            key: 'preview',
            content: { html: '<main>Preview</main>' },
          },
        ],
      },
    });

    expect(valid.valid).toBe(true);
    expect(valid.projectedRoot.sections).toEqual([
      {
        key: 'preview',
        content: { html: '<main>Preview</main>', css: '' },
      },
    ]);
    expect(invalid.valid).toBe(false);
    expect(invalid.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'invalid_html_css_section' }),
      ]),
    );
  });

  it('enforces authored-section invariants without requiring Service coverage for direct Plan Stage tasks', async () => {
    const { projector, prisma } = await createProjector();
    const planId = '33333333-3333-4333-8333-333333333333';
    (prisma.db.task.findMany as jest.Mock).mockResolvedValue([
      persistedTask(planId, 'Plan', 'PLAN'),
    ]);

    const projected = await projector.project({
      organizationId,
      projectId,
      request: {
        root: { refType: 'temporary', tempId: 'stage' },
        operations: [
          {
            op: 'workItem.create',
            ref: { refType: 'temporary', tempId: 'stage' },
            name: 'Stage',
            type: 'PLAN_STAGE',
            parent: { refType: 'existing', id: planId },
          },
          {
            op: 'workItem.create',
            ref: { refType: 'temporary', tempId: 'task' },
            name: 'Task',
            type: 'STANDARD',
            parent: { refType: 'temporary', tempId: 'stage' },
          },
        ],
      },
    });

    expect(projected.valid).toBe(false);
    expect(projected.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'nodes.temporary:task.sections.description',
          code: 'missing_required_section',
        }),
        expect.objectContaining({
          field: 'nodes.temporary:task.sections.acceptanceCriteria',
          code: 'missing_required_section',
        }),
      ]),
    );
  });

  it('accepts missing Plan Task Service scope when all durable content is valid', async () => {
    const { projector, prisma } = await createProjector();
    const planId = '33333333-3333-4333-8333-333333333333';
    const stageId = '44444444-4444-4444-8444-444444444444';
    (prisma.db.task.findMany as jest.Mock).mockImplementation(
      async ({ where }) =>
        [
          persistedTask(planId, 'Plan', 'PLAN'),
          persistedTask(stageId, 'Stage', 'PLAN_STAGE', planId),
        ].filter((task) => where.id?.in?.includes(task.id)),
    );

    const projected = await projector.project({
      organizationId,
      projectId,
      request: {
        root: { refType: 'existing', id: planId },
        operations: [
          {
            op: 'workItem.create',
            ref: { refType: 'temporary', tempId: 'task' },
            name: 'Task',
            type: 'STANDARD',
            parent: { refType: 'existing', id: stageId },
          },
          {
            op: 'section.replace',
            ref: { refType: 'temporary', tempId: 'task' },
            key: 'description',
            content: 'Description',
          },
          {
            op: 'section.replace',
            ref: { refType: 'temporary', tempId: 'task' },
            key: 'acceptanceCriteria',
            content: '- Accepted',
          },
        ],
      },
    });

    expect(projected.valid).toBe(true);
    expect(projected.issues).toEqual([]);
  });

  it('retains out-of-project Service validation for an ordinary STANDARD task', async () => {
    const { projector, prisma } = await createProjector();
    const taskId = '33333333-3333-4333-8333-333333333333';
    const invalidServiceId = '44444444-4444-4444-8444-444444444444';
    (prisma.db.task.findMany as jest.Mock).mockResolvedValue([
      persistedTask(taskId, 'Ordinary task', 'STANDARD'),
    ]);
    (prisma.db.service.findMany as jest.Mock).mockResolvedValue([]);

    const projected = await projector.project({
      organizationId,
      projectId,
      request: {
        root: { refType: 'existing', id: taskId },
        operations: [
          {
            op: 'workItem.update',
            ref: { refType: 'existing', id: taskId },
            serviceIds: [invalidServiceId],
          },
        ],
      },
    });

    expect(projected.valid).toBe(false);
    expect(projected.issues).toEqual([
      expect.objectContaining({
        field: 'operations[0].serviceIds',
        code: 'entity_not_found',
      }),
    ]);
  });

  it('uses registry roles for BUG, custom work-item, and project-info service scope', async () => {
    const serviceId = '33333333-3333-4333-8333-333333333333';
    const rootId = '44444444-4444-4444-8444-444444444444';
    const bugId = '55555555-5555-4555-8555-555555555555';
    const { projector, prisma } = await createProjector();
    (prisma.db.service.findMany as jest.Mock).mockResolvedValue([
      { id: serviceId },
    ]);
    (prisma.db.task.findMany as jest.Mock).mockImplementation(
      async ({ where }) =>
        [
          persistedTask(rootId, 'Root', 'FEATURE'),
          persistedTask(bugId, 'Bug', 'BUG', rootId),
        ].filter((task) => where.id?.in?.includes(task.id)),
    );

    const bugProjection = await projector.project({
      organizationId,
      projectId,
      request: {
        root: { refType: 'existing', id: bugId },
        operations: [
          {
            op: 'workItem.update',
            ref: { refType: 'existing', id: bugId },
            serviceIds: [serviceId],
          },
        ],
      },
    });
    expect(bugProjection.valid).toBe(true);

    const customProjection = await projector.project({
      organizationId,
      projectId,
      request: {
        root: { refType: 'existing', id: rootId },
        operations: [
          {
            op: 'workItem.create',
            ref: { refType: 'temporary', tempId: 'custom' },
            name: 'Custom work item',
            type: 'CUSTOM_WORK_ITEM',
            parent: { refType: 'existing', id: rootId },
            serviceIds: [serviceId],
          },
        ],
      },
    });
    expect(customProjection.valid).toBe(true);

    const projectInfoProjection = await projector.project({
      organizationId,
      projectId,
      request: {
        root: { refType: 'existing', id: rootId },
        operations: [
          {
            op: 'workItem.update',
            ref: { refType: 'existing', id: rootId },
            serviceIds: [serviceId],
          },
        ],
      },
    });
    expect(projectInfoProjection.valid).toBe(false);
    expect(projectInfoProjection.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'operations[0].serviceIds',
          code: 'invalid_field',
          reason: expect.stringContaining('registry role'),
        }),
      ]),
    );
  });

  it('uses the supplied transaction client for projection hydration', async () => {
    const { projector, prisma } = await createProjector();
    const featureId = '55555555-5555-4555-8555-555555555555';
    const transactionTaskFindMany = jest
      .fn()
      .mockResolvedValue([
        { ...persistedTask(featureId, 'Feature', 'FEATURE'), tag: 'product' },
      ]);
    const transactionDb = {
      task: { findMany: transactionTaskFindMany },
      service: { findMany: jest.fn().mockResolvedValue([]) },
    } as any;

    const projected = await projector.project({
      organizationId,
      projectId,
      db: transactionDb,
      request: {
        root: { refType: 'existing', id: featureId },
        operations: [
          {
            op: 'section.replace',
            ref: { refType: 'existing', id: featureId },
            key: 'requirements',
            content: { records: [] },
          },
        ],
      },
    });

    expect(projected.valid).toBe(true);
    expect(projected.issues).toEqual([]);
    expect(transactionTaskFindMany).toHaveBeenCalled();
    expect(prisma.db.task.findMany).not.toHaveBeenCalled();
    expect(projected.projectedRoot.tag).toBe('product');
  });

  it('requires multiple Plan Stages to form one linear dependency chain', async () => {
    const { projector, prisma } = await createProjector();
    const featureId = '44444444-4444-4444-8444-444444444444';
    (prisma.db.task.findMany as jest.Mock).mockResolvedValue([
      persistedTask(featureId, 'Feature', 'FEATURE'),
    ]);

    const projected = await projector.project({
      organizationId,
      projectId,
      request: {
        root: { refType: 'temporary', tempId: 'plan' },
        operations: [
          {
            op: 'workItem.create',
            ref: { refType: 'temporary', tempId: 'plan' },
            name: 'Plan',
            type: 'PLAN',
            parent: { refType: 'existing', id: featureId },
          },
          {
            op: 'workItem.create',
            ref: { refType: 'temporary', tempId: 'stage-a' },
            name: 'Stage A',
            type: 'PLAN_STAGE',
            parent: { refType: 'temporary', tempId: 'plan' },
          },
          {
            op: 'workItem.create',
            ref: { refType: 'temporary', tempId: 'stage-b' },
            name: 'Stage B',
            type: 'PLAN_STAGE',
            parent: { refType: 'temporary', tempId: 'plan' },
          },
        ],
      },
    });

    expect(projected.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'plan_stage_disconnected',
          metadata: expect.objectContaining({
            planIdentity: 'temporary:plan',
            firstStageIdentities: ['temporary:stage-a', 'temporary:stage-b'],
          }),
        }),
      ]),
    );
  });

  it('returns before draft enumeration for non-Stage create and update candidates', async () => {
    const { projector, prisma } = await createProjector();
    const taskId = '45454545-4545-4545-8545-454545454545';
    (prisma.db.task.findMany as jest.Mock).mockResolvedValue([
      {
        id: taskId,
        type: 'STANDARD',
        parentTaskId: '46464646-4646-4646-8646-464646464646',
      },
    ]);

    await expect(
      projector.projectPlanStageProposalCandidates({
        organizationId,
        projectId,
        candidates: [
          {
            proposal: {
              type: 'SINGLE',
              action: 'CREATE',
              targetEntityId: '00000000-0000-0000-0000-000000000000',
              targetEntityType: 'TASK',
              title: 'Ordinary task',
              updates: {
                name: 'Ordinary task',
                type: 'STANDARD',
                parentTaskId: '46464646-4646-4646-8646-464646464646',
              },
            },
          },
          {
            proposal: {
              type: 'SINGLE',
              action: 'UPDATE',
              targetEntityId: taskId,
              targetEntityType: 'TASK',
              title: 'Rename ordinary task',
              updates: { name: 'Renamed ordinary task' },
            },
          },
        ],
      }),
    ).resolves.toEqual([]);

    expect(prisma.db.task.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.db.task.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { in: [taskId] } }),
        select: { id: true, type: true, parentTaskId: true },
      }),
    );
    expect(prisma.db.proposal.findMany).not.toHaveBeenCalled();
  });

  describe('Plan Task dependency candidates', () => {
    const planId = '51515151-5151-4515-8515-515151515151';
    const stageAId = '52525252-5252-4525-8525-525252525252';
    const stageBId = '53535353-5353-4535-8535-535353535353';
    const taskAId = '54545454-5454-4545-8545-545454545454';
    const taskBId = '55555555-5555-4555-8555-555555555551';

    async function planProjector() {
      const created = await createProjector();
      (created.prisma.db.task.findMany as jest.Mock).mockResolvedValue([
        persistedTask(planId, 'Plan', 'PLAN'),
        persistedTask(stageAId, 'Stage A', 'PLAN_STAGE', planId),
        persistedTask(stageBId, 'Stage B', 'PLAN_STAGE', planId),
        persistedTask(taskAId, 'Task A', 'STANDARD', stageAId),
        persistedTask(taskBId, 'Task B', 'STANDARD', stageBId),
      ]);
      return created;
    }

    function createTaskCandidate(dependencyTargetId: string) {
      return {
        proposal: {
          type: 'SINGLE' as const,
          action: 'CREATE' as const,
          targetEntityId: '00000000-0000-0000-0000-000000000000',
          targetEntityType: 'TASK' as const,
          title: 'New Plan Task',
          updates: {
            name: 'New Plan Task',
            type: 'STANDARD',
            parentTaskId: stageAId,
          },
          edges: [
            {
              targetEntityId: dependencyTargetId,
              targetEntityType: 'TASK' as const,
              edgeType: 'DEPENDS_ON' as const,
            },
          ],
        },
      };
    }

    it('rejects a Task create depending on a Task in another Stage', async () => {
      const { projector, prisma } = await planProjector();

      const issues = await projector.projectPlanStageProposalCandidates({
        organizationId,
        projectId,
        candidates: [createTaskCandidate(taskBId)],
      });

      expect(issues).toEqual([
        expect.objectContaining({
          field: 'relationships.temporary:proposal-edge-0',
          code: 'cross_boundary_dependency',
          layer: 'referential',
        }),
      ]);
      expect(prisma.db.proposal.findMany).not.toHaveBeenCalled();
    });

    it('accepts a Task create depending on a Task in the same Stage', async () => {
      const { projector } = await planProjector();

      await expect(
        projector.projectPlanStageProposalCandidates({
          organizationId,
          projectId,
          candidates: [createTaskCandidate(taskAId)],
        }),
      ).resolves.toEqual([]);
    });

    it('rejects an edge-only Task update that crosses Stages', async () => {
      const { projector } = await planProjector();

      const issues = await projector.projectPlanStageProposalCandidates({
        organizationId,
        projectId,
        candidates: [
          {
            proposal: {
              type: 'SINGLE',
              action: 'UPDATE',
              targetEntityId: taskAId,
              targetEntityType: 'TASK',
              title: 'Task A',
              updates: {},
              edges: [
                {
                  targetEntityId: taskBId,
                  targetEntityType: 'TASK',
                  edgeType: 'DEPENDS_ON',
                },
              ],
            },
          },
        ],
      });

      expect(issues).toEqual([
        expect.objectContaining({
          field: 'relationships.temporary:proposal-edge-0',
          code: 'cross_boundary_dependency',
        }),
      ]);
    });
  });

  it('validates both canonical parents when a submitted Stage update reparents', async () => {
    const { projector, prisma } = await createProjector();
    const oldPlanId = '56565656-5656-4656-8656-565656565656';
    const newPlanId = '57575757-5757-4757-8757-575757575757';
    const stageId = '58585858-5858-4858-8858-585858585858';
    (prisma.db.task.findMany as jest.Mock).mockImplementation(
      ({ where }: { where: { id?: { in?: string[] } } }) => {
        if (where.id?.in?.includes(stageId)) {
          return Promise.resolve([
            { id: stageId, type: 'PLAN_STAGE', parentTaskId: oldPlanId },
          ]);
        }
        return Promise.resolve([]);
      },
    );
    (prisma.db.proposal.findMany as jest.Mock).mockResolvedValue([]);
    const project = jest
      .spyOn(projector, 'project')
      .mockResolvedValue({ issues: [] } as never);

    await expect(
      projector.projectPlanStageProposalCandidates({
        organizationId,
        projectId,
        candidates: [
          {
            proposalId: '59595959-5959-4959-8959-595959595959',
            proposal: {
              type: 'SINGLE',
              action: 'UPDATE',
              targetEntityId: stageId,
              targetEntityType: 'TASK',
              title: 'Move Stage',
              updates: { parentTaskId: newPlanId },
              edges: [
                {
                  endpointMode: 'PROPOSAL',
                  targetEntityType: 'PROPOSAL',
                  targetEntityId: '69696969-6969-4969-8969-696969696969',
                  edgeType: 'DEPENDS_ON',
                },
              ],
            },
          },
        ],
      }),
    ).resolves.toEqual([]);

    expect(project.mock.calls.map(([call]) => call.request.root)).toEqual([
      { refType: 'existing', id: oldPlanId },
      { refType: 'existing', id: newPlanId },
    ]);
    for (const [call] of project.mock.calls) {
      expect(
        call.request.operations.some(
          (operation) => operation.op === 'relationship.create',
        ),
      ).toBe(false);
    }
    expect(prisma.db.proposal.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { notIn: ['59595959-5959-4959-8959-595959595959'] },
          OR: expect.any(Array),
        }),
      }),
    );
  });

  it.each(['ENTITY', 'PROPOSAL'] as const)(
    'expands referenced draft content only for ENTITY links (%s mode)',
    async (endpointMode) => {
      const { projector, prisma } = await createProjector();
      const planId = '60606060-6060-4060-8060-606060606060';
      const targetProposalId = '63636363-6363-4363-8363-636363636363';
      const target = {
        id: targetProposalId,
        action: 'CREATE',
        targetEntityType: 'TASK',
        targetEntityId: '00000000-0000-0000-0000-000000000000',
        title: 'Unrelated draft',
        updates: { name: 'Unrelated draft', type: 'FEATURE', tag: 'product' },
        edges: [],
      };
      (prisma.db.proposal.findMany as jest.Mock).mockImplementation(
        ({ where }) => Promise.resolve(where.id?.in ? [target] : []),
      );
      const project = jest
        .spyOn(projector, 'project')
        .mockResolvedValue({ issues: [] } as never);

      await projector.projectPlanStageProposalCandidates({
        organizationId,
        projectId,
        candidates: [
          {
            proposal: {
              type: 'SINGLE',
              action: 'CREATE',
              targetEntityType: 'TASK',
              targetEntityId: '00000000-0000-0000-0000-000000000000',
              title: 'New Stage',
              updates: {
                name: 'New Stage',
                type: 'PLAN_STAGE',
                parentTaskId: planId,
              },
              edges: [
                {
                  endpointMode,
                  targetEntityType: 'PROPOSAL',
                  targetEntityId: targetProposalId,
                  edgeType: 'DEPENDS_ON',
                },
              ],
            },
          },
        ],
      });

      const operations = project.mock.calls[0]![0].request.operations;
      expect(
        operations.filter((operation) => operation.op === 'workItem.create'),
      ).toHaveLength(endpointMode === 'ENTITY' ? 2 : 1);
      expect(
        operations.filter(
          (operation) => operation.op === 'relationship.create',
        ),
      ).toHaveLength(endpointMode === 'ENTITY' ? 1 : 0);
      expect(
        (prisma.db.proposal.findMany as jest.Mock).mock.calls.some(
          ([{ where }]) => where.id?.in?.includes(targetProposalId),
        ),
      ).toBe(endpointMode === 'ENTITY');
    },
  );

  it('expands affected plans through pending Stage reparenting', async () => {
    const { projector, prisma } = await createProjector();
    const oldPlanId = '60606060-6060-4060-8060-606060606060';
    const newPlanId = '61616161-6161-4161-8161-616161616161';
    const stageId = '62626262-6262-4262-8262-626262626262';
    const pendingProposalId = '63636363-6363-4363-8363-636363636363';
    (prisma.db.task.findMany as jest.Mock).mockImplementation(
      ({ where }: { where: { parentTaskId?: { in?: string[] } } }) => {
        if (where.parentTaskId?.in?.includes(oldPlanId)) {
          return Promise.resolve([
            { id: stageId, type: 'PLAN_STAGE', parentTaskId: oldPlanId },
          ]);
        }
        return Promise.resolve([]);
      },
    );
    (prisma.db.proposal.findMany as jest.Mock).mockImplementation(
      ({ where }: { where: object }) =>
        JSON.stringify(where).includes(oldPlanId)
          ? Promise.resolve([
              {
                id: pendingProposalId,
                action: 'UPDATE',
                targetEntityId: stageId,
                targetEntityType: 'TASK',
                title: 'Move pending Stage',
                updates: { parentTaskId: newPlanId },
                edges: [],
              },
            ])
          : Promise.resolve([]),
    );
    const project = jest
      .spyOn(projector, 'project')
      .mockResolvedValue({ issues: [] } as never);

    await projector.projectPlanStageProposalCandidates({
      organizationId,
      projectId,
      candidates: [
        {
          proposal: {
            type: 'SINGLE',
            action: 'CREATE',
            targetEntityId: '00000000-0000-0000-0000-000000000000',
            targetEntityType: 'TASK',
            title: 'New Stage',
            updates: {
              name: 'New Stage',
              type: 'PLAN_STAGE',
              parentTaskId: oldPlanId,
            },
          },
        },
      ],
    });

    expect(project.mock.calls.map(([call]) => call.request.root)).toEqual([
      { refType: 'existing', id: oldPlanId },
      { refType: 'existing', id: newPlanId },
    ]);
  });

  it('projects prior DRAFT Stage proposals with the current candidate before admission', async () => {
    const { projector, prisma } = await createProjector();
    const planId = '47474747-4747-4474-8474-474747474747';
    const firstProposalId = '48484848-4848-4484-8484-484848484848';
    const secondProposalId = '49494949-4949-4494-8494-494949494949';
    (prisma.db.task.findMany as jest.Mock).mockImplementation(({ where }) =>
      Promise.resolve(
        where.id?.in?.includes(planId)
          ? [persistedTask(planId, 'Plan', 'PLAN')]
          : [],
      ),
    );
    (prisma.db.proposal.findMany as jest.Mock).mockResolvedValue([
      {
        id: firstProposalId,
        type: 'SINGLE',
        action: 'CREATE',
        targetEntityId: '00000000-0000-0000-0000-000000000000',
        targetEntityType: 'TASK',
        title: 'Stage A',
        updates: {
          name: 'Stage A',
          type: 'PLAN_STAGE',
          parentTaskId: planId,
          sections: [{ key: 'description', content: 'First milestone.' }],
        },
        edges: [],
      },
      {
        id: secondProposalId,
        type: 'SINGLE',
        action: 'CREATE',
        targetEntityId: '00000000-0000-0000-0000-000000000000',
        targetEntityType: 'TASK',
        title: 'Stage B',
        updates: {
          name: 'Stage B',
          type: 'PLAN_STAGE',
          parentTaskId: planId,
          sections: [{ key: 'description', content: 'Second milestone.' }],
        },
        edges: [
          {
            edgeType: 'DEPENDS_ON',
            targetEntityType: 'PROPOSAL',
            targetEntityId: firstProposalId,
          },
        ],
      },
    ]);

    const issues = await projector.projectPlanStageProposalCandidates({
      organizationId,
      projectId,
      candidates: [
        {
          proposal: {
            type: 'SINGLE',
            action: 'CREATE',
            targetEntityId: '00000000-0000-0000-0000-000000000000',
            targetEntityType: 'TASK',
            title: 'Stage C',
            updates: {
              name: 'Stage C',
              type: 'PLAN_STAGE',
              parentTaskId: planId,
              sections: [
                { key: 'description', content: 'Competing milestone.' },
              ],
            },
            edges: [
              {
                edgeType: 'DEPENDS_ON',
                targetEntityType: 'PROPOSAL',
                targetEntityId: firstProposalId,
              },
            ],
          },
        },
      ],
    });

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'plan_stage_branching',
          metadata: expect.objectContaining({
            stageIdentity: `temporary:proposal-${firstProposalId}`,
            successorStageIdentities: expect.arrayContaining([
              `temporary:proposal-${secondProposalId}`,
              'temporary:proposal-candidate-2',
            ]),
          }),
        }),
      ]),
    );
  });

  it('resolves grouped Stage dependencies through reserved TASK identities', async () => {
    const { projector, prisma } = await createProjector();
    const planId = '53535353-5353-4353-8353-535353535353';
    const firstReservedId = '54545454-5454-4454-8454-545454545454';
    const secondReservedId = '55555555-5555-4555-8555-555555555555';
    (prisma.db.task.findMany as jest.Mock).mockImplementation(({ where }) =>
      Promise.resolve(
        where.id?.in?.includes(planId)
          ? [persistedTask(planId, 'Plan', 'PLAN')]
          : [],
      ),
    );
    (prisma.db.proposal.findMany as jest.Mock).mockResolvedValue([]);

    const issues = await projector.projectPlanStageProposalCandidates({
      organizationId,
      projectId,
      candidates: [
        {
          proposal: {
            type: 'SINGLE',
            action: 'CREATE',
            targetEntityId: firstReservedId,
            targetEntityType: 'TASK',
            title: 'Stage A',
            updates: {
              name: 'Stage A',
              type: 'PLAN_STAGE',
              parentTaskId: planId,
            },
            edges: [],
          },
        },
        {
          proposal: {
            type: 'SINGLE',
            action: 'CREATE',
            targetEntityId: secondReservedId,
            targetEntityType: 'TASK',
            title: 'Stage B',
            updates: {
              name: 'Stage B',
              type: 'PLAN_STAGE',
              parentTaskId: planId,
            },
            edges: [
              {
                edgeType: 'DEPENDS_ON',
                targetEntityType: 'TASK',
                targetEntityId: firstReservedId,
              },
            ],
          },
        },
      ],
    });

    expect(issues).toEqual([]);
  });

  it('identifies a dependency on a Stage proposal owned by another Plan', async () => {
    const { projector, prisma } = await createProjector();
    const planId = '50505050-5050-4050-8050-505050505050';
    const otherPlanId = '51515151-5151-4151-8151-515151515151';
    const otherStageProposalId = '52525252-5252-4252-8252-525252525252';
    (prisma.db.task.findMany as jest.Mock).mockImplementation(({ where }) => {
      const ids = where.id?.in ?? [];
      return Promise.resolve(
        [
          persistedTask(planId, 'Plan', 'PLAN'),
          persistedTask(otherPlanId, 'Other Plan', 'PLAN'),
        ].filter((task) => ids.includes(task.id)),
      );
    });
    (prisma.db.proposal.findMany as jest.Mock).mockResolvedValue([
      {
        id: otherStageProposalId,
        type: 'SINGLE',
        action: 'CREATE',
        targetEntityId: '00000000-0000-0000-0000-000000000000',
        targetEntityType: 'TASK',
        title: 'Other Stage',
        updates: {
          name: 'Other Stage',
          type: 'PLAN_STAGE',
          parentTaskId: otherPlanId,
        },
        edges: [],
      },
    ]);

    const issues = await projector.projectPlanStageProposalCandidates({
      organizationId,
      projectId,
      candidates: [
        {
          proposal: {
            type: 'SINGLE',
            action: 'CREATE',
            targetEntityId: '00000000-0000-0000-0000-000000000000',
            targetEntityType: 'TASK',
            title: 'Stage A',
            updates: {
              name: 'Stage A',
              type: 'PLAN_STAGE',
              parentTaskId: planId,
            },
            edges: [
              {
                edgeType: 'DEPENDS_ON',
                targetEntityType: 'PROPOSAL',
                targetEntityId: otherStageProposalId,
              },
            ],
          },
        },
      ],
    });

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'plan_stage_reference_outside_plan',
          metadata: expect.objectContaining({
            sourceStageIdentity: 'temporary:proposal-candidate-1',
            targetStageIdentity: `temporary:proposal-${otherStageProposalId}`,
          }),
        }),
      ]),
    );
  });

  it.each([
    {
      name: 'branching',
      edges: [
        ['stage-b', 'stage-a'],
        ['stage-c', 'stage-a'],
      ],
      code: 'plan_stage_branching',
      metadataKey: 'successorStageIdentities',
    },
    {
      name: 'cycles',
      edges: [
        ['stage-a', 'stage-b'],
        ['stage-b', 'stage-a'],
      ],
      code: 'plan_stage_cycle',
      metadataKey: 'relationshipIdentities',
    },
    {
      name: 'cycles when a cyclic Stage has an extra predecessor',
      edges: [
        ['stage-a', 'stage-b'],
        ['stage-a', 'stage-c'],
        ['stage-b', 'stage-a'],
      ],
      code: 'plan_stage_cycle',
      metadataKey: 'relationshipIdentities',
    },
    {
      name: 'duplicate dependencies',
      edges: [
        ['stage-b', 'stage-a'],
        ['stage-b', 'stage-a'],
      ],
      code: 'duplicate_plan_stage_dependency',
      metadataKey: 'relationshipIdentity',
    },
  ])(
    'identifies $name with stage and relationship metadata',
    async (scenario) => {
      const { projector, prisma } = await createProjector();
      const featureId = '45454545-4545-4454-8454-454545454545';
      (prisma.db.task.findMany as jest.Mock).mockResolvedValue([
        persistedTask(featureId, 'Feature', 'FEATURE'),
      ]);
      const stageIds = ['stage-a', 'stage-b', 'stage-c'];
      const operations: WorkItemChangeSetOperation[] = [
        {
          op: 'workItem.create',
          ref: { refType: 'temporary', tempId: 'plan' },
          name: 'Plan',
          type: 'PLAN',
          parent: { refType: 'existing', id: featureId },
        },
        ...stageIds.map(
          (tempId): WorkItemChangeSetOperation => ({
            op: 'workItem.create',
            ref: { refType: 'temporary', tempId },
            name: tempId,
            type: 'PLAN_STAGE',
            parent: { refType: 'temporary', tempId: 'plan' },
          }),
        ),
        ...scenario.edges.map(
          ([source, target], index): WorkItemChangeSetOperation => ({
            op: 'relationship.create',
            ref: { refType: 'temporary', tempId: `edge-${index}` },
            source: { refType: 'temporary', tempId: source! },
            target: { refType: 'temporary', tempId: target! },
            edgeType: 'DEPENDS_ON',
            category: 'meta',
          }),
        ),
      ];

      const projected = await projector.project({
        organizationId,
        projectId,
        request: { root: { refType: 'temporary', tempId: 'plan' }, operations },
      });

      expect(projected.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: scenario.code,
            metadata: expect.objectContaining({
              planIdentity: 'temporary:plan',
              [scenario.metadataKey]: expect.anything(),
            }),
          }),
        ]),
      );
    },
  );

  it('identifies a Plan Stage dependency whose target is outside the Plan', async () => {
    const { projector, prisma } = await createProjector();
    const featureId = '46464646-4646-4464-8464-464646464646';
    (prisma.db.task.findMany as jest.Mock).mockResolvedValue([
      persistedTask(featureId, 'Feature', 'FEATURE'),
    ]);

    const projected = await projector.project({
      organizationId,
      projectId,
      request: {
        root: { refType: 'temporary', tempId: 'plan' },
        operations: [
          {
            op: 'workItem.create',
            ref: { refType: 'temporary', tempId: 'plan' },
            name: 'Plan',
            type: 'PLAN',
            parent: { refType: 'existing', id: featureId },
          },
          {
            op: 'workItem.create',
            ref: { refType: 'temporary', tempId: 'stage' },
            name: 'Stage',
            type: 'PLAN_STAGE',
            parent: { refType: 'temporary', tempId: 'plan' },
          },
          {
            op: 'workItem.create',
            ref: { refType: 'temporary', tempId: 'ordinary-task' },
            name: 'Ordinary task',
            type: 'STANDARD',
            parent: { refType: 'existing', id: featureId },
          },
          {
            op: 'relationship.create',
            ref: { refType: 'temporary', tempId: 'edge' },
            source: { refType: 'temporary', tempId: 'stage' },
            target: { refType: 'temporary', tempId: 'ordinary-task' },
            edgeType: 'DEPENDS_ON',
            category: 'meta',
          },
        ],
      },
    });

    expect(projected.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'relationships.temporary:edge',
          code: 'plan_stage_reference_outside_plan',
          metadata: expect.objectContaining({
            relationshipIdentity: 'temporary:edge',
            sourceStageIdentity: 'temporary:stage',
            targetStageIdentity: 'temporary:ordinary-task',
          }),
        }),
      ]),
    );
  });

  it('normalizes semantically equivalent operation orderings', async () => {
    const { projector } = await createProjector();

    const first = await projector.project({
      organizationId,
      projectId,
      request: request(validAlphaOperations()),
    });
    const second = await projector.project({
      organizationId,
      projectId,
      request: request([...validAlphaOperations()].reverse()),
    });

    expect(first.valid).toBe(true);
    expect(second.valid).toBe(true);
    expect(second).toEqual(first);
  });

  it('validates a differently named configured graph fixture through the same path', async () => {
    const { projector } = await createProjector();
    const betaOps = validAlphaOperations().map((operation) => {
      if (operation.op !== 'workItem.create') return operation;
      return {
        ...operation,
        type:
          operation.type === 'GRAPH_ALPHA' ? 'GRAPH_BETA' : 'GRAPH_BETA_NODE',
      };
    });

    const projected = await projector.project({
      organizationId,
      projectId,
      request: request(betaOps),
    });

    expect(projected.valid).toBe(true);
    expect(projected.projectedRoot.type).toBe('GRAPH_BETA');
  });

  it('rejects projected Task parentage through the centralized EntityType axis', async () => {
    const { projector } = await createProjector(undefined, [
      EntityType.DesignDoc,
    ]);

    const projected = await projector.project({
      organizationId,
      projectId,
      request: request(validAlphaOperations()),
    });

    expect(projected.valid).toBe(false);
    expect(projected.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'invalid_child_type',
          reason:
            'A TASK entity cannot parent a GRAPH_ALPHA_NODE item under the configured work-item type definitions.',
        }),
      ]),
    );
  });

  it('projects the complete versioned authored-layout section value', async () => {
    const { projector } = await createProjector();

    const projected = await projector.project({
      organizationId,
      projectId,
      request: request(validAlphaOperations()),
    });

    expect(projected.sections).toEqual(
      expect.arrayContaining([
        {
          key: 'graphLayout',
          content: {
            schemaVersion: 'work-item-graph-layout.v1',
            nodes: [
              {
                node: {
                  kind: 'temporaryWorkItem',
                  temporaryRef: 'node-a',
                },
                position: { x: 0, y: 0 },
              },
              {
                node: {
                  kind: 'temporaryWorkItem',
                  temporaryRef: 'node-b',
                },
                position: { x: 10, y: 0 },
              },
            ],
          },
        },
      ]),
    );
  });

  it('projects a preference-only edit without replacing the saved graph layout', async () => {
    const { projector, prisma } = await createProjector();
    const rootId = '71717171-7171-4171-8171-717171717171';
    const savedLayout = {
      schemaVersion: 'work-item-graph-layout.v1',
      nodes: [],
    };
    (prisma.db.task.findMany as jest.Mock).mockResolvedValue([
      {
        ...persistedTask(rootId, 'Alpha graph', 'GRAPH_ALPHA'),
        sections: [
          { key: 'description', materializedMarkdown: 'Existing graph' },
          {
            key: 'graphLayout',
            materializedMarkdown: JSON.stringify(savedLayout),
          },
        ],
      },
    ]);

    const projected = await projector.project({
      organizationId,
      projectId,
      request: {
        root: { refType: 'existing', id: rootId },
        operations: [
          {
            op: 'section.replace',
            ref: { refType: 'existing', id: rootId },
            key: 'graphLayoutPreference',
            content: {
              schemaVersion: 'work-item-graph-layout-preference.v1',
              rows: 2,
              columns: 3,
            },
          },
        ],
      },
    });

    expect(projected.valid).toBe(true);
    expect(projected.sections).toEqual(
      expect.arrayContaining([
        { key: 'graphLayout', content: JSON.stringify(savedLayout) },
        {
          key: 'graphLayoutPreference',
          content: {
            schemaVersion: 'work-item-graph-layout-preference.v1',
            rows: 2,
            columns: 3,
          },
        },
      ]),
    );
  });

  it('removes section values for section and layout clear operations', async () => {
    const { projector } = await createProjector();
    const operations: WorkItemChangeSetOperation[] = [
      ...validAlphaOperations(),
      {
        op: 'section.clear',
        ref: { refType: 'temporary', tempId: 'root' },
        key: 'description',
      },
      {
        op: 'layout.clear',
        root: { refType: 'temporary', tempId: 'root' },
        sectionKey: 'graphLayout',
      },
    ];

    const projected = await projector.project({
      organizationId,
      projectId,
      request: request(operations),
    });

    expect(projected.valid).toBe(true);
    expect(projected.sections).toEqual([]);
  });

  it('omits null persisted sections when rehydrating a cleared layout', async () => {
    const { projector, prisma } = await createProjector();
    const rootId = '11111111-1111-4111-8111-111111111111';
    (prisma.db.task.findMany as jest.Mock).mockResolvedValue([
      {
        ...persistedTask(rootId, 'Alpha graph', 'GRAPH_ALPHA'),
        sections: [
          { key: 'description', materializedMarkdown: 'Graph root' },
          { key: 'graphLayout', materializedMarkdown: null },
        ],
      },
    ]);

    const projected = await projector.rehydrateCurrentProjection({
      organizationId,
      projectId,
      rootWorkItemId: rootId,
    });

    expect(projected.sections).toEqual([
      { key: 'description', content: 'Graph root' },
    ]);
  });

  it('rehydrates persisted HTML/CSS source as the typed section value', async () => {
    const { projector, prisma } = await createProjector();
    const rootId = '33333333-3333-4333-8333-333333333333';
    (prisma.db.task.findMany as jest.Mock).mockResolvedValue([
      {
        ...persistedTask(rootId, 'HTML/CSS work item', 'HTML_CSS_TYPE'),
        sections: [
          {
            key: 'preview',
            materializedMarkdown: '{"html":"<main>Preview</main>","css":""}',
          },
        ],
      },
    ]);

    const projected = await projector.rehydrateCurrentProjection({
      organizationId,
      projectId,
      rootWorkItemId: rootId,
    });

    expect(projected.valid).toBe(true);
    expect(projected.sections).toEqual([
      {
        key: 'preview',
        content: { html: '<main>Preview</main>', css: '' },
      },
    ]);
  });

  it('preserves relationship metadata without duplicating Graph policy validation', async () => {
    const { projector } = await createProjector();
    const operations = validAlphaOperations().map((operation) =>
      operation.op === 'relationship.create'
        ? { ...operation, metadata: { confidence: 2 } }
        : operation,
    ) as WorkItemChangeSetOperation[];

    const projected = await projector.project({
      organizationId,
      projectId,
      request: request(operations),
    });

    expect(projected.valid).toBe(true);
    expect(projected.incidentRelationships).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ metadata: { confidence: 2 } }),
      ]),
    );
  });

  it('does not resolve relationship metadata schemas during projection', async () => {
    const { projector } = await createProjector(
      '#/components/schemas/MissingRelationshipMetadata',
    );

    const projected = await projector.project({
      organizationId,
      projectId,
      request: request(validAlphaOperations()),
    });

    expect(projected.valid).toBe(true);
    expect(projected.issues).toEqual([]);
  });

  it('accepts an internal flow relationship', async () => {
    const { projector } = await createProjector();
    const operations = validAlphaOperations().map((operation) =>
      operation.op === 'relationship.create'
        ? {
            ...operation,
            edgeType: 'CONDITIONAL' as const,
            category: 'flow' as const,
            direction: 'forward' as const,
            predicate: 'approved',
          }
        : operation,
    );

    const projected = await projector.project({
      organizationId,
      projectId,
      request: request(operations),
    });

    expect(projected.valid).toBe(true);
    expect(projected.issues).toEqual([]);
  });

  it('accepts external fulfillment without revalidating graph capability policy', async () => {
    const { projector, prisma } = await createProjector();
    const rootId = '13131313-1313-4313-8313-131313131313';
    const sourceId = '14141414-1414-4414-8414-141414141414';
    const externalRootId = '15151515-1515-4515-8515-151515151515';
    const externalTargetId = '16161616-1616-4616-8616-161616161616';
    (prisma.db.task.findMany as jest.Mock).mockResolvedValue([
      persistedTask(rootId, 'Alpha graph', 'GRAPH_ALPHA'),
      persistedTask(sourceId, 'Internal node', 'GRAPH_ALPHA_NODE', rootId),
      persistedTask(
        externalTargetId,
        'Implementing task',
        'STANDARD',
        externalRootId,
      ),
    ]);

    const projected = await projector.project({
      organizationId,
      projectId,
      request: {
        root: { refType: 'existing', id: rootId },
        operations: [
          {
            op: 'relationship.create',
            ref: { refType: 'temporary', tempId: 'cross-root' },
            source: { refType: 'existing', id: sourceId },
            target: { refType: 'existing', id: externalTargetId },
            edgeType: 'FULFILLED_BY',
            category: 'meta',
          },
        ],
      },
    });

    expect(projected.valid).toBe(true);
    expect(projected.issues).toEqual([]);
  });

  it('accepts a relationship update that reconnects to a resolved endpoint outside the projected root', async () => {
    const { projector, prisma, mockAgentEdgeClient } = await createProjector();
    const rootId = '17171717-1717-4717-8717-171717171717';
    const sourceId = '18181818-1818-4818-8818-181818181818';
    const originalTargetId = '19191919-1919-4919-8919-191919191919';
    const externalRootId = '20202020-2020-4020-8020-202020202020';
    const externalTargetId = '21212121-2121-4121-8121-212121212121';
    const relationshipId = '22222222-3333-4333-8333-222222222222';
    (prisma.db.task.findMany as jest.Mock).mockResolvedValue([
      persistedTask(rootId, 'Alpha graph', 'GRAPH_ALPHA'),
      persistedTask(sourceId, 'Internal node', 'GRAPH_ALPHA_NODE', rootId),
      persistedTask(
        originalTargetId,
        'Original target',
        'GRAPH_ALPHA_NODE',
        rootId,
      ),
      persistedTask(
        externalTargetId,
        'External node',
        'GRAPH_ALPHA_NODE',
        externalRootId,
      ),
    ]);
    mockAgentEdgeClient.findIncident.mockResolvedValue([
      {
        id: relationshipId,
        sourceNodeId: sourceId,
        sourceEntityType: 'TASK',
        targetNodeId: originalTargetId,
        targetEntityType: 'TASK',
        type: 'RELATED_TO',
        category: 'meta',
        createdAt: '2026-08-11T00:00:00.000Z',
        updatedAt: '2026-08-11T00:00:00.000Z',
      },
    ]);

    const projected = await projector.project({
      organizationId,
      projectId,
      request: {
        root: { refType: 'existing', id: rootId },
        operations: [
          {
            op: 'relationship.update',
            ref: { refType: 'existing', id: relationshipId },
            target: { refType: 'existing', id: externalTargetId },
          },
        ],
      },
    });

    expect(projected.valid).toBe(true);
    expect(projected.issues).toEqual([]);
    expect(projected.incidentRelationships).toEqual([
      expect.objectContaining({
        identity: { refType: 'existing', id: relationshipId },
        target: { refType: 'existing', id: externalTargetId },
      }),
    ]);
  });

  it('leaves relationship labels to Graph while retaining layout validation', async () => {
    const { projector } = await createProjector();
    const operations = validAlphaOperations().map((operation) => {
      if (operation.op === 'relationship.create') {
        return {
          ...operation,
          edgeType: 'CONTRADICTS' as const,
          category: 'meta' as const,
        };
      }
      if (operation.op === 'layout.replace') {
        return { ...operation, entries: operation.entries.slice(0, 1) };
      }
      return operation;
    });

    const projected = await projector.project({
      organizationId,
      projectId,
      request: request(operations),
    });

    expect(projected.valid).toBe(false);
    expect(projected.issues.map((issue) => issue.code)).toContain(
      'incomplete_layout_membership',
    );
    expect(projected.issues.map((issue) => issue.code)).not.toContain(
      'invalid_relationship_label',
    );
  });

  it('rejects unresolved layout entries even when they appear in the boundary', async () => {
    const { projector } = await createProjector();
    const missingNode = {
      refType: 'temporary' as const,
      tempId: 'missing-node',
    };
    const operations = validAlphaOperations().map((operation) => {
      if (operation.op !== 'layout.replace') return operation;
      return {
        ...operation,
        entries: [
          ...operation.entries,
          {
            node: missingNode,
            position: { x: 20, y: 0 },
          },
        ],
      };
    });

    const projected = await projector.project({
      organizationId,
      projectId,
      request: {
        ...request(operations),
        layoutBoundary: [
          { refType: 'temporary', tempId: 'node-a' },
          { refType: 'temporary', tempId: 'node-b' },
          missingNode,
        ],
      },
    });

    expect(projected.valid).toBe(false);
    expect(projected.issues.map((issue) => issue.code)).toContain(
      'dangling_reference',
    );
  });

  it('rejects existing relationship refs that were not projected', async () => {
    const { projector } = await createProjector();
    const operations: WorkItemChangeSetOperation[] = [
      ...validAlphaOperations(),
      {
        op: 'relationship.delete',
        ref: {
          refType: 'existing',
          id: '33333333-3333-4333-8333-333333333333',
        },
      },
    ];

    const projected = await projector.project({
      organizationId,
      projectId,
      request: request(operations),
    });

    expect(projected.valid).toBe(false);
    expect(projected.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'relationship.delete.ref',
          code: 'dangling_reference',
        }),
      ]),
    );
  });

  it('hydrates the root-children view relationships from incident edges before update projection', async () => {
    const { projector, prisma, mockAgentEdgeClient } = await createProjector();
    const rootId = '33333333-3333-4333-8333-333333333333';
    const nodeAId = '44444444-4444-4444-8444-444444444444';
    const nodeBId = '55555555-5555-4555-8555-555555555555';
    const nodeCId = '66666666-6666-4666-8666-666666666666';
    const relationshipId = '77777777-7777-4777-8777-777777777777';
    (prisma.db.task.findMany as jest.Mock).mockResolvedValue([
      persistedTask(rootId, 'Alpha graph', 'GRAPH_ALPHA'),
      persistedTask(nodeAId, 'Node A', 'GRAPH_ALPHA_NODE', rootId),
      persistedTask(nodeBId, 'Node B', 'GRAPH_ALPHA_NODE', rootId),
      persistedTask(nodeCId, 'Node C', 'GRAPH_ALPHA_NODE', rootId),
    ]);
    mockAgentEdgeClient.findIncident.mockResolvedValue([
      {
        id: relationshipId,
        sourceNodeId: nodeAId,
        sourceEntityType: 'TASK',
        targetNodeId: nodeBId,
        targetEntityType: 'TASK',
        type: 'RELATED_TO',
        category: 'meta',
        reasoning: 'Canonical Graph relationship',
        metadata: { lane: 'primary' },
        createdAt: '2026-07-13T00:00:00.000Z',
        updatedAt: '2026-07-13T00:00:00.000Z',
      },
    ]);

    const projected = await projector.project({
      organizationId,
      projectId,
      request: {
        root: { refType: 'existing', id: rootId },
        layoutBoundary: [
          { refType: 'existing', id: nodeAId },
          { refType: 'existing', id: nodeBId },
          { refType: 'existing', id: nodeCId },
        ],
        operations: [
          {
            op: 'relationship.update',
            ref: { refType: 'existing', id: relationshipId },
            target: { refType: 'existing', id: nodeCId },
            metadata: { lane: 'secondary' },
          },
        ],
      },
      view: rootChildrenView,
    });

    expect(projected.valid).toBe(true);
    expect(mockAgentEdgeClient.findIncident).toHaveBeenCalledWith(
      organizationId,
      projectId,
      {
        nodeIds: new Set([nodeAId, nodeBId, nodeCId, rootId]),
        types: new Set([
          'CONDITIONAL',
          'CONTRADICTS',
          'DEPENDS_ON',
          'DERIVES_FROM',
          'EVOLVES',
          'FULFILLED_BY',
          'GUARANTEES',
          'IMPLEMENTS',
          'CONSUMES',
          'LOOP',
          'RELATED_TO',
          'STANDARD',
          'SUPERSEDES',
          'TRACKS',
        ]),
      },
      'service-token',
    );
    expect(projected.incidentRelationships).toEqual([
      expect.objectContaining({
        identity: { refType: 'existing', id: relationshipId },
        source: { refType: 'existing', id: nodeAId },
        sourceEntityType: 'TASK',
        target: { refType: 'existing', id: nodeCId },
        targetEntityType: 'TASK',
        metadata: { lane: 'secondary' },
      }),
    ]);
  });

  it('allows an existing graph root to retain a parent outside the projection boundary', async () => {
    const { projector, prisma, mockAgentEdgeClient } = await createProjector();
    const rootId = '12121212-1212-4212-8212-121212121212';
    const parentId = '23232323-2323-4232-8232-232323232323';
    const nodeId = '34343434-3434-4343-8343-343434343434';
    const ambientRelationshipId = '45454545-4545-4454-8454-454545454545';
    (prisma.db.task.findMany as jest.Mock)
      .mockResolvedValueOnce([
        persistedTask(rootId, 'Nested graph', 'GRAPH_ALPHA', parentId),
        persistedTask(nodeId, 'Node A', 'GRAPH_ALPHA_NODE', rootId),
      ])
      .mockResolvedValueOnce([
        persistedTask(nodeId, 'Node A', 'GRAPH_ALPHA_NODE', rootId),
      ]);
    mockAgentEdgeClient.findIncident.mockResolvedValue([
      {
        id: ambientRelationshipId,
        sourceNodeId: rootId,
        sourceEntityType: 'TASK',
        targetNodeId: parentId,
        targetEntityType: 'TASK',
        type: 'RELATED_TO',
        category: 'meta',
        reasoning: 'Ambient cross-boundary relationship',
        createdAt: '2026-07-24T00:00:00.000Z',
        updatedAt: '2026-07-24T00:00:00.000Z',
      },
    ]);

    const projected = await projector.project({
      organizationId,
      projectId,
      request: {
        root: { refType: 'existing', id: rootId },
        layoutBoundary: [{ refType: 'existing', id: nodeId }],
        operations: [
          {
            op: 'layout.replace',
            root: { refType: 'existing', id: rootId },
            sectionKey: 'graphLayout',
            entries: [
              {
                node: { refType: 'existing', id: nodeId },
                position: { x: 24, y: 24 },
              },
            ],
          },
        ],
      },
    });

    expect(projected.valid).toBe(true);
    expect(projected.issues).toEqual([]);
    expect(projected.incidentRelationships).toEqual([]);
    expect(prisma.db.task.findMany).toHaveBeenCalledTimes(1);
  });

  it('hydrates existing relationships across all labels before applying label updates', async () => {
    const { projector, prisma, mockAgentEdgeClient } = await createProjector();
    const rootId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const nodeAId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    const nodeBId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    const relationshipId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    (prisma.db.task.findMany as jest.Mock).mockResolvedValue([
      persistedTask(rootId, 'Alpha graph', 'GRAPH_ALPHA'),
      persistedTask(nodeAId, 'Node A', 'GRAPH_ALPHA_NODE', rootId),
      persistedTask(nodeBId, 'Node B', 'GRAPH_ALPHA_NODE', rootId),
    ]);
    mockAgentEdgeClient.findIncident.mockImplementation(
      async (
        _organizationId: unknown,
        _projectId: unknown,
        incidentRequest: any,
      ) => {
        if (!incidentRequest.types.has('DEPENDS_ON')) return [];
        return [
          {
            id: relationshipId,
            sourceNodeId: nodeAId,
            sourceEntityType: 'TASK',
            targetNodeId: nodeBId,
            targetEntityType: 'TASK',
            type: 'DEPENDS_ON',
            category: 'meta',
            reasoning: 'Original relationship',
            createdAt: '2026-07-13T00:00:00.000Z',
            updatedAt: '2026-07-13T00:00:00.000Z',
          },
        ];
      },
    );

    const projected = await projector.project({
      organizationId,
      projectId,
      request: {
        root: { refType: 'existing', id: rootId },
        layoutBoundary: [
          { refType: 'existing', id: nodeAId },
          { refType: 'existing', id: nodeBId },
        ],
        operations: [
          {
            op: 'relationship.update',
            ref: { refType: 'existing', id: relationshipId },
            edgeType: 'RELATED_TO',
          },
        ],
      },
    });

    expect(projected.valid).toBe(true);
    expect(projected.incidentRelationships).toEqual([
      expect.objectContaining({
        identity: { refType: 'existing', id: relationshipId },
        edgeType: 'RELATED_TO',
      }),
    ]);
  });

  it('allows deletion of a legacy relationship without revalidating its ambient fields', async () => {
    const { projector, prisma, mockAgentEdgeClient } = await createProjector();
    const rootId = '88888888-8888-4888-8888-888888888888';
    const nodeAId = '99999999-9999-4999-8999-999999999999';
    const nodeBId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const relationshipId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    (prisma.db.task.findMany as jest.Mock).mockResolvedValue([
      persistedTask(rootId, 'Alpha graph', 'GRAPH_ALPHA'),
      persistedTask(nodeAId, 'Node A', 'GRAPH_ALPHA_NODE', rootId),
      persistedTask(nodeBId, 'Node B', 'GRAPH_ALPHA_NODE', rootId),
    ]);
    mockAgentEdgeClient.findIncident.mockResolvedValue([
      {
        id: relationshipId,
        sourceNodeId: nodeAId,
        targetNodeId: nodeBId,
        type: 'RELATED_TO',
        category: 'meta',
        reasoning: 'Missing endpoint types',
        createdAt: '2026-07-13T00:00:00.000Z',
        updatedAt: '2026-07-13T00:00:00.000Z',
      },
    ]);

    const projected = await projector.project({
      organizationId,
      projectId,
      request: {
        root: { refType: 'existing', id: rootId },
        layoutBoundary: [
          { refType: 'existing', id: nodeAId },
          { refType: 'existing', id: nodeBId },
        ],
        operations: [
          {
            op: 'relationship.delete',
            ref: { refType: 'existing', id: relationshipId },
          },
        ],
      },
    });

    expect(projected.valid).toBe(true);
    expect(projected.issues).toEqual([]);
    expect(projected.incidentRelationships).toEqual([
      expect.objectContaining({
        identity: { refType: 'existing', id: relationshipId },
        deleted: true,
      }),
    ]);
  });

  it('preserves persisted identities while replacing a mixed graph topology', async () => {
    const { projector, prisma, mockAgentEdgeClient } = await createProjector();
    const rootId = '10101010-1010-4010-8010-101010101010';
    const selectId = '20202020-2020-4020-8020-202020202020';
    const openId = '30303030-3030-4030-8030-303030303030';
    const viewId = '40404040-4040-4040-8040-404040404040';
    const selectOpenId = '50505050-5050-4050-8050-505050505050';
    const openViewId = '60606060-6060-4060-8060-606060606060';
    const tasks = [
      persistedTask(rootId, 'Alpha graph', 'GRAPH_ALPHA'),
      persistedTask(selectId, 'Select', 'GRAPH_ALPHA_NODE', rootId),
      persistedTask(openId, 'Open', 'GRAPH_ALPHA_NODE', rootId),
      persistedTask(viewId, 'View', 'GRAPH_ALPHA_NODE', rootId),
    ];
    (prisma.db.task.findMany as jest.Mock).mockResolvedValue(tasks);
    mockAgentEdgeClient.findIncident.mockResolvedValue([
      {
        id: selectOpenId,
        sourceNodeId: selectId,
        sourceEntityType: 'TASK',
        targetNodeId: openId,
        targetEntityType: 'TASK',
        type: 'RELATED_TO',
        category: 'meta',
        createdAt: '2026-07-31T00:00:00.000Z',
        updatedAt: '2026-07-31T00:00:00.000Z',
      },
      {
        id: openViewId,
        sourceNodeId: openId,
        sourceEntityType: 'TASK',
        targetNodeId: viewId,
        targetEntityType: 'TASK',
        type: 'RELATED_TO',
        category: 'meta',
        createdAt: '2026-07-31T00:00:00.000Z',
        updatedAt: '2026-07-31T00:00:00.000Z',
      },
    ]);

    const wait = { refType: 'temporary' as const, tempId: 'wait' };
    const projected = await projector.project({
      organizationId,
      projectId,
      request: {
        root: { refType: 'existing', id: rootId },
        layoutBoundary: [
          { refType: 'existing', id: selectId },
          { refType: 'existing', id: openId },
          { refType: 'existing', id: viewId },
          wait,
        ],
        operations: [
          {
            op: 'relationship.delete',
            ref: { refType: 'existing', id: openViewId },
          },
          {
            op: 'workItem.create',
            ref: wait,
            name: 'Wait',
            type: 'GRAPH_ALPHA_NODE',
            parent: { refType: 'existing', id: rootId },
          },
          {
            op: 'relationship.create',
            ref: { refType: 'temporary', tempId: 'open-wait' },
            source: { refType: 'existing', id: openId },
            target: wait,
            edgeType: 'RELATED_TO',
            category: 'meta',
          },
          {
            op: 'relationship.create',
            ref: { refType: 'temporary', tempId: 'wait-view' },
            source: wait,
            target: { refType: 'existing', id: viewId },
            edgeType: 'RELATED_TO',
            category: 'meta',
          },
          {
            op: 'layout.replace',
            root: { refType: 'existing', id: rootId },
            sectionKey: 'graphLayout',
            entries: [
              {
                node: { refType: 'existing', id: selectId },
                position: { x: 0, y: 0 },
              },
              {
                node: { refType: 'existing', id: openId },
                position: { x: 120, y: 0 },
              },
              {
                node: wait,
                position: { x: 240, y: 0 },
              },
              {
                node: { refType: 'existing', id: viewId },
                position: { x: 360, y: 0 },
              },
            ],
          },
        ],
      },
      view: rootChildrenView,
    });

    expect(projected.valid).toBe(true);
    expect(projected.children.map((child) => child.identity)).toEqual([
      { refType: 'existing', id: selectId },
      { refType: 'existing', id: openId },
      { refType: 'existing', id: viewId },
      wait,
    ]);
    expect(
      new Set(
        projected.children.map((child) => thisIdentityKey(child.identity)),
      ).size,
    ).toBe(4);
    expect(projected.incidentRelationships).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          identity: { refType: 'existing', id: selectOpenId },
          deleted: false,
        }),
        expect.objectContaining({
          identity: { refType: 'existing', id: openViewId },
          deleted: true,
        }),
        expect.objectContaining({
          identity: { refType: 'temporary', tempId: 'open-wait' },
          source: { refType: 'existing', id: openId },
          target: wait,
        }),
        expect.objectContaining({
          identity: { refType: 'temporary', tempId: 'wait-view' },
          source: wait,
          target: { refType: 'existing', id: viewId },
        }),
      ]),
    );
    expect(projected.issues).toEqual([]);
  });

  it('warns on same-type name collisions and rejects references outside the target graph', async () => {
    const { projector, prisma } = await createProjector();
    const rootId = '70707070-7070-4070-8070-707070707070';
    const childId = '80808080-8080-4080-8080-808080808080';
    const outsideId = '90909090-9090-4090-8090-909090909090';
    (prisma.db.task.findMany as jest.Mock)
      .mockResolvedValueOnce([
        persistedTask(rootId, 'Alpha graph', 'GRAPH_ALPHA'),
        persistedTask(childId, 'Select', 'GRAPH_ALPHA_NODE', rootId),
        persistedTask(
          outsideId,
          'Outside',
          'GRAPH_ALPHA_NODE',
          'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        ),
      ])
      .mockResolvedValueOnce([
        persistedTask(childId, 'Select', 'GRAPH_ALPHA_NODE', rootId),
      ]);

    const projected = await projector.project({
      organizationId,
      projectId,
      request: {
        root: { refType: 'existing', id: rootId },
        operations: [
          {
            op: 'workItem.create',
            ref: { refType: 'temporary', tempId: 'duplicate-select' },
            name: 'Select',
            type: 'GRAPH_ALPHA_NODE',
            parent: { refType: 'existing', id: rootId },
          },
          {
            op: 'workItem.update',
            ref: { refType: 'existing', id: outsideId },
            name: 'Outside edit',
          },
        ],
      },
    });

    expect(projected.valid).toBe(false);
    expect(projected.issues).toEqual([
      expect.objectContaining({
        field: 'operations[1].ref',
        code: 'cross_root_reference',
      }),
    ]);
    expect(projected.warnings).toEqual([
      expect.objectContaining({
        field: 'operations[0].name',
        code: 'work_item_name_collision',
      }),
    ]);
  });

  it('allows an existing structural parent outside the mutation root', async () => {
    const { projector, prisma } = await createProjector();
    const childId = '81818181-8181-4181-8181-818181818181';
    const sourceRootId = '82828282-8282-4282-8282-828282828282';
    const destinationRootId = '83838383-8383-4383-8383-838383838383';
    (prisma.db.task.findMany as jest.Mock).mockResolvedValue([
      persistedTask(childId, 'Moving node', 'GRAPH_ALPHA_NODE', sourceRootId),
      persistedTask(sourceRootId, 'Source graph', 'GRAPH_ALPHA'),
      persistedTask(destinationRootId, 'Destination graph', 'GRAPH_ALPHA'),
    ]);

    const projected = await projector.project({
      organizationId,
      projectId,
      request: {
        root: { refType: 'existing', id: childId },
        operations: [
          {
            op: 'workItem.update',
            ref: { refType: 'existing', id: childId },
            parent: { refType: 'existing', id: destinationRootId },
          },
        ],
      },
    });

    expect(projected.valid).toBe(true);
    expect(projected.projectedRoot.parent).toEqual({
      refType: 'existing',
      id: destinationRootId,
    });
    expect(projected.issues).toEqual([]);
  });

  it('does not validate untouched children when updating one section on the root', async () => {
    const { projector, prisma } = await createProjector();
    const rootId = '84848484-8484-4484-8484-848484848484';
    const firstChildId = '85858585-8585-4585-8585-858585858585';
    const secondChildId = '86868686-8686-4686-8686-868686868686';
    (prisma.db.task.findMany as jest.Mock)
      .mockResolvedValueOnce([
        {
          ...persistedTask(rootId, 'Feature root', 'FEATURE'),
          tag: 'product',
        },
      ])
      .mockResolvedValueOnce([
        persistedTask(firstChildId, 'Legacy child one', 'FEATURE', rootId),
        persistedTask(secondChildId, 'Legacy child two', 'FEATURE', rootId),
      ]);

    const projected = await projector.project({
      organizationId,
      projectId,
      request: {
        root: { refType: 'existing', id: rootId },
        operations: [
          {
            op: 'section.replace',
            ref: { refType: 'existing', id: rootId },
            key: 'requirements',
            content: { records: [] },
          },
        ],
      },
      view: rootChildrenView,
    });

    expect(projected.valid).toBe(true);
    expect(projected.issues).toEqual([]);
    expect(projected.children).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          identity: { refType: 'existing', id: firstChildId },
          tag: undefined,
        }),
        expect.objectContaining({
          identity: { refType: 'existing', id: secondChildId },
          tag: undefined,
        }),
      ]),
    );
  });

  it('still validates every field of a newly created work item', async () => {
    const { projector } = await createProjector();

    const projected = await projector.project({
      organizationId,
      projectId,
      request: {
        root: { refType: 'temporary', tempId: 'feature' },
        operations: [
          {
            op: 'workItem.create',
            ref: { refType: 'temporary', tempId: 'feature' },
            name: 'Untagged feature',
            type: 'FEATURE',
          },
        ],
      },
    });

    expect(projected.valid).toBe(false);
    expect(projected.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'missing_required_scalar',
          reason: 'FEATURE requires tag.',
        }),
      ]),
    );
  });

  it('rejects temporary work items created outside the target graph root', async () => {
    const { projector, prisma } = await createProjector();
    const rootId = 'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd';
    (prisma.db.task.findMany as jest.Mock).mockResolvedValue([
      persistedTask(rootId, 'Alpha graph', 'GRAPH_ALPHA'),
    ]);

    const projected = await projector.project({
      organizationId,
      projectId,
      request: {
        root: { refType: 'existing', id: rootId },
        operations: [
          {
            op: 'workItem.create',
            ref: { refType: 'temporary', tempId: 'orphan-root' },
            name: 'Orphan graph',
            type: 'GRAPH_ALPHA',
          },
        ],
      },
    });

    expect(projected.valid).toBe(false);
    expect(projected.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'operations[0].ref',
          code: 'cross_root_reference',
        }),
      ]),
    );
  });

  it('treats descendants at every depth as part of the target graph root', async () => {
    const { projector, prisma } = await createProjector();
    const featureId = 'dededede-dede-4ede-8ede-dededededede';
    const serviceId = 'efefefef-efef-4fef-8fef-efefefefefef';
    (prisma.db.task.findMany as jest.Mock).mockResolvedValue([
      persistedTask(featureId, 'Feature', 'FEATURE'),
    ]);
    (prisma.db.service.findMany as jest.Mock).mockResolvedValue([
      { id: serviceId },
    ]);

    const projected = await projector.project({
      organizationId,
      projectId,
      request: {
        root: { refType: 'temporary', tempId: 'plan' },
        operations: [
          {
            op: 'workItem.create',
            ref: { refType: 'temporary', tempId: 'plan' },
            name: 'Plan',
            type: 'PLAN',
            parent: { refType: 'existing', id: featureId },
          },
          {
            op: 'workItem.create',
            ref: { refType: 'temporary', tempId: 'stage' },
            name: 'Stage',
            type: 'PLAN_STAGE',
            parent: { refType: 'temporary', tempId: 'plan' },
          },
          {
            op: 'section.replace',
            ref: { refType: 'temporary', tempId: 'stage' },
            key: 'description',
            content: 'Deliver the plan in one stage.',
          },
          {
            op: 'workItem.create',
            ref: { refType: 'temporary', tempId: 'task' },
            name: 'Task',
            type: 'STANDARD',
            parent: { refType: 'temporary', tempId: 'stage' },
            serviceIds: [serviceId],
          },
          {
            op: 'section.replace',
            ref: { refType: 'temporary', tempId: 'task' },
            key: 'description',
            content: 'Implement the reviewed stage outcome.',
          },
          {
            op: 'section.replace',
            ref: { refType: 'temporary', tempId: 'task' },
            key: 'acceptanceCriteria',
            content: '- The reviewed outcome is implemented.',
          },
          {
            op: 'workItem.create',
            ref: { refType: 'temporary', tempId: 'subtask' },
            name: 'Subtask',
            type: 'STANDARD',
            parent: { refType: 'temporary', tempId: 'task' },
          },
          {
            op: 'section.replace',
            ref: { refType: 'temporary', tempId: 'subtask' },
            key: 'description',
            content: 'Complete the nested part of the implementation.',
          },
        ],
      },
    });

    expect(projected.valid).toBe(true);
    expect(projected.issues).toEqual([]);
  });

  it('rejects duplicate layout identities and undeclared temporary references', async () => {
    const { projector, prisma } = await createProjector();
    const rootId = 'abababab-abab-4bab-8bab-abababababab';
    const childId = 'bcbcbcbc-bcbc-4cbc-8cbc-bcbcbcbcbcbc';
    (prisma.db.task.findMany as jest.Mock).mockResolvedValue([
      persistedTask(rootId, 'Alpha graph', 'GRAPH_ALPHA'),
      persistedTask(childId, 'Select', 'GRAPH_ALPHA_NODE', rootId),
    ]);

    const projected = await projector.project({
      organizationId,
      projectId,
      request: {
        root: { refType: 'existing', id: rootId },
        layoutBoundary: [
          { refType: 'existing', id: childId },
          { refType: 'existing', id: childId },
        ],
        operations: [
          {
            op: 'relationship.create',
            ref: { refType: 'temporary', tempId: 'unresolved-edge' },
            source: { refType: 'existing', id: childId },
            target: { refType: 'temporary', tempId: 'missing-node' },
            edgeType: 'RELATED_TO',
            category: 'meta',
          },
          {
            op: 'layout.replace',
            root: { refType: 'existing', id: rootId },
            sectionKey: 'graphLayout',
            entries: [
              {
                node: { refType: 'existing', id: childId },
                position: { x: 0, y: 0 },
              },
              {
                node: { refType: 'existing', id: childId },
                position: { x: 100, y: 0 },
              },
            ],
          },
        ],
      },
    });

    expect(projected.valid).toBe(false);
    expect(projected.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'duplicate_layout_reference' }),
        expect.objectContaining({ code: 'duplicate_layout_entry' }),
        expect.objectContaining({
          field: 'operations[0].target',
          code: 'unresolved_reference',
        }),
      ]),
    );
  });
});

function thisIdentityKey(identity: {
  refType: string;
  id?: string;
  tempId?: string;
}) {
  return identity.refType === 'existing'
    ? `existing:${identity.id}`
    : `temporary:${identity.tempId}`;
}

function persistedTask(
  id: string,
  name: string,
  type: string,
  parentTaskId: string | null = null,
) {
  return {
    id,
    name,
    type,
    parentTaskId,
    status: 'ACTIVE',
    priority: null,
    dueDate: null,
    assigneeId: null,
    tag: null,
    serviceRelations: [],
    sections: [],
  };
}

function graphSectionDefinitions() {
  return [
    { key: 'description', label: 'Description', kind: 'markdown' as const },
    {
      key: 'graphLayout',
      label: 'Graph Layout',
      kind: 'json' as const,
      schemaRef: '#/components/schemas/WorkItemGraphLayoutValue',
    },
    {
      key: 'graphLayoutPreference',
      label: 'Graph Layout Preference',
      kind: 'json' as const,
      schemaRef: '#/components/schemas/WorkItemGraphLayoutPreferenceValue',
    },
    {
      key: 'diagramGroups',
      label: 'Diagram Groups',
      kind: 'json' as const,
      required: false,
      schemaRef: '#/components/schemas/DiagramGroupsValue',
    },
  ];
}

describe('Graph groups and boundaries', () => {
  const ROOT = '33333333-3333-4333-8333-333333333333';
  const API_EAST = '44444444-4444-4444-8444-444444444444';
  const API_WEST = '55555555-5555-4555-8555-555555555555';
  const persisted = (workItemId: string) => ({
    kind: 'persistedWorkItem' as const,
    workItemId,
  });
  const groupsSection = (groups: unknown[]) => ({
    schemaVersion: 'diagram-groups.v1',
    groups,
  });
  const persistedGroups = groupsSection([
    { id: 'aws', label: 'AWS', meaning: 'DEPLOYMENT_BOUNDARY', members: [] },
    {
      id: 'aws-east',
      label: 'us-east-1',
      meaning: 'DEPLOYMENT_BOUNDARY',
      parentGroupId: 'aws',
      members: [persisted(API_EAST)],
    },
    {
      id: 'aws-west',
      label: 'us-west-2',
      meaning: 'DEPLOYMENT_BOUNDARY',
      parentGroupId: 'aws',
      members: [persisted(API_WEST)],
    },
  ]);

  async function setup() {
    const context = await createProjector();
    const rows = [
      {
        ...persistedTask(ROOT, 'Deployment', 'GRAPH_ALPHA'),
        sections: [
          {
            key: 'diagramGroups',
            materializedMarkdown: JSON.stringify(persistedGroups),
          },
          {
            key: 'graphLayout',
            materializedMarkdown: JSON.stringify({
              schemaVersion: 'work-item-graph-layout.v1',
              nodes: [
                { node: persisted(API_EAST), position: { x: 0, y: 0 } },
                { node: persisted(API_WEST), position: { x: 300, y: 0 } },
              ],
            }),
          },
        ],
      },
      persistedTask(API_EAST, 'Checkout API', 'GRAPH_ALPHA_NODE', ROOT),
      persistedTask(API_WEST, 'Checkout API', 'GRAPH_ALPHA_NODE', ROOT),
    ];
    (context.prisma.db.task.findMany as jest.Mock).mockImplementation(
      async ({ where }) =>
        rows.filter(
          (row) =>
            where.id?.in?.includes(row.id) ||
            (where.parentTaskId && row.parentTaskId === where.parentTaskId),
        ),
    );
    return context;
  }

  type GroupsValue = {
    groups: Array<{ id: string; color?: string; members: unknown[] }>;
  };
  const rootSection = (
    sections: Array<{ key: string; content?: unknown }>,
    key: string,
  ) => sections.find((section) => section.key === key)?.content;
  const groupsOf = (sections: Array<{ key: string; content?: unknown }>) =>
    (rootSection(sections, 'diagramGroups') as GroupsValue).groups;

  it('projects temporary members on create without touching layout', async () => {
    const { projector } = await createProjector();
    const operations = validAlphaOperations();
    operations.push({
      op: 'section.replace',
      ref: { refType: 'temporary', tempId: 'root' },
      key: 'diagramGroups',
      content: groupsSection([
        {
          id: 'association',
          label: 'Checkout path',
          meaning: 'VISUAL_ASSOCIATION',
          color: 'purple',
          members: [
            { kind: 'temporaryWorkItem', temporaryRef: 'node-a' },
            { kind: 'temporaryWorkItem', temporaryRef: 'node-b' },
          ],
        },
      ]),
    });
    const result = await projector.project({
      organizationId,
      projectId,
      request: request(operations),
    });
    expect(result.issues).toEqual([]);
    expect(groupsOf(result.sections)[0]!.members).toHaveLength(2);
    expect(groupsOf(result.sections)[0]!.color).toBe('purple');
    expect(
      (rootSection(result.sections, 'graphLayout') as { nodes: unknown[] })
        .nodes,
    ).toHaveLength(2);
  });

  it('accepts a diagram without groups', async () => {
    const { projector } = await createProjector();
    const result = await projector.project({
      organizationId,
      projectId,
      request: request(validAlphaOperations()),
    });
    expect(result.valid).toBe(true);
    expect(rootSection(result.sections, 'diagramGroups')).toBeUndefined();
  });

  it('rejects members that are not elements of the diagram', async () => {
    const { projector } = await setup();
    const result = await projector.project({
      organizationId,
      projectId,
      request: {
        root: { refType: 'existing', id: ROOT },
        operations: [
          {
            op: 'section.replace',
            ref: { refType: 'existing', id: ROOT },
            key: 'diagramGroups',
            content: groupsSection([
              {
                id: 'g',
                label: 'G',
                meaning: 'STRUCTURAL_BOUNDARY',
                members: [persisted('66666666-6666-4666-8666-666666666666')],
              },
            ]),
          },
        ],
      },
    });
    expect(result.issues.map((issue) => issue.code)).toContain(
      'dangling_group_member',
    );
  });

  it('rejects a non-palette color on a group section replacement', async () => {
    const { projector } = await setup();
    const result = await projector.project({
      organizationId,
      projectId,
      request: {
        root: { refType: 'existing', id: ROOT },
        operations: [
          {
            op: 'section.replace',
            ref: { refType: 'existing', id: ROOT },
            key: 'diagramGroups',
            content: groupsSection([
              {
                id: 'aws',
                label: 'AWS',
                meaning: 'DEPLOYMENT_BOUNDARY',
                color: '#123456',
                members: [],
              },
            ]),
          },
        ],
      },
    });
    expect(result.valid).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it('rejects an explicit replacement whose parent group was removed', async () => {
    const { projector } = await setup();
    const result = await projector.project({
      organizationId,
      projectId,
      request: {
        root: { refType: 'existing', id: ROOT },
        operations: [
          {
            op: 'section.replace',
            ref: { refType: 'existing', id: ROOT },
            key: 'diagramGroups',
            content: groupsSection(
              persistedGroups.groups.filter(
                (group) => (group as { id: string }).id !== 'aws',
              ),
            ),
          },
        ],
      },
    });
    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.reason).join(' ')).toContain(
      'unknown parent group aws',
    );
  });

  it('prunes a deleted element from persisted groups and keeps the other placement', async () => {
    const { projector } = await setup();
    const result = await projector.project({
      organizationId,
      projectId,
      request: {
        root: { refType: 'existing', id: ROOT },
        operations: [
          { op: 'workItem.delete', ref: { refType: 'existing', id: API_WEST } },
        ],
      },
    });
    const groups = groupsOf(result.sections);
    expect(groups.find((group) => group.id === 'aws-west')?.members).toEqual(
      [],
    );
    expect(groups.find((group) => group.id === 'aws-east')?.members).toEqual([
      persisted(API_EAST),
    ]);
    expect(result.issues.map((issue) => issue.code)).not.toContain(
      'dangling_group_member',
    );
  });

  it('rejects an element directly inside two factual boundaries', async () => {
    const { projector } = await setup();
    const groups = structuredClone(persistedGroups) as GroupsValue;
    groups.groups[2]!.members.push(persisted(API_EAST));
    const result = await projector.project({
      organizationId,
      projectId,
      request: {
        root: { refType: 'existing', id: ROOT },
        operations: [
          {
            op: 'section.replace',
            ref: { refType: 'existing', id: ROOT },
            key: 'diagramGroups',
            content: groups,
          },
        ],
      },
    });
    expect(result.issues.map((issue) => issue.code)).toContain(
      'multiple_factual_boundaries',
    );
  });

  it('leaves an untouched malformed groups section alone on an unrelated edit', async () => {
    const context = await setup();
    const malformed = '{"groups": "not-a-list"}';
    const rows = [
      {
        ...persistedTask(ROOT, 'Deployment', 'GRAPH_ALPHA'),
        sections: [{ key: 'diagramGroups', materializedMarkdown: malformed }],
      },
      persistedTask(API_EAST, 'Checkout API', 'GRAPH_ALPHA_NODE', ROOT),
    ];
    (context.prisma.db.task.findMany as jest.Mock).mockImplementation(
      async ({ where }) =>
        rows.filter(
          (row) =>
            where.id?.in?.includes(row.id) ||
            (where.parentTaskId && row.parentTaskId === where.parentTaskId),
        ),
    );
    const result = await context.projector.project({
      organizationId,
      projectId,
      request: {
        root: { refType: 'existing', id: ROOT },
        operations: [
          {
            op: 'workItem.update',
            ref: { refType: 'existing', id: API_EAST },
            name: 'Checkout API (east)',
          },
        ],
      },
    });
    expect(result.issues.map((issue) => issue.code)).not.toContain(
      'invalid_diagram_groups',
    );
  });
});

describe('Diagram metadata', () => {
  const DIAGRAM = '71717171-7171-4171-8171-717171717171';
  const ELEMENT = '72727272-7272-4272-8272-727272727272';
  const ARCHIVED_TARGET = '73737373-7373-4373-8373-737373737373';
  const elementMetadata = JSON.stringify({
    role: 'GENERIC',
    canonicalReference: { entityType: 'TASK', entityId: ARCHIVED_TARGET },
  });

  function rows() {
    return [
      {
        ...persistedTask(DIAGRAM, 'Checkout', 'DIAGRAM'),
        sections: [
          {
            key: 'diagramMetadata',
            materializedMarkdown: JSON.stringify({
              kind: 'GENERAL',
              level: 'OVERVIEW',
            }),
          },
        ],
      },
      {
        ...persistedTask(ELEMENT, 'Checkout API', 'DIAGRAM_ELEMENT', DIAGRAM),
        sections: [
          {
            key: 'diagramElementMetadata',
            materializedMarkdown: elementMetadata,
          },
        ],
      },
    ];
  }

  /** A caller db whose archived canonical target is filtered out as live. */
  function callerDb() {
    const stored = rows();
    return {
      task: {
        findMany: jest.fn(async ({ where }) =>
          stored.filter(
            (row) =>
              where.id?.in?.includes(row.id) ||
              (where.parentTaskId && row.parentTaskId === where.parentTaskId),
          ),
        ),
      },
      service: { findMany: jest.fn().mockResolvedValue([]) },
    } as any;
  }

  it('does not fail an unrelated edit on an untouched element with an archived target', async () => {
    const { projector } = await createProjector();
    const db = callerDb();
    const result = await projector.project({
      organizationId,
      projectId,
      db,
      request: {
        root: { refType: 'existing', id: DIAGRAM },
        operations: [
          {
            op: 'section.replace',
            ref: { refType: 'existing', id: DIAGRAM },
            key: 'description',
            content: 'Updated.',
          },
        ],
      },
    });
    expect(result.issues.map((issue) => issue.code)).not.toContain(
      'invalid_diagram_metadata',
    );
  });

  it('reports an archived target on a touched element through the caller db', async () => {
    const { projector, prisma } = await createProjector();
    const db = callerDb();
    const result = await projector.project({
      organizationId,
      projectId,
      db,
      request: {
        root: { refType: 'existing', id: DIAGRAM },
        operations: [
          {
            op: 'section.replace',
            ref: { refType: 'existing', id: ELEMENT },
            key: 'diagramElementMetadata',
            content: elementMetadata,
          },
        ],
      },
    });
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        field: `nodes.existing:${ELEMENT}.sections`,
        code: 'invalid_diagram_metadata',
      }),
    );
    expect(db.task.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { in: [ARCHIVED_TARGET] } }),
      }),
    );
    expect(prisma.db.task.findFirst).not.toHaveBeenCalled();
  });
});

describe('Retired work-item types', () => {
  async function setup() {
    const context = await createProjector();
    const rows = [
      persistedTask('root', 'Root', 'FEATURE'),
      {
        ...persistedTask('orphan', 'Legacy child', 'retired_mockup', 'root'),
        sections: [
          { key: 'preview', materializedMarkdown: '{"html":"legacy"}' },
        ],
      },
    ];
    (context.prisma.db.task.findMany as jest.Mock).mockImplementation(
      async ({ where }) =>
        rows.filter(
          (row) =>
            where.id?.in?.includes(row.id) ||
            (where.parentTaskId && row.parentTaskId === where.parentTaskId) ||
            where.OR?.some(
              (clause: { id?: string; parentTaskId?: string }) =>
                clause.id === row.id ||
                (clause.parentTaskId &&
                  clause.parentTaskId === row.parentTaskId),
            ),
        ),
    );
    return context;
  }

  it('omits ambient retired children from unrelated projection and current reads', async () => {
    const { projector } = await setup();
    const result = await projector.projectSnapshots({
      organizationId,
      projectId,
      request: {
        root: { refType: 'existing', id: 'root' },
        operations: [
          {
            op: 'workItem.update',
            ref: { refType: 'existing', id: 'root' },
            name: 'Updated root',
          },
        ],
      },
      view: rootChildrenView,
    });
    expect(result.target.issues).toEqual([]);
    expect(result.prior.children).toEqual([]);
    expect(result.unavailableWorkItemIds).toEqual(new Set(['orphan']));
    expect(result.target.children).toEqual([]);
    expect(
      (
        await projector.rehydrateCurrentProjection({
          organizationId,
          projectId,
          rootWorkItemId: 'root',
        })
      ).children,
    ).toEqual([]);
  });

  it('retains the raw deletion snapshot and deletes an orphan without its definition', async () => {
    const { projector } = await setup();
    const result = await projector.projectSnapshots({
      organizationId,
      projectId,
      request: {
        root: { refType: 'existing', id: 'root' },
        operations: [
          { op: 'workItem.delete', ref: { refType: 'existing', id: 'orphan' } },
        ],
      },
    });
    expect(result.target.issues).toEqual([]);
    expect(result.prior.children[0]).toMatchObject({
      deleted: false,
      sections: [{ key: 'preview', content: '{"html":"legacy"}' }],
    });
    expect(result.target.children[0]).toMatchObject({ deleted: true });
    expect(result.unavailableWorkItemIds).toEqual(new Set(['orphan']));
  });

  it.each<WorkItemChangeSetOperation>([
    {
      op: 'workItem.update',
      ref: { refType: 'existing', id: 'orphan' },
      name: 'Retained child',
    },
    {
      op: 'section.clear',
      ref: { refType: 'existing', id: 'orphan' },
      key: 'preview',
    },
    {
      op: 'section.replace',
      ref: { refType: 'existing', id: 'orphan' },
      key: 'preview',
      content: 'new',
    },
  ])(
    'returns a field-addressable diagnostic for $op on an unavailable type',
    async (operation) => {
      const { projector } = await setup();
      const result = await projector.project({
        organizationId,
        projectId,
        request: {
          root: { refType: 'existing', id: 'root' },
          operations: [operation],
        },
      });
      expect(result.valid).toBe(false);
      expect(result.issues).toContainEqual(
        expect.objectContaining({
          field: 'references.orphan.type',
          code: 'unrecognized_type',
        }),
      );
    },
  );
});

describe('Graph dependency admission', () => {
  it.each([
    { name: 'valid', first: [], second: ['first'], code: undefined },
    {
      name: 'dangling',
      first: [],
      second: ['removed'],
      code: 'unresolved_reference',
    },
    { name: 'self', first: [], second: ['second'], code: 'dependency_cycle' },
    {
      name: 'cycle',
      first: ['second'],
      second: ['first'],
      code: 'dependency_cycle',
    },
    {
      name: 'duplicate',
      first: [],
      second: ['first', 'first'],
      code: 'duplicate_dependency',
    },
  ])(
    'admits authored plan prerequisites through shared projection: $name',
    async ({ first, second, code }) => {
      const { projector, prisma } = await createProjector();
      const rows = [
        persistedTask('feature', 'Feature', 'FEATURE'),
        persistedTask('plan', 'Plan', 'PLAN', 'feature'),
        persistedTask('stage', 'Stage', 'PLAN_STAGE', 'plan'),
      ];
      (prisma.db.task.findMany as jest.Mock).mockImplementation(
        async ({ where }) =>
          rows.filter((row) => where.id?.in?.includes(row.id)),
      );
      const admission = new PlanSubmissionAdmissionService(prisma, projector);
      const steps = [first, second].map((dependsOnStepIds, index) => ({
        id: index === 0 ? 'first' : 'second',
        stageId: 'stage',
        title: `Task ${index}`,
        description: 'Work',
        implementation: 'Implement',
        acceptanceCriteria: '- Works',
        designDocMotivation: 'Required',
        type: 'TASK' as const,
        sequenceOrder: index,
        dependsOnStepIds,
      }));
      const request = admission.buildChangeSet('plan' as never, {
        0: { 0: { steps } },
      });
      const result = await projector.project({
        organizationId,
        projectId,
        request,
      });
      if (code)
        expect(result.issues).toEqual(
          expect.arrayContaining([expect.objectContaining({ code })]),
        );
      else expect(result.issues).toEqual([]);
    },
  );

  it.each(['RELATED_TO', 'DERIVES_FROM'] as const)(
    'permits an authored %s edge without traversing an existing dependency to a missing target',
    async (edgeType) => {
      const { projector, prisma, mockAgentEdgeClient } =
        await createProjector();
      const rows = [
        persistedTask('feature', 'Feature', 'FEATURE'),
        persistedTask('target', 'Target', 'STANDARD'),
      ];
      (prisma.db.task.findMany as jest.Mock).mockImplementation(
        async ({ where }) =>
          rows.filter((row) => where.id?.in?.includes(row.id)),
      );
      mockAgentEdgeClient.findIncident.mockImplementation(
        async (_org, _project, incidentRequest) =>
          incidentRequest.nodeIds.has('feature')
            ? [
                {
                  id: 'stale-dependency',
                  sourceNodeId: 'feature',
                  targetNodeId: 'missing-transitive',
                  sourceEntityType: 'TASK',
                  targetEntityType: 'TASK',
                  type: 'DEPENDS_ON',
                  category: 'meta',
                  reasoning: 'Existing dependency',
                },
              ]
            : [],
      );

      const projected = await projector.project({
        organizationId,
        projectId,
        request: {
          root: { refType: 'temporary', tempId: 'created' },
          operations: [
            {
              op: 'workItem.create',
              ref: { refType: 'temporary', tempId: 'created' },
              name: 'Created task',
              type: 'STANDARD',
              parent: { refType: 'existing', id: 'feature' },
            },
            {
              op: 'relationship.create',
              ref: { refType: 'temporary', tempId: 'authored-edge' },
              source: { refType: 'temporary', tempId: 'created' },
              target: { refType: 'existing', id: 'target' },
              edgeType,
              category: 'meta',
            },
          ],
        },
      });

      expect(projected.valid).toBe(true);
      expect(projected.issues).toEqual([]);
      expect(mockAgentEdgeClient.findIncident).not.toHaveBeenCalledWith(
        organizationId,
        projectId,
        expect.objectContaining({
          nodeIds: new Set(['missing-transitive']),
        }),
        'service-token',
      );
    },
  );

  it.each([
    {
      name: 'parent',
      missingId: 'missing-parent',
      operations: [
        {
          op: 'workItem.create' as const,
          ref: { refType: 'temporary' as const, tempId: 'created' },
          name: 'Created task',
          type: 'STANDARD',
          parent: { refType: 'existing' as const, id: 'missing-parent' },
        },
      ],
    },
    {
      name: 'relationship endpoint',
      missingId: 'missing-endpoint',
      operations: [
        {
          op: 'workItem.create' as const,
          ref: { refType: 'temporary' as const, tempId: 'created' },
          name: 'Created task',
          type: 'STANDARD',
          parent: { refType: 'existing' as const, id: 'feature' },
        },
        {
          op: 'relationship.create' as const,
          ref: { refType: 'temporary' as const, tempId: 'authored-edge' },
          source: { refType: 'temporary' as const, tempId: 'created' },
          target: { refType: 'existing' as const, id: 'missing-endpoint' },
          edgeType: 'RELATED_TO' as const,
          category: 'meta' as const,
        },
      ],
    },
  ])('still rejects an explicitly missing $name', async (testCase) => {
    const { projector, prisma } = await createProjector();
    const rows = [persistedTask('feature', 'Feature', 'FEATURE')];
    (prisma.db.task.findMany as jest.Mock).mockImplementation(
      async ({ where }) => rows.filter((row) => where.id?.in?.includes(row.id)),
    );

    const projected = await projector.project({
      organizationId,
      projectId,
      request: {
        root: { refType: 'temporary', tempId: 'created' },
        operations: testCase.operations,
      },
    });

    expect(projected.valid).toBe(false);
    expect(projected.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: `references.${testCase.missingId}`,
          code: 'dangling_reference',
        }),
      ]),
    );
  });

  it('rejects a cycle through a transitive prerequisite beyond the initial boundary', async () => {
    const { projector, prisma, mockAgentEdgeClient } = await createProjector();
    const rows = ['a', 'b', 'c', 'd'].map((id) =>
      persistedTask(id, id, 'STANDARD'),
    );
    (prisma.db.task.findMany as jest.Mock).mockImplementation(
      async ({ where }) => rows.filter((row) => where.id?.in?.includes(row.id)),
    );
    const edges = [
      ['b', 'c'],
      ['c', 'd'],
      ['d', 'a'],
    ].map(([sourceNodeId, targetNodeId]) => ({
      id: sourceNodeId + '->' + targetNodeId,
      sourceNodeId,
      targetNodeId,
      sourceEntityType: 'TASK',
      targetEntityType: 'TASK',
      type: 'DEPENDS_ON',
      category: 'meta',
      reasoning: 'Prerequisite',
    }));
    mockAgentEdgeClient.findIncident.mockImplementation(
      async (_org, _project, request) =>
        edges.filter(
          (edge) =>
            request.nodeIds.has(edge.sourceNodeId) ||
            request.nodeIds.has(edge.targetNodeId),
        ),
    );
    const projected = await projector.project({
      organizationId,
      projectId,
      request: {
        root: { refType: 'existing', id: 'a' },
        operations: [
          {
            op: 'relationship.create',
            ref: { refType: 'temporary', tempId: 'new' },
            source: { refType: 'existing', id: 'a' },
            target: { refType: 'existing', id: 'b' },
            edgeType: 'DEPENDS_ON',
            category: 'meta',
          },
        ],
      },
    });
    expect(projected.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'dependency_cycle' }),
      ]),
    );
    expect(mockAgentEdgeClient.findIncident.mock.calls.length).toBeGreaterThan(
      1,
    );
  });

  it('rejects duplicate projected endpoints and permits deleting the predecessor edge', async () => {
    const { projector, prisma, mockAgentEdgeClient } = await createProjector();
    (prisma.db.task.findMany as jest.Mock).mockResolvedValue([
      persistedTask('a', 'A', 'STANDARD'),
      persistedTask('b', 'B', 'STANDARD'),
    ]);
    mockAgentEdgeClient.findIncident.mockResolvedValue([
      {
        id: 'existing-edge',
        sourceNodeId: 'a',
        targetNodeId: 'b',
        sourceEntityType: 'TASK',
        targetEntityType: 'TASK',
        type: 'DEPENDS_ON',
        category: 'meta',
        reasoning: 'Prerequisite',
      },
    ]);
    const create: WorkItemChangeSetOperation = {
      op: 'relationship.create',
      ref: { refType: 'temporary', tempId: 'new' },
      source: { refType: 'existing', id: 'a' },
      target: { refType: 'existing', id: 'b' },
      edgeType: 'DEPENDS_ON',
      category: 'meta',
    };
    for (const removeOld of [false, true]) {
      const projected = await projector.project({
        organizationId,
        projectId,
        request: {
          root: { refType: 'existing', id: 'a' },
          operations: [
            ...(removeOld
              ? [
                  {
                    op: 'relationship.delete' as const,
                    ref: { refType: 'existing' as const, id: 'existing-edge' },
                  },
                ]
              : []),
            create,
          ],
        },
      });
      expect(
        projected.issues.some((issue) => issue.code === 'duplicate_dependency'),
      ).toBe(!removeOld);
    }
  });
});
