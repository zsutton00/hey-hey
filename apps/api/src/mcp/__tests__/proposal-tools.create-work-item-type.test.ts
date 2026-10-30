import {
  createWorkItemParameters,
  ProposalToolsProvider,
} from '../tools/proposal-tools.provider';
import type { ProposalService } from '../../services/proposal/proposal.service';
import type { TaskService } from '../../services/tasks/task.service';
import { WorkItemTypeRegistryService } from '../../services/tasks/work-item-type-registry.service';
import {
  createRegistryWithArchivedSystemType,
  createWarmWorkItemTypeRegistryWithCustomTypes,
} from '../../../test/setup/work-item-type-registry.fixture';
import { TaskSectionKey } from '../../generated/model/taskSectionKey';
import { EntityType } from '../../generated/model/entityType';
import { guidanceTokenForType } from '../tools/work-item-guidance-token';
import { AUTHORING_ROOT_PROOF } from '../tools/authoring-guidance';

const ORG_ID = '00000000-0000-4000-8000-000000000001';
const PROJECT_ID = '00000000-0000-4000-8000-000000000002';
const PARENT_ID = '00000000-0000-4000-8000-000000000030';
const NIL_UUID = '00000000-0000-0000-0000-000000000000';
const EMPTY_GRAPH_LAYOUT =
  '{"schemaVersion":"work-item-graph-layout.v1","nodes":[]}';

// A project-scoped custom type: description + requirements sections, tag
// forbidden, child-optional. Exercises the create path resolving rules from a
// non-system registry entry.
const RESEARCH = 'RESEARCH';
// An archived custom type in the same project — present in the registry but not
// usable, so the create gate must reject it like an unknown key.
const LEGACY = 'LEGACY';
const MODE = 'MODE';
const MODE_FILES = {
  schemaVersion: 'project-mode-files.v1',
  files: {
    'MODE.md': 'Apply this mode to STANDARD work items.',
    'references/checklist.md': '- Verify the requested behavior.',
  },
};

let workItemTypeRegistry: WorkItemTypeRegistryService;
beforeAll(async () => {
  workItemTypeRegistry = await createWarmWorkItemTypeRegistryWithCustomTypes([
    {
      typeKey: RESEARCH,
      projectId: PROJECT_ID,
      sectionKeys: [TaskSectionKey.Description, TaskSectionKey.Requirements],
      allowedParentTypes: ['STANDARD'],
      allowedParentEntityTypes: [EntityType.Task],
    },
    {
      typeKey: LEGACY,
      projectId: PROJECT_ID,
      lifecycleStatus: 'archived',
    },
    {
      typeKey: MODE,
      projectId: PROJECT_ID,
      name: 'Mode',
      sectionDefinitions: [
        { key: 'description', label: 'Catalog description' },
        {
          key: 'files',
          label: 'Files',
          kind: 'json',
          schemaRef: '#/components/schemas/ProjectModeFiles',
        },
      ],
      allowedParentTypes: ['FEATURE'],
      allowedParentEntityTypes: [EntityType.Task],
      capabilities: { requiresParent: true },
      forbiddenScalars: ['dueDate', 'tag'],
    },
  ]);
});

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

function makeRequest() {
  return {
    headers: {
      authorization: 'Bearer tok',
      'x-project-id': PROJECT_ID,
    },
    cookies: {},
    user: makeUser(),
    ip: '127.0.0.1',
  } as any;
}

function makeCreatedProposal(overrides: Record<string, any> = {}) {
  return {
    id: '00000000-0000-4000-8000-000000000020',
    organizationId: ORG_ID,
    projectId: PROJECT_ID,
    type: 'SINGLE',
    action: 'CREATE',
    status: 'DRAFT',
    targetEntityId: NIL_UUID,
    targetEntityType: 'TASK',
    updates: {},
    createdAt: '2026-06-14T00:00:00.000Z',
    updatedAt: '2026-06-14T00:00:00.000Z',
    ...overrides,
  };
}

