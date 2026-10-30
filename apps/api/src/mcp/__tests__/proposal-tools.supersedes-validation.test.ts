import type { Context } from '@rekog/mcp-nest';
import type { Request } from 'express';
import type { PrismaService } from '../../prisma/prisma.service';
import type { ProposalService } from '../../services/proposal/proposal.service';
import type { TaskService } from '../../services/tasks/task.service';
import { WorkItemTypeRegistryService } from '../../services/tasks/work-item-type-registry.service';
import { createWarmWorkItemTypeRegistry } from '../../../test/setup/work-item-type-registry.fixture';
import type { LintRecoveryStore } from '../tools/lint-recovery.store';
import { ProposalToolsProvider } from '../tools/proposal-tools.provider';
import { guidanceTokenForType } from '../tools/work-item-guidance-token';
import { AUTHORING_ROOT_PROOF } from '../tools/authoring-guidance';

const ORGANIZATION_ID = '10000000-0000-4000-8000-000000000001';
const PROJECT_ID = '10000000-0000-4000-8000-000000000002';
const PARENT_ID = '10000000-0000-4000-8000-000000000003';
const SUCCESSOR_ID = '10000000-0000-4000-8000-000000000004';
const BUG_PREDECESSOR_ID = '10000000-0000-4000-8000-000000000005';
const STANDARD_PREDECESSOR_ID = '10000000-0000-4000-8000-000000000006';
const PROPOSAL_ID = '10000000-0000-4000-8000-000000000007';

let registry: WorkItemTypeRegistryService;

beforeAll(async () => {
  registry = await createWarmWorkItemTypeRegistry();
});

function makeRequest() {
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
      currentOrgId: ORGANIZATION_ID,
      orgMemberships: [],
      isDevAdmin: false,
      devAdminMode: false,
    },
    ip: '127.0.0.1',
  } as unknown as Request;
}

function makeProposal(action: 'CREATE' | 'UPDATE') {
  return {
    id: PROPOSAL_ID,
    organizationId: ORGANIZATION_ID,
    projectId: PROJECT_ID,
    type: 'SINGLE',
    action,
    status: 'DRAFT',
    targetEntityId: SUCCESSOR_ID,
    targetEntityType: 'TASK',
    updates: {},
    createdAt: '2026-07-17T00:00:00.000Z',
    updatedAt: '2026-07-17T00:00:00.000Z',
  };
}

function createProvider(predecessorType: 'BUG' | 'STANDARD') {
  const proposalCreate = jest
    .fn()
    .mockImplementation(
      async (
        _organizationId: string,
        _projectId: string,
        _userId: string,
        dto: { action: 'CREATE' | 'UPDATE' },
      ) => makeProposal(dto.action),
    );
  const taskFindOne = jest.fn().mockResolvedValue({
    id: SUCCESSOR_ID,
    name: 'Successor',
    type: 'STANDARD',
    sections: [],
  });
  const proposalService = {
    create: proposalCreate,
    findOne: jest.fn(),
  } as unknown as ProposalService;
  const taskService = {
    findOne: taskFindOne,
  } as unknown as TaskService;
  const lintRecovery = {
    markNeedsRevision: jest.fn().mockResolvedValue(undefined),
    consumeRecovery: jest.fn().mockResolvedValue(false),
  } as unknown as LintRecoveryStore;
  const prisma = {
    db: {
      task: {
        findFirst: jest.fn().mockResolvedValue({ type: predecessorType }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      proposal: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      designDoc: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    },
  } as unknown as PrismaService;

  return {
    provider: new ProposalToolsProvider(
      proposalService,
      taskService,
      lintRecovery,
      registry,
      prisma,
    ),
    proposalCreate,
  };
}

function errorText(result: unknown): string {
  return (result as { content: Array<{ text: string }> }).content[0]!.text;
}

function supersedesEdge(targetEntityId: string) {
  return {
    targetEntityId,
    targetEntityType: 'TASK' as const,
    edgeType: 'SUPERSEDES' as const,
  };
}

describe.each(['create_work_item', 'edit_work_item'] as const)(
  '%s proposal-time SUPERSEDES eligibility',
  (toolName) => {
    async function invoke(
      provider: ProposalToolsProvider,
      predecessorId: string,
    ) {
      if (toolName === 'create_work_item') {
        return provider.createWorkItem(
          {
            eli5: 'Explains the proposed change.',
            type: 'STANDARD',
            name: 'Replacement task',
            parentTaskId: PARENT_ID,
            authoringRootProof: AUTHORING_ROOT_PROOF,
            sections: [
              { key: 'description', content: 'Replace the predecessor.' },
              {
                key: 'acceptanceCriteria',
                content: '- Replacement behavior is delivered.',
              },
            ],
            guidanceToken: guidanceTokenForType('STANDARD', PROJECT_ID),
            edges: [supersedesEdge(predecessorId)],
          },
          {} as Context,
          makeRequest(),
        );
      }

      return provider.editWorkItem(
        {
          eli5: 'Explains the proposed change.',
          targetEntityId: SUCCESSOR_ID,
          authoringRootProof: AUTHORING_ROOT_PROOF,
          edges: [supersedesEdge(predecessorId)],
        },
        {} as Context,
        makeRequest(),
      );
    }

    it('rejects an ineligible BUG predecessor before proposal persistence', async () => {
      const { provider, proposalCreate } = createProvider('BUG');

      const result = await invoke(provider, BUG_PREDECESSOR_ID);

      expect((result as { isError?: boolean }).isError).toBe(true);
      expect(errorText(result)).toContain(BUG_PREDECESSOR_ID);
      expect(errorText(result)).toContain('predecessor type BUG');
      expect(errorText(result)).toContain(
        'SUPERSEDES requires a predecessor type whose allowed-status policy permits SUPERSEDED',
      );
      expect(proposalCreate).not.toHaveBeenCalled();
    });

    it('accepts an eligible STANDARD predecessor', async () => {
      const { provider, proposalCreate } = createProvider('STANDARD');

      const result = await invoke(provider, STANDARD_PREDECESSOR_ID);

      expect((result as { isError?: boolean }).isError).toBeUndefined();
      expect((result as { status: string }).status).toBe('proposed');
      expect(proposalCreate).toHaveBeenCalledTimes(1);
      expect(proposalCreate.mock.calls[0]![3]).toEqual(
        expect.objectContaining({
          edges: [supersedesEdge(STANDARD_PREDECESSOR_ID)],
        }),
      );
    });
  },
);
