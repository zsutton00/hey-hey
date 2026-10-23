import type { ProposalService } from '../../services/proposal/proposal.service';
import type { TaskService } from '../../services/tasks/task.service';
import { createWarmWorkItemTypeRegistryWithCustomTypes } from '../../../test/setup/work-item-type-registry.fixture';
import {
  createWorkItemParameters,
  editWorkItemParameters,
  ProposalToolsProvider,
  validateGraphOperationsAgainstCapability,
} from '../tools/proposal-tools.provider';
import { guidanceTokenForType } from '../tools/work-item-guidance-token';
import { AUTHORING_ROOT_PROOF } from '../tools/authoring-guidance';
import { workItemChangeSetValidationRequestSchema } from '../../services/proposal/work-item-change-set.schema';
import { WorkStatus } from '../../generated/model/workStatus';
import { BadRequestException } from '@nestjs/common';
import { rootChildrenView } from '../../services/proposal/work-item-change-set-projector.service';

const ORG_ID = '00000000-0000-4000-8000-000000000001';
const PROJECT_ID = '00000000-0000-4000-8000-000000000002';
const WORKFLOW_ID = '00000000-0000-4000-8000-000000000003';
const PROPOSAL_ID = '00000000-0000-4000-8000-000000000004';
const STEP_ID = '00000000-0000-4000-8000-000000000005';
const RELATIONSHIP_ID = '00000000-0000-4000-8000-000000000006';
const GRAPH_TYPE = 'TEST_WORKFLOW';

const graphCapability = {
  nodeChildType: 'workflow_step',
  layout: {
    sectionKey: 'graphLayout',
    schemaRef: '#/components/schemas/WorkItemGraphLayoutValue',
  },
  readableRelationships: [
    {
      edgeType: 'STANDARD',
      category: 'flow',
      sourceEndpoint: {
        role: 'graphNode',
        entityTypes: ['TASK'],
        workItemTypeKeys: ['workflow_step'],
      },
      targetEndpoint: {
        role: 'graphNode',
        entityTypes: ['TASK'],
        workItemTypeKeys: ['workflow_step'],
      },
      direction: { required: true, allowedDirections: ['forward', 'backward'] },
    },
    {
      edgeType: 'CONDITIONAL',
      category: 'flow',
      sourceEndpoint: {
        role: 'graphNode',
        entityTypes: ['TASK'],
        workItemTypeKeys: ['workflow_step'],
      },
      targetEndpoint: {
        role: 'graphNode',
        entityTypes: ['TASK'],
        workItemTypeKeys: ['workflow_step'],
      },
      direction: {
        required: true,
        allowedDirections: ['forward', 'backward'],
        predicateRequired: true,
      },
    },
    {
      edgeType: 'LOOP',
      category: 'flow',
      sourceEndpoint: {
        role: 'graphNode',
        entityTypes: ['TASK'],
        workItemTypeKeys: ['workflow_step'],
      },
      targetEndpoint: {
        role: 'graphNode',
        entityTypes: ['TASK'],
        workItemTypeKeys: ['workflow_step'],
      },
    },
  ],
  editableRelationships: [] as Array<Record<string, unknown>>,
  rendererKey: 'work-item-graph',
  editorKey: 'work-item-graph-editor',
  supportedActions: [
    'viewGraph',
    'createNode',
    'updateNode',
    'deleteNode',
    'createRelationship',
    'updateRelationship',
    'reconnectRelationship',
    'deleteRelationship',
    'replaceLayout',
    'clearLayout',
  ],
};
graphCapability.editableRelationships = graphCapability.readableRelationships;

function request() {
  return {
    headers: {
      authorization: 'Bearer token',
      'x-project-id': PROJECT_ID,
    },
    cookies: {},
    user: {
      userId: 'user-1',
      email: 'test@example.com',
      name: 'Test',
      currentOrgId: ORG_ID,
      orgMemberships: [],
      isDevAdmin: false,
      devAdminMode: false,
    },
    ip: '127.0.0.1',
  } as any;
}

// Mirrors the canonical DIAGRAM meta relationships after the informational
// element-link migration, plus the DIAGRAM_ELEMENT registry edge targets.
const elementEndpoint = {
  role: 'graphNode',
  entityTypes: ['TASK'],
  workItemTypeKeys: ['DIAGRAM_ELEMENT'],
};
const diagramElementMetaRelationships = [
  ...[
    'RELATED_TO',
    'DERIVES_FROM',
    'CONTRADICTS',
    'EVOLVES',
    'FULFILLED_BY',
  ].map((edgeType) => ({
    edgeType,
    category: 'meta',
    sourceEndpoint: elementEndpoint,
    targetEndpoint: { role: 'externalEntity', entityTypes: ['TASK'] },
  })),
  ...['DEPENDS_ON', 'GUARANTEES', 'IMPLEMENTS', 'CONSUMES'].map((edgeType) => ({
    edgeType,
    category: 'meta',
    sourceEndpoint: elementEndpoint,
    targetEndpoint: {
      role: 'externalEntity',
      entityTypes: ['TASK'],
      workItemTypeKeys: ['CONTRACT'],
    },
  })),
];
const diagramElementEdgeTargets = [
  { edgeType: 'RELATED_TO', targetTypeKeys: [] },
  { edgeType: 'DEPENDS_ON', targetTypeKeys: ['CONTRACT'] },
  { edgeType: 'DERIVES_FROM', targetTypeKeys: [] },
  { edgeType: 'SUPERSEDES', targetTypeKeys: [] },
  { edgeType: 'CONTRADICTS', targetTypeKeys: [] },
  { edgeType: 'EVOLVES', targetTypeKeys: [] },
  { edgeType: 'GUARANTEES', targetTypeKeys: ['CONTRACT'] },
  { edgeType: 'IMPLEMENTS', targetTypeKeys: ['CONTRACT'] },
  { edgeType: 'CONSUMES', targetTypeKeys: ['CONTRACT'] },
];