function createProvider(
  opts: {
    proposalCreate?: jest.Mock;
    registry?: WorkItemTypeRegistryService;
  } = {},
) {
  const proposalCreate =
    opts.proposalCreate ?? jest.fn().mockResolvedValue(makeCreatedProposal());
  const proposalService = {
    create: proposalCreate,
    findOne: jest.fn(),
  } as unknown as ProposalService;
  const taskService = {
    findOne: jest.fn(),
  } as unknown as TaskService;
  const lintRecovery = {
    markNeedsRevision: jest.fn().mockResolvedValue(undefined),
    consumeRecovery: jest.fn().mockResolvedValue(false),
  } as any;
  const prisma = {
    db: {
      task: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest
          .fn()
          .mockImplementation(({ where }: any) =>
            where?.id === PARENT_ID
              ? Promise.resolve({ id: PARENT_ID, type: 'FEATURE' })
              : Promise.resolve(null),
          ),
      },
      designDoc: { findMany: jest.fn().mockResolvedValue([]) },
    },
  } as any;
  const provider = new ProposalToolsProvider(
    proposalService,
    taskService,
    lintRecovery,
    opts.registry ?? workItemTypeRegistry,
    prisma,
  );
  return { provider, proposalCreate };
}

describe('ProposalToolsProvider.createWorkItem custom type', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('accepts a registry-recognized custom type and derives sections from its entry', async () => {
    const { provider, proposalCreate } = createProvider();

    const result = await provider.createWorkItem(
      {
        type: RESEARCH,
        name: 'Spike on caching',
        parentTaskId: PARENT_ID,
        authoringRootProof: AUTHORING_ROOT_PROOF,
        sections: [
          { key: 'description', content: 'Caching spike.' },
          { key: 'requirements', content: 'Investigate options.' },
        ],
        guidanceToken: guidanceTokenForType(RESEARCH, PROJECT_ID),
      } as any,
      {} as any,
      makeRequest(),
    );

    expect((result as any).isError).toBeUndefined();
    expect((result as any).status).toBe('proposed');
    expect(proposalCreate).toHaveBeenCalledTimes(1);
    const dto = proposalCreate.mock.calls[0][3];
    expect(dto.updates.type).toBe(RESEARCH);
    expect(dto.updates.sections).toEqual([
      { key: 'description', content: 'Caching spike.' },
      { key: 'requirements', content: 'Investigate options.' },
    ]);
  });

  it('carries a complete MODE description, and files bundle into the review proposal', async () => {
    const { provider, proposalCreate } = createProvider();
    const description =
      'A compact review mode for STANDARD work items. The mode applies the captured checklist.';

    const result = await provider.createWorkItem(
      {
        type: MODE,
        name: 'Review Mode',
        parentTaskId: PARENT_ID,
        authoringRootProof: AUTHORING_ROOT_PROOF,
        sections: [
          { key: 'description', content: description },
          { key: 'files', content: MODE_FILES },
        ],
        guidanceToken: guidanceTokenForType(MODE, PROJECT_ID),
      } as any,
      {} as any,
      makeRequest(),
    );

    expect((result as any).status).toBe('proposed');
    const dto = proposalCreate.mock.calls[0][3];
    expect(dto.updates).toEqual({
      name: 'Review Mode',
      parentTaskId: PARENT_ID,
      sections: [
        { key: 'description', content: description },
        { key: 'files', content: MODE_FILES },
      ],
      type: MODE,
    });
  });

  it('rejects launch config for a type with no accepted config kinds', async () => {
    const { provider, proposalCreate } = createProvider();

    const result = await provider.createWorkItem(
      {
        type: RESEARCH,
        name: 'Ineligible launch default',
        config: {
          kind: 'INITIAL_WORKTREE',
          version: 'v1',
          initialWorktreeBranch: 'feature/not-accepted',
        },
      } as any,
      {} as any,
      makeRequest(),
    );

    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toContain(
      "does not accept config kind 'INITIAL_WORKTREE'",
    );
    expect(proposalCreate).not.toHaveBeenCalled();
  });

  it('rejects a section key the custom type does not carry', async () => {
    const { provider, proposalCreate } = createProvider();

    const result = await provider.createWorkItem(
      {
        type: RESEARCH,
        name: 'Spike on caching',
        parentTaskId: PARENT_ID,
        authoringRootProof: AUTHORING_ROOT_PROOF,
        sections: [{ key: 'acceptanceCriteria', content: 'AC text' }],
        guidanceToken: guidanceTokenForType(RESEARCH, PROJECT_ID),
      } as any,
      {} as any,
      makeRequest(),
    );

    expect((result as any).isError).toBe(true);
    const text = (result as any).content[0].text as string;
    expect(text).toContain(
      `Section "acceptanceCriteria" is not valid for ${RESEARCH} work items`,
    );
    expect(proposalCreate).not.toHaveBeenCalled();
  });

  it('rejects an unknown type key with the valid-types error', async () => {
    const { provider, proposalCreate } = createProvider();

    const result = await provider.createWorkItem(
      { type: 'NONEXISTENT', name: 'Whatever' } as any,
      {} as any,
      makeRequest(),
    );

    expect((result as any).isError).toBe(true);
    const text = (result as any).content[0].text as string;
    expect(text).toContain(
      "'NONEXISTENT' is not a usable type for this project",
    );
    expect(text).toContain('Valid types:');
    // The active built-ins and the active custom type are named; the archived
    // one is not.
    expect(text).toContain(RESEARCH);
    expect(text).not.toContain(LEGACY);
    expect(proposalCreate).not.toHaveBeenCalled();
  });

  it('rejects an archived custom type with the valid-types error', async () => {
    const { provider, proposalCreate } = createProvider();

    const result = await provider.createWorkItem(
      {
        type: LEGACY,
        name: 'Whatever',
        parentTaskId: PARENT_ID,
        authoringRootProof: AUTHORING_ROOT_PROOF,
      } as any,
      {} as any,
      makeRequest(),
    );

    expect((result as any).isError).toBe(true);
    const text = (result as any).content[0].text as string;
    expect(text).toContain(`'${LEGACY}' is not a usable type for this project`);
    expect(proposalCreate).not.toHaveBeenCalled();
  });

  it('rejects retired workflow before creating a proposal', async () => {
    const registry = await createRegistryWithArchivedSystemType('workflow');
    const { provider, proposalCreate } = createProvider({ registry });

    const result = await provider.createWorkItem(
      { type: 'workflow', name: 'Legacy diagram' } as any,
      {} as any,
      makeRequest(),
    );

    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toContain(
      "type: 'workflow' is not a usable type for this project",
    );
    expect(proposalCreate).not.toHaveBeenCalled();
  });

  it('routes generic PLAN creation to create_plan before proposal persistence', async () => {
    const { provider, proposalCreate } = createProvider();

    const result = await provider.createWorkItem(
      {
        type: 'PLAN',
        name: 'Direct Plan creation',
        parentTaskId: PARENT_ID,
        sections: [
          { key: 'outcome', content: 'Deliver the reviewed capability.' },
          { key: 'description', content: 'The generic payload looks valid.' },
          { key: 'planConfiguration', content: '{}' },
        ],
        authoringRootProof: AUTHORING_ROOT_PROOF,
        guidanceToken: guidanceTokenForType('PLAN', PROJECT_ID),
      } as any,
      {} as any,
      makeRequest(),
    );

    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toContain(
      'PLAN work items must be created through create_plan. Use create_plan for Plan intake; do not use create_work_item for Plan creation.',
    );
    expect(proposalCreate).not.toHaveBeenCalled();
  });
});

