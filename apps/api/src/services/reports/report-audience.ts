import { ReportAudience as PrismaReportAudience } from '@prisma/client';
import { ReportAudience } from 'src/generated';

export const USER_VISIBLE_PERSISTED_REPORT_AUDIENCES: PrismaReportAudience[] = [
  PrismaReportAudience.PROJECT_VISIBLE,
  PrismaReportAudience.ORGANIZATION_VISIBLE,
];

export const isUserVisiblePersistedReportAudience = (
  value: PrismaReportAudience | ReportAudience,
): boolean =>
  USER_VISIBLE_PERSISTED_REPORT_AUDIENCES.includes(
    value as PrismaReportAudience,
  );

export const toReportAudience = (value: PrismaReportAudience): ReportAudience =>
  value as ReportAudience;
