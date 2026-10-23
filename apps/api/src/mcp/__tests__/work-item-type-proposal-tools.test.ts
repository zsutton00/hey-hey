import Ajv from 'ajv';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { load } from 'js-yaml';
import {
  resolveSiblingRepository,
  resolveWorktreeContext,
} from '../../utils/worktree-context';
import {
  CREATE_WORK_ITEM_TYPE_AUTHORING_AXES,
  createWorkItemTypeParameters,
  EDIT_WORK_ITEM_TYPE_TOOL_DESCRIPTION,
  editWorkItemTypeOutput,
  editWorkItemTypeParameters,
  WORK_ITEM_TYPE_PARENTAGE_GUIDANCE,
  WorkItemTypeProposalToolsProvider,
} from '../tools/work-item-type-proposal-tools.provider';
import { CREATE_WORK_ITEM_TYPE_TOOL_DESCRIPTION } from '../tools/work-item-type-review-contract';
import { PROPOSAL_TOOL_NAMES } from '../tools/proposal-tool-names';
import type { ProposalService } from '../../services/proposal/proposal.service';
import type { WorkItemTypeRegistryService } from '../../services/tasks/work-item-type-registry.service';
import { WorkItemTypeEffectiveSource } from '../../generated/model/workItemTypeEffectiveSource';
import { WorkItemTypeLifecycleStatus } from '../../generated/model/workItemTypeLifecycleStatus';
import { BadRequestException, ForbiddenException } from '@nestjs/common';

const ORG_ID = '00000000-0000-4000-8000-000000000001';
const PROJECT_ID = '00000000-0000-4000-8000-000000000002';
const PROPOSAL_ID = '00000000-0000-4000-8000-000000000020';
const CONVERSATION_ID = '00000000-0000-4000-8000-000000000030';
const MESSAGE_ID = '00000000-0000-4000-8000-000000000031';
const NIL_UUID = '00000000-0000-0000-0000-000000000000';

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

function makeRequest(headers: Record<string, string> = {}) {
  return {
    headers: {
      authorization: 'Bearer tok',
      'x-project-id': PROJECT_ID,
      'x-conversation-id': CONVERSATION_ID,
      'x-message-id': MESSAGE_ID,
      ...headers,
    },
    cookies: {},
    user: makeUser(),
    ip: '127.0.0.1',
  } as any;
}

function makeProposal(overrides: Record<string, any> = {}) {
  return {
    id: PROPOSAL_ID,
    organizationId: ORG_ID,
    projectId: PROJECT_ID,
    type: 'SINGLE',
    action: 'CREATE',
    status: 'DRAFT',
    targetEntityId: NIL_UUID,
    targetEntityType: 'WORK_ITEM_TYPE',
    updates: {},
    createdAt: '2026-06-13T00:00:00.000Z',
    updatedAt: '2026-06-13T00:00:00.000Z',
    ...overrides,
  };
}

function createProvider(
  opts: {
    proposalCreate?: jest.Mock;
    workItemTypeRegistry?: WorkItemTypeRegistryService;
  } = {},
) {
  const proposalCreate = opts.proposalCreate ?? jest.fn();
  const proposalService = {
    create: proposalCreate,
  } as unknown as ProposalService;
  const provider = new WorkItemTypeProposalToolsProvider(
    proposalService,
    opts.workItemTypeRegistry,
  );
  return { provider, proposalCreate };
}

const MARKETING_DEFINITION = {
  key: 'MARKETING',
  name: 'Marketing',
  role: 'work-item' as const,
  description: 'Campaign and go-to-market work.',
  sections: [
    {
      key: 'audience',
      label: 'Target audience',
      writingStandard: 'Name the segment and why it is reachable.',
    },
  ],
  requiredScalars: ['dueDate' as const],
  forbiddenScalars: ['tag' as const],
  allowedStatuses: [
    'BACKLOG' as const,
    'ACTIVE' as const,
    'COMPLETED' as const,
  ],
  allowedParentTypes: ['FEATURE'],
  edgeTargets: [
    { edgeType: 'RELATED_TO' as const, targetTypeKeys: ['STANDARD'] },
  ],
  capabilities: { showsInExplorerSidebar: true },
};

const SCHEMA_BACKED_DEFINITION = {
  ...MARKETING_DEFINITION,
  key: 'RESEARCH',
  name: 'Research',
  sections: [
    {
      key: 'findings',
      label: 'Findings',
      writingStandard: 'Capture structured research findings.',
      kind: 'json' as const,
      schemaRef: '#/components/schemas/TaskMonitorExecutionDefinition',
    },
  ],
};