// The built-ins must behave exactly as before now that the type param is a
// registry-backed string gated at the handler boundary rather than a closed
// enum at the schema.
describe('ProposalToolsProvider.createWorkItem built-in parity', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates a STANDARD with a parent', async () => {
    const { provider, proposalCreate } = createProvider();

    const result = await provider.createWorkItem(
      {
        type: 'STANDARD',
        name: 'Do the thing',
        parentTaskId: PARENT_ID,
        authoringRootProof: AUTHORING_ROOT_PROOF,
        sections: [
          { key: 'description', content: 'Do it.' },
          { key: 'acceptanceCriteria', content: 'AC.' },
        ],
        guidanceToken: guidanceTokenForType('STANDARD', PROJECT_ID),
      } as any,
      {} as any,
      makeRequest(),
    );

    expect((result as any).status).toBe('proposed');
    expect(proposalCreate.mock.calls[0][3].updates.type).toBe('STANDARD');
  });

  it('carries an accepted launch config into the generic create proposal', async () => {
    const { provider, proposalCreate } = createProvider();

    const result = await provider.createWorkItem(
      {
        type: 'STANDARD',
        name: 'Configured standard task',
        parentTaskId: PARENT_ID,
        config: {
          kind: 'INITIAL_WORKTREE',
          version: 'v1',
          initialWorktreeBranch: 'feature/launch-default',
        },
        authoringRootProof: AUTHORING_ROOT_PROOF,
        sections: [
          { key: 'description', content: 'Configured task.' },
          { key: 'acceptanceCriteria', content: 'The default is retained.' },
        ],
        guidanceToken: guidanceTokenForType('STANDARD', PROJECT_ID),
      } as any,
      {} as any,
      makeRequest(),
    );

    expect((result as any).status).toBe('proposed');
    expect(proposalCreate.mock.calls[0][3].updates.config).toEqual({
      kind: 'INITIAL_WORKTREE',
      version: 'v1',
      initialWorktreeBranch: 'feature/launch-default',
    });
  });

  it('accepts the registry-declared graphLayout JSON section on workflow create', async () => {
    const { provider, proposalCreate } = createProvider();
    const params = createWorkItemParameters.parse({
      eli5: 'Creates the smoke-test workflow.',
      type: 'workflow',
      name: 'User View Web Page Smoke Test',
      parentTaskId: PARENT_ID,
      authoringRootProof: AUTHORING_ROOT_PROOF,
      sections: [
        { key: 'description', order: 0, content: 'Smoke test workflow.' },
        { key: 'graphLayout', order: 1, content: EMPTY_GRAPH_LAYOUT },
      ],
      guidanceToken: guidanceTokenForType('workflow', PROJECT_ID),
    });

    const result = await provider.createWorkItem(
      params,
      {} as any,
      makeRequest(),
    );

    expect((result as any).status).toBe('proposed');
    expect(proposalCreate.mock.calls[0][3].updates.sections).toEqual([
      { key: 'description', order: 0, content: 'Smoke test workflow.' },
      { key: 'graphLayout', order: 1, content: EMPTY_GRAPH_LAYOUT },
    ]);
  });

  it('does not expose legacy workflow child or link aliases', () => {
    for (const field of [
      'workflowSteps',
      'steps',
      'children',
      'workflowLinks',
      'flowLinks',
      'flowEdges',
    ]) {
      expect(createWorkItemParameters.shape).not.toHaveProperty(field);
    }
  });

  it('surfaces proposal-boundary validation failures', async () => {
    const { provider, proposalCreate } = createProvider({
      proposalCreate: jest
        .fn()
        .mockRejectedValue(new Error("Unknown workflow step tempId 'missing'")),
    });

    const result = await provider.createWorkItem(
      {
        eli5: 'Creates a workflow proposal.',
        type: 'workflow',
        name: 'Broken workflow',
        authoringRootProof: AUTHORING_ROOT_PROOF,
        sections: [
          { key: 'description', content: 'Broken graph.' },
          { key: 'graphLayout', content: EMPTY_GRAPH_LAYOUT },
        ],
        guidanceToken: guidanceTokenForType('workflow', PROJECT_ID),
      } as any,
      {} as any,
      makeRequest(),
    );

    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toContain(
      "Unknown workflow step tempId 'missing'",
    );
    expect(proposalCreate).toHaveBeenCalledTimes(1);
  });

  it('rejects a STANDARD without a parent', async () => {
    const { provider, proposalCreate } = createProvider();

    const result = await provider.createWorkItem(
      { type: 'STANDARD', name: 'Do the thing' } as any,
      {} as any,
      makeRequest(),
    );

    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toContain(
      'parentTaskId is required to create a STANDARD work item',
    );
    expect(proposalCreate).not.toHaveBeenCalled();
  });

  it('creates a FEATURE with the required tag', async () => {
    const { provider, proposalCreate } = createProvider();

    const result = await provider.createWorkItem(
      {
        type: 'FEATURE',
        name: 'Plans',
        tag: 'product',
        sections: [{ key: 'description', content: 'Plans feature.' }],
        initialRequirements: [{ statement: 'Users can create plans.' }],
        guidanceToken: guidanceTokenForType('FEATURE', PROJECT_ID),
      } as any,
      {} as any,
      makeRequest(),
    );

    expect((result as any).status).toBe('proposed');
    expect(proposalCreate.mock.calls[0][3].updates.tag).toBe('product');
  });

  it('rejects a FEATURE without a tag', async () => {
    const { provider, proposalCreate } = createProvider();

    const result = await provider.createWorkItem(
      { type: 'FEATURE', name: 'Plans' } as any,
      {} as any,
      makeRequest(),
    );

    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toContain(
      'tag is required to create a FEATURE work item',
    );
    expect(proposalCreate).not.toHaveBeenCalled();
  });

  it('creates a GOAL with a dueDate and no parent', async () => {
    const { provider, proposalCreate } = createProvider();

    const result = await provider.createWorkItem(
      {
        type: 'GOAL',
        name: 'Ship by Q3',
        dueDate: '2026-09-30T00:00:00.000Z',
        sections: [{ key: 'description', content: 'Goal description.' }],
        guidanceToken: guidanceTokenForType('GOAL', PROJECT_ID),
      } as any,
      {} as any,
      makeRequest(),
    );

    expect((result as any).status).toBe('proposed');
    expect(proposalCreate.mock.calls[0][3].updates.type).toBe('GOAL');
  });

  it('rejects a GOAL with a parentTaskId', async () => {
    const { provider, proposalCreate } = createProvider();

    const result = await provider.createWorkItem(
      {
        type: 'GOAL',
        name: 'Ship by Q3',
        dueDate: '2026-09-30T00:00:00.000Z',
        parentTaskId: PARENT_ID,
        authoringRootProof: AUTHORING_ROOT_PROOF,
        sections: [{ key: 'description', content: 'Goal description.' }],
        guidanceToken: guidanceTokenForType('GOAL', PROJECT_ID),
      } as any,
      {} as any,
      makeRequest(),
    );

    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toContain(
      'GOAL work items do not declare any allowed structural parent types',
    );
    expect(proposalCreate).not.toHaveBeenCalled();
  });

  it('creates a BUG with a parent and a description', async () => {
    const { provider, proposalCreate } = createProvider();

    const result = await provider.createWorkItem(
      {
        type: 'BUG',
        name: 'Crash on save',
        parentTaskId: PARENT_ID,
        authoringRootProof: AUTHORING_ROOT_PROOF,
        sections: [{ key: 'description', content: 'Crash on save action.' }],
        guidanceToken: guidanceTokenForType('BUG', PROJECT_ID),
      } as any,
      {} as any,
      makeRequest(),
    );

    expect((result as any).status).toBe('proposed');
    expect(proposalCreate.mock.calls[0][3].updates.type).toBe('BUG');
  });
});