async function createProvider(
  options: {
    type?: string;
    projection?: Record<string, unknown>;
    elementLinks?: {
      tasks?: Array<{ id: string; type: string }>;
      proposals?: Array<Record<string, unknown>>;
    };
  } = {},
) {
  const registry = await createWarmWorkItemTypeRegistryWithCustomTypes([
    {
      typeKey: GRAPH_TYPE,
      projectId: PROJECT_ID,
      sectionKeys: ['description'],
      capabilities: {
        requiresParent: false,
        graph: graphCapability,
      },
    },
    {
      typeKey: 'DIAGRAM',
      projectId: PROJECT_ID,
      sectionKeys: ['description', 'diagramMetadata', 'graphLayout'],
      capabilities: {
        requiresParent: false,
        graph: {
          ...graphCapability,
          nodeChildType: 'DIAGRAM_ELEMENT',
          ...(options.elementLinks
            ? {
                editableRelationships: [
                  ...graphCapability.editableRelationships,
                  ...diagramElementMetaRelationships,
                ],
              }
            : {}),
        },
      },
    },
    ...(options.elementLinks
      ? [
          {
            typeKey: 'DIAGRAM_ELEMENT',
            projectId: PROJECT_ID,
            sectionKeys: ['description', 'diagramElementMetadata'],
            allowedParentTypes: ['DIAGRAM'],
            edgeTargets: diagramElementEdgeTargets,
          },
        ]
      : []),
  ]);
  // The element-link lookup filters archived rows in the query; the mock
  // reproduces that by returning only the rows a test declares as live.
  const taskFindMany = jest
    .fn()
    .mockImplementation(({ where }: { where: { id?: { in?: string[] } } }) =>
      Promise.resolve(
        (options.elementLinks?.tasks ?? []).filter((row) =>
          where.id?.in?.includes(row.id),
        ),
      ),
    );
  const proposalFindMany = jest
    .fn()
    .mockImplementation(({ where }: { where: { id?: { in?: string[] } } }) =>
      Promise.resolve(
        (options.elementLinks?.proposals ?? []).filter((row) =>
          where.id?.in?.includes(row['id'] as string),
        ),
      ),
    );
  const proposalCreate = jest.fn().mockResolvedValue({
    id: PROPOSAL_ID,
    action: 'UPDATE',
    targetEntityType: 'TASK',
    targetEntityId: WORKFLOW_ID,
    createdAt: '2026-07-31T00:00:00.000Z',
  });
  const proposalService = {
    create: proposalCreate,
    createBatch: jest.fn(),
    findOne: jest.fn(),
  } as unknown as ProposalService;
  const taskService = {
    findOne: jest.fn().mockResolvedValue({
      id: WORKFLOW_ID,
      type: options.type ?? GRAPH_TYPE,
      sections: [
        { key: 'description', materializedMarkdown: 'Existing description' },
      ],
    }),
  } as unknown as TaskService;
  const projector = {
    project: jest.fn().mockResolvedValue(
      options.projection ?? {
        valid: true,
        root: { refType: 'existing', id: WORKFLOW_ID },
        workItems: [],
        relationships: [],
        identityLabels: {},
        issues: [],
      },
    ),
  };
  const provider = new ProposalToolsProvider(
    proposalService,
    taskService,
    {
      markNeedsRevision: jest.fn(),
      consumeRecovery: jest.fn().mockResolvedValue(false),
    } as any,
    registry,
    {
      db: {
        task: { findMany: taskFindMany, findFirst: jest.fn() },
        proposal: { findMany: proposalFindMany },
        designDoc: { findMany: jest.fn() },
      },
    } as any,
    projector as any,
  );
  return { provider, proposalCreate, projector, registry, taskFindMany };
}

const canonicalDiagramCreateOperations = [
  {
    op: 'workItem.create' as const,
    ref: { refType: 'temporary' as const, tempId: 'diagram-root' },
    name: 'Service overview',
    type: 'DIAGRAM',
  },
  {
    op: 'section.replace' as const,
    ref: { refType: 'temporary' as const, tempId: 'diagram-root' },
    key: 'diagramMetadata',
    content: { kind: 'GENERAL', level: 'OVERVIEW' },
  },
];

