import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from 'src/prisma/prisma.service';
import { ReportBugService } from '../report-bug.service';
import type { TaskService } from '../tasks/task.service';
import type { UserId } from 'src/types';

describe('ReportBugService', () => {
  const destination = {
    REPORT_BUG_ORGANIZATION_ID: '11111111-1111-4111-8111-111111111111',
    REPORT_BUG_PROJECT_ID: '22222222-2222-4222-8222-222222222222',
    REPORT_BUG_PARENT_FEATURE_ID: '33333333-3333-4333-8333-333333333333',
  };
  const userId = '55555555-5555-4555-8555-555555555555' as UserId;

  const tx = {
    organization: { findFirst: jest.fn() },
    project: { findFirst: jest.fn() },
    task: { findFirst: jest.fn() },
    bugReportIntakeContext: { create: jest.fn() },
  };
  const prisma = {
    $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) =>
      callback(tx),
    ),
  };
  const config = {
    get: jest.fn(
      (key: keyof typeof destination): string | undefined => destination[key],
    ),
  };
  const taskService = { createInTransaction: jest.fn() };

  let service: ReportBugService;

  beforeEach(() => {
    jest.clearAllMocks();
    config.get.mockImplementation(
      (key: keyof typeof destination) => destination[key],
    );
    tx.organization.findFirst.mockResolvedValue({
      id: destination.REPORT_BUG_ORGANIZATION_ID,
    });
    tx.project.findFirst.mockResolvedValue({
      id: destination.REPORT_BUG_PROJECT_ID,
    });
    tx.task.findFirst.mockResolvedValue({
      id: destination.REPORT_BUG_PARENT_FEATURE_ID,
    });
    taskService.createInTransaction.mockResolvedValue({
      id: '44444444-4444-4444-8444-444444444444',
    });
    tx.bugReportIntakeContext.create.mockResolvedValue({ id: 'context-id' });

    service = new ReportBugService(
      prisma as unknown as PrismaService,
      config as unknown as ConfigService,
      taskService as unknown as TaskService,
    );
  });

  it('atomically creates a parented BUG and separately persists consented context', async () => {
    await expect(
      service.reportBug(
        {
          description: '  Saving a feature fails.  ',
          productLocation: '/projects/project-1/features/feature-1?tab=details',
          correlationId: '  correlation-123  ',
          diagnosticConsent: true,
        },
        userId,
      ),
    ).resolves.toEqual({
      bugId: '44444444-4444-4444-8444-444444444444',
    });

    expect(taskService.createInTransaction).toHaveBeenCalledWith(
      tx,
      destination.REPORT_BUG_ORGANIZATION_ID,
      null,
      expect.objectContaining({
        type: 'BUG',
        parentTaskId: destination.REPORT_BUG_PARENT_FEATURE_ID,
        source: 'user',
        sections: [{ key: 'description', content: 'Saving a feature fails.' }],
      }),
      destination.REPORT_BUG_PROJECT_ID,
    );
    expect(tx.bugReportIntakeContext.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        bugTaskId: '44444444-4444-4444-8444-444444444444',
        reportedByUserId: '55555555-5555-4555-8555-555555555555',
        productLocation: '/projects/project-1/features/feature-1?tab=details',
        correlationId: 'correlation-123',
        diagnosticConsentAt: expect.any(Date),
      }),
    });
  });

  it.each([
    {
      description: '   ',
      productLocation: '/projects',
      diagnosticConsent: true,
    },
    {
      description: 'Broken',
      productLocation: '   ',
      diagnosticConsent: true,
    },
    {
      description: 'Broken',
      productLocation: '/projects',
      diagnosticConsent: false,
    },
  ])('rejects invalid reports before creating a BUG', async (input) => {
    await expect(service.reportBug(input, userId)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('fails visibly when the configured destination is incomplete', async () => {
    config.get.mockReturnValue(undefined);

    await expect(
      service.reportBug(
        {
          description: 'Broken',
          productLocation: '/projects',
          diagnosticConsent: true,
        },
        userId,
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(taskService.createInTransaction).not.toHaveBeenCalled();
  });

  it('does not create an orphan when the destination feature is unavailable', async () => {
    tx.task.findFirst.mockResolvedValue(null);

    await expect(
      service.reportBug(
        {
          description: 'Broken',
          productLocation: '/projects',
          diagnosticConsent: true,
        },
        userId,
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(taskService.createInTransaction).not.toHaveBeenCalled();
    expect(tx.bugReportIntakeContext.create).not.toHaveBeenCalled();
  });
});
