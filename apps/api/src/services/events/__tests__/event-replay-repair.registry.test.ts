import { ReportType } from '../../../generated';
import { SCHEMAS } from '../event-replay-repair.registry';

function reportCreatedPayload(reportType: string) {
  return {
    payloadType: 'report.created',
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
