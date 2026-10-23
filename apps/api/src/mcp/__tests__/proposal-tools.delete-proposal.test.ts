import { ConflictException, NotFoundException } from '@nestjs/common';
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
const PROPOSAL_ID = '00000000-0000-4000-8000-000000000010';

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
    user:
      opts.authed === false
        ? undefined
        : {
            userId: 'u1',
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

function createProvider(proposalDelete: jest.Mock) {
  const proposalService = {
    delete: proposalDelete,
  } as unknown as ProposalService;
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

  return new ProposalToolsProvider(
    proposalService,
    taskService,
    lintRecovery,
    workItemTypeRegistry,
    prisma,
  );
}

describe('ProposalToolsProvider.deleteProposal', () => {
  it('rejects unauthenticated calls without deleting', async () => {
    const proposalDelete = jest.fn();
    const provider = createProvider(proposalDelete);

    const result = await provider.deleteProposal(
      { proposalId: PROPOSAL_ID },
      {} as any,
      makeRequest({ authed: false }),
    );

    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toContain(
      'Authentication required',
    );
    expect(proposalDelete).not.toHaveBeenCalled();
  });

  it('requires project scope before deleting', async () => {
    const proposalDelete = jest.fn();
    const provider = createProvider(proposalDelete);

    const result = await provider.deleteProposal(
      { proposalId: PROPOSAL_ID },
      {} as any,
      makeRequest({ projectId: null }),
    );

    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toContain('X-Project-ID');
    expect(proposalDelete).not.toHaveBeenCalled();
  });

  it('deletes through the scoped ProposalService path and returns a deterministic result', async () => {
    const proposalDelete = jest.fn().mockResolvedValue(undefined);
    const provider = createProvider(proposalDelete);

    const result = await provider.deleteProposal(
      { proposalId: PROPOSAL_ID },
      {} as any,
      makeRequest(),
    );

    expect(result).toEqual({ deleted: true, proposalId: PROPOSAL_ID });
    expect(proposalDelete).toHaveBeenCalledWith(
      PROPOSAL_ID,
      ORG_ID,
      PROJECT_ID,
    );
  });

  it.each([
    new NotFoundException('Proposal not found'),
    new ConflictException(
      'Cannot delete a proposal that belongs to a proposal group',
    ),
  ])('returns actionable service errors: %s', async (error) => {
    const proposalDelete = jest.fn().mockRejectedValue(error);
    const provider = createProvider(proposalDelete);

    const result = await provider.deleteProposal(
      { proposalId: PROPOSAL_ID },
      {} as any,
      makeRequest(),
    );

    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toContain(error.message);
  });
});
