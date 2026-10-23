import { ReportAudience as PrismaReportAudience } from '@prisma/client';
import { ReportAudience } from 'src/generated';
import {
  toReportAudience,
  USER_VISIBLE_PERSISTED_REPORT_AUDIENCES,
} from '../report-audience';

describe('report audience contract', () => {
  it.each([
    [PrismaReportAudience.WORKFLOW_ONLY, ReportAudience.WorkflowOnly],
    [PrismaReportAudience.PROJECT_VISIBLE, ReportAudience.ProjectVisible],
    [
      PrismaReportAudience.ORGANIZATION_VISIBLE,
      ReportAudience.OrganizationVisible,
    ],
  ])('maps persisted %s to canonical %s', (persisted, canonical) => {
    expect(toReportAudience(persisted)).toBe(canonical);
  });

  it('keeps only canonical visible scopes user-facing', () => {
    expect(USER_VISIBLE_PERSISTED_REPORT_AUDIENCES).toEqual([
      PrismaReportAudience.PROJECT_VISIBLE,
      PrismaReportAudience.ORGANIZATION_VISIBLE,
    ]);
  });
});