const GRAPH_DEFINITION = {
  ...MARKETING_DEFINITION,
  key: 'GRAPH_ROOT',
  name: 'Graph Root',
  capabilities: {
    graph: {
      nodeChildType: 'GRAPH_NODE',
      layout: {
        sectionKey: 'graphLayout',
        schemaRef: '#/components/schemas/WorkItemGraphLayoutValue',
      },
      layoutPreference: {
        sectionKey: 'graphLayoutPreference',
        schemaRef: '#/components/schemas/WorkItemGraphLayoutPreferenceValue',
      },
      readableRelationships: [
        {
          edgeType: 'STANDARD' as const,
          category: 'flow' as const,
          sourceEndpoint: {
            role: 'graphNode' as const,
            entityTypes: ['TASK' as const],
            workItemTypeKeys: ['GRAPH_NODE'],
          },
          targetEndpoint: {
            role: 'graphNode' as const,
            entityTypes: ['TASK' as const],
            workItemTypeKeys: ['GRAPH_NODE'],
          },
          direction: {
            required: true,
            allowedDirections: ['forward' as const],
          },
        },
      ],
      editableRelationships: [],
      searchableMetaLinkTargets: [],
      rendererKey: 'work-item-graph',
      editorKey: 'work-item-graph-editor',
      supportedActions: ['viewGraph' as const],
    },
  },
};

const AXIS_COMPLETE_DEFINITION = {
  ...MARKETING_DEFINITION,
  iconKey: 'task' as const,
  allowedParentEntityTypes: ['PROJECT' as const, 'TASK' as const],
  tracking: {
    allowedSourceEntityTypes: ['TASK' as const],
    allowedSourceTaskTypes: ['STANDARD'],
  },
  agentSettableStatuses: ['BACKLOG' as const, 'ACTIVE' as const],
  anchorableReportTypes: ['IMPLEMENT' as const],
  writingStandards: {
    create: 'Ground the campaign in a measurable outcome.',
    edit: 'Preserve the measurable outcome while updating current intent.',
  },
};

function makeRegistryDefinition(overrides: Record<string, any> = {}) {
  return {
    id: '00000000-0000-4000-8000-000000000040',
    projectId: PROJECT_ID,
    definition: AXIS_COMPLETE_DEFINITION,
    status: WorkItemTypeLifecycleStatus.Active,
    effectiveSource: WorkItemTypeEffectiveSource.ProjectCustom,
    ...overrides,
  };
}

describe.each(['create', 'edit'] as const)(
  'image beta on MCP type %s',
  (action) => {
    it.each([
      ['u1', false],
      ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true],
    ] as const)(
      'checks authenticated user %s (allowed=%s)',
      async (userId, allowed) => {
        const { provider, proposalCreate } = createProvider({
          proposalCreate: jest.fn().mockResolvedValue(makeProposal()),
          workItemTypeRegistry: {
            getDefinition: jest.fn().mockReturnValue(makeRegistryDefinition()),
          } as unknown as WorkItemTypeRegistryService,
        });
        const definition = {
          ...AXIS_COMPLETE_DEFINITION,
          sections: [
            {
              key: 'picture',
              label: 'Picture',
              kind: 'json' as const,
              schemaRef: '#/components/schemas/ImageSectionContent',
            },
          ],
        };
        const request = makeRequest();
        request.user.userId = userId;
        const result =
          action === 'create'
            ? await provider.createWorkItemType(definition, {} as any, request)
            : await provider.editWorkItemType(
                { typeKey: definition.key, definition },
                {} as any,
                request,
              );

        if (allowed) {
          expect((result as any).isError).toBeUndefined();
          expect(proposalCreate).toHaveBeenCalledTimes(1);
        } else {
          expect(result).toMatchObject({
            isError: true,
            content: [
              {
                type: 'text',
                text: 'Image sections are restricted to the beta user.',
              },
            ],
          });
          expect(proposalCreate).not.toHaveBeenCalled();
        }
      },
    );
  },
);

