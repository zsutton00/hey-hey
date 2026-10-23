import { BadRequestException, ConflictException } from '@nestjs/common';
import { EntityType, type CreateProjectReportRequestDto } from 'src/generated';
import type { OrganizationId, ProjectId, UserId } from 'src/types';
import { ProjectReportActivityService } from '../project-report-activity.service';
import { ProjectReportContextService } from '../project-report-context.service';
import { ProjectReportPlacementService } from '../project-report-placement.service';

const projectId = '22222222-2222-4222-8222-222222222222';
const included = {
  entityType: EntityType.Task,
  entityId: '11111111-1111-4111-8111-111111111111',
};
const second = {
  entityType: EntityType.DesignDoc,
  entityId: '77777777-7777-4777-8777-777777777777',
};
const unselected = {
  entityType: EntityType.Task,
  entityId: '88888888-8888-4888-8888-888888888888',
};
const excluded = {
  entityType: EntityType.Task,
  entityId: '33333333-3333-4333-8333-333333333333',
};
const submission = {
  question: 'What changed?',
  scope: {
    projectId,
    windowStart: '2026-09-20T00:00:00Z',
    windowEnd: '2026-09-29T00:00:00Z',
    timeZone: 'UTC',
  },
  exclusions: [excluded],
  launch: {
    machineId: '44444444-4444-4444-8444-444444444444',
    provider: 'codex',
    model: 'model',
    effort: 'high',
  },
  idempotencyKey: 'key',
} satisfies CreateProjectReportRequestDto;

describe('ProjectReportContextService', () => {
  const activity = { select: jest.fn() };
  const placement = { resolve: jest.fn() };
  const service = new ProjectReportContextService(
    activity as unknown as ProjectReportActivityService,
    placement as unknown as ProjectReportPlacementService,
  );
  const input = {
    organizationId: '55555555-5555-4555-8555-555555555555' as OrganizationId,
    projectId: projectId as ProjectId,
    userId: '66666666-6666-4666-8666-666666666666' as UserId,
    requestId: 'request',
    attemptId: 'attempt',
    submission,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    activity.select.mockResolvedValue({
      subjects: [
        { subject: included, excluded: false },
        { subject: second, excluded: false },
        { subject: excluded, excluded: true },
      ],
      records: [
        {
          ...included,
          title: 'Current included title',
          status: 'IN_PROGRESS',
          updatedAt: '2026-09-29T12:00:00Z',
          linkedEntities: [excluded],
        },
        {
          ...second,
          title: 'Design doc',
          linkedEntities: [],
        },
      ],
    });
    placement.resolve.mockImplementation(
      ({
        subjects,
      }: {
        subjects: { entityType: string; entityId: string }[];
      }) =>
        Promise.resolve(
          new Map(
            subjects.map((subject) => [
              `${subject.entityType}:${subject.entityId}`,
              { features: [{ id: subject.entityId, title: 'Feature' }] },
            ]),
          ),
        ),
    );
  });

  it('labels current state separately and keeps excluded links as context only', async () => {
    const page = await service.read({ ...input, subject: included });
    expect(page).toMatchObject({
      subject: included,
      kind: 'CURRENT_STATE_CONTEXT',
      title: 'Current included title',
      relatedSubjects: [excluded],
    });
    expect(page.relatedSubjects).toHaveLength(1);
  });

  it('refuses an excluded subject as the context anchor', async () => {
    await expect(service.read({ ...input, subject: excluded })).rejects.toThrow(
      ConflictException,
    );
  });

  describe('readBatch', () => {
    it('selects once and returns each subject with the single-read context and its placement, in request order', async () => {
      const batch = await service.readBatch({
        ...input,
        subjects: [second, included],
      });
      expect(activity.select).toHaveBeenCalledTimes(1);
      expect(placement.resolve).toHaveBeenCalledTimes(1);
      const single = await service.read({ ...input, subject: included });
      expect(batch).toMatchObject({
        requestId: 'request',
        attemptId: 'attempt',
        items: [
          {
            context: { subject: second, title: 'Design doc' },
            placement: { features: [{ id: second.entityId }] },
          },
          {
            context: { ...single, queriedAt: batch.queriedAt },
            placement: { features: [{ id: included.entityId }] },
          },
        ],
      });
    });

    it.each([
      ['excluded', excluded],
      ['unselected', unselected],
    ])(
      'rejects the whole batch with 409 for an %s subject',
      async (_, subject) => {
        await expect(
          service.readBatch({ ...input, subjects: [included, subject] }),
        ).rejects.toThrow(ConflictException);
        expect(placement.resolve).not.toHaveBeenCalled();
      },
    );

    it('rejects empty, oversized, and duplicate batches before selecting', async () => {
      const many = Array.from({ length: 101 }, (_, index) => ({
        entityType: EntityType.Task,
        entityId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      }));
      for (const subjects of [[], many, [included, { ...included }]]) {
        await expect(service.readBatch({ ...input, subjects })).rejects.toThrow(
          BadRequestException,
        );
      }
      expect(activity.select).not.toHaveBeenCalled();
    });
  });
});
