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
const BUG_ID = '00000000-0000-4000-8000-000000000040';
const PARENT_ID = '00000000-0000-4000-8000-000000000041';
const TRACKING_SOURCE_ID = '00000000-0000-4000-8000-000000000042';
const PROPOSAL_ID = '00000000-0000-4000-8000-000000000050';

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
    action: 'CREATE',
    status: 'DRAFT',
    targetEntityId: BUG_ID,
    targetEntityType: 'TASK',
    updates: {},
    createdAt: '2026-04-29T00:00:00.000Z',
    updatedAt: '2026-04-29T00:00:00.000Z',
    ...overrides,
  };
}

function createProvider(
  opts: { proposalCreate?: jest.Mock; taskFindOne?: jest.Mock } = {},
) {
  const proposalCreate = opts.proposalCreate ?? jest.fn();
  const proposalService = {
    create: proposalCreate,
    findOne: jest.fn(),
  } as unknown as ProposalService;
  const taskService = {
    findOne: opts.taskFindOne ?? jest.fn(),
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
  return { provider, proposalCreate };
}

describe('createWorkItem with type BUG', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects creation without a parentTaskId — bugs must belong to a parent', async () => {
    const proposalCreate = jest.fn();
    const { provider } = createProvider({ proposalCreate });

    const result = await provider.createWorkItem(
      {
        eli5: 'Explains the proposed change.',
        type: 'BUG',
        name: 'Orphan bug',
        sections: [{ key: 'description', content: 'Something is broken.' }],
        guidanceToken: guidanceTokenForType('BUG', PROJECT_ID),
      },
      {} as any,
      makeRequest(),
    );

    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toContain(
      'parentTaskId is required to create a BUG work item',
    );
    expect(proposalCreate).not.toHaveBeenCalled();
  });

  it('rejects creation without a description section', async () => {
    const proposalCreate = jest.fn();
    const { provider } = createProvider({ proposalCreate });

    const result = await provider.createWorkItem(
      {
        type: 'BUG',
        name: 'Bug with no body',
        parentTaskId: PARENT_ID,
        authoringRootProof: AUTHORING_ROOT_PROOF,
      } as any,
      {} as any,
      makeRequest(),
    );

    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toContain(
      'Section "description" is required to create a BUG work item',
    );
    expect(proposalCreate).not.toHaveBeenCalled();
  });

  it('accepts a BUG with both a parent and a description', async () => {
    const proposalCreate = jest.fn().mockResolvedValue(makeProposal());
    const { provider } = createProvider({ proposalCreate });

    const result = await provider.createWorkItem(
      {
        eli5: 'Explains the proposed change.',
        type: 'BUG',
        name: 'Valid bug',
        parentTaskId: PARENT_ID,
        authoringRootProof: AUTHORING_ROOT_PROOF,
        sections: [
          { key: 'description', content: 'Reproduction and expected fix.' },
        ],
        serviceIds: ['00000000-0000-4000-8000-000000000060'],
        guidanceToken: guidanceTokenForType('BUG', PROJECT_ID),
      },
      {} as any,
      makeRequest(),
    );

    expect((result as any).isError).toBeUndefined();
    expect((result as any).status).toBe('proposed');
    expect(proposalCreate).toHaveBeenCalledTimes(1);
    const dto = proposalCreate.mock.calls[0][3];
    expect(dto.action).toBe('CREATE');
    expect(dto.updates.type).toBe('BUG');
    expect(dto.updates.parentTaskId).toBe(PARENT_ID);
    expect(dto.updates.serviceIds).toEqual([
      '00000000-0000-4000-8000-000000000060',
    ]);
  });

  it('accepts serviceIds when editing a BUG', async () => {
    const serviceId = '00000000-0000-4000-8000-000000000060';
    const proposalCreate = jest
      .fn()
      .mockResolvedValue(makeProposal({ action: 'UPDATE' }));
    const taskFindOne = jest.fn().mockResolvedValue({
      id: BUG_ID,
      type: 'BUG',
      sections: [{ key: 'description', materializedMarkdown: 'Existing bug.' }],
    });
    const { provider } = createProvider({ proposalCreate, taskFindOne });

    const result = await provider.editWorkItem(
      {
        eli5: 'Explains the proposed change.',
        targetEntityId: BUG_ID,
        serviceIds: [serviceId],
      },
      {} as any,
      makeRequest(),
    );

    expect((result as any).status).toBe('proposed');
    expect(proposalCreate.mock.calls[0][3].updates.serviceIds).toEqual([
      serviceId,
    ]);
  });

  it('forwards the structured TRACKS attachment on the same create proposal', async () => {
    const proposalCreate = jest.fn().mockResolvedValue(makeProposal());
    const { provider } = createProvider({ proposalCreate });

    await provider.createWorkItem(
      {
        eli5: 'Explains the proposed change.',
        type: 'BUG',
        name: 'Tracked bug',
        parentTaskId: PARENT_ID,
        authoringRootProof: AUTHORING_ROOT_PROOF,
        sections: [
          { key: 'description', content: 'Reproduction and expected fix.' },
        ],
        tracks: { sourceEntityId: TRACKING_SOURCE_ID },
        guidanceToken: guidanceTokenForType('BUG', PROJECT_ID),
      },
      {} as any,
      makeRequest(),
    );

    expect(proposalCreate.mock.calls[0][3]).toEqual(
      expect.objectContaining({
        tracks: { sourceEntityId: TRACKING_SOURCE_ID },
      }),
    );
  });
});