describe('create_work_item_type', () => {
  beforeEach(() => jest.clearAllMocks());

  it('creates an ordinary SINGLE/CREATE proposal with the nil target', async () => {
    const proposalCreate = jest.fn().mockResolvedValue(makeProposal());
    const { provider } = createProvider({ proposalCreate });

    const result = await provider.createWorkItemType(
      MARKETING_DEFINITION,
      {} as any,
      makeRequest(),
    );

    expect((result as any).isError).toBeUndefined();
    expect(proposalCreate).toHaveBeenCalledTimes(1);

    const [orgId, projectId, , dto] = proposalCreate.mock.calls[0];
    expect(orgId).toBe(ORG_ID);
    expect(projectId).toBe(PROJECT_ID);
    expect(dto.type).toBe('SINGLE');
    expect(dto.action).toBe('CREATE');
    expect(dto.targetEntityType).toBe('WORK_ITEM_TYPE');
    expect(dto.targetEntityId).toBe(NIL_UUID);
    // title is the definition's display name, not its key.
    expect(dto.title).toBe('Marketing');
    expect(dto.updates).toEqual({
      ...MARKETING_DEFINITION,
      allowedParentEntityTypes: ['TASK'],
    });
  });

  it('creates a stable-key CREATE restoration proposal targeting the retained archived key', async () => {
    const proposalCreate = jest.fn().mockResolvedValue(
      makeProposal({
        action: 'CREATE',
        targetEntityId: MARKETING_DEFINITION.key,
      }),
    );
    const workItemTypeRegistry = {
      getDefinition: jest.fn().mockReturnValue({ status: 'ARCHIVED' }),
    } as unknown as WorkItemTypeRegistryService;
    const { provider } = createProvider({
      proposalCreate,
      workItemTypeRegistry,
    });

    const result = await provider.createWorkItemType(
      MARKETING_DEFINITION,
      {} as any,
      makeRequest(),
    );

    expect(result).toEqual({
      proposalId: PROPOSAL_ID,
      action: 'CREATE',
      targetEntityType: 'WORK_ITEM_TYPE',
      targetEntityId: MARKETING_DEFINITION.key,
      createdAt: '2026-06-13T00:00:00.000Z',
    });

    const dto = proposalCreate.mock.calls[0][3];
    expect(dto.action).toBe('CREATE');
    expect(dto.targetEntityId).toBe(MARKETING_DEFINITION.key);
    expect(dto.updates).toEqual(MARKETING_DEFINITION);
  });

  it('surfaces the persisted proposal id and metadata', async () => {
    const proposalCreate = jest.fn().mockResolvedValue(makeProposal());
    const { provider } = createProvider({ proposalCreate });

    const result = await provider.createWorkItemType(
      MARKETING_DEFINITION,
      {} as any,
      makeRequest(),
    );

    expect(result).toEqual({
      proposalId: PROPOSAL_ID,
      action: 'CREATE',
      targetEntityType: 'WORK_ITEM_TYPE',
      targetEntityId: NIL_UUID,
      createdAt: '2026-06-13T00:00:00.000Z',
    });
  });

  it('preserves the complete canonical admission issue collection', async () => {
    const issues = [
      {
        field: 'proposals[0].updates.allowedParentTypes',
        code: 'unrecognized_type',
        reason: 'A referenced parent type is unavailable.',
        layer: 'referential',
        suggestion: 'Use an active work-item type.',
        metadata: { typeKey: 'MISSING' },
      },
      {
        field: 'proposals[0].updates.edgeTargets',
        code: 'unrecognized_type',
        reason: 'A referenced edge target type is unavailable.',
        layer: 'referential',
      },
    ];
    const { provider } = createProvider({
      proposalCreate: jest.fn().mockRejectedValue(
        new BadRequestException({
          message: 'Proposal authoring validation failed',
          errors: issues,
        }),
      ),
    });

    const result = await provider.createWorkItemType(
      MARKETING_DEFINITION,
      {} as any,
      makeRequest(),
    );

    expect(result).toEqual({ status: 'invalid_change_set', issues });
  });

  it('errors without creating a proposal when project context is missing', async () => {
    const proposalCreate = jest.fn();
    const { provider } = createProvider({ proposalCreate });

    const request = makeRequest();
    delete request.headers['x-project-id'];

    const result = await provider.createWorkItemType(
      MARKETING_DEFINITION,
      {} as any,
      request,
    );

    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toContain(
      'Missing project context',
    );
    expect(proposalCreate).not.toHaveBeenCalled();
  });

  it('threads conversation context without caller-authored Message ownership', async () => {
    const proposalCreate = jest.fn().mockResolvedValue(makeProposal());
    const { provider } = createProvider({ proposalCreate });

    await provider.createWorkItemType(
      MARKETING_DEFINITION,
      {} as any,
      makeRequest({
        'x-conversation-id': 'conv-1',
        'x-message-id': 'msg-1',
      }),
    );

    const dto = proposalCreate.mock.calls[0][3];
    expect(dto.conversationId).toBe('conv-1');
    expect(dto).not.toHaveProperty('messageId');
  });

  it('returns the role denial as a tool error when the caller may not manage work-item types', async () => {
    const proposalCreate = jest
      .fn()
      .mockRejectedValue(new ForbiddenException('Insufficient permissions'));
    const { provider } = createProvider({ proposalCreate });

    const result = await provider.createWorkItemType(
      MARKETING_DEFINITION,
      {} as any,
      makeRequest(),
    );

    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toBe('Insufficient permissions');
  });

  it('creates without requiring conversation review history', async () => {
    const proposalCreate = jest.fn().mockResolvedValue(makeProposal());
    const { provider } = createProvider({ proposalCreate });
    const request = makeRequest();
    delete request.headers['x-conversation-id'];
    delete request.headers['x-message-id'];

    const result = await provider.createWorkItemType(
      MARKETING_DEFINITION,
      {} as any,
      request,
    );

    expect((result as any).isError).toBeUndefined();
    expect(proposalCreate).toHaveBeenCalledTimes(1);
  });

  it('accepts the full WorkItemTypeDefinitionDto axes through the parameter schema', () => {
    const parsed = createWorkItemTypeParameters.parse(AXIS_COMPLETE_DEFINITION);
    expect(parsed).toEqual(AXIS_COMPLETE_DEFINITION);
    expect(CREATE_WORK_ITEM_TYPE_AUTHORING_AXES).toEqual(
      Object.keys(createWorkItemTypeParameters.shape),
    );
  });

  it.each([
    'star',
    'flag',
    'folder',
    'book',
    'lightbulb',
    'science',
    'code',
    'database',
    'link',
    'people',
    'chat',
    'calendar',
    'timer',
    'chart',
    'shield',
  ])('accepts the added %s icon with an independent color', (iconKey) => {
    const definition = {
      ...MARKETING_DEFINITION,
      iconKey,
      colorKey: 'secondary',
    };
    expect(createWorkItemTypeParameters.parse(definition)).toEqual(definition);
    expect(
      editWorkItemTypeParameters.parse({ typeKey: definition.key, definition })
        .definition,
    ).toEqual(definition);
  });

  it('rejects arbitrary CSS and color tokens outside the contract', () => {
    expect(() =>
      createWorkItemTypeParameters.parse({
        ...MARKETING_DEFINITION,
        colorKey: '#fff',
      }),
    ).toThrow();
  });

  it('rejects missing and unknown classification roles', () => {
    const { role: _role, ...withoutRole } = MARKETING_DEFINITION;

    expect(() => createWorkItemTypeParameters.parse(withoutRole)).toThrow();
    expect(() =>
      createWorkItemTypeParameters.parse({
        ...MARKETING_DEFINITION,
        role: 'task',
      }),
    ).toThrow();
  });

  it('rejects the removed allowedChildTypes axis instead of stripping it', () => {
    expect(() =>
      createWorkItemTypeParameters.parse({
        ...MARKETING_DEFINITION,
        allowedChildTypes: ['STANDARD'],
      }),
    ).toThrow();
  });

  it.each([true, false])(
    'preserves showsInExplorerSidebar=%s through the parameter schema',
    (showsInExplorerSidebar) => {
      const parsed = createWorkItemTypeParameters.parse({
        ...MARKETING_DEFINITION,
        capabilities: { showsInExplorerSidebar },
      });

      expect(parsed.capabilities?.showsInExplorerSidebar).toBe(
        showsInExplorerSidebar,
      );
    },
  );

  it('preserves omission of showsInExplorerSidebar as no Explorer opt-in', () => {
    const parsed = createWorkItemTypeParameters.parse({
      ...MARKETING_DEFINITION,
      capabilities: { requiresParent: true },
    });

    expect(parsed.capabilities).toEqual({ requiresParent: true });
    expect(parsed.capabilities?.showsInExplorerSidebar).toBeUndefined();
  });

  it.each(['canBeTrackedByGoals', 'trackableByGoals', 'isHierarchyNode'])(
    'rejects unsupported capability key %s',
    (capabilityKey) => {
      expect(() =>
        createWorkItemTypeParameters.parse({
          ...MARKETING_DEFINITION,
          capabilities: { [capabilityKey]: true },
        }),
      ).toThrow(/Unrecognized key/);
    },
  );

  it('preserves schema-backed section metadata through the parameter schema', () => {
    const parsed = createWorkItemTypeParameters.parse(SCHEMA_BACKED_DEFINITION);

    expect(parsed.sections[0]).toMatchObject({
      key: 'findings',
      kind: 'json',
      schemaRef: '#/components/schemas/TaskMonitorExecutionDefinition',
    });
  });

  it('preserves HTML/CSS section declarations and rejects schemaRef', () => {
    const definition = {
      ...MARKETING_DEFINITION,
      sections: [
        { key: 'preview', label: 'Preview', kind: 'html/css' as const },
      ],
    };

    expect(createWorkItemTypeParameters.parse(definition).sections[0]).toEqual({
      key: 'preview',
      label: 'Preview',
      kind: 'html/css',
    });
    expect(() =>
      createWorkItemTypeParameters.parse({
        ...definition,
        sections: [
          {
            ...definition.sections[0],
            schemaRef: '#/components/schemas/WorkItemHtmlCssSectionContent',
          },
        ],
      }),
    ).toThrow(/schemaRef must be omitted/);
  });

  it('preserves structured mockup declarations, sizing, and rejects schemaRef', () => {
    const section = {
      key: 'mockup',
      label: 'Mockup',
      kind: 'structured-mockup' as const,
      defaultSizeKey: 'panel',
      sizeProfiles: [
        {
          key: 'panel',
          label: 'Panel',
          breakpoints: [
            {
              minContainerWidth: 0,
              inline: { width: 320, height: 240 },
              page: { width: 1024, height: 768 },
            },
          ],
        },
      ],
    };
    const definition = { ...MARKETING_DEFINITION, sections: [section] };

    expect(createWorkItemTypeParameters.parse(definition).sections[0]).toEqual(
      section,
    );
    expect(() =>
      createWorkItemTypeParameters.parse({
        ...definition,
        sections: [{ ...section, schemaRef: '#/components/schemas/Anything' }],
      }),
    ).toThrow(/schemaRef must be omitted/);
  });

  it('preserves graph capability declarations through the parameter schema', () => {
    const parsed = createWorkItemTypeParameters.parse(GRAPH_DEFINITION);

    expect(parsed.capabilities?.graph).toEqual(
      GRAPH_DEFINITION.capabilities.graph,
    );
  });

  it('exposes the canonical tool name in PROPOSAL_TOOL_NAMES', () => {
    expect(PROPOSAL_TOOL_NAMES.CREATE_WORK_ITEM_TYPE).toBe(
      'create_work_item_type',
    );
  });

  it('routes the compact description to the canonical review guidance', () => {
    expect(CREATE_WORK_ITEM_TYPE_TOOL_DESCRIPTION).toBe(
      'Propose a new custom work-item type for user review. Before authoring the ' +
        'definition, call get_tool_guidance({ toolName: "create_work_item_type" }) ' +
        'for the canonical review questionnaire and complete configuration contract. ' +
        'Creation requires one completed review of every question.',
    );
  });
});

