import {
  ProposalToolsProvider,
  createWorkItemParameters,
  editWorkItemParameters,
  editTasksParameters,
} from '../tools/proposal-tools.provider';
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
const PARENT_ID = '00000000-0000-4000-8000-000000000011';
const PROPOSAL_ID = '00000000-0000-4000-8000-000000000020';

const IMPL_TEXT = 'Touch src/foo.ts; follow the existing bar pattern.';
const IMPL_BLOCK = `## Implementation\n\n${IMPL_TEXT}`;
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

function makeRequest() {
  return {
    headers: { authorization: 'Bearer tok', 'x-project-id': PROJECT_ID },
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
    targetEntityId: TASK_ID,
    targetEntityType: 'TASK',
    updates: {},
    createdAt: '2026-05-19T00:00:00.000Z',
    updatedAt: '2026-05-19T00:00:00.000Z',
    ...overrides,
  };
}

function createProvider(
  opts: { proposalCreate?: jest.Mock; taskFindOne?: jest.Mock } = {},
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

describe('create_work_item (STANDARD) — implementation field folding', () => {
  beforeEach(() => jest.clearAllMocks());

  it('appends a ## Implementation block to the description section', async () => {
    const proposalCreate = jest.fn().mockResolvedValue(makeProposal());
    const { provider } = createProvider({ proposalCreate });

    const result = await provider.createWorkItem(
      {
        eli5: 'Explains the proposed change.',
        type: 'STANDARD',
        name: 'Add the field',
        parentTaskId: PARENT_ID,
        authoringRootProof: AUTHORING_ROOT_PROOF,
        sections: [
          { key: 'description', content: 'Base description.' },
          { key: 'acceptanceCriteria', content: 'AC.' },
        ],
        implementation: IMPL_TEXT,
        guidanceToken: guidanceTokenForType('STANDARD', PROJECT_ID),
      },
      {} as any,
      makeRequest(),
    );

    expect((result as any).isError).toBeUndefined();
    const dto = proposalCreate.mock.calls[0][3];
    expect(dto.updates.sections).toEqual([
      {
        key: 'description',
        content: `Base description.\n\n${IMPL_BLOCK}`,
      },
      { key: 'acceptanceCriteria', content: 'AC.' },
    ]);
    // implementation is never stored as a raw field — only folded in.
    expect(dto.updates.implementation).toBeUndefined();
  });

  it('creates a description section when the call supplies none', async () => {
    const proposalCreate = jest.fn().mockResolvedValue(makeProposal());
    const { provider } = createProvider({ proposalCreate });

    await provider.createWorkItem(
      {
        eli5: 'Explains the proposed change.',
        type: 'STANDARD',
        name: 'Add the field',
        parentTaskId: PARENT_ID,
        authoringRootProof: AUTHORING_ROOT_PROOF,
        sections: [{ key: 'acceptanceCriteria', content: 'AC.' }],
        implementation: IMPL_TEXT,
        guidanceToken: guidanceTokenForType('STANDARD', PROJECT_ID),
      },
      {} as any,
      makeRequest(),
    );

    const dto = proposalCreate.mock.calls[0][3];
    expect(dto.updates.sections).toEqual([
      { key: 'acceptanceCriteria', content: 'AC.' },
      { key: 'description', content: IMPL_BLOCK },
    ]);
  });

  it('leaves the description untouched when implementation is empty', async () => {
    const proposalCreate = jest.fn().mockResolvedValue(makeProposal());
    const { provider } = createProvider({ proposalCreate });

    await provider.createWorkItem(
      {
        eli5: 'Explains the proposed change.',
        type: 'STANDARD',
        name: 'Add the field',
        parentTaskId: PARENT_ID,
        authoringRootProof: AUTHORING_ROOT_PROOF,
        sections: [
          { key: 'description', content: 'Base description.' },
          { key: 'acceptanceCriteria', content: 'AC.' },
        ],
        implementation: '   ',
        guidanceToken: guidanceTokenForType('STANDARD', PROJECT_ID),
      },
      {} as any,
      makeRequest(),
    );

    const dto = proposalCreate.mock.calls[0][3];
    expect(dto.updates.sections).toEqual([
      { key: 'description', content: 'Base description.' },
      { key: 'acceptanceCriteria', content: 'AC.' },
    ]);
  });

  it('leaves the description untouched when implementation is omitted', async () => {
    const proposalCreate = jest.fn().mockResolvedValue(makeProposal());
    const { provider } = createProvider({ proposalCreate });

    await provider.createWorkItem(
      {
        eli5: 'Explains the proposed change.',
        type: 'STANDARD',
        name: 'Add the field',
        parentTaskId: PARENT_ID,
        authoringRootProof: AUTHORING_ROOT_PROOF,
        sections: [
          { key: 'description', content: 'Base description.' },
          { key: 'acceptanceCriteria', content: 'AC.' },
        ],
        guidanceToken: guidanceTokenForType('STANDARD', PROJECT_ID),
      },
      {} as any,
      makeRequest(),
    );

    const dto = proposalCreate.mock.calls[0][3];
    expect(dto.updates.sections).toEqual([
      { key: 'description', content: 'Base description.' },
      { key: 'acceptanceCriteria', content: 'AC.' },
    ]);
  });
});

describe('edit_work_item (STANDARD) — implementation field folding', () => {
  beforeEach(() => jest.clearAllMocks());

  it('folds into a description section supplied by the call', async () => {
    const proposalCreate = jest
      .fn()
      .mockResolvedValue(makeProposal({ action: 'UPDATE' }));
    const taskFindOne = jest
      .fn()
      .mockResolvedValue({ id: TASK_ID, type: 'STANDARD', sections: [] });
    const { provider } = createProvider({ proposalCreate, taskFindOne });

    await provider.editWorkItem(
      {
        eli5: 'Explains the proposed change.',
        targetEntityId: TASK_ID,
        sections: [{ key: 'description', content: 'Edited body.' }],
        implementation: IMPL_TEXT,
        guidanceToken: guidanceTokenForType('STANDARD', PROJECT_ID),
      },
      {} as any,
      makeRequest(),
    );

    const dto = proposalCreate.mock.calls[0][3];
    expect(dto.updates.sections).toEqual([
      { key: 'description', content: `Edited body.\n\n${IMPL_BLOCK}` },
    ]);
    expect(dto.updates.implementation).toBeUndefined();
  });

  it('appends to the current description when the call supplies no section', async () => {
    const proposalCreate = jest
      .fn()
      .mockResolvedValue(makeProposal({ action: 'UPDATE' }));
    const taskFindOne = jest.fn().mockResolvedValue({
      id: TASK_ID,
      type: 'STANDARD',
      sections: [
        {
          id: 's1',
          key: 'description',
          order: 0,
          materializedMarkdown: 'Original body.',
        },
      ],
    });
    const { provider } = createProvider({ proposalCreate, taskFindOne });

    const result = await provider.editWorkItem(
      {
        eli5: 'Explains the proposed change.',
        targetEntityId: TASK_ID,
        implementation: IMPL_TEXT,
        guidanceToken: guidanceTokenForType('STANDARD', PROJECT_ID),
      },
      {} as any,
      makeRequest(),
    );

    // An implementation-only edit is a real change — the empty-payload
    // guard must not reject it.
    expect((result as any).isError).toBeUndefined();
    const dto = proposalCreate.mock.calls[0][3];
    expect(dto.updates.sections).toEqual([
      { key: 'description', content: `Original body.\n\n${IMPL_BLOCK}` },
    ]);
  });

  it('folds for a BUG target too — edit parity with the retired edit_task reach', async () => {
    const proposalCreate = jest
      .fn()
      .mockResolvedValue(makeProposal({ action: 'UPDATE' }));
    const taskFindOne = jest
      .fn()
      .mockResolvedValue({ id: TASK_ID, type: 'BUG', sections: [] });
    const { provider } = createProvider({ proposalCreate, taskFindOne });

    const result = await provider.editWorkItem(
      {
        eli5: 'Explains the proposed change.',
        targetEntityId: TASK_ID,
        sections: [{ key: 'description', content: 'Bug report body.' }],
        implementation: IMPL_TEXT,
        guidanceToken: guidanceTokenForType('BUG', PROJECT_ID),
      },
      {} as any,
      makeRequest(),
    );

    expect((result as any).isError).toBeUndefined();
    const dto = proposalCreate.mock.calls[0][3];
    expect(dto.updates.sections).toEqual([
      { key: 'description', content: `Bug report body.\n\n${IMPL_BLOCK}` },
    ]);
  });

  it('leaves the payload empty when implementation is empty and nothing else changes', async () => {
    const proposalCreate = jest.fn();
    const taskFindOne = jest
      .fn()
      .mockResolvedValue({ id: TASK_ID, type: 'STANDARD', sections: [] });
    const { provider } = createProvider({ proposalCreate, taskFindOne });

    const result = await provider.editWorkItem(
      {
        eli5: 'Explains the proposed change.',
        targetEntityId: TASK_ID,
        implementation: '   ',
      },
      {} as any,
      makeRequest(),
    );

    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toContain('No update fields');
    expect(proposalCreate).not.toHaveBeenCalled();
  });
});

describe('implementation field is scoped per work-item type', () => {
  beforeEach(() => jest.clearAllMocks());

  it('is declared on create_work_item and edit_work_item', () => {
    expect(createWorkItemParameters.shape.implementation).toBeDefined();
    expect(editWorkItemParameters.shape.implementation).toBeDefined();
  });

  it('is rejected when creating a FEATURE', async () => {
    const proposalCreate = jest.fn();
    const { provider } = createProvider({ proposalCreate });

    const result = await provider.createWorkItem(
      {
        type: 'FEATURE',
        name: 'A feature',
        tag: 'product',
        sections: [{ key: 'description', content: 'Feature description.' }],
        initialRequirements: [{ requirement: 'A requirement.' }],
        implementation: IMPL_TEXT,
        guidanceToken: guidanceTokenForType('FEATURE', PROJECT_ID),
      } as any,
      {} as any,
      makeRequest(),
    );

    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toContain(
      'implementation is not accepted for FEATURE work items',
    );
    expect(proposalCreate).not.toHaveBeenCalled();
  });

  it('is rejected when creating a GOAL', async () => {
    const proposalCreate = jest.fn();
    const { provider } = createProvider({ proposalCreate });

    const result = await provider.createWorkItem(
      {
        type: 'GOAL',
        name: 'A goal',
        dueDate: DUE_DATE,
        sections: [{ key: 'description', content: 'Goal description.' }],
        implementation: IMPL_TEXT,
        guidanceToken: guidanceTokenForType('GOAL', PROJECT_ID),
      } as any,
      {} as any,
      makeRequest(),
    );

    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toContain(
      'implementation is not accepted for GOAL work items',
    );
    expect(proposalCreate).not.toHaveBeenCalled();
  });

  it('is rejected when editing a FEATURE target', async () => {
    const proposalCreate = jest.fn();
    const taskFindOne = jest
      .fn()
      .mockResolvedValue({ id: TASK_ID, type: 'FEATURE', sections: [] });
    const { provider } = createProvider({ proposalCreate, taskFindOne });

    const result = await provider.editWorkItem(
      {
        eli5: 'Explains the proposed change.',
        targetEntityId: TASK_ID,
        implementation: IMPL_TEXT,
        guidanceToken: guidanceTokenForType('FEATURE', PROJECT_ID),
      },
      {} as any,
      makeRequest(),
    );

    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toContain(
      'implementation is not accepted for FEATURE work items',
    );
    expect(proposalCreate).not.toHaveBeenCalled();
  });

  it('is stripped from edit_tasks batch entries', () => {
    const parsed = editTasksParameters.parse({
      edits: [
        {
          taskId: TASK_ID,
          eli5: 'Explains the proposed change.',
          name: 'Renamed',
          implementation: IMPL_TEXT,
        },
      ],
    });
    expect(parsed.edits[0]).not.toHaveProperty('implementation');
  });
});