describe('create_work_item canonical Diagram change sets', () => {
  it('retains durable proposal links alongside the complete graph CREATE', async () => {
    const { provider, proposalCreate } = await createProvider();
    const edges = [
      {
        endpointMode: 'PROPOSAL' as const,
        targetEntityType: 'PROPOSAL' as const,
        targetEntityId: PROPOSAL_ID,
        edgeType: 'EVOLVES' as const,
      },
    ];
    const result = await provider.createWorkItem(
      {
        type: 'DIAGRAM',
        name: 'Service overview',
        eli5: 'Creates a linked diagram.',
        operations: canonicalDiagramCreateOperations,
        edges,
        authoringRootProof: AUTHORING_ROOT_PROOF,
      },
      {} as any,
      request(),
    );
    expect(result).toMatchObject({ status: 'proposed' });
    expect(proposalCreate.mock.calls[0][3]).toMatchObject({
      edges,
      updates: { operations: canonicalDiagramCreateOperations },
    });
  });

  it('retains durable proposal links alongside graph UPDATE operations', async () => {
    const { provider, proposalCreate } = await createProvider();
    const edges = [
      {
        endpointMode: 'PROPOSAL' as const,
        targetEntityType: 'PROPOSAL' as const,
        targetEntityId: PROPOSAL_ID,
        edgeType: 'DEPENDS_ON' as const,
      },
    ];
    const operations = [
      {
        op: 'workItem.update' as const,
        ref: { refType: 'existing' as const, id: WORKFLOW_ID },
        name: 'Updated diagram',
      },
    ];
    const result = await provider.editWorkItem(
      {
        targetEntityId: WORKFLOW_ID,
        eli5: 'Updates a linked diagram.',
        operations,
        edges,
        authoringRootProof: AUTHORING_ROOT_PROOF,
      },
      {} as any,
      request(),
    );
    expect(result).toMatchObject({ status: 'proposed' });
    expect(proposalCreate.mock.calls[0][3]).toMatchObject({
      edges,
      updates: { operations },
    });
  });
  it('exposes diagramElements and removes workflowSteps from the tool schema', () => {
    expect(createWorkItemParameters.shape).toHaveProperty('diagramElements');
    expect(createWorkItemParameters.shape).not.toHaveProperty('workflowSteps');
    expect(createWorkItemParameters.shape).not.toHaveProperty('steps');
    expect(createWorkItemParameters.shape).not.toHaveProperty('children');
  });

  it.each(['COMPONENT', 'AGENT', 'PERSON'])(
    'projects %s Diagram Elements and relationships with shared temporary identities',
    async (role) => {
      const { provider, proposalCreate } = await createProvider();
      const relationship = {
        op: 'relationship.create' as const,
        ref: { refType: 'temporary' as const, tempId: 'relationship-a-b' },
        source: { refType: 'temporary' as const, tempId: 'element-a' },
        target: { refType: 'temporary' as const, tempId: 'element-b' },
        edgeType: 'STANDARD' as const,
        category: 'flow' as const,
        direction: 'forward' as const,
      };

      const result = await provider.createWorkItem(
        {
          type: 'DIAGRAM',
          eli5: 'Explains the proposed change.',
          name: 'Service overview',
          diagramElements: [
            {
              tempId: 'element-a',
              name: 'Ingress',
              sections: [
                {
                  key: 'diagramElementMetadata',
                  content: { role },
                },
              ],
            },
            {
              tempId: 'element-b',
              name: 'Worker',
              sections: [
                {
                  key: 'diagramElementMetadata',
                  content: { role },
                },
              ],
            },
          ],
          operations: [...canonicalDiagramCreateOperations, relationship],
          guidanceToken: guidanceTokenForType('DIAGRAM', PROJECT_ID),
          authoringRootProof: AUTHORING_ROOT_PROOF,
        },
        {} as any,
        request(),
      );

      expect(result).toMatchObject({ status: 'proposed' });
      expect(proposalCreate).toHaveBeenCalledTimes(1);
      const updates = proposalCreate.mock.calls[0][3].updates;
      expect(updates.root).toEqual({
        refType: 'temporary',
        tempId: 'diagram-root',
      });
      expect(updates.operations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            op: 'workItem.create',
            ref: { refType: 'temporary', tempId: 'element-a' },
            type: 'DIAGRAM_ELEMENT',
            parent: { refType: 'temporary', tempId: 'diagram-root' },
          }),
          expect.objectContaining({
            op: 'section.replace',
            ref: { refType: 'temporary', tempId: 'element-a' },
            key: 'diagramElementMetadata',
            content: { role },
          }),
          expect.objectContaining({
            op: 'workItem.create',
            ref: { refType: 'temporary', tempId: 'element-b' },
            type: 'DIAGRAM_ELEMENT',
            parent: { refType: 'temporary', tempId: 'diagram-root' },
          }),
          relationship,
        ]),
      );
      expect(updates).not.toHaveProperty('diagramElements');
      expect(updates).not.toHaveProperty('workflowSteps');
    },
  );

  it.each([
    [
      'sections',
      { sections: [{ key: 'description', content: 'Do not discard me.' }] },
    ],
    ['parentTaskId', { parentTaskId: WORKFLOW_ID }],
  ])(
    'rejects mixed outer %s instead of silently discarding it',
    async (field, outer) => {
      const { provider, proposalCreate, projector } = await createProvider();

      const result = await provider.createWorkItem(
        {
          eli5: 'Explains the proposed change.',
          type: 'DIAGRAM',
          name: 'Service overview',
          operations: canonicalDiagramCreateOperations,
          authoringRootProof: AUTHORING_ROOT_PROOF,
          ...outer,
        },
        {} as any,
        request(),
      );

      expect(result).toMatchObject({ isError: true });
      expect((result as any).content[0].text).toContain(
        'Canonical Diagram CREATE cannot mix',
      );
      expect((result as any).content[0].text).toContain(field);
      expect(proposalCreate).not.toHaveBeenCalled();
      expect(projector.project).not.toHaveBeenCalled();
    },
  );

  it('passes the complete generated request to shared create admission unchanged', async () => {
    const { provider, proposalCreate, projector } = await createProvider();

    const result = await provider.createWorkItem(
      {
        eli5: 'Explains the proposed change.',
        type: 'DIAGRAM',
        name: 'Service overview',
        operations: canonicalDiagramCreateOperations,
        authoringRootProof: AUTHORING_ROOT_PROOF,
      },
      {} as any,
      request(),
    );

    expect(result).toMatchObject({ status: 'proposed' });
    expect(proposalCreate).toHaveBeenCalledTimes(1);
    expect(proposalCreate.mock.calls[0][3].updates).toEqual({
      root: { refType: 'temporary', tempId: 'diagram-root' },
      operations: canonicalDiagramCreateOperations,
    });
    expect(projector.project).not.toHaveBeenCalled();
  });

  it('returns structured shared-admission findings for canonical CREATE recovery', async () => {
    const { provider, proposalCreate } = await createProvider();
    proposalCreate.mockRejectedValueOnce(
      new BadRequestException({
        message: 'Diagram proposals contain an invalid projected change set',
        errors: [
          {
            field: 'nodes.temporary:diagram-root.sections.diagramMetadata',
            code: 'invalid_diagram_metadata',
            reason: 'Diagram metadata must be canonical.',
            layer: 'referential',
            suggestion: 'Retry with canonical Diagram metadata.',
          },
        ],
      }),
    );

    const result = await provider.createWorkItem(
      {
        eli5: 'Explains the proposed change.',
        type: 'DIAGRAM',
        name: 'Service overview',
        operations: canonicalDiagramCreateOperations,
        authoringRootProof: AUTHORING_ROOT_PROOF,
      },
      {} as any,
      request(),
    );

    expect(result).toEqual({
      status: 'invalid_change_set',
      workItemType: 'DIAGRAM',
      issues: [
        expect.objectContaining({
          code: 'invalid_diagram_metadata',
          field: 'nodes.temporary:diagram-root.sections.diagramMetadata',
        }),
      ],
    });
  });
});

