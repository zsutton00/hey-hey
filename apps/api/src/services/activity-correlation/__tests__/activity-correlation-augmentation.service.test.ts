import { ActivityCorrelationLinkType, EntityType } from 'src/generated';
import { DEFAULT_AGENT_SESSION_TITLE } from 'src/services/agent-session-title';
import { ActivityCorrelationAugmentationService } from 'src/services/activity-correlation/activity-correlation-augmentation.service';
import { RecentActivityCorrelationRecordDraft } from 'src/services/activity-correlation/activity-correlation.types';
import { ReportService } from 'src/services/reports/report.service';
import { createMockPrismaService } from 'src/utils/testUtils';

describe('ActivityCorrelationAugmentationService', () => {
  const organizationId = 'org-1' as any;
  let prisma: ReturnType<typeof createMockPrismaService>;
  let reportService: Pick<ReportService, 'getReportTitle'>;
  let service: ActivityCorrelationAugmentationService;

  beforeEach(() => {
    prisma = createMockPrismaService();
    reportService = {
      getReportTitle: jest.fn(),
    };
    service = new ActivityCorrelationAugmentationService(
      prisma as any,
      reportService as any,
    );

    (prisma.db.entityRegistry.findMany as jest.Mock).mockResolvedValue([]);
  });

  it('falls back to a generic root title for blank agent-session titles', async () => {
    (prisma.db.agentSession.findMany as jest.Mock)
      .mockResolvedValueOnce([{ id: 'session-1', title: '   ' }])
      .mockResolvedValueOnce([]);

    const records = [
      {
        entityId: 'session-1',
        entityType: EntityType.AgentSession,
        timestamp: '2026-07-06T08:00:00.000Z',
        conversationId: null,
        status: 'IN_PROGRESS',
        linkedEntities: [],
        reportIds: [],
        reports: [],
      },
    ] satisfies RecentActivityCorrelationRecordDraft[];

    const result = await service.augmentRecentRecords(
      organizationId,
      records,
      new Map(),
      new Map(),
      new Map(),
    );

    expect(result[0]).toMatchObject({
      entityId: 'session-1',
      entityType: EntityType.AgentSession,
      title: DEFAULT_AGENT_SESSION_TITLE,
      conversationId: null,
      lastMessage: null,
    });
  });

  it('falls back to a generic linked title for blank agent-session titles', async () => {
    (prisma.db.task.findMany as jest.Mock).mockResolvedValue([
      { id: 'task-1', name: 'Root task' },
    ]);
    (prisma.db.agentSession.findMany as jest.Mock)
      .mockResolvedValueOnce([{ id: 'session-1', title: '' }])
      .mockResolvedValueOnce([]);

    const records = [
      {
        entityId: 'task-1',
        entityType: EntityType.Task,
        timestamp: '2026-07-06T08:00:00.000Z',
        status: 'COMPLETED',
        linkedEntities: [
          {
            entityId: 'session-1',
            entityType: EntityType.AgentSession,
            linkType: ActivityCorrelationLinkType.Related,
            status: 'IN_PROGRESS',
          },
        ],
        reportIds: [],
        reports: [],
      },
    ] satisfies RecentActivityCorrelationRecordDraft[];

    const result = await service.augmentRecentRecords(
      organizationId,
      records,
      new Map(),
      new Map(),
      new Map(),
    );

    const record = result[0];
    if (!record) {
      throw new Error('Expected one activity correlation record');
    }
    const linkedEntity = record.linkedEntities[0];
    if (!linkedEntity) {
      throw new Error('Expected one linked entity');
    }

    expect(record.title).toBe('Root task');
    expect(linkedEntity).toMatchObject({
      entityId: 'session-1',
      entityType: EntityType.AgentSession,
      title: DEFAULT_AGENT_SESSION_TITLE,
      conversationId: null,
      lastMessage: null,
    });
  });

  it('still rejects missing non-agent titles', async () => {
    const records = [
      {
        entityId: 'task-1',
        entityType: EntityType.Task,
        timestamp: '2026-07-06T08:00:00.000Z',
        status: 'COMPLETED',
        linkedEntities: [],
        reportIds: [],
        reports: [],
      },
    ] satisfies RecentActivityCorrelationRecordDraft[];

    await expect(
      service.augmentRecentRecords(
        organizationId,
        records,
        new Map([['TASK:task-1', '']]),
        new Map(),
        new Map(),
      ),
    ).rejects.toThrow(
      'Missing required activity correlation title for TASK:task-1',
    );
  });
});
