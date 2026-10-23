import { Test } from '@nestjs/testing';
import { PrismaService } from 'src/prisma/prisma.service';
import { ProposalApprovalService } from '../proposal-approval.service';
import { ProposalGroupCoordinatorService } from '../proposal-group-coordinator.service';
import { ProposalGroupLifecycleEventService } from '../proposal-group-lifecycle-event.service';

describe('proposal group dependency injection', () => {
  it('resolves the coordinator approval dependency across the service cycle', async () => {
    const approvalService = { enactGroupedMember: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      providers: [
        ProposalGroupCoordinatorService,
        { provide: PrismaService, useValue: { db: {} } },
        { provide: ProposalApprovalService, useValue: approvalService },
        { provide: ProposalGroupLifecycleEventService, useValue: {} },
      ],
    }).compile();

    expect(moduleRef.get(ProposalGroupCoordinatorService)).toBeInstanceOf(
      ProposalGroupCoordinatorService,
    );
  });
});