describe('create_work_item per-element Diagram links', () => {
  const MOCKUP_ID = '00000000-0000-4000-8000-0000000000a1';
  const CONTRACT_ID = '00000000-0000-4000-8000-0000000000a2';
  const DECISION_ID = '00000000-0000-4000-8000-0000000000a3';
  const ARCHIVED_ID = '00000000-0000-4000-8000-0000000000a4';
  const MISSING_ID = '00000000-0000-4000-8000-0000000000a5';
  const TARGET_PROPOSAL_ID = '00000000-0000-4000-8000-0000000000b1';

  const liveTargets = [
    { id: MOCKUP_ID, type: 'mockup' },
    { id: CONTRACT_ID, type: 'CONTRACT' },
    { id: DECISION_ID, type: 'decision' },
  ];

  const element = (
    tempId: string,
    name: string,
    edges: Array<Record<string, unknown>>,
  ) => ({
    tempId,
    name,
    sections: [
      { key: 'diagramElementMetadata', content: { role: 'COMPONENT' } },
    ],
    edges: edges as any,
  });

  const createDiagram = (
    provider: ProposalToolsProvider,
    diagramElements: Array<ReturnType<typeof element>>,
    extra: Record<string, unknown> = {},
  ) =>
    provider.createWorkItem(
      {
        type: 'DIAGRAM',
        eli5: 'Creates a connected diagram.',
        name: 'Service overview',
        diagramElements,
        operations: canonicalDiagramCreateOperations,
        guidanceToken: guidanceTokenForType('DIAGRAM', PROJECT_ID),
        authoringRootProof: AUTHORING_ROOT_PROOF,
        ...extra,
      } as any,
      {} as any,
      request(),
    );

  it('compiles existing-target links into element-sourced relationship operations', async () => {
    const { provider, proposalCreate } = await createProvider({
      elementLinks: { tasks: liveTargets },
    });

    const result = await createDiagram(provider, [
      element('ui', 'Checkout UI', [
        {
          edgeType: 'RELATED_TO',
          targetEntityType: 'TASK',
          targetEntityId: MOCKUP_ID,
          description: 'Explanatory Mockup',
        },
      ]),
      element('controller', 'Checkout controller', [
        {
          edgeType: 'GUARANTEES',
          targetEntityType: 'TASK',
          targetEntityId: CONTRACT_ID,
        },
      ]),
      element('db', 'Orders database', [
        {
          edgeType: 'RELATED_TO',
          targetEntityType: 'TASK',
          targetEntityId: DECISION_ID,
        },
      ]),
    ]);

    expect(result).toMatchObject({ status: 'proposed' });
    const dto = proposalCreate.mock.calls[0][3];
    expect(dto.edges).toBeUndefined();
    const linkOperations = dto.updates.operations.filter(
      (operation: { op: string; category?: string }) =>
        operation.op === 'relationship.create' && operation.category === 'meta',
    );
    expect(linkOperations).toEqual([
      {
        op: 'relationship.create',
        ref: { refType: 'temporary', tempId: 'diagramElements[0].edges[0]' },
        source: { refType: 'temporary', tempId: 'ui' },
        target: { refType: 'existing', id: MOCKUP_ID },
        edgeType: 'RELATED_TO',
        category: 'meta',
        reasoning: 'Explanatory Mockup',
      },
      {
        op: 'relationship.create',
        ref: { refType: 'temporary', tempId: 'diagramElements[1].edges[0]' },
        source: { refType: 'temporary', tempId: 'controller' },
        target: { refType: 'existing', id: CONTRACT_ID },
        edgeType: 'GUARANTEES',
        category: 'meta',
      },
      {
        op: 'relationship.create',
        ref: { refType: 'temporary', tempId: 'diagramElements[2].edges[0]' },
        source: { refType: 'temporary', tempId: 'db' },
        target: { refType: 'existing', id: DECISION_ID },
        edgeType: 'RELATED_TO',
        category: 'meta',
      },
    ]);
    // The generated request is the validated change-set shape approval
    // materializes; element links never leak into it as a raw field.
    expect(
      workItemChangeSetValidationRequestSchema.safeParse(dto.updates).success,
    ).toBe(true);
    expect(JSON.stringify(dto.updates)).not.toContain('"edges"');
  });

  it('persists a same-round proposal target as a deferred edge sourced from the element', async () => {
    const { provider, proposalCreate } = await createProvider({
      elementLinks: {
        proposals: [
          {
            id: TARGET_PROPOSAL_ID,
            status: 'DRAFT',
            action: 'CREATE',
            targetEntityType: 'TASK',
            updates: { type: 'STANDARD', name: 'Checkout mockup' },
          },
        ],
      },
    });
    const wholeDiagramEdge = {
      targetEntityType: 'PROPOSAL' as const,
      targetEntityId: TARGET_PROPOSAL_ID,
      edgeType: 'RELATED_TO' as const,
    };

    const result = await createDiagram(
      provider,
      [
        element('ui', 'Checkout UI', [
          {
            edgeType: 'RELATED_TO',
            targetEntityType: 'PROPOSAL',
            targetEntityId: TARGET_PROPOSAL_ID,
            description: 'Mockup proposed in this round',
          },
        ]),
      ],
      { edges: [wholeDiagramEdge] },
    );

    expect(result).toMatchObject({ status: 'proposed' });
    const dto = proposalCreate.mock.calls[0][3];
    expect(dto.edges).toEqual([
      wholeDiagramEdge,
      {
        targetEntityType: 'PROPOSAL',
        targetEntityId: TARGET_PROPOSAL_ID,
        edgeType: 'RELATED_TO',
        sourceRef: { refType: 'temporary', tempId: 'ui' },
        description: 'Mockup proposed in this round',
      },
    ]);
    expect(
      dto.updates.operations.some(
        (operation: { category?: string }) => operation.category === 'meta',
      ),
    ).toBe(false);
  });

  it('rejects every invalid element link in one response, naming the element and link', async () => {
    const { provider, proposalCreate, projector } = await createProvider({
      elementLinks: {
        tasks: liveTargets,
        proposals: [
          {
            id: TARGET_PROPOSAL_ID,
            status: 'DRAFT',
            action: 'CREATE',
            targetEntityType: 'TASK',
            updates: { type: 'STANDARD', name: 'Checkout mockup' },
          },
        ],
      },
      projection: {
        valid: false,
        issues: [
          {
            field: 'nodes.temporary:diagram-root.sections.diagramMetadata',
            code: 'invalid_diagram_metadata',
            reason: 'Diagram metadata must be canonical.',
            layer: 'referential',
          },
        ],
      },
    });

    const result = await createDiagram(provider, [
      element('ui', 'Checkout UI', [
        // Registry allows GUARANTEES only to CONTRACT.
        {
          edgeType: 'GUARANTEES',
          targetEntityType: 'TASK',
          targetEntityId: MOCKUP_ID,
        },
        {
          edgeType: 'SUPERSEDES',
          targetEntityType: 'TASK',
          targetEntityId: DECISION_ID,
        },
        // Valid link: must not be reported.
        {
          edgeType: 'RELATED_TO',
          targetEntityType: 'TASK',
          targetEntityId: MOCKUP_ID,
        },
      ]),
      element('controller', 'Checkout controller', [
        {
          edgeType: 'DEPENDS_ON',
          targetEntityType: 'TASK',
          targetEntityId: CONTRACT_ID,
        },
        {
          edgeType: 'RELATED_TO',
          targetEntityType: 'TASK',
          targetEntityId: MISSING_ID,
        },
        {
          edgeType: 'RELATED_TO',
          targetEntityType: 'TASK',
          targetEntityId: ARCHIVED_ID,
        },
        {
          edgeType: 'FULFILLED_BY',
          targetEntityType: 'PROPOSAL',
          targetEntityId: TARGET_PROPOSAL_ID,
        },
      ]),
    ]);

    expect(proposalCreate).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: 'invalid_change_set',
      workItemType: 'DIAGRAM',
    });
    const issues = (
      result as unknown as { issues: Array<Record<string, string>> }
    ).issues;
    expect(issues.map((issue) => [issue['field'], issue['code']])).toEqual([
      ['diagramElements[0].edges[0].edgeType', 'invalid_value'],
      ['diagramElements[0].edges[1].edgeType', 'supersede_transition_required'],
      ['diagramElements[1].edges[0].edgeType', 'invalid_contract_participants'],
      ['diagramElements[1].edges[1].targetEntityId', 'dangling_reference'],
      ['diagramElements[1].edges[2].targetEntityId', 'dangling_reference'],
      ['diagramElements[1].edges[3].edgeType', 'invalid_value'],
      [
        'nodes.temporary:diagram-root.sections.diagramMetadata',
        'invalid_diagram_metadata',
      ],
    ]);
    expect(issues[0]!['reason']).toContain(
      'Diagram Element "Checkout UI" link 0 (GUARANTEES',
    );
    expect(issues[2]!['reason']).toContain('Checkout controller');
    expect(issues[2]!['suggestion']).toContain(
      'GUARANTEES, IMPLEMENTS or CONSUMES',
    );
    // Remaining change set, including the valid element link, is still
    // projected so the rejection carries every knowable finding.
    const projected = projector.project.mock.calls[0][0].request.operations;
    expect(
      projected.filter(
        (operation: { category?: string }) => operation.category === 'meta',
      ),
    ).toEqual([
      expect.objectContaining({
        ref: { refType: 'temporary', tempId: 'diagramElements[0].edges[2]' },
      }),
    ]);
  });

  it('maps shared-admission findings on compiled carriers back to the element link', async () => {
    const { provider, proposalCreate } = await createProvider({
      elementLinks: {
        tasks: liveTargets,
        proposals: [
          {
            id: TARGET_PROPOSAL_ID,
            status: 'DRAFT',
            action: 'CREATE',
            targetEntityType: 'TASK',
            updates: { type: 'STANDARD', name: 'Checkout mockup' },
          },
        ],
      },
    });
    proposalCreate.mockRejectedValueOnce(
      new BadRequestException({
        message: 'Invalid proposal',
        errors: [
          {
            field: 'relationships.temporary:diagramElements[0].edges[0].target',
            code: 'dangling_reference',
            reason: 'Relationship endpoints must resolve.',
            layer: 'referential',
          },
          {
            field: 'proposals[0].edges[0].targetEntityId',
            code: 'invalid_value',
            reason: 'Deferred Diagram links require a CREATE proposal target.',
            layer: 'referential',
          },
        ],
      }),
    );

    const result = await createDiagram(provider, [
      element('ui', 'Checkout UI', [
        {
          edgeType: 'RELATED_TO',
          targetEntityType: 'TASK',
          targetEntityId: MOCKUP_ID,
        },
        {
          edgeType: 'RELATED_TO',
          targetEntityType: 'PROPOSAL',
          targetEntityId: TARGET_PROPOSAL_ID,
        },
      ]),
    ]);

    expect(result).toMatchObject({
      status: 'invalid_change_set',
      issues: [
        expect.objectContaining({
          field: 'diagramElements[0].edges[0].targetEntityId',
          reason: expect.stringContaining(
            'Diagram Element "Checkout UI" link 0',
          ),
        }),
        expect.objectContaining({
          field: 'diagramElements[0].edges[1].targetEntityId',
          reason: expect.stringContaining(
            'Diagram Element "Checkout UI" link 1',
          ),
        }),
      ],
    });
  });

  it('does not accept an agent-authored sourceRef on create_work_item edges', () => {
    const parsed = createWorkItemParameters.safeParse({
      type: 'DIAGRAM',
      eli5: 'Creates a diagram.',
      name: 'Service overview',
      edges: [
        {
          targetEntityType: 'PROPOSAL',
          targetEntityId: PROPOSAL_ID,
          edgeType: 'RELATED_TO',
          sourceRef: { refType: 'temporary', tempId: 'ui' },
        },
      ],
    });
    expect(parsed.success).toBe(false);
    expect(
      createWorkItemParameters.safeParse({
        type: 'DIAGRAM',
        eli5: 'Creates a diagram.',
        name: 'Service overview',
        diagramElements: [
          {
            tempId: 'ui',
            name: 'Checkout UI',
            edges: [
              {
                edgeType: 'RELATED_TO',
                targetEntityType: 'PROPOSAL',
                targetEntityId: PROPOSAL_ID,
              },
            ],
          },
        ],
      }).success,
    ).toBe(true);
  });
});