describe('edit_work_item_type', () => {
  beforeEach(() => jest.clearAllMocks());

  it('is exposed under the canonical catalog name with a strict complete-definition schema', () => {
    expect(PROPOSAL_TOOL_NAMES.EDIT_WORK_ITEM_TYPE).toBe('edit_work_item_type');
    expect(
      typeof WorkItemTypeProposalToolsProvider.prototype.editWorkItemType,
    ).toBe('function');

    const definition = {
      ...AXIS_COMPLETE_DEFINITION,
      allowedParentTypes: ['FEATURE', 'PLAN'],
      allowedParentEntityTypes: ['PROJECT' as const, 'TASK' as const],
    };
    expect(
      editWorkItemTypeParameters.parse({
        typeKey: AXIS_COMPLETE_DEFINITION.key,
        definition,
        acknowledgeCanonicalCustomization: true,
      }),
    ).toEqual({
      typeKey: AXIS_COMPLETE_DEFINITION.key,
      definition,
      acknowledgeCanonicalCustomization: true,
    });
    expect(() =>
      editWorkItemTypeParameters.parse({
        typeKey: AXIS_COMPLETE_DEFINITION.key,
        definition,
        unsupported: true,
      }),
    ).toThrow(/Unrecognized key/);
  });

  it('describes its UPDATE response and stable type-key target accurately', () => {
    expect(editWorkItemTypeOutput.shape.action.description).toContain('UPDATE');
    expect(editWorkItemTypeOutput.shape.targetEntityId.description).toContain(
      'work-item type key',
    );
  });

  it('requires an authoritative read and preservation of unchanged axes', () => {
    expect(EDIT_WORK_ITEM_TYPE_TOOL_DESCRIPTION).toContain(
      'calling get_work_item_type',
    );
    expect(EDIT_WORK_ITEM_TYPE_TOOL_DESCRIPTION).toContain(
      'complete definition',
    );
    expect(EDIT_WORK_ITEM_TYPE_TOOL_DESCRIPTION).toContain(
      'preserve every unchanged definition axis',
    );
    expect(EDIT_WORK_ITEM_TYPE_TOOL_DESCRIPTION).toContain(
      'CANONICAL, CANONICAL_OVERRIDE, or PROJECT_CUSTOM',
    );
    expect(EDIT_WORK_ITEM_TYPE_TOOL_DESCRIPTION).toContain(
      'complete project override over the immutable global canonical definition',
    );
    expect(EDIT_WORK_ITEM_TYPE_TOOL_DESCRIPTION).toContain(
      WORK_ITEM_TYPE_PARENTAGE_GUIDANCE,
    );
  });

  it('adds TASK to an edited definition when the entity-parent axis is omitted', async () => {
    const proposalCreate = jest.fn().mockResolvedValue(
      makeProposal({
        action: 'UPDATE',
        targetEntityId: AXIS_COMPLETE_DEFINITION.key,
      }),
    );
    const workItemTypeRegistry = {
      getDefinition: jest.fn().mockReturnValue(makeRegistryDefinition()),
    } as unknown as WorkItemTypeRegistryService;
    const { provider } = createProvider({
      proposalCreate,
      workItemTypeRegistry,
    });
    const definition = {
      ...AXIS_COMPLETE_DEFINITION,
    };
    delete (definition as Partial<typeof definition>).allowedParentEntityTypes;

    await provider.editWorkItemType(
      { typeKey: AXIS_COMPLETE_DEFINITION.key, definition },
      {} as any,
      makeRequest(),
    );

    expect(proposalCreate.mock.calls[0][3].updates.definition).toEqual({
      ...definition,
      allowedParentEntityTypes: ['TASK'],
    });
  });

  it('preserves the complete canonical admission issue collection', async () => {
    const issues = [
      {
        field: 'proposals[0].updates.definition.allowedParentTypes',
        code: 'unrecognized_type',
        reason: 'A referenced parent type is unavailable.',
        layer: 'referential',
        suggestion: 'Use an active work-item type.',
        metadata: { typeKey: 'MISSING' },
      },
      {
        field: 'proposals[0].updates.definition.edgeTargets',
        code: 'unrecognized_type',
        reason: 'A referenced edge target type is unavailable.',
        layer: 'referential',
      },
    ];
    const workItemTypeRegistry = {
      getDefinition: jest.fn().mockReturnValue(makeRegistryDefinition()),
    } as unknown as WorkItemTypeRegistryService;
    const { provider } = createProvider({
      proposalCreate: jest.fn().mockRejectedValue(
        new BadRequestException({
          message: 'Proposal authoring validation failed',
          errors: issues,
        }),
      ),
      workItemTypeRegistry,
    });

    const result = await provider.editWorkItemType(
      {
        typeKey: AXIS_COMPLETE_DEFINITION.key,
        definition: AXIS_COMPLETE_DEFINITION,
      },
      {} as any,
      makeRequest(),
    );

    expect(result).toEqual({ status: 'invalid_change_set', issues });
  });

  it.each([
    WorkItemTypeEffectiveSource.ProjectCustom,
    WorkItemTypeEffectiveSource.CanonicalOverride,
  ])(
    'creates one SINGLE/UPDATE proposal with complete parentage and provenance for %s',
    async (effectiveSource) => {
      const proposalCreate = jest.fn().mockResolvedValue(
        makeProposal({
          action: 'UPDATE',
          targetEntityId: AXIS_COMPLETE_DEFINITION.key,
        }),
      );
      const existing = makeRegistryDefinition({ effectiveSource });
      const workItemTypeRegistry = {
        getDefinition: jest.fn().mockReturnValue(existing),
      } as unknown as WorkItemTypeRegistryService;
      const { provider } = createProvider({
        proposalCreate,
        workItemTypeRegistry,
      });
      const definition = {
        ...AXIS_COMPLETE_DEFINITION,
        allowedParentTypes: ['FEATURE', 'PLAN'],
        allowedParentEntityTypes: ['PROJECT' as const, 'TASK' as const],
      };

      const result = await provider.editWorkItemType(
        { typeKey: AXIS_COMPLETE_DEFINITION.key, definition },
        {} as any,
        makeRequest(),
      );

      expect(result).toEqual({
        proposalId: PROPOSAL_ID,
        action: 'UPDATE',
        targetEntityType: 'WORK_ITEM_TYPE',
        targetEntityId: AXIS_COMPLETE_DEFINITION.key,
        createdAt: '2026-06-13T00:00:00.000Z',
      });
      expect(workItemTypeRegistry.getDefinition).toHaveBeenCalledWith(
        PROJECT_ID,
        AXIS_COMPLETE_DEFINITION.key,
      );
      expect(existing).toEqual(makeRegistryDefinition({ effectiveSource }));
      expect(proposalCreate).toHaveBeenCalledTimes(1);
      expect(proposalCreate).toHaveBeenCalledWith(ORG_ID, PROJECT_ID, 'u1', {
        type: 'SINGLE',
        action: 'UPDATE',
        eli5: 'Changes the rules for this work item type.',
        targetEntityId: AXIS_COMPLETE_DEFINITION.key,
        targetEntityType: 'WORK_ITEM_TYPE',
        updates: { definition },
        requestorContext: {
          userId: 'u1',
          organizationId: ORG_ID,
          toolName: 'edit_work_item_type',
          timestamp: expect.any(String),
          source: 'agent',
          conversationId: CONVERSATION_ID,
          ipAddress: '127.0.0.1',
        },
        influences: [],
        conversationId: CONVERSATION_ID,
      });
    },
  );

  it('creates a complete override proposal for an acknowledged canonical definition', async () => {
    const proposalCreate = jest.fn().mockResolvedValue(
      makeProposal({
        action: 'UPDATE',
        targetEntityId: AXIS_COMPLETE_DEFINITION.key,
      }),
    );
    const workItemTypeRegistry = {
      getDefinition: jest.fn().mockReturnValue(
        makeRegistryDefinition({
          effectiveSource: WorkItemTypeEffectiveSource.Canonical,
        }),
      ),
    } as unknown as WorkItemTypeRegistryService;
    const { provider } = createProvider({
      proposalCreate,
      workItemTypeRegistry,
    });

    const result = await provider.editWorkItemType(
      {
        typeKey: AXIS_COMPLETE_DEFINITION.key,
        definition: AXIS_COMPLETE_DEFINITION,
        acknowledgeCanonicalCustomization: true,
      },
      {} as any,
      makeRequest(),
    );

    expect((result as any).isError).toBeUndefined();
    expect(proposalCreate.mock.calls[0][3].updates).toEqual({
      definition: AXIS_COMPLETE_DEFINITION,
      acknowledgeCanonicalCustomization: true,
    });
  });

  it('returns the role denial as a tool error when the caller may not manage work-item types', async () => {
    const proposalCreate = jest
      .fn()
      .mockRejectedValue(new ForbiddenException('Insufficient permissions'));
    const workItemTypeRegistry = {
      getDefinition: jest.fn().mockReturnValue(
        makeRegistryDefinition({
          effectiveSource: WorkItemTypeEffectiveSource.Canonical,
        }),
      ),
    } as unknown as WorkItemTypeRegistryService;
    const { provider } = createProvider({
      proposalCreate,
      workItemTypeRegistry,
    });

    const result = await provider.editWorkItemType(
      {
        typeKey: AXIS_COMPLETE_DEFINITION.key,
        definition: AXIS_COMPLETE_DEFINITION,
        acknowledgeCanonicalCustomization: true,
      },
      {} as any,
      makeRequest(),
    );

    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toBe('Insufficient permissions');
  });

  it('rejects a canonical definition without explicit acknowledgement', async () => {
    const proposalCreate = jest.fn();
    const workItemTypeRegistry = {
      getDefinition: jest.fn().mockReturnValue(
        makeRegistryDefinition({
          effectiveSource: WorkItemTypeEffectiveSource.Canonical,
        }),
      ),
    } as unknown as WorkItemTypeRegistryService;
    const { provider } = createProvider({
      proposalCreate,
      workItemTypeRegistry,
    });

    const result = await provider.editWorkItemType(
      {
        typeKey: AXIS_COMPLETE_DEFINITION.key,
        definition: AXIS_COMPLETE_DEFINITION,
      },
      {} as any,
      makeRequest(),
    );

    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toContain(
      'Canonical customization acknowledgement is required',
    );
    expect(proposalCreate).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: 'missing',
      existing: undefined,
      message: 'is not available in this project',
    },
    {
      name: 'different project',
      existing: makeRegistryDefinition({
        projectId: '00000000-0000-4000-8000-000000000099',
      }),
      message: 'is not available in this project',
    },
    {
      name: 'archived',
      existing: makeRegistryDefinition({
        status: WorkItemTypeLifecycleStatus.Archived,
      }),
      message: 'is not active in this project',
    },
  ])(
    'rejects a $name target before proposal creation',
    async ({ existing, message }) => {
      const proposalCreate = jest.fn();
      const workItemTypeRegistry = {
        getDefinition: jest.fn().mockReturnValue(existing),
      } as unknown as WorkItemTypeRegistryService;
      const { provider } = createProvider({
        proposalCreate,
        workItemTypeRegistry,
      });

      const result = await provider.editWorkItemType(
        {
          typeKey: AXIS_COMPLETE_DEFINITION.key,
          definition: AXIS_COMPLETE_DEFINITION,
        },
        {} as any,
        makeRequest(),
      );

      expect((result as any).isError).toBe(true);
      expect((result as any).content[0].text).toContain(message);
      expect(proposalCreate).not.toHaveBeenCalled();
    },
  );

  it('errors without resolving or creating when project context is missing', async () => {
    const proposalCreate = jest.fn();
    const getDefinition = jest.fn();
    const { provider } = createProvider({
      proposalCreate,
      workItemTypeRegistry: {
        getDefinition,
      } as unknown as WorkItemTypeRegistryService,
    });
    const request = makeRequest();
    delete request.headers['x-project-id'];

    const result = await provider.editWorkItemType(
      {
        typeKey: AXIS_COMPLETE_DEFINITION.key,
        definition: AXIS_COMPLETE_DEFINITION,
      },
      {} as any,
      request,
    );

    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toContain(
      'Missing project context',
    );
    expect(getDefinition).not.toHaveBeenCalled();
    expect(proposalCreate).not.toHaveBeenCalled();
  });
});

