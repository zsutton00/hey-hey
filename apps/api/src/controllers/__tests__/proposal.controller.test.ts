import { ProjectAccessService } from '../../auth/services/project-access.service';
import { ProjectResourceAccessService } from '../../auth/services/project-resource-access.service';
import { Test, TestingModule } from '@nestjs/testing';
import type { Request } from 'express';
import { ProposalController } from '../proposal.controller';
import { ProposalService } from '../../services/proposal/proposal.service';
import { ProposalApprovalService } from '../../services/proposal/proposal-approval.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import type { OrganizationId, ProjectId, UserId } from '../../types';
import type { CreateProposalRequestDto } from '../../services/proposal/proposal.dto';
import {
  QueryProposalsDto,
  resolveProposalWindow,
} from '../../services/proposal/proposal.dto';
import { ProposalAction, WorkItemTypeRole } from '../../generated';
import { validate } from 'class-validator';

describe('ProposalController.create — requestor context boundary', () => {
  let controller: ProposalController;
  let proposalService: jest.Mocked<ProposalService>;

  const ORG_ID = '00000000-0000-4000-8000-000000000001' as OrganizationId;
  const USER_ID = '00000000-0000-4000-8000-000000000099' as UserId;
  const PROJECT_ID = '00000000-0000-4000-8000-0000000000aa' as ProjectId;

  const user: AuthenticatedUser = {
    userId: USER_ID,
    email: 'user@example.com',
    name: 'Test User',
    currentOrgId: ORG_ID,
    orgMemberships: [],
    isDevAdmin: false,
    devAdminMode: false,
  };

  function makeRequest(headers: Record<string, string> = {}): Request {
    return {
      headers: { 'user-agent': 'JestAgent/1.0', ...headers },
      ip: '10.0.0.1',
    } as unknown as Request;
  }

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProposalController],
      providers: [
        { provide: ProjectAccessService, useValue: { assertOrganization: jest.fn(), assertProject: jest.fn() } },
        { provide: ProjectResourceAccessService, useValue: { assertResource: jest.fn() } },
        {
          provide: ProposalService,
          useValue: {
            create: jest.fn().mockResolvedValue({ id: 'proposal-1' }),
            findMany: jest.fn().mockResolvedValue({
              data: [],
              total: 0,
              limit: 20,
              offset: 0,
            }),
          },
        },
        {
          provide: ProposalApprovalService,
          useValue: {
            reject: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get(ProposalController);
    proposalService = module.get(
      ProposalService,
    ) as jest.Mocked<ProposalService>;
  });

  it('stamps source: user even when the client tries to inject source: agent', async () => {
    const dto: CreateProposalRequestDto = {
      type: 'SINGLE',
      action: 'UPDATE',
      eli5: 'Updates the task name.',
      targetEntityId: '00000000-0000-4000-8000-0000000000bb',
      targetEntityType: 'TASK',
      updates: { name: 'New name' },
      requestorContext: {
        userId: 'attacker',
        organizationId: ORG_ID,
        toolName: 'forged_tool',
        timestamp: '2026-04-30T00:00:00.000Z',
        source: 'agent',
      },
    } as CreateProposalRequestDto;

    await controller.create(user, ORG_ID, PROJECT_ID, dto, makeRequest());

    expect(proposalService.create).toHaveBeenCalledTimes(1);
    const stampedDto = proposalService.create.mock
      .calls[0]![3] as CreateProposalRequestDto;
    const ctx = stampedDto.requestorContext as Record<string, unknown>;

    expect(ctx.source).toBe('user');
    expect(ctx.userId).toBe(USER_ID);
    expect(ctx.organizationId).toBe(ORG_ID);
    expect(ctx.toolName).toBe('POST /proposals');
  });

  it('stamps source: user when no requestorContext is supplied at all', async () => {
    const dto: CreateProposalRequestDto = {
      type: 'SINGLE',
      action: 'UPDATE',
      eli5: 'Updates the task name.',
      targetEntityId: '00000000-0000-4000-8000-0000000000bb',
      targetEntityType: 'TASK',
      updates: { name: 'New name' },
    } as CreateProposalRequestDto;

    await controller.create(user, ORG_ID, PROJECT_ID, dto, makeRequest());

    const stampedDto = proposalService.create.mock
      .calls[0]![3] as CreateProposalRequestDto;
    const ctx = stampedDto.requestorContext as Record<string, unknown>;

    expect(ctx.source).toBe('user');
    expect(ctx.userId).toBe(USER_ID);
  });

  it('passes through conversationId from X-Conversation-ID header', async () => {
    const dto: CreateProposalRequestDto = {
      type: 'SINGLE',
      action: 'UPDATE',
      eli5: 'Updates the task name.',
      targetEntityId: '00000000-0000-4000-8000-0000000000bb',
      targetEntityType: 'TASK',
      updates: { name: 'New name' },
    } as CreateProposalRequestDto;

    await controller.create(
      user,
      ORG_ID,
      PROJECT_ID,
      dto,
      makeRequest({ 'x-conversation-id': 'conv-42' }),
    );

    const stampedDto = proposalService.create.mock
      .calls[0]![3] as CreateProposalRequestDto;
    const ctx = stampedDto.requestorContext as Record<string, unknown>;

    expect(ctx.conversationId).toBe('conv-42');
    expect(ctx.source).toBe('user');
  });

  it('forwards the positive work-item role scope to proposal listing', async () => {
    const query = Object.assign(new QueryProposalsDto(), {
      action: ProposalAction.Create,
      workItemRole: WorkItemTypeRole.ProjectInfo,
      windowStart: '2026-09-15T00:00:00.000Z',
      windowEnd: '2026-09-16T00:00:00.000Z',
    });

    await controller.findMany(ORG_ID, PROJECT_ID, query);

    expect(proposalService.findMany).toHaveBeenCalledWith(
      ORG_ID,
      PROJECT_ID,
      query,
    );
  });
});

