import { ProposalToolsProvider, editWorkItemParameters } from '../tools/proposal-tools.provider';
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
const GOAL_ID = '00000000-0000-4000-8000-000000000010';
const PROPOSAL_ID = '00000000-0000-4000-8000-000000000020';
const SOMEONE = '00000000-0000-4000-8000-000000000030';
const DUE_DATE = '2026-06-15T00:00:00.000Z';

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

function makeRequest(
  opts: { projectId?: string | null; authed?: boolean } = {},
) {
  const headers: Record<string, string> = { authorization: 'Bearer tok' };
  if (opts.projectId !== null) {
    headers['x-project-id'] = opts.projectId ?? PROJECT_ID;
  }
  return {
    headers,
    cookies: {},
    user: opts.authed === false ? undefined : makeUser(),
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
    targetEntityId: GOAL_ID,
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
    taskFindOne?: jest.Mock;
  } = {},
) {
  const proposalCreate = opts.proposalCreate ?? jest.fn();
  const taskFindOne = opts.taskFindOne ?? jest.fn();
  const proposalService = {
    create: proposalCreate,
    createBatch: jest.fn(),
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
  return { provider, proposalCreate, taskFindOne };
}

describe('createWorkItem with type GOAL', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates a CREATE proposal with type=GOAL and the lint-aware envelope', async () => {
    const proposalCreate = jest
      .fn()
      .mockResolvedValue(makeProposal({ targetEntityId: GOAL_ID }));
    const { provider } = createProvider({ proposalCreate });

    const result = await provider.createWorkItem(
      {
        eli5: 'Explains the proposed change.',
        type: 'GOAL',
        name: 'Ship widgets v1',
        dueDate: DUE_DATE,
        sections: [{ key: 'description', content: 'Goal description.' }],
        guidanceToken: guidanceTokenForType('GOAL', PROJECT_ID),
      },
      {} as any,
      makeRequest(),
    );

    expect((result as any).isError).toBeUndefined();
    // GOAL now shares the lint-aware envelope — the legacy id+DRAFT goal
    // envelope is folded into the same shape every type returns.
    expect((result as any).status).toBe('proposed');
    expect((result as any).lintFindings).toEqual([]);
    expect((result as any).proposalId).toBe(PROPOSAL_ID);
    expect(proposalCreate).toHaveBeenCalledTimes(1);
    const dto = proposalCreate.mock.calls[0][3];
    expect(dto.action).toBe('CREATE');
    expect(dto.targetEntityType).toBe('TASK');
    expect(dto.updates.type).toBe('GOAL');
    expect(dto.updates.name).toBe('Ship widgets v1');
    expect(dto.updates.dueDate).toBe(DUE_DATE);
  });

  it('creates an undated canonical Goal through generic authoring', async () => {
    const proposalCreate = jest.fn().mockResolvedValue(makeProposal());

    const { provider } = createProvider({ proposalCreate });
    const result = await provider.createWorkItem(
      {
        eli5: 'An outcome without a deadline.',
        type: 'GOAL',
        name: 'Goal without date',
        sections: [{ key: 'description', content: 'Deliver the outcome.' }],
        guidanceToken: guidanceTokenForType('GOAL', PROJECT_ID),
      },
      {} as any,
      makeRequest(),
    );
    expect((result as any).isError).toBeUndefined();
    expect(proposalCreate.mock.calls[0][3].updates.dueDate).toBeUndefined();
  });

  it('rejects parentTaskId when GOAL declares no structural parent types', async () => {
    const proposalCreate = jest.fn();
    const { provider } = createProvider({ proposalCreate });

    const result = await provider.createWorkItem(
      {
        eli5: 'Explains the proposed change.',
        type: 'GOAL',
        name: 'Goal',
        dueDate: DUE_DATE,
        parentTaskId: SOMEONE,
        authoringRootProof: AUTHORING_ROOT_PROOF,
        sections: [{ key: 'description', content: 'Goal description.' }],
        guidanceToken: guidanceTokenForType('GOAL', PROJECT_ID),
      },
      {} as any,
      makeRequest(),
    );

    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toContain(
      'do not declare any allowed structural parent types',
    );
    expect(proposalCreate).not.toHaveBeenCalled();
  });

  it('rejects sections beyond the GOAL description-only profile', async () => {
    const proposalCreate = jest.fn();
    const { provider } = createProvider({ proposalCreate });

    const result = await provider.createWorkItem(
      {
        type: 'GOAL',
        name: 'Goal',
        dueDate: DUE_DATE,
        sections: [{ key: 'acceptanceCriteria', content: 'AC text' }],
        guidanceToken: guidanceTokenForType('GOAL', PROJECT_ID),
      } as any,
      {} as any,
      makeRequest(),
    );

    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toContain(
      'Section "acceptanceCriteria" is not valid for GOAL work items',
    );
    expect(proposalCreate).not.toHaveBeenCalled();
  });

  it('rejects unauthenticated calls', async () => {
    const proposalCreate = jest.fn();
    const { provider } = createProvider({ proposalCreate });

    const result = await provider.createWorkItem(
      {
        eli5: 'Explains the proposed change.',
        type: 'GOAL',
        name: 'Goal',
        dueDate: DUE_DATE,
      },
      {} as any,
      makeRequest({ authed: false }),
    );

    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toContain(
      'Authentication required',
    );
    expect(proposalCreate).not.toHaveBeenCalled();
  });

  it('rejects calls missing X-Project-ID', async () => {
    const proposalCreate = jest.fn();
    const { provider } = createProvider({ proposalCreate });

    const result = await provider.createWorkItem(
      {
        eli5: 'Explains the proposed change.',
        type: 'GOAL',
        name: 'Goal',
        dueDate: DUE_DATE,
      },
      {} as any,
      makeRequest({ projectId: null }),
    );

    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toContain('X-Project-ID');
    expect(proposalCreate).not.toHaveBeenCalled();
  });

  it('surfaces underlying service rejection (e.g. dueDate guard)', async () => {
    const proposalCreate = jest
      .fn()
      .mockRejectedValue(new Error('GOAL tasks require a dueDate.'));
    const { provider } = createProvider({ proposalCreate });

    const result = await provider.createWorkItem(
      {
        eli5: 'Explains the proposed change.',
        type: 'GOAL',
        name: 'Goal',
        dueDate: DUE_DATE,
        sections: [{ key: 'description', content: 'Goal description.' }],
        guidanceToken: guidanceTokenForType('GOAL', PROJECT_ID),
      },
      {} as any,
      makeRequest(),
    );

    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toContain('dueDate');
  });
});

