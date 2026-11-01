import { describe, expect, it } from 'vitest';
import { EntityType, type ProjectReportSubjectPlacement } from '../../shared/api/generated/api';
import {
  planProjectReportGroups,
  type ProjectReportSubjectSummary,
} from './project-report-grouping';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const entry = (n: number, title: string) => ({ id: uuid(n), title });

const ROOT = entry(900, 'Workspace');
const REPORTS = entry(901, 'Reports');
const BILLING = entry(902, 'Billing');
const PLAN = entry(950, 'Report plan');

let next = 0;
const subject = (
  placement: ProjectReportSubjectPlacement | undefined,
  changes: number,
  views = 0,
  lastOccurredAt = '2026-09-03T00:00:00.000Z',
): ProjectReportSubjectSummary => {
  next += 1;
  return {
    subject: { entityType: EntityType.Task, entityId: uuid(next) },
    title: `Subject ${next}`,
    changeCount: changes,
    activityCount: changes + views,
    lastOccurredAt,
    ...(placement ? { placement } : {}),
  };
};

const planned = { plan: PLAN, features: [REPORTS, ROOT] };
const reportsOnly = { features: [REPORTS, ROOT] };
const billingOnly = { features: [BILLING, ROOT] };

describe('planProjectReportGroups', () => {
  it('groups by owning plan, then nearest feature, then unplaced, ranked by changes, activity and recency', () => {
    const groups = planProjectReportGroups([
      subject(reportsOnly, 1, 4),
      subject(planned, 3),
      subject(billingOnly, 1, 4, '2026-09-01T00:00:00.000Z'),
      subject({ features: [] }, 0, 9),
      subject(undefined, 0, 1),
    ]);

    expect(groups.map((group) => [group.kind, group.title, group.subjects.length])).toEqual([
      ['PLAN', 'Report plan', 1],
      ['FEATURE', 'Reports', 1],
      ['FEATURE', 'Billing', 1],
      ['UNPLACED', 'Other work', 2],
    ]);
  });

  it('keeps every group and every subject however many there are, with nothing reduced to a mention', () => {
    const subjects = Array.from({ length: 300 }, (_, index) =>
      subject({ features: [entry(2000 + index, `Area ${index}`)] }, 1),
    );
    const groups = planProjectReportGroups(subjects);

    expect(groups).toHaveLength(300);
    expect(groups.flatMap((group) => group.subjects)).toHaveLength(300);
  });

  it('puts related subjects of one plan or feature in the same group', () => {
    const groups = planProjectReportGroups([
      subject(planned, 1),
      subject({ plan: PLAN, features: [BILLING] }, 1),
      subject(reportsOnly, 1),
      subject(reportsOnly, 2),
    ]);

    expect(groups.map((group) => [group.title, group.subjects.length])).toEqual([
      ['Reports', 2],
      ['Report plan', 2],
    ]);
  });
});