describe('QueryProposalsDto — proposal occurrence window', () => {
  it('requires window bounds as a pair', () => {
    expect(() =>
      resolveProposalWindow({ windowStart: '2026-09-13T00:00:00.000Z' }),
    ).toThrow('requires both windowStart and windowEnd');
  });

  it('rejects equal or reversed bounds', () => {
    expect(() =>
      resolveProposalWindow({
        windowStart: '2026-09-14T00:00:00.000Z',
        windowEnd: '2026-09-14T00:00:00.000Z',
      }),
    ).toThrow('windowStart must be before windowEnd');
    expect(() =>
      resolveProposalWindow({
        windowStart: '2026-09-15T00:00:00.000Z',
        windowEnd: '2026-09-14T00:00:00.000Z',
      }),
    ).toThrow('windowStart must be before windowEnd');
  });

  it('rejects malformed ISO date-time bounds through DTO validation', async () => {
    const query = Object.assign(new QueryProposalsDto(), {
      windowStart: 'not-a-date',
      windowEnd: '2026-09-14T00:00:00.000Z',
    });

    const errors = await validate(query);

    expect(errors.map(({ property }) => property)).toContain('windowStart');
  });

  it('rejects an unsupported work-item role through DTO validation', async () => {
    const query = Object.assign(new QueryProposalsDto(), {
      workItemRole: 'not-a-role',
    });

    const errors = await validate(query);

    expect(errors.map(({ property }) => property)).toContain('workItemRole');
  });

  it('normalizes a valid inclusive-start/exclusive-end window once', () => {
    expect(
      resolveProposalWindow({
        windowStart: '2026-09-13T00:00:00Z',
        windowEnd: '2026-09-14T00:00:00Z',
      }),
    ).toEqual({
      windowStart: new Date('2026-09-13T00:00:00.000Z'),
      windowEnd: new Date('2026-09-14T00:00:00.000Z'),
    });
  });
});
