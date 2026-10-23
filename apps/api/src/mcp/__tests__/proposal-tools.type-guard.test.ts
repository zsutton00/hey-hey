import { ProposalToolsProvider } from '../tools/proposal-tools.provider';
import type { ProposalService } from '../../services/proposal/proposal.service';
import type { TaskService } from '../../services/tasks/task.service';
import { WorkItemTypeRegistryService } from '../../services/tasks/work-item-type-registry.service';
import { createWarmWorkItemTypeRegistry } from '../../../test/setup/work-item-type-registry.fixture';
import { guidanceTokenForType } from '../tools/work-item-guidance-token';
import { AUTHORING_ROOT_PROOF } from '../tools/authoring-guidance';

let workItemTypeRegistry: WorkItemTypeRegistryService;
beforeAll(async () => {
  workItemTypeRegistry = await createWarmWorkItemTypeRegistry();
});

const ORG_ID = '00000000-0000-4000-8000-000000000001';
const PROJECT_ID = '00000000-0000-4000-8000-000000000002';
const TASK_ID = '00000000-0000-4000-8000-000000000010';
const FEATURE_ID = '00000000-0000-4000-8000-000000000011';
const GOAL_ID = '00000000-0000-4000-8000-000000000012';
const PLAN_ID = '00000000-0000-4000-8000-000000000013';
const MISSING_ID = '00000000-0000-4000-8000-000000000099';
const PROPOSAL_ID = '00000000-0000-4000-8000-000000000020';
const PARENT_ID = '00000000-0000-4000-8000-000000000030';

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

function makeProposal(overrides: Record<string, any> = {}) {
  return {
    id: PROPOSAL_ID,
    organizationId: ORG_ID,
    projectId: PROJECT_ID,
    type: 'SINGLE',
    action: 'UPDATE',
    status: 'DRAFT',
    targetEntityId: TASK_ID,
    targetEntityType: 'TASK',
    updates: {},
    createdAt: '2026-04-29T00:00:00.000Z',
    updatedAt: '2026-04-29T00:00:00.000Z',
    ...overrides,
  };
}

function createProvider(
  opts: {
    proposalCreate?: jest.Mock;
    proposalCreateBatch?: jest.Mock;
    taskFindOne?: jest.Mock;
  } = {},
) {
  const proposalCreate = opts.proposalCreate ?? jest.fn();
  const proposalCreateBatch = opts.proposalCreateBatch ?? jest.fn();
  const taskFindOne = opts.taskFindOne ?? jest.fn();
  const proposalService = {
    create: proposalCreate,
    createBatch: proposalCreateBatch,
    findOne: jest.fn(),
  } as unknown as ProposalService;
  const taskService = {
    findOne: taskFindOne,
  } as unknown as TaskService;
  const lintRecovery = {
    markNeedsRevision: jest.fn().mockResolvedValue(undefined),
    consumeRecovery: jest.fn().mockResolvedValue(false),
  } as any;
  const prisma = {
    db: {
      task: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      designDoc: { findMany: jest.fn().mockResolvedValue([]) },
    },
  } as any;
  const provider = new ProposalToolsProvider(
    proposalService,
    taskService,
    lintRecovery,
    workItemTypeRegistry,
    prisma,
  );
  return { provider, proposalCreate, proposalCreateBatch, taskFindOne };
}

