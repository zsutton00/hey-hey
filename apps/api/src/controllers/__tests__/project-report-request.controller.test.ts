import { ProjectReportRequestController } from '../project-report-request.controller';
import { projectReportRequest } from 'src/services/reports/__tests__/project-report.fixture';
import { ProjectReportRequestService } from 'src/services/project-reports/project-report-request.service';
import { ProjectReportActivityService } from 'src/services/project-reports/project-report-activity.service';
import { ProjectReportContextService } from 'src/services/project-reports/project-report-context.service';
import { ProjectReportLaunchService } from 'src/services/project-reports/project-report-launch.service';
import type { OrganizationId, ProjectId, UserId } from 'src/types';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { EntityType } from 'src/generated';
import { ProjectReportContextBatchPipe } from '../project-report-request.validation';

describe('ProjectReportRequestController', () => {
  const request = { id: '11111111-1111-4111-8111-111111111111' };
  const requests = {
    create: jest.fn(),
    get: jest.fn(),
    retry: jest.fn(),
    loadForAgentRead: jest.fn(),
    fail: jest.fn(),
  };
  const activity = { preview: jest.fn(), page: jest.fn() };
  const context = { read: jest.fn(), readBatch: jest.fn() };
  const launch = { prepare: jest.fn() };
  const controller = new ProjectReportRequestController(
    requests as unknown as ProjectReportRequestService,
    activity as unknown as ProjectReportActivityService,
    context as unknown as ProjectReportContextService,
    launch as unknown as ProjectReportLaunchService,
  );
  const organizationId =
    '22222222-2222-4222-8222-222222222222' as OrganizationId;
  const projectId = projectReportRequest.scope.projectId as ProjectId;
  const userId = '33333333-3333-4333-8333-333333333333' as UserId;

  beforeEach(() => {
    jest.clearAllMocks();
    requests.get.mockResolvedValue(request);
  });

  it.each(['activity', 'context'])(
    'returns %s read errors without failing the attempt',
    async (kind) => {
      requests.loadForAgentRead.mockResolvedValue({
        submission: projectReportRequest,
      });
      const error = new Error('temporarily unavailable');
      activity.page.mockRejectedValue(error);
      context.read.mockRejectedValue(error);
      const args = [
        organizationId,
        projectId,
        userId,
        request.id,
        '44444444-4444-4444-8444-444444444444',
        '55555555-5555-4555-8555-555555555555',
      ] as const;
      const read =
        kind === 'activity'
          ? controller.activityPage(...args, 50, 0)
          : controller.contextPage(...args, EntityType.Task, request.id);
      await expect(read).rejects.toBe(error);
      expect(requests.fail).not.toHaveBeenCalled();
    },
  );

  it('hands every same-key replay to launch preparation so an unprepared attempt resumes', async () => {
    const replayed = { ...request, attempts: [{ status: 'QUEUED' }] };
    requests.create
      .mockResolvedValueOnce(request)
      .mockResolvedValueOnce(replayed);
    await controller.create(
      organizationId,
      projectId,
      userId,
      projectReportRequest,
    );
    await controller.create(
      organizationId,
      projectId,
      userId,
      projectReportRequest,
    );
    expect(launch.prepare).toHaveBeenNthCalledWith(
      1,
      organizationId,
      projectId,
      userId,
      request,
    );
    expect(launch.prepare).toHaveBeenNthCalledWith(
      2,
      organizationId,
      projectId,
      userId,
      replayed,
    );
    expect(requests.get).toHaveBeenLastCalledWith(
      organizationId,
      projectId,
      userId,
      request.id,
    );
  });

  it('checks active request and session binding before returning evidence', async () => {
    requests.loadForAgentRead.mockResolvedValue({
      submission: projectReportRequest,
    });
    activity.page.mockResolvedValue({ records: [], total: 0 });
    await controller.activityPage(
      organizationId,
      projectId,
      userId,
      request.id,
      '44444444-4444-4444-8444-444444444444',
      '55555555-5555-4555-8555-555555555555',
      50,
      0,
    );
    expect(requests.loadForAgentRead).toHaveBeenCalledWith(
      organizationId,
      projectId,
      userId,
      request.id,
      '44444444-4444-4444-8444-444444444444',
      '55555555-5555-4555-8555-555555555555',
    );
    expect(activity.page).toHaveBeenCalledWith(
      organizationId,
      projectId,
      userId,
      request.id,
      '44444444-4444-4444-8444-444444444444',
      projectReportRequest,
      50,
      0,
    );
  });

  describe('contextBatch', () => {
    const attemptId = '44444444-4444-4444-8444-444444444444';
    const agentSessionId = '55555555-5555-4555-8555-555555555555';
    const subjects = [{ entityType: EntityType.Task, entityId: request.id }];
    const batch = () =>
      controller.contextBatch(
        organizationId,
        projectId,
        userId,
        request.id,
        agentSessionId,
        { attemptId, subjects },
      );

    it('binds the body attempt and header session exactly like the single read', async () => {
      requests.loadForAgentRead.mockResolvedValue({
        submission: projectReportRequest,
      });
      context.readBatch.mockResolvedValue({ items: [] });
      await batch();
      expect(requests.loadForAgentRead).toHaveBeenCalledWith(
        organizationId,
        projectId,
        userId,
        request.id,
        attemptId,
        agentSessionId,
      );
      expect(context.readBatch).toHaveBeenCalledWith({
        organizationId,
        projectId,
        userId,
        requestId: request.id,
        attemptId,
        submission: projectReportRequest,
        subjects,
      });
    });

    it.each([
      ['a stale attempt', new ConflictException('stale')],
      ['a session mismatch', new ConflictException('session')],
      ['revoked access', new ForbiddenException('revoked')],
      ['a missing request', new NotFoundException('missing')],
    ])('rejects %s before reading any subject', async (_, error) => {
      requests.loadForAgentRead.mockRejectedValue(error);
      await expect(batch()).rejects.toBe(error);
      expect(context.readBatch).not.toHaveBeenCalled();
    });

    it('validates 1–100 unique subjects at the boundary', () => {
      const pipe = new ProjectReportContextBatchPipe();
      const subject = (index: number) => ({
        entityType: EntityType.Task,
        entityId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      });
      const many = (count: number) =>
        Array.from({ length: count }, (_, index) => subject(index));
      expect(pipe.transform({ attemptId, subjects: many(100) })).toBeDefined();
      for (const invalid of [
        { attemptId, subjects: [] },
        { attemptId, subjects: many(101) },
        { attemptId, subjects: [subject(1), subject(1)] },
        { subjects: many(1) },
      ]) {
        expect(() => pipe.transform(invalid)).toThrow();
      }
    });
  });
});
