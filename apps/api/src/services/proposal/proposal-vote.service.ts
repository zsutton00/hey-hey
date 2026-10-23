import { assertProposalApplicationEligible } from './proposal-application-eligibility';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ProposalApprovalType } from '@prisma/client';
import type { ProposalApprovalRecord } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import type { OrganizationId, ProposalId, UserId } from 'src/types';

@Injectable()
export class ProposalVoteService {
  private readonly logger = new Logger(ProposalVoteService.name);

  constructor(private readonly prisma: PrismaService) {}

  async recordApproval(
    proposalId: ProposalId,
    userId: UserId,
    organizationId: OrganizationId,
  ): Promise<ProposalApprovalRecord> {
    this.logger.log('Recording approval', {
      proposalId,
      userId,
      organizationId,
    });

    const proposal = await this.prisma.db.proposal.findFirst({
      where: { id: proposalId, organizationId },
      select: { id: true, applicationEligible: true },
    });
    if (!proposal) {
      throw new NotFoundException('Proposal not found');
    }
    assertProposalApplicationEligible(proposal, 'vote.recordApproval');

    const record = await this.createRecord({
      proposalId,
      userId,
      type: ProposalApprovalType.APPROVAL,
    });

    this.logger.log('Approval recorded', {
      id: record.id,
      proposalId,
      userId,
    });

    return record;
  }

  async recordRejection(
    proposalId: ProposalId,
    userId: UserId,
    reason: string,
  ): Promise<ProposalApprovalRecord> {
    if (!reason?.trim()) {
      throw new BadRequestException('A reason is required when rejecting');
    }

    this.logger.log('Recording rejection', { proposalId, userId });

    const record = await this.createRecord({
      proposalId,
      userId,
      type: ProposalApprovalType.REJECTION,
      reason: reason.trim(),
    });

    this.logger.log('Rejection recorded', {
      id: record.id,
      proposalId,
      userId,
    });

    return record;
  }

  async getApprovals(
    proposalId: ProposalId,
  ): Promise<ProposalApprovalRecord[]> {
    this.logger.debug('Fetching approvals', { proposalId });

    return this.prisma.db.proposalApprovalRecord.findMany({
      where: { proposalId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async getApprovalCount(proposalId: ProposalId): Promise<number> {
    this.logger.debug('Counting approvals', { proposalId });

    return this.prisma.db.proposalApprovalRecord.count({
      where: {
        proposalId,
        type: ProposalApprovalType.APPROVAL,
      },
    });
  }

  private async createRecord(
    data: Prisma.ProposalApprovalRecordUncheckedCreateInput,
  ): Promise<ProposalApprovalRecord> {
    try {
      return await this.prisma.db.proposalApprovalRecord.create({ data });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          this.logger.warn('User already voted on proposal', {
            proposalId: data.proposalId,
            userId: data.userId,
          });
          throw new ConflictException(
            'User has already recorded a decision on this proposal',
          );
        }
        if (error.code === 'P2003') {
          this.logger.warn('Proposal or user not found', {
            proposalId: data.proposalId,
            userId: data.userId,
          });
          throw new NotFoundException('Proposal or user not found');
        }
      }
      throw error;
    }
  }
}