// edit_work_item replaced the per-type edit tools: instead of redirecting a
// wrong-type target at a sibling tool, it resolves the target's type and
// applies that type's update rules from WORK_ITEM_TYPE_CONFIG. These tests
// pin the per-type rule application across target types.
describe('ProposalToolsProvider.editWorkItem per-type rules', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns not-found when the target entity does not exist', async () => {
    const taskFindOne = jest.fn().mockResolvedValue(null);
    const proposalCreate = jest.fn();
    const { provider } = createProvider({ proposalCreate, taskFindOne });

    const result = await provider.editWorkItem(
      {
        eli5: 'Explains the proposed change.',
        targetEntityId: MISSING_ID,
        name: 'Renamed',
      },
      {} as any,
      makeRequest(),
    );

    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toContain('not found');
    expect(proposalCreate).not.toHaveBeenCalled();
  });

  it('edits a STANDARD target', async () => {
    const taskFindOne = jest
      .fn()
      .mockResolvedValue({ id: TASK_ID, type: 'STANDARD' });
    const proposalCreate = jest
      .fn()
      .mockResolvedValue(makeProposal({ targetEntityId: TASK_ID }));
    const { provider } = createProvider({ proposalCreate, taskFindOne });

    const result = await provider.editWorkItem(
      {
        eli5: 'Explains the proposed change.',
        targetEntityId: TASK_ID,
        name: 'Renamed',
      },
      {} as any,
      makeRequest(),
    );

    expect((result as any).isError).toBeUndefined();
    expect((result as any).status).toBe('proposed');
    expect(taskFindOne).toHaveBeenCalledWith(ORG_ID, TASK_ID);
    expect(proposalCreate).toHaveBeenCalledTimes(1);
  });

  it('edits a FEATURE target, accepting the feature-only tag', async () => {
    const taskFindOne = jest
      .fn()
      .mockResolvedValue({ id: FEATURE_ID, type: 'FEATURE' });
    const proposalCreate = jest
      .fn()
      .mockResolvedValue(makeProposal({ targetEntityId: FEATURE_ID }));
    const { provider } = createProvider({ proposalCreate, taskFindOne });

    const result = await provider.editWorkItem(
      { targetEntityId: FEATURE_ID, tag: 'backend' } as any,
      {} as any,
      makeRequest(),
    );

    expect((result as any).isError).toBeUndefined();
    expect((result as any).status).toBe('proposed');
    const dto = proposalCreate.mock.calls[0][3];
    expect(dto.updates.tag).toBe('backend');
  });

  it('rejects tag when the target is a STANDARD task', async () => {
    const taskFindOne = jest
      .fn()
      .mockResolvedValue({ id: TASK_ID, type: 'STANDARD' });
    const proposalCreate = jest.fn();
    const { provider } = createProvider({ proposalCreate, taskFindOne });

    const result = await provider.editWorkItem(
      { targetEntityId: TASK_ID, tag: 'backend' } as any,
      {} as any,
      makeRequest(),
    );

    expect((result as any).isError).toBe(true);
    const text = (result as any).content[0].text as string;
    // The error leads with the server-resolved identity so an agent holding
    // a wrong type belief gets corrected, not just rejected.
    expect(text).toContain(`Work item ${TASK_ID} is a STANDARD.`);
    expect(text).toContain('tag is only valid on FEATURE work items');
    expect(proposalCreate).not.toHaveBeenCalled();
  });

  it('rejects a section key the target type does not carry', async () => {
    const taskFindOne = jest
      .fn()
      .mockResolvedValue({ id: FEATURE_ID, type: 'FEATURE' });
    const proposalCreate = jest.fn();
    const { provider } = createProvider({ proposalCreate, taskFindOne });

    const result = await provider.editWorkItem(
      {
        targetEntityId: FEATURE_ID,
        sections: [{ key: 'acceptanceCriteria', content: 'AC text' }],
        guidanceToken: guidanceTokenForType('FEATURE', PROJECT_ID),
      } as any,
      {} as any,
      makeRequest(),
    );

    expect((result as any).isError).toBe(true);
    const text = (result as any).content[0].text as string;
    expect(text).toContain(`Work item ${FEATURE_ID} is a FEATURE.`);
    expect(text).toContain(
      'Section "acceptanceCriteria" is not valid for FEATURE work items',
    );
    expect(text).toContain('description, requirements');
    expect(proposalCreate).not.toHaveBeenCalled();
  });

  it('rejects parentTaskId when the target is a GOAL', async () => {
    const taskFindOne = jest
      .fn()
      .mockResolvedValue({ id: GOAL_ID, type: 'GOAL' });
    const proposalCreate = jest.fn();
    const { provider } = createProvider({ proposalCreate, taskFindOne });

    const result = await provider.editWorkItem(
      {
        targetEntityId: GOAL_ID,
        parentTaskId: PARENT_ID,
        authoringRootProof: AUTHORING_ROOT_PROOF,
      } as any,
      {} as any,
      makeRequest(),
    );

    expect((result as any).isError).toBe(true);
    const text = (result as any).content[0].text as string;
    expect(text).toContain('parentTaskId is not editable on GOAL work items');
    expect(proposalCreate).not.toHaveBeenCalled();
  });

  it('edits a GOAL target through the same generic path', async () => {
    const taskFindOne = jest
      .fn()
      .mockResolvedValue({ id: GOAL_ID, type: 'GOAL' });
    const proposalCreate = jest
      .fn()
      .mockResolvedValue(makeProposal({ targetEntityId: GOAL_ID }));
    const { provider } = createProvider({ proposalCreate, taskFindOne });

    const result = await provider.editWorkItem(
      {
        eli5: 'Explains the proposed change.',
        targetEntityId: GOAL_ID,
        name: 'Renamed goal',
      },
      {} as any,
      makeRequest(),
    );

    expect((result as any).isError).toBeUndefined();
    expect((result as any).status).toBe('proposed');
    expect(proposalCreate).toHaveBeenCalledTimes(1);
  });

  it('edits a materialized PLAN target through the same generic path', async () => {
    const taskFindOne = jest
      .fn()
      .mockResolvedValue({ id: PLAN_ID, type: 'PLAN' });
    const proposalCreate = jest
      .fn()
      .mockResolvedValue(makeProposal({ targetEntityId: PLAN_ID }));
    const { provider } = createProvider({ proposalCreate, taskFindOne });

    const result = await provider.editWorkItem(
      {
        eli5: 'Explains the proposed change.',
        targetEntityId: PLAN_ID,
        name: 'Renamed plan',
      },
      {} as any,
      makeRequest(),
    );

    expect((result as any).isError).toBeUndefined();
    expect((result as any).status).toBe('proposed');
    expect(proposalCreate).toHaveBeenCalledTimes(1);
    expect(proposalCreate.mock.calls[0][3].updates.name).toBe('Renamed plan');
  });

  // The resolved type is echoed on every successful edit so an agent that
  // never hits a type rule (name/status-only edits) still learns what it
  // is editing — correction without an error.
  it.each([
    ['STANDARD', TASK_ID],
    ['FEATURE', FEATURE_ID],
    ['GOAL', GOAL_ID],
    ['BUG', TASK_ID],
  ] as const)(
    'echoes the server-resolved workItemType %s on the proposed envelope',
    async (type, targetId) => {
      const taskFindOne = jest.fn().mockResolvedValue({ id: targetId, type });
      const proposalCreate = jest
        .fn()
        .mockResolvedValue(makeProposal({ targetEntityId: targetId }));
      const { provider } = createProvider({ proposalCreate, taskFindOne });

      const result = await provider.editWorkItem(
        {
          eli5: 'Explains the proposed change.',
          targetEntityId: targetId,
          name: 'Renamed',
        },
        {} as any,
        makeRequest(),
      );

      expect((result as any).status).toBe('proposed');
      expect((result as any).workItemType).toBe(type);
    },
  );
});

