import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { ProposalVoteService } from '../proposal-vote.service';
import * as TestUtils from '../../../utils/testUtils';
import { Prisma } from '@prisma/client';
import type { ProposalId, UserId } from '../../../types';

const { testIds } = TestUtils;

const proposalId = '123e4567-e89b-42d3-a456-426614174099' as ProposalId;
const secondUserId = '123e4567-e89b-42d3-a456-426614174200' as UserId;

function makeApprovalRecord(overrides?: Record<string, unknown>) {
  return {
    id: '123e4567-e89b-42d3-a456-426614174300',
    proposalId,
    userId: testIds.user,
    type: 'APPROVAL',
    reason: null,
    createdAt: new Date('2026-04-14T00:00:00Z'),
    ...overrides,
  };
}

describe('ProposalVoteService', () => {
  let service: ProposalVoteService;
  let mockPrisma: ReturnType<typeof TestUtils.createMockPrismaService>;

  beforeEach(async () => {
    mockPrisma = TestUtils.createMockPrismaService();
    (mockPrisma.db as any).proposalApprovalRecord = {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProposalVoteService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get(ProposalVoteService);
  });

  describe('recordApproval', () => {
    beforeEach(() => {
      (mockPrisma.db.proposal.findFirst as jest.Mock).mockResolvedValue({
        id: proposalId,
        applicationEligible: true,
      });
    });

    it('throws NotFoundException when the proposal is outside the organization', async () => {
      (mockPrisma.db.proposal.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.recordApproval(proposalId, testIds.user, testIds.organization),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrisma.db.proposal.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: proposalId, organizationId: testIds.organization },
        }),
      );
      expect(
        (mockPrisma.db as any).proposalApprovalRecord.create,
      ).not.toHaveBeenCalled();
    });

    it('inserts an APPROVAL row and returns it', async () => {
      const record = makeApprovalRecord();
      (mockPrisma.db as any).proposalApprovalRecord.create.mockResolvedValue(
        record,
      );

      const result = await service.recordApproval(
        proposalId,
        testIds.user,
        testIds.organization,
      );

      expect(result).toEqual(record);
      expect(
        (mockPrisma.db as any).proposalApprovalRecord.create,
      ).toHaveBeenCalledWith({
        data: {
          proposalId,
          userId: testIds.user,
          type: 'APPROVAL',
        },
      });
    });

    it('throws ConflictException when user already voted', async () => {
      const uniqueError = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed',
        { code: 'P2002', clientVersion: '5.0.0' },
      );
      (mockPrisma.db as any).proposalApprovalRecord.create.mockRejectedValue(
        uniqueError,
      );

      await expect(
        service.recordApproval(proposalId, testIds.user, testIds.organization),
      ).rejects.toThrow(ConflictException);
    });

    it('throws NotFoundException when proposal or user does not exist', async () => {
      const fkError = new Prisma.PrismaClientKnownRequestError(
        'Foreign key constraint failed',
        { code: 'P2003', clientVersion: '5.0.0' },
      );
      (mockPrisma.db as any).proposalApprovalRecord.create.mockRejectedValue(
        fkError,
      );

      await expect(
        service.recordApproval(proposalId, testIds.user, testIds.organization),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('recordRejection', () => {
    it('inserts a REJECTION row with reason', async () => {
      const record = makeApprovalRecord({
        type: 'REJECTION',
        reason: 'Needs revision',
      });
      (mockPrisma.db as any).proposalApprovalRecord.create.mockResolvedValue(
        record,
      );

      const result = await service.recordRejection(
        proposalId,
        testIds.user,
        'Needs revision',
      );

      expect(result).toEqual(record);
      expect(
        (mockPrisma.db as any).proposalApprovalRecord.create,
      ).toHaveBeenCalledWith({
        data: {
          proposalId,
          userId: testIds.user,
          type: 'REJECTION',
          reason: 'Needs revision',
        },
      });
    });

    it('throws BadRequestException when reason is empty', async () => {
      await expect(
        service.recordRejection(proposalId, testIds.user, ''),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when reason is whitespace', async () => {
      await expect(
        service.recordRejection(proposalId, testIds.user, '   '),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws ConflictException when user already voted', async () => {
      const uniqueError = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed',
        { code: 'P2002', clientVersion: '5.0.0' },
      );
      (mockPrisma.db as any).proposalApprovalRecord.create.mockRejectedValue(
        uniqueError,
      );

      await expect(
        service.recordRejection(proposalId, testIds.user, 'Bad approach'),
      ).rejects.toThrow(ConflictException);
    });

    it('throws NotFoundException when proposal or user does not exist', async () => {
      const fkError = new Prisma.PrismaClientKnownRequestError(
        'Foreign key constraint failed',
        { code: 'P2003', clientVersion: '5.0.0' },
      );
      (mockPrisma.db as any).proposalApprovalRecord.create.mockRejectedValue(
        fkError,
      );

      await expect(
        service.recordRejection(proposalId, testIds.user, 'Bad approach'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getApprovals', () => {
    it('returns all approval/rejection rows for a proposal', async () => {
      const records = [
        makeApprovalRecord(),
        makeApprovalRecord({
          id: '123e4567-e89b-42d3-a456-426614174301',
          userId: secondUserId,
          type: 'REJECTION',
          reason: 'Disagree',
        }),
      ];
      (mockPrisma.db as any).proposalApprovalRecord.findMany.mockResolvedValue(
        records,
      );

      const result = await service.getApprovals(proposalId);

      expect(result).toEqual(records);
      expect(
        (mockPrisma.db as any).proposalApprovalRecord.findMany,
      ).toHaveBeenCalledWith({
        where: { proposalId },
        orderBy: { createdAt: 'asc' },
      });
    });
  });

  describe('getApprovalCount', () => {
    it('counts only APPROVAL rows, not rejections', async () => {
      (mockPrisma.db as any).proposalApprovalRecord.count.mockResolvedValue(2);

      const result = await service.getApprovalCount(proposalId);

      expect(result).toBe(2);
      expect(
        (mockPrisma.db as any).proposalApprovalRecord.count,
      ).toHaveBeenCalledWith({
        where: {
          proposalId,
          type: 'APPROVAL',
        },
      });
    });
  });
});