describe('edit_work_item generic graph change sets', () => {
  it.each([
    ['create_design_doc', 'createDesignDoc'],
    ['edit_design_doc', 'editDesignDoc'],
  ] as const)(
    '%s preserves the shared canonical admission issue shape',
    async (_toolName, methodName) => {
      const issues = [
        {
          field: 'proposals[0].updates.parentEntityId',
          code: 'entity_not_found',
          reason: 'The requested parent does not exist.',
          layer: 'referential',
          suggestion: 'Choose an active parent.',
          metadata: { parentEntityType: 'TASK' },
        },
        {
          field: 'proposals[0].influences[0].entityId',
          code: 'entity_not_found',
          reason: 'The influence does not exist.',
          layer: 'referential',
        },
      ];
      const { provider, proposalCreate } = await createProvider();
      proposalCreate.mockRejectedValueOnce(
        new BadRequestException({
          message: 'Proposal authoring validation failed',
          errors: issues,
        }),
      );

      const result =
        methodName === 'createDesignDoc'
          ? await provider.createDesignDoc(
              {
                eli5: 'Explains the proposed change.',
                name: 'A design doc',
                content: 'Focused design content.',
              },
              {} as any,
              request(),
            )
          : await provider.editDesignDoc(
              {
                eli5: 'Explains the proposed change.',
                targetEntityId: WORKFLOW_ID,
                sections: [
                  { key: 'content', content: 'Focused design content.' },
                ],
              },
              {} as any,
              request(),
            );

      expect(result).toEqual({ status: 'invalid_change_set', issues });
    },
  );

  it('preserves structured projected findings returned during create admission', async () => {
    const { provider, proposalCreate } = await createProvider();
    proposalCreate.mockRejectedValueOnce(
      new BadRequestException({
        message: 'Plan Stage proposals contain an invalid projected change set',
        errors: [
          {
            field: 'nodes.existing:plan.stageDependencies',
            code: 'plan_stage_branching',
            reason:
              'A Plan Stage may have only one immediate successor in a linear Plan.',
            layer: 'referential',
            suggestion: 'Choose one next Stage.',
            metadata: {
              planIdentity: 'existing:plan',
              stageIdentity: 'temporary:stage-a',
              relationshipIdentities: ['temporary:edge-a', 'temporary:edge-b'],
            },
          },
        ],
      }),
    );

    const result = await provider.createWorkItem(
      {
        eli5: 'Explains the proposed change.',
        type: 'PLAN_STAGE',
        name: 'Stage B',
        parentTaskId: WORKFLOW_ID,
        sections: [
          { key: 'description', content: 'Deliver the next milestone.' },
        ],
        guidanceToken: guidanceTokenForType('PLAN_STAGE', PROJECT_ID),
        authoringRootProof: AUTHORING_ROOT_PROOF,
      },
      {} as any,
      request(),
    );

    expect(result).toEqual({
      status: 'invalid_change_set',
      workItemType: 'PLAN_STAGE',
      issues: [
        expect.objectContaining({
          field: 'nodes.existing:plan.stageDependencies',
          code: 'plan_stage_branching',
          metadata: expect.objectContaining({
            stageIdentity: 'temporary:stage-a',
          }),
        }),
      ],
    });
  });

  it('strictly parses generated operations and rejects non-finite layout coordinates', () => {
    const base = {
      root: { refType: 'existing' as const, id: WORKFLOW_ID },
      operations: [
        {
          op: 'layout.replace' as const,
          root: { refType: 'existing' as const, id: WORKFLOW_ID },
          sectionKey: 'graphLayout',
          entries: [
            {
              node: { refType: 'existing' as const, id: STEP_ID },
              position: { x: 0, y: 10 },
            },
          ],
        },
      ],
    };

    expect(
      workItemChangeSetValidationRequestSchema.safeParse(base).success,
    ).toBe(true);
    expect(
      workItemChangeSetValidationRequestSchema.safeParse({
        ...base,
        extra: true,
      }).success,
    ).toBe(false);
    expect(
      workItemChangeSetValidationRequestSchema.safeParse({
        ...base,
        operations: [
          {
            ...base.operations[0],
            entries: [
              {
                node: { refType: 'existing', id: STEP_ID },
                position: { x: Number.POSITIVE_INFINITY, y: 0 },
              },
            ],
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      editWorkItemParameters.safeParse({
        eli5: 'Deletes an existing workflow step.',
        targetEntityId: WORKFLOW_ID,
        operations: [
          { op: 'workItem.delete', ref: { refType: 'existing', id: STEP_ID } },
        ],
      }).success,
    ).toBe(true);
  });

  it('uses generated OpenAPI vocabularies and constraints for graph operations', () => {
    for (const status of Object.values(WorkStatus)) {
      expect(
        workItemChangeSetValidationRequestSchema.safeParse({
          root: { refType: 'existing', id: WORKFLOW_ID },
          operations: [
            {
              op: 'workItem.update',
              ref: { refType: 'existing', id: STEP_ID },
              parent: null,
              status,
            },
          ],
        }).success,
      ).toBe(true);
    }

    expect(
      workItemChangeSetValidationRequestSchema.safeParse({
        root: { refType: 'existing', id: 'not-a-uuid' },
        operations: [],
      }).success,
    ).toBe(false);
    expect(
      workItemChangeSetValidationRequestSchema.safeParse({
        root: { refType: 'temporary', tempId: '' },
        operations: [],
      }).success,
    ).toBe(false);
  });

  it('rejects graph operations for a type without graph capabilities', async () => {
    const { provider, proposalCreate, projector } = await createProvider({
      type: 'STANDARD',
    });

    const result = await provider.editWorkItem(
      {
        eli5: 'Explains the proposed change.',
        targetEntityId: WORKFLOW_ID,
        authoringRootProof: AUTHORING_ROOT_PROOF,
        operations: [
          { op: 'workItem.delete', ref: { refType: 'existing', id: STEP_ID } },
        ],
      },
      {} as any,
      request(),
    );

    expect(result).toMatchObject({
      status: 'invalid_change_set',
      workItemType: 'STANDARD',
      issues: [{ code: 'graph_capability_required', field: 'operations' }],
    });
    expect(projector.project).not.toHaveBeenCalled();
    expect(proposalCreate).not.toHaveBeenCalled();
  });

  it('translates root scalar and prose edits before projection and persists the exact request', async () => {
    const { provider, proposalCreate, projector } = await createProvider();
    const operations = [
      {
        op: 'workItem.create' as const,
        ref: { refType: 'temporary' as const, tempId: 'new-step' },
        name: 'New step',
        type: 'workflow_step',
        parent: { refType: 'existing' as const, id: WORKFLOW_ID },
      },
    ];

    const result = await provider.editWorkItem(
      {
        eli5: 'Explains the proposed change.',
        targetEntityId: WORKFLOW_ID,
        name: 'Settled supervision',
        sections: [{ key: 'description', content: 'Current behavior.' }],
        guidanceToken: guidanceTokenForType(GRAPH_TYPE, PROJECT_ID),
        authoringRootProof: AUTHORING_ROOT_PROOF,
        operations,
      },
      {} as any,
      request(),
    );

    expect(result).toMatchObject({ status: 'proposed' });
    const expectedRequest = {
      root: { refType: 'existing', id: WORKFLOW_ID },
      operations: [
        {
          op: 'workItem.update',
          ref: { refType: 'existing', id: WORKFLOW_ID },
          name: 'Settled supervision',
        },
        {
          op: 'section.replace',
          ref: { refType: 'existing', id: WORKFLOW_ID },
          key: 'description',
          content: 'Current behavior.',
        },
        ...operations,
      ],
    };
    expect(projector.project).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      projectId: PROJECT_ID,
      request: expectedRequest,
      view: rootChildrenView,
    });
    expect(proposalCreate.mock.calls[0][3].updates).toEqual(expectedRequest);
  });

  it('requires reconnectRelationship independently from ordinary relationship updates', async () => {
    const { registry } = await createProvider();
    const graph = registry.getGraphCapability(GRAPH_TYPE, PROJECT_ID)!;
    const withoutReconnect = {
      ...graph,
      supportedActions: graph.supportedActions.filter(
        (action) => action !== 'reconnectRelationship',
      ),
    };

    expect(
      validateGraphOperationsAgainstCapability({
        graph: withoutReconnect,
        operations: [
          {
            op: 'relationship.update',
            ref: { refType: 'existing', id: RELATIONSHIP_ID },
            target: { refType: 'existing', id: STEP_ID },
            targetEntityType: 'TASK',
          },
        ],
      }),
    ).toEqual([
      expect.objectContaining({
        code: 'unsupported_graph_action',
        reason: expect.stringContaining('reconnectRelationship'),
      }),
    ]);
    expect(
      validateGraphOperationsAgainstCapability({
        graph: withoutReconnect,
        operations: [
          {
            op: 'relationship.update',
            ref: { refType: 'existing', id: RELATIONSHIP_ID },
            reasoning: 'Clarify the branch.',
          },
        ],
      }),
    ).toEqual([]);
  });

  it('rejects direct supersede state and lineage operations', async () => {
    const { registry } = await createProvider();
    const graph = registry.getGraphCapability(GRAPH_TYPE, PROJECT_ID)!;
    const graphWithSupersedes = {
      ...graph,
      editableRelationships: [
        ...graph.editableRelationships,
        {
          ...graph.editableRelationships[0]!,
          edgeType: 'SUPERSEDES' as const,
          category: 'meta' as const,
        },
      ],
    };

    expect(
      validateGraphOperationsAgainstCapability({
        graph: graphWithSupersedes,
        operations: [
          {
            op: 'workItem.update',
            ref: { refType: 'existing', id: STEP_ID },
            status: 'SUPERSEDED',
          },
          {
            op: 'relationship.create',
            ref: { refType: 'temporary', tempId: 'supersedes-link' },
            source: { refType: 'existing', id: WORKFLOW_ID },
            target: { refType: 'existing', id: STEP_ID },
            edgeType: 'SUPERSEDES',
            category: 'meta',
          },
          {
            op: 'relationship.update',
            ref: { refType: 'existing', id: RELATIONSHIP_ID },
            edgeType: 'SUPERSEDES',
          },
        ],
      }),
    ).toEqual([
      expect.objectContaining({
        field: 'operations.0.status',
        code: 'supersede_transition_required',
      }),
      expect.objectContaining({
        field: 'operations.1.edgeType',
        code: 'supersede_transition_required',
      }),
      expect.objectContaining({
        field: 'operations.2.edgeType',
        code: 'supersede_transition_required',
      }),
    ]);
  });

  it('retains deferred Diagram element links when graph editing is selected', async () => {
    const { provider, proposalCreate, projector } = await createProvider({
      type: 'DIAGRAM',
    });
    const edges = [
      {
        targetEntityId: PROPOSAL_ID,
        targetEntityType: 'PROPOSAL' as const,
        edgeType: 'RELATED_TO' as const,
        sourceRef: {
          refType: 'temporary' as const,
          tempId: 'new-diagram-element',
        },
      },
    ];
    const result = await provider.editWorkItem(
      {
        eli5: 'Explains the proposed change.',
        targetEntityId: WORKFLOW_ID,
        authoringRootProof: AUTHORING_ROOT_PROOF,
        operations: [],
        edges,
      },
      {} as any,
      request(),
    );

    expect(result).toMatchObject({ status: 'proposed' });
    expect(projector.project).toHaveBeenCalledTimes(1);
    expect(proposalCreate.mock.calls[0][3]).toMatchObject({ edges });
  });

  it('returns projector issues unchanged and does not persist', async () => {
    const issue = {
      field: 'relationships.existing:edge-1.target',
      code: 'invalid_endpoint_type',
      reason: 'Target is not a workflow step.',
      layer: 'referential',
      suggestion: 'Choose a workflow_step target.',
    };
    const { provider, proposalCreate } = await createProvider({
      projection: {
        valid: false,
        root: { refType: 'existing', id: WORKFLOW_ID },
        workItems: [],
        relationships: [],
        identityLabels: {},
        issues: [issue],
      },
    });

    const result = await provider.editWorkItem(
      {
        eli5: 'Explains the proposed change.',
        targetEntityId: WORKFLOW_ID,
        operations: [],
      },
      {} as any,
      request(),
    );

    expect(result).toEqual({
      status: 'invalid_change_set',
      workItemType: GRAPH_TYPE,
      issues: [issue],
    });
    expect(proposalCreate).not.toHaveBeenCalled();
  });

  it('persists valid graph edits while returning advisory topology warnings', async () => {
    const { provider, proposalCreate, projector } = await createProvider();
    const projection = {
      valid: true,
      projectedRoot: {
        identity: { refType: 'existing', id: WORKFLOW_ID },
        label: 'Workflow',
        name: 'Workflow',
        type: GRAPH_TYPE,
        sections: [],
        deleted: false,
      },
      children: [
        {
          identity: { refType: 'existing', id: STEP_ID },
          label: 'Step',
          name: 'Step',
          type: 'workflow_step',
          parent: { refType: 'existing', id: WORKFLOW_ID },
          sections: [],
          deleted: false,
        },
      ],
      sections: [],
      incidentRelationships: [],
      identityLabels: {},
      issues: [],
    } as any;
    (projector as any).projectTopology = jest.fn().mockResolvedValue({
      projection,
      nodes: [projection.projectedRoot, ...projection.children],
      relationships: [],
      featureContractCitations: new Map(),
      participatingFeatureByWorkflowNode: new Map(),
    });

    const result = await provider.editWorkItem(
      {
        eli5: 'Explains the proposed change.',
        targetEntityId: WORKFLOW_ID,
        operations: [],
      },
      {} as any,
      request(),
    );

    expect(result).toMatchObject({
      status: 'proposed',
      lintFindings: [
        expect.objectContaining({
          rule: 'workflow_step_missing_fulfillment',
          severity: 'warning',
        }),
      ],
    });
    expect(proposalCreate).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['dangling_reference', 'operations[0].ref'],
    ['cross_root_reference', 'operations[0].target'],
    ['duplicate_layout_reference', 'layoutBoundary[1]'],
    ['unresolved_reference', 'operations[0].target'],
    ['incomplete_layout_membership', 'layout.existing:root'],
  ])(
    'does not create a proposal for projector identity failure %s',
    async (code, field) => {
      const issue = {
        field,
        code,
        reason: 'The generic change set is not a complete valid projection.',
        layer: 'referential',
      };
      const { provider, proposalCreate } = await createProvider({
        projection: {
          valid: false,
          root: { refType: 'existing', id: WORKFLOW_ID },
          workItems: [],
          relationships: [],
          identityLabels: {},
          issues: [issue],
        },
      });

      const result = await provider.editWorkItem(
        {
          eli5: 'Explains the proposed change.',
          targetEntityId: WORKFLOW_ID,
          operations: [],
        },
        {} as any,
        request(),
      );

      expect(result).toEqual({
        status: 'invalid_change_set',
        workItemType: GRAPH_TYPE,
        issues: [issue],
      });
      expect(proposalCreate).not.toHaveBeenCalled();
    },
  );

  it('preserves layout replacement, clearing, and the complete boundary', async () => {
    const { provider, proposalCreate } = await createProvider();
    const layoutOperations = [
      {
        op: 'layout.replace' as const,
        root: { refType: 'existing' as const, id: WORKFLOW_ID },
        sectionKey: 'graphLayout',
        entries: [
          {
            node: { refType: 'existing' as const, id: STEP_ID },
            position: { x: 120, y: -40 },
          },
        ],
      },
      {
        op: 'layout.clear' as const,
        root: { refType: 'existing' as const, id: WORKFLOW_ID },
        sectionKey: 'graphLayout',
      },
    ];
    const layoutBoundary = [{ refType: 'existing' as const, id: STEP_ID }];

    await provider.editWorkItem(
      {
        eli5: 'Explains the proposed change.',
        targetEntityId: WORKFLOW_ID,
        operations: layoutOperations,
        layoutBoundary,
        authoringRootProof: AUTHORING_ROOT_PROOF,
      },
      {} as any,
      request(),
    );

    expect(proposalCreate.mock.calls[0][3].updates).toEqual({
      root: { refType: 'existing', id: WORKFLOW_ID },
      operations: layoutOperations,
      layoutBoundary,
    });
  });

  it('keeps scalar-only proposal payloads unchanged and skips projection', async () => {
    const { provider, proposalCreate, projector } = await createProvider();

    await provider.editWorkItem(
      {
        eli5: 'Explains the proposed change.',
        targetEntityId: WORKFLOW_ID,
        name: 'Scalar-only rename',
      },
      {} as any,
      request(),
    );

    expect(projector.project).not.toHaveBeenCalled();
    expect(proposalCreate.mock.calls[0][3].updates).toEqual({
      name: 'Scalar-only rename',
    });
  });

  it('rejects a malformed CONDITIONAL operation before projection or persistence', async () => {
    const { provider, proposalCreate, projector } = await createProvider();

    const result = await provider.editWorkItem(
      {
        targetEntityId: WORKFLOW_ID,
        authoringRootProof: AUTHORING_ROOT_PROOF,
        operations: [
          {
            op: 'relationship.create',
            ref: { refType: 'temporary', tempId: 'branch' },
            source: { refType: 'existing', id: STEP_ID },
            target: { refType: 'existing', id: STEP_ID },
            edgeType: 'CONDITIONAL',
            category: 'flow',
            direction: 'forward',
          },
        ],
      } as never,
      {} as any,
      request(),
    );

    expect(result).toEqual(expect.objectContaining({ isError: true }));
    expect(projector.project).not.toHaveBeenCalled();
    expect(proposalCreate).not.toHaveBeenCalled();
  });

  it('rejects LOOP direction before projection or persistence', async () => {
    const { provider, proposalCreate, projector } = await createProvider();

    const result = await provider.editWorkItem(
      {
        targetEntityId: WORKFLOW_ID,
        authoringRootProof: AUTHORING_ROOT_PROOF,
        operations: [
          {
            op: 'relationship.create',
            ref: { refType: 'temporary', tempId: 'retry-loop' },
            source: { refType: 'existing', id: STEP_ID },
            target: { refType: 'existing', id: STEP_ID },
            edgeType: 'LOOP',
            category: 'flow',
            direction: 'forward',
            predicate: 'retryCount < 3',
          },
        ],
      } as never,
      {} as any,
      request(),
    );

    expect(result).toEqual(expect.objectContaining({ isError: true }));
    expect(projector.project).not.toHaveBeenCalled();
    expect(proposalCreate).not.toHaveBeenCalled();
  });

  it('preserves a predicate-bearing LOOP operation through proposal authoring', async () => {
    const { provider, proposalCreate, projector } = await createProvider();
    const loop = {
      op: 'relationship.create' as const,
      ref: { refType: 'temporary' as const, tempId: 'retry-loop' },
      source: { refType: 'existing' as const, id: STEP_ID },
      target: { refType: 'existing' as const, id: STEP_ID },
      edgeType: 'LOOP' as const,
      category: 'flow' as const,
      predicate: 'retryCount < 3',
    };

    const result = await provider.editWorkItem(
      {
        eli5: 'Explains the proposed change.',
        targetEntityId: WORKFLOW_ID,
        authoringRootProof: AUTHORING_ROOT_PROOF,
        operations: [loop],
      },
      {} as any,
      request(),
    );

    expect(result).toEqual(expect.objectContaining({ status: 'proposed' }));
    expect(projector.project).toHaveBeenCalled();
    expect(proposalCreate.mock.calls[0][3].updates.operations).toEqual([loop]);
  });

  it('authors the settled supervision fixture with first refusal and release-only continuation', async () => {
    const { provider, proposalCreate } = await createProvider();
    const step = (tempId: string, name: string) => ({
      op: 'workItem.create' as const,
      ref: { refType: 'temporary' as const, tempId },
      name,
      type: 'workflow_step',
      parent: { refType: 'existing' as const, id: WORKFLOW_ID },
    });
    const link = (
      tempId: string,
      source: string,
      target: string,
      predicate: string,
    ) => ({
      op: 'relationship.create' as const,
      ref: { refType: 'temporary' as const, tempId },
      source: { refType: 'temporary' as const, tempId: source },
      target: { refType: 'temporary' as const, tempId: target },
      edgeType: 'CONDITIONAL' as const,
      category: 'flow' as const,
      direction: 'forward' as const,
      predicate,
    });
    const operations = [
      step('settled-turn', 'Evaluate settled Turn'),
      step('session-monitor', 'Session Monitor first refusal'),
      step('handled', 'Finish HANDLED'),
      step('released', 'Finish RELEASED'),
      step('failed', 'Finish FAILED'),
      step('task-monitor', 'Task Monitor supervision'),
      link('handled-link', 'session-monitor', 'handled', 'HANDLED'),
      link('released-link', 'session-monitor', 'released', 'RELEASED'),
      link('failed-link', 'session-monitor', 'failed', 'FAILED'),
      {
        op: 'relationship.create' as const,
        ref: { refType: 'temporary' as const, tempId: 'release-only-link' },
        source: { refType: 'temporary' as const, tempId: 'released' },
        target: { refType: 'temporary' as const, tempId: 'task-monitor' },
        edgeType: 'STANDARD' as const,
        category: 'flow' as const,
        direction: 'forward' as const,
      },
    ];
    const layoutBoundary = [
      'settled-turn',
      'session-monitor',
      'handled',
      'released',
      'failed',
      'task-monitor',
    ].map((tempId) => ({ refType: 'temporary' as const, tempId }));

    await provider.editWorkItem(
      {
        eli5: 'Explains the proposed change.',
        targetEntityId: WORKFLOW_ID,
        operations,
        layoutBoundary,
        authoringRootProof: AUTHORING_ROOT_PROOF,
      },
      {} as any,
      request(),
    );

    const persisted = proposalCreate.mock.calls[0][3].updates;
    expect(persisted.operations).toEqual(operations);
    expect(persisted.layoutBoundary).toEqual(layoutBoundary);
    const taskMonitorIncoming = persisted.operations.filter(
      (operation: any) => operation.target?.tempId === 'task-monitor',
    );
    expect(taskMonitorIncoming).toHaveLength(1);
    expect(taskMonitorIncoming[0].source.tempId).toBe('released');
  });
});
