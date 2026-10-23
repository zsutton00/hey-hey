import { NotFoundException } from '@nestjs/common';
import { ProposalToolsProvider } from '../tools/proposal-tools.provider';
import type { ProposalService } from '../../services/proposal/proposal.service';
import type { TaskService } from '../../services/tasks/task.service';
import { WorkItemTypeRegistryService } from '../../services/tasks/work-item-type-registry.service';
import { createWarmWorkItemTypeRegistry } from '../../../test/setup/work-item-type-registry.fixture';

let workItemTypeRegistry: WorkItemTypeRegistryService;
beforeAll(async () => {
  workItemTypeRegistry = await createWarmWorkItemTypeRegistry();
});

const ORG_ID = '00000000-0000-4000-8000-000000000001';
const PROJECT_ID = '00000000-0000-4000-8000-000000000002';
const CONVERSATION_ID = '00000000-0000-4000-8000-000000000003';
const PROPOSAL_ID = '00000000-0000-4000-8000-000000000010';
const DRAFT_TARGET_ID = '00000000-0000-4000-8000-000000000020';
const MATERIALIZED_TARGET_ID = '00000000-0000-4000-8000-000000000021';

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
    targetEntityId: DRAFT_TARGET_ID,
    targetEntityType: 'PLAN_STAGE',
    updates: {},
    conversationId: CONVERSATION_ID,
    createdAt: '2026-04-24T00:00:00.000Z',
    updatedAt: '2026-04-24T00:00:00.000Z',
    ...overrides,
  };
}

function createProvider(findOne: jest.Mock = jest.fn()) {
  const proposalService = { findOne } as unknown as ProposalService;
  const taskService = {} as unknown as TaskService;
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
  return { provider, findOne };
}

describe('ProposalToolsProvider.getProposal', () => {
  it.each(['DRAFT', 'APPROVED', 'REJECTED'])(
    'returns durable declarations unchanged for %s sources',
    async (status) => {
      const edges = [
        {
          endpointMode: 'PROPOSAL',
          targetEntityType: 'PROPOSAL',
          targetEntityId: DRAFT_TARGET_ID,
          edgeType: 'EVOLVES',
          targetEntityTitle: 'Original proposal',
        },
      ];
      const { provider } = createProvider(
        jest.fn().mockResolvedValue(makeProposal({ status, edges })),
      );
      expect(
        await provider.getProposal(
          { proposalId: PROPOSAL_ID },
          {} as any,
          makeRequest(),
        ),
      ).toMatchObject({ edges });
    },
  );
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects unauthenticated calls', async () => {
    const { provider, findOne } = createProvider();
    const result = await provider.getProposal(
      { proposalId: PROPOSAL_ID },
      {} as any,
      makeRequest({ authed: false }),
    );
    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toContain(
      'Authentication required',
    );
    expect(findOne).not.toHaveBeenCalled();
  });

  it('rejects calls missing X-Project-ID', async () => {
    const { provider, findOne } = createProvider();
    const result = await provider.getProposal(
      { proposalId: PROPOSAL_ID },
      {} as any,
      makeRequest({ projectId: null }),
    );
    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toContain('X-Project-ID');
    expect(findOne).not.toHaveBeenCalled();
  });

  it('returns mcpError when the proposal is not found', async () => {
    const findOne = jest
      .fn()
      .mockRejectedValue(new NotFoundException('Proposal not found'));
    const { provider } = createProvider(findOne);
    const result = await provider.getProposal(
      { proposalId: PROPOSAL_ID },
      {} as any,
      makeRequest(),
    );
    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toContain('Proposal not found');
    expect(findOne).toHaveBeenCalledWith(PROPOSAL_ID, ORG_ID, PROJECT_ID);
  });

  it('returns mcpError when the proposal belongs to a different org or project', async () => {
    // findOne scopes by org+project; a wrong-org lookup surfaces as NotFound.
    const findOne = jest
      .fn()
      .mockRejectedValue(new NotFoundException('Proposal not found'));
    const { provider } = createProvider(findOne);
    const result = await provider.getProposal(
      { proposalId: PROPOSAL_ID },
      {} as any,
      makeRequest(),
    );
    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toContain('Proposal not found');
  });

  it('returns the current state for a DRAFT proposal', async () => {
    const findOne = jest
      .fn()
      .mockResolvedValue(makeProposal({ status: 'DRAFT' }));
    const { provider } = createProvider(findOne);
    const result = await provider.getProposal(
      { proposalId: PROPOSAL_ID },
      {} as any,
      makeRequest(),
    );
    expect((result as any).isError).toBeUndefined();
    expect(result).toEqual({
      id: PROPOSAL_ID,
      status: 'DRAFT',
      action: 'CREATE',
      targetEntityType: 'PLAN_STAGE',
      targetEntityId: DRAFT_TARGET_ID,
      conversationId: CONVERSATION_ID,
      createdAt: '2026-04-24T00:00:00.000Z',
      updatedAt: '2026-04-24T00:00:00.000Z',
    });
  });

  it('surfaces the materialized targetEntityId once APPROVED', async () => {
    const findOne = jest.fn().mockResolvedValue(
      makeProposal({
        status: 'APPROVED',
        targetEntityId: MATERIALIZED_TARGET_ID,
        updatedAt: '2026-04-24T00:05:00.000Z',
      }),
    );
    const { provider } = createProvider(findOne);
    const result = await provider.getProposal(
      { proposalId: PROPOSAL_ID },
      {} as any,
      makeRequest(),
    );
    expect((result as any).isError).toBeUndefined();
    expect((result as any).status).toBe('APPROVED');
    // The generated handle the DRAFT carried (DRAFT_TARGET_ID) is NOT what
    // surfaces here: approval rewrites targetEntityId to the enacted entity.
    expect((result as any).targetEntityId).toBe(MATERIALIZED_TARGET_ID);
    expect((result as any).updatedAt).toBe('2026-04-24T00:05:00.000Z');
  });

  it('returns the current state for a REJECTED proposal', async () => {
    const findOne = jest
      .fn()
      .mockResolvedValue(makeProposal({ status: 'REJECTED' }));
    const { provider } = createProvider(findOne);
    const result = await provider.getProposal(
      { proposalId: PROPOSAL_ID },
      {} as any,
      makeRequest(),
    );
    expect((result as any).isError).toBeUndefined();
    expect((result as any).status).toBe('REJECTED');
    expect((result as any).targetEntityId).toBe(DRAFT_TARGET_ID);
  });

  it('omits conversationId when the proposal has none', async () => {
    const findOne = jest
      .fn()
      .mockResolvedValue(makeProposal({ conversationId: undefined }));
    const { provider } = createProvider(findOne);
    const result = await provider.getProposal(
      { proposalId: PROPOSAL_ID },
      {} as any,
      makeRequest(),
    );
    expect((result as any).isError).toBeUndefined();
    expect((result as any).conversationId).toBeUndefined();
  });
});