describe('editWorkItem on a GOAL target', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('accepts explicit date clearing at the MCP input boundary', () => {
    const parsed = editWorkItemParameters.parse({
      eli5: 'Clear the target date.', targetEntityId: GOAL_ID, dueDate: null,
    });
    expect(parsed.dueDate).toBeNull();
  });

  it('creates an UPDATE proposal applying the GOAL update rules', async () => {
    const proposalCreate = jest
      .fn()
      .mockResolvedValue(
        makeProposal({ action: 'UPDATE', targetEntityId: GOAL_ID }),
      );
    const taskFindOne = jest
      .fn()
      .mockResolvedValue({ id: GOAL_ID, type: 'GOAL' });
    const { provider } = createProvider({ proposalCreate, taskFindOne });

    const result = await provider.editWorkItem(
      {
        eli5: 'Explains the proposed change.',
        targetEntityId: GOAL_ID,
        name: 'Renamed goal',
        dueDate: DUE_DATE,
      },
      {} as any,
      makeRequest(),
    );

    expect((result as any).isError).toBeUndefined();
    expect((result as any).status).toBe('proposed');
    expect(taskFindOne).toHaveBeenCalledWith(ORG_ID, GOAL_ID);
    expect(proposalCreate).toHaveBeenCalledTimes(1);
    const dto = proposalCreate.mock.calls[0][3];
    expect(dto.action).toBe('UPDATE');
    expect(dto.targetEntityId).toBe(GOAL_ID);
    expect(dto.updates).toEqual({
      name: 'Renamed goal',
      dueDate: DUE_DATE,
    });
  });

  it.each([undefined, null, DUE_DATE])(
    'preserves edit date semantics for %s',
    async (dueDate) => {
      const proposalCreate = jest
        .fn()
        .mockResolvedValue(makeProposal({ action: 'UPDATE' }));
      const taskFindOne = jest
        .fn()
        .mockResolvedValue({ id: GOAL_ID, type: 'GOAL' });
      const { provider } = createProvider({ proposalCreate, taskFindOne });
      const result = await provider.editWorkItem(
        {
          eli5: 'Edit the outcome.',
          targetEntityId: GOAL_ID,
          name: 'Updated Goal',
          ...(dueDate === undefined ? {} : { dueDate }),
        },
        {} as any,
        makeRequest(),
      );
      expect((result as any).isError).toBeUndefined();
      const updates = proposalCreate.mock.calls[0][3].updates;
      if (dueDate === undefined) expect(updates).not.toHaveProperty('dueDate');
      else expect(updates.dueDate).toBe(dueDate);
    },
  );

  it('rejects clearing a date required by a project-owned definition', async () => {
    const scalarRequired = jest
      .spyOn(workItemTypeRegistry, 'isScalarRequired')
      .mockReturnValue(true);
    const taskFindOne = jest
      .fn()
      .mockResolvedValue({ id: GOAL_ID, type: 'GOAL' });
    const { provider, proposalCreate } = createProvider({ taskFindOne });
    const result = await provider.editWorkItem(
      {
        eli5: 'Clear target date.',
        targetEntityId: GOAL_ID,
        dueDate: null,
      },
      {} as any,
      makeRequest(),
    );
    expect((result as any).isError).toBe(true);
    expect(proposalCreate).not.toHaveBeenCalled();
    scalarRequired.mockRestore();
  });

  it('returns error when target entity does not exist', async () => {
    const proposalCreate = jest.fn();
    const taskFindOne = jest.fn().mockResolvedValue(null);
    const { provider } = createProvider({ proposalCreate, taskFindOne });

    const result = await provider.editWorkItem(
      {
        eli5: 'Explains the proposed change.',
        targetEntityId: GOAL_ID,
        name: 'X',
      },
      {} as any,
      makeRequest(),
    );

    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toContain('not found');
    expect(proposalCreate).not.toHaveBeenCalled();
  });

  it('rejects empty update payloads', async () => {
    const proposalCreate = jest.fn();
    const taskFindOne = jest
      .fn()
      .mockResolvedValue({ id: GOAL_ID, type: 'GOAL' });
    const { provider } = createProvider({ proposalCreate, taskFindOne });

    const result = await provider.editWorkItem(
      { eli5: 'Explains the proposed change.', targetEntityId: GOAL_ID },
      {} as any,
      makeRequest(),
    );

    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toContain('No update fields');
    expect(proposalCreate).not.toHaveBeenCalled();
  });

  it('rejects parentTaskId — goals must remain top-level', async () => {
    const proposalCreate = jest.fn();
    const taskFindOne = jest
      .fn()
      .mockResolvedValue({ id: GOAL_ID, type: 'GOAL' });
    const { provider } = createProvider({ proposalCreate, taskFindOne });

    const result = await provider.editWorkItem(
      {
        eli5: 'Explains the proposed change.',
        targetEntityId: GOAL_ID,
        name: 'X',
        parentTaskId: SOMEONE,
        authoringRootProof: AUTHORING_ROOT_PROOF,
      },
      {} as any,
      makeRequest(),
    );

    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toContain('not editable');
    // The generic tool resolves the target's type before validating, so
    // findOne runs (unlike the retired edit_goal, which rejected at the
    // schema boundary before any lookup).
    expect(taskFindOne).toHaveBeenCalledWith(ORG_ID, GOAL_ID);
    expect(proposalCreate).not.toHaveBeenCalled();
  });
});