describe('semantic guidance definition schema', () => {
  const openapiRoot = resolveSiblingRepository(
    resolveWorktreeContext(),
    'openapi',
    process.env.HEY_HEY_OPENAPI_ROOT,
  );
  const schemas = load(
    readFileSync(
      join(openapiRoot, 'specs/schemas/work-item-type-definition.yaml'),
      'utf8',
    ),
  ) as Record<string, object>;
  const validateGuidance = new Ajv({ strict: false }).compile({
    ...schemas,
    $ref: '#/WorkItemTypeAgentGuidance',
  });

  const agentGuidance = {
    overview: 'Meaning',
    examples: [{ title: 'Example', guidance: 'Use it here' }],
    contexts: [
      {
        focalTypeKeys: ['custom_type'],
        guidance: 'Interpretation',
        examples: [{ title: 'Context example', guidance: 'Why it applies' }],
      },
    ],
  };
  it('preserves the complete semantic axis in create and administrative edit schemas', () => {
    expect(validateGuidance(agentGuidance)).toBe(true);
    const definition = { ...MARKETING_DEFINITION, agentGuidance };
    expect(createWorkItemTypeParameters.parse(definition)).toEqual(definition);
    expect(
      editWorkItemTypeParameters.parse({ typeKey: definition.key, definition })
        .definition,
    ).toEqual(definition);
    expect(
      createWorkItemTypeParameters.parse(MARKETING_DEFINITION),
    ).not.toHaveProperty('agentGuidance');
  });
  it('preserves optional maintenance advice in create and administrative edit schemas', () => {
    const definition = {
      ...MARKETING_DEFINITION,
      maintenanceGuidance:
        'Review approved behavior against the existing artifact.',
    };
    expect(createWorkItemTypeParameters.parse(definition)).toEqual(definition);
    expect(
      editWorkItemTypeParameters.parse({ typeKey: definition.key, definition })
        .definition,
    ).toEqual(definition);
    expect(
      createWorkItemTypeParameters.parse(MARKETING_DEFINITION),
    ).not.toHaveProperty('maintenanceGuidance');
  });
  it.each([
    null,
    {},
    { overview: '' },
    { overview: 'Meaning', extra: true },
    { overview: 'Meaning', examples: [{ title: '', guidance: 'Body' }] },
    { overview: 'Meaning', examples: [{ title: 'Title', guidance: '' }] },
    {
      overview: 'Meaning',
      examples: [{ title: 'Title', guidance: 'Body', extra: true }],
    },
    {
      overview: 'Meaning',
      contexts: [{ focalTypeKeys: [], guidance: 'Body' }],
    },
    {
      overview: 'Meaning',
      contexts: [{ focalTypeKeys: [''], guidance: 'Body' }],
    },
    {
      overview: 'Meaning',
      contexts: [{ focalTypeKeys: ['custom'], guidance: '' }],
    },
    {
      overview: 'Meaning',
      contexts: [{ focalTypeKeys: ['custom'], guidance: 'Body', extra: true }],
    },
    {
      overview: 'Meaning',
      contexts: [
        {
          focalTypeKeys: ['custom'],
          guidance: 'Body',
          examples: [{ title: 'T', guidance: '' }],
        },
      ],
    },
  ])('rejects invalid or open guidance %j', (invalid) => {
    expect(validateGuidance(invalid)).toBe(false);
    expect(
      createWorkItemTypeParameters.safeParse({
        ...MARKETING_DEFINITION,
        agentGuidance: invalid,
      }).success,
    ).toBe(false);
  });
});
