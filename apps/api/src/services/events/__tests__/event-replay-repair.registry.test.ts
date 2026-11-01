import { ReportType } from '../../../generated';
import { SCHEMAS, attemptFix } from '../event-replay-repair.registry';

function reportCreatedPayload(reportType: string) {
  return {
    payloadType: 'report.created',
    shouldProcess: true,
    organizationId: 'org-1',
    report: {
      id: 'report-1',
      organizationId: 'org-1',
      projectId: 'project-1',
      reportType,
      audience: 'PROJECT_VISIBLE',
      title: 'Replayed report',
      payload: {},
      version: 1,
      schemaVersion: 1,
      createdAt: '2026-10-15T00:00:00.000Z',
      expiresAt: '2026-11-15T00:00:00.000Z',
      entities: [],
    },
  };
}

describe('report.created replay schema', () => {
  it('restores persisted exclusion when an older report event lacks its flags', async () => {
    const raw = reportCreatedPayload('SNAPSHOT');
    const validation = SCHEMAS['report.created']!.safeParse({
      ...raw,
      shouldProcess: undefined,
    });
    if (validation.success) throw new Error('Fixture must need replay repair.');
    const repaired = await attemptFix(
      {
        report: {
          findUnique: jest.fn().mockResolvedValue({ ragEnabled: false }),
        },
      },
      { eventType: 'report.created', aggregateId: raw.report.id },
      { ...raw, shouldProcess: undefined },
      validation.error,
    );
    expect(repaired).toMatchObject({
      shouldProcess: false,
      report: { ragEnabled: false },
    });
    expect(SCHEMAS['report.created']!.safeParse(repaired).success).toBe(true);
  });

  it('accepts retained excluded reports without expiration', () => {
    const raw = reportCreatedPayload('SNAPSHOT');
    expect(
      SCHEMAS['report.created']!.safeParse({
        ...raw,
        shouldProcess: false,
        report: { ...raw.report, ragEnabled: false, expiresAt: null },
      }).success,
    ).toBe(true);
  });

  it.each(Object.values(ReportType))('accepts report type %s', (reportType) => {
    expect(
      SCHEMAS['report.created']!.safeParse(reportCreatedPayload(reportType))
        .success,
    ).toBe(true);
  });

  it('rejects a report type outside the generated contract', () => {
    expect(
      SCHEMAS['report.created']!.safeParse(
        reportCreatedPayload('NOT_A_REPORT_TYPE'),
      ).success,
    ).toBe(false);
  });
});