describe('ProposalToolsProvider.editTasks cross-type guard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects the whole batch when one entry targets a FEATURE', async () => {
    const taskFindOne = jest
      .fn()
      .mockImplementation((_org: string, id: string) => {
        if (id === TASK_ID) return Promise.resolve({ id, type: 'STANDARD' });
        if (id === FEATURE_ID) return Promise.resolve({ id, type: 'FEATURE' });
        return Promise.resolve(null);
      });
    const proposalCreateBatch = jest.fn();
    const { provider } = createProvider({
      proposalCreateBatch,
      taskFindOne,
    });

    const result = await provider.editTasks(
      {
        edits: [
          { taskId: TASK_ID, name: 'Fine update' },
          { taskId: FEATURE_ID, name: 'Wrong type' },
        ],
      } as any,
      {} as any,
      makeRequest(),
    );

    expect((result as any).isError).toBe(true);
    const text = (result as any).content[0].text as string;
    expect(text).toContain('Validation failed');
    expect(text).toContain('is a FEATURE');
    expect(text).toContain('edit_work_item');
    expect(proposalCreateBatch).not.toHaveBeenCalled();
  });

  it('rejects the whole batch when one entry targets a GOAL', async () => {
    const taskFindOne = jest
      .fn()
      .mockImplementation((_org: string, id: string) => {
        if (id === TASK_ID) return Promise.resolve({ id, type: 'STANDARD' });
        if (id === GOAL_ID) return Promise.resolve({ id, type: 'GOAL' });
        return Promise.resolve(null);
      });
    const proposalCreateBatch = jest.fn();
    const { provider } = createProvider({
      proposalCreateBatch,
      taskFindOne,
    });

    const result = await provider.editTasks(
      {
        edits: [
          { taskId: TASK_ID, name: 'Fine update' },
          { taskId: GOAL_ID, name: 'Wrong type' },
        ],
      } as any,
      {} as any,
      makeRequest(),
    );

    expect((result as any).isError).toBe(true);
    const text = (result as any).content[0].text as string;
    expect(text).toContain('is a GOAL');
    expect(text).toContain('edit_work_item');
    expect(proposalCreateBatch).not.toHaveBeenCalled();
  });

  it('rejects the batch when a BUG entry carries a section its type does not allow', async () => {
    // Parity with edit_work_item: the batch tool runs the same
    // config-driven per-type validation on its plain-task entries.
    const BUG_ID = '00000000-0000-4000-8000-000000000013';
    const taskFindOne = jest
      .fn()
      .mockImplementation((_org: string, id: string) => {
        if (id === TASK_ID) return Promise.resolve({ id, type: 'STANDARD' });
        if (id === BUG_ID) return Promise.resolve({ id, type: 'BUG' });
        return Promise.resolve(null);
      });
    const proposalCreateBatch = jest.fn();
    const { provider } = createProvider({
      proposalCreateBatch,
      taskFindOne,
    });

    const result = await provider.editTasks(
      {
        edits: [
          { taskId: TASK_ID, name: 'Fine update' },
          {
            taskId: BUG_ID,
            sections: [{ key: 'acceptanceCriteria', content: 'AC text' }],
            guidanceToken: guidanceTokenForType('BUG', PROJECT_ID),
          },
        ],
      } as any,
      {} as any,
      makeRequest(),
    );

    expect((result as any).isError).toBe(true);
    const text = (result as any).content[0].text as string;
    expect(text).toContain(`Work item ${BUG_ID} is a BUG.`);
    // The batch error JSON-encodes per-entry messages, so match on
    // quote-free fragments of the per-type section error.
    expect(text).toContain('acceptanceCriteria');
    expect(text).toContain('is not valid for BUG work items');
    expect(proposalCreateBatch).not.toHaveBeenCalled();
  });

  it('accepts a BUG entry whose sections fit its type', async () => {
    const BUG_ID = '00000000-0000-4000-8000-000000000013';
    const taskFindOne = jest
      .fn()
      .mockResolvedValue({ id: BUG_ID, type: 'BUG' });
    const proposalCreateBatch = jest
      .fn()
      .mockResolvedValue([
        makeProposal({ targetEntityId: BUG_ID, updates: { sections: [] } }),
      ]);
    const { provider } = createProvider({
      proposalCreateBatch,
      taskFindOne,
    });

    const result = await provider.editTasks(
      {
        edits: [
          {
            taskId: BUG_ID,
            sections: [{ key: 'description', content: 'Updated repro.' }],
            guidanceToken: guidanceTokenForType('BUG', PROJECT_ID),
          },
        ],
      } as any,
      {} as any,
      makeRequest(),
    );

    expect((result as any).isError).toBeUndefined();
    expect(proposalCreateBatch).toHaveBeenCalledTimes(1);
  });

  it('rejects a sections-bearing entry with no token, naming the get_tool_guidance call', async () => {
    // edit_tasks must not be an open lane for authoring prose without
    // reading the per-type conventions — same proof-of-read gate as
    // edit_work_item, validated against each entry's resolved type.
    const taskFindOne = jest
      .fn()
      .mockResolvedValue({ id: TASK_ID, type: 'STANDARD' });
    const proposalCreateBatch = jest.fn();
    const { provider } = createProvider({ proposalCreateBatch, taskFindOne });

    const result = await provider.editTasks(
      {
        edits: [
          {
            taskId: TASK_ID,
            sections: [{ key: 'description', content: 'New body.' }],
            // no guidanceToken
          },
        ],
      } as any,
      {} as any,
      makeRequest(),
    );

    expect((result as any).isError).toBe(true);
    const text = (result as any).content[0].text as string;
    expect(text).toContain('guidanceToken');
    expect(text).toContain(
      'get_tool_guidance({ toolName: \\"edit_work_item\\", workItemType: \\"STANDARD\\" })',
    );
    expect(proposalCreateBatch).not.toHaveBeenCalled();
  });

  it('lets a scalar-only batch entry through with no token', async () => {
    const taskFindOne = jest
      .fn()
      .mockResolvedValue({ id: TASK_ID, type: 'STANDARD' });
    const proposalCreateBatch = jest
      .fn()
      .mockResolvedValue([makeProposal({ targetEntityId: TASK_ID })]);
    const { provider } = createProvider({ proposalCreateBatch, taskFindOne });

    const result = await provider.editTasks(
      { edits: [{ taskId: TASK_ID, status: 'ACTIVE' }] } as any,
      {} as any,
      makeRequest(),
    );

    expect((result as any).isError).toBeUndefined();
    expect(proposalCreateBatch).toHaveBeenCalledTimes(1);
  });

  it('rejects the batch when one entry targets a missing id', async () => {
    const taskFindOne = jest
      .fn()
      .mockImplementation((_org: string, id: string) => {
        if (id === TASK_ID) return Promise.resolve({ id, type: 'STANDARD' });
        return Promise.resolve(null);
      });
    const proposalCreateBatch = jest.fn();
    const { provider } = createProvider({
      proposalCreateBatch,
      taskFindOne,
    });

    const result = await provider.editTasks(
      {
        edits: [
          { taskId: TASK_ID, name: 'Fine update' },
          { taskId: MISSING_ID, name: 'Missing entity' },
        ],
      } as any,
      {} as any,
      makeRequest(),
    );

    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toContain('not found');
    expect(proposalCreateBatch).not.toHaveBeenCalled();
  });
});
