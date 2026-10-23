import {
  WORK_ITEM_TYPE_KEYS,
  type WorkItemTypeKey,
} from 'src/services/tasks/work-item-type-keys';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { WorkStatus } from '@prisma/client';

import { TaskSupersedeService } from '../task-supersede.service';
import { TaskService } from '../task.service';
import { ProposalService } from '../../proposal/proposal.service';
import type { RequestorContext } from '../../../mcp/tools/requestor-context';
import type { CreateProposalDto, TaskResponseDto } from '../../../generated';
import type { TypedProposalResponse } from '../../proposal/proposal.types';
import { PrismaService } from '../../../prisma/prisma.service';
import { WorkItemTypeRegistryService } from '../work-item-type-registry.service';
import { createWarmWorkItemTypeRegistry } from '../../../../test/setup/work-item-type-registry.fixture';
import * as TestUtils from '../../../utils/testUtils';
import { OrganizationId, ProjectId, TaskId, UserId } from '../../../types';

const ORG_ID = '00000000-0000-4000-8000-000000000001' as OrganizationId;
const PROJECT_ID = '00000000-0000-4000-8000-000000000002' as ProjectId;
const TASK_ID = '00000000-0000-4000-8000-000000000010' as TaskId;
const SUCCESSOR_ID = '00000000-0000-4000-8000-000000000020';
const USER_ID = '00000000-0000-4000-8000-000000000030' as UserId;

const REQUESTOR_CONTEXT = {
  userId: USER_ID,
  organizationId: ORG_ID,
  toolName: 'POST /tasks/:taskId/supersede',
  timestamp: '2026-05-20T00:00:00.000Z',
  source: 'user',
} as unknown as RequestorContext;

function makeTask(
  overrides: Partial<{ type: WorkItemTypeKey; status: WorkStatus }> = {},
) {
  return {
    id: TASK_ID,
    name: 'Original login flow',
    type: WORK_ITEM_TYPE_KEYS.Standard,
    status: WorkStatus.ACTIVE,
    ...overrides,
  };
}

function makeSuccessor() {
  return { id: SUCCESSOR_ID, name: 'Rebuilt login flow' };
}

function makeProposal(
  overrides: Partial<TypedProposalResponse> = {},
): TypedProposalResponse {
  return {
    id: '00000000-0000-4000-8000-000000000050',
    status: 'DRAFT',
    ...overrides,
  } as unknown as TypedProposalResponse;
}

