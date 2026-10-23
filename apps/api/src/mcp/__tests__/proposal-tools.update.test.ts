import {
  ProposalToolsProvider,
  updateProposalParameters,
} from '../tools/proposal-tools.provider';
import type { ProposalService } from '../../services/proposal/proposal.service';
import type { TaskService } from '../../services/tasks/task.service';
import { WorkItemTypeRegistryService } from '../../services/tasks/work-item-type-registry.service';
import { createWarmWorkItemTypeRegistry } from '../../../test/setup/work-item-type-registry.fixture';

const ORG_ID = '00000000-0000-4000-8000-000000000001';
const PROJECT_ID = '00000000-0000-4000-8000-000000000002';
const PROPOSAL_ID = '00000000-0000-4000-8000-000000000003';
const TASK_ID = '00000000-0000-4000-8000-000000000004';

let workItemTypeRegistry: WorkItemTypeRegistryService;

beforeAll(async () => {
  workItemTypeRegistry = await createWarmWorkItemTypeRegistry();
});

function makeRequest() {
  return {
    headers: {
      authorization: 'Bearer tok',
      'x-project-id': PROJECT_ID,
    },
    cookies: {},
    user: {
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

function createProvider(proposalUpdate: jest.Mock) {
  const proposalService = {
    update: proposalUpdate,
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

const htmlCssContent = {
  html: '<button data-hh-id="submit">Submit</button>',
  css: 'button { color: rebeccapurple; }',
  sizeKey: 'panel',
};

describe('ProposalToolsProvider.updateProposal', () => {
  it('accepts the registry-declared HTML/CSS object at the MCP boundary', () => {
    const parsed = updateProposalParameters.safeParse({
      proposalId: PROPOSAL_ID,
      updates: {
        sections: [{ key: 'preview', content: htmlCssContent, order: 0 }],
      },
    });

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.updates?.sections).toEqual([
      { key: 'preview', content: htmlCssContent, order: 0 },
    ]);
  });

  it('forwards the typed HTML/CSS section unchanged to the proposal service', async () => {
    const proposalUpdate = jest.fn().mockResolvedValue({
      id: PROPOSAL_ID,
      status: 'DRAFT',
      action: 'UPDATE',
      targetEntityType: 'TASK',
      targetEntityId: TASK_ID,
      updatedAt: '2026-09-20T00:00:00.000Z',
    });
    const provider = createProvider(proposalUpdate);
    const params = updateProposalParameters.parse({
      proposalId: PROPOSAL_ID,
      updates: {
        sections: [{ key: 'preview', content: htmlCssContent, order: 0 }],
      },
    });

    const result = await provider.updateProposal(
      params,
      {} as any,
      makeRequest(),
    );

    expect((result as any).isError).toBeUndefined();
    expect(proposalUpdate).toHaveBeenCalledWith(
      PROPOSAL_ID,
      ORG_ID,
      PROJECT_ID,
      expect.objectContaining({
        updates: {
          sections: [{ key: 'preview', content: htmlCssContent, order: 0 }],
        },
      }),
      'u1',
      'tok',
    );
  });
});