describe('TaskSupersedeService', () => {
  let service: TaskSupersedeService;
  let prisma: ReturnType<typeof TestUtils.createMockPrismaService>;
  let taskService: jest.Mocked<Pick<TaskService, 'findOneByOrganization'>>;
  let proposalService: jest.Mocked<Pick<ProposalService, 'create'>>;

  beforeEach(async () => {
    prisma = TestUtils.createMockPrismaService();
    taskService = {
      findOneByOrganization: jest.fn(),
    } as unknown as jest.Mocked<Pick<TaskService, 'findOneByOrganization'>>;
    proposalService = {
      create: jest.fn(),
    } as unknown as jest.Mocked<Pick<ProposalService, 'create'>>;
    const registry = await createWarmWorkItemTypeRegistry();
    service = new TaskSupersedeService(
      prisma as unknown as PrismaService,
      taskService as unknown as TaskService,
      proposalService as unknown as ProposalService,
      registry as unknown as WorkItemTypeRegistryService,
    );
  });

  const supersede = (successorTaskId = SUCCESSOR_ID) =>
    service.supersedeTask(
      ORG_ID,
      PROJECT_ID,
      TASK_ID,
      { successorTaskId },
      USER_ID,
      REQUESTOR_CONTEXT,
    );

  it('rejects when no successor is supplied', async () => {
    await expect(supersede('')).rejects.toBeInstanceOf(BadRequestException);
    expect(proposalService.create).not.toHaveBeenCalled();
  });

  it('rejects when the successor is the task itself', async () => {
    await expect(supersede(TASK_ID)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(proposalService.create).not.toHaveBeenCalled();
  });

  it('throws NotFoundException when the task is missing', async () => {
    (prisma.db.task.findFirst as jest.Mock).mockResolvedValueOnce(null);

    await expect(supersede()).rejects.toBeInstanceOf(NotFoundException);
    expect(proposalService.create).not.toHaveBeenCalled();
  });

  it('rejects a task that is already superseded', async () => {
    (prisma.db.task.findFirst as jest.Mock).mockResolvedValueOnce(
      makeTask({ status: WorkStatus.SUPERSEDED }),
    );

    await expect(supersede()).rejects.toBeInstanceOf(BadRequestException);
    expect(proposalService.create).not.toHaveBeenCalled();
  });

  it.each([[WORK_ITEM_TYPE_KEYS.Bug], [WORK_ITEM_TYPE_KEYS.Goal]])(
    'rejects %s tasks — the type disallows SUPERSEDED',
    async (type) => {
      (prisma.db.task.findFirst as jest.Mock).mockResolvedValueOnce(
        makeTask({ type }),
      );

      await expect(supersede()).rejects.toBeInstanceOf(BadRequestException);
      expect(proposalService.create).not.toHaveBeenCalled();
    },
  );

  it('throws NotFoundException when the successor is missing', async () => {
    (prisma.db.task.findFirst as jest.Mock)
      .mockResolvedValueOnce(makeTask())
      .mockResolvedValueOnce(null);

    await expect(supersede()).rejects.toBeInstanceOf(NotFoundException);
    expect(proposalService.create).not.toHaveBeenCalled();
  });

  it.each([[WORK_ITEM_TYPE_KEYS.Standard], [WORK_ITEM_TYPE_KEYS.Feature]])(
    'supersedes a %s task: authors a proposal pairing the status change with the SUPERSEDES edge',
    async (type) => {
      (prisma.db.task.findFirst as jest.Mock)
        .mockResolvedValueOnce(makeTask({ type }))
        .mockResolvedValueOnce(makeSuccessor());
      proposalService.create.mockResolvedValue(makeProposal());
      taskService.findOneByOrganization.mockResolvedValue({
        id: TASK_ID,
        status: WorkStatus.ACTIVE,
      } as unknown as TaskResponseDto);

      await supersede();

      expect(proposalService.create).toHaveBeenCalledTimes(1);
      const [org, project, userId, dto] = proposalService.create.mock.calls[0]!;
      expect(org).toBe(ORG_ID);
      expect(project).toBe(PROJECT_ID);
      expect(userId).toBe(USER_ID);
      expect(dto.action).toBe('UPDATE');
      expect(dto.targetEntityType).toBe('TASK');
      expect(dto.targetEntityId).toBe(TASK_ID);
      expect(dto.updates).toEqual({ status: WorkStatus.SUPERSEDED });
      // The status change and the SUPERSEDES edge travel on one proposal.
      expect(dto.edges).toEqual([
        expect.objectContaining({
          targetEntityId: SUCCESSOR_ID,
          targetEntityType: 'TASK',
          edgeType: 'SUPERSEDES',
        }),
      ]);
    },
  );

  it('returns APPLIED when the proposal auto-applied', async () => {
    (prisma.db.task.findFirst as jest.Mock)
      .mockResolvedValueOnce(makeTask())
      .mockResolvedValueOnce(makeSuccessor());
    proposalService.create.mockResolvedValue(
      makeProposal({ status: 'APPROVED' } as Partial<TypedProposalResponse>),
    );
    taskService.findOneByOrganization.mockResolvedValue({
      id: TASK_ID,
      status: WorkStatus.SUPERSEDED,
    } as unknown as TaskResponseDto);

    const result = await supersede();

    expect(result.status).toBe('APPLIED');
    expect(result.task.status).toBe(WorkStatus.SUPERSEDED);
    expect(result.proposal).toBeUndefined();
  });

  it('returns PENDING with the proposal when it awaits review', async () => {
    (prisma.db.task.findFirst as jest.Mock)
      .mockResolvedValueOnce(makeTask())
      .mockResolvedValueOnce(makeSuccessor());
    const proposal = makeProposal({
      status: 'DRAFT',
    } as Partial<TypedProposalResponse>);
    proposalService.create.mockResolvedValue(proposal);
    taskService.findOneByOrganization.mockResolvedValue({
      id: TASK_ID,
      status: WorkStatus.ACTIVE,
    } as unknown as TaskResponseDto);

    const result = await supersede();

    expect(result.status).toBe('PENDING');
    expect(result.task.status).toBe(WorkStatus.ACTIVE);
    expect(result.proposal).toBe(proposal);
  });
});
