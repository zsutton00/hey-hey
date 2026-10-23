import { describe, expect, it } from 'vitest';
import {
  ActivityCorrelationActivityType,
  ActivityCorrelationSource,
  EntityType,
  type ProjectReportSubjectPlacement,
} from '../../shared/api/generated/api';
import type { ProjectReportSubjectDigest } from './project-report-evidence-reader';
import { planProjectReportGroups } from './project-report-grouping';

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
): ProjectReportSubjectDigest => {
  next += 1;
  const activity = [
    ...(changes > 0
      ? [
          {
            activityType: ActivityCorrelationActivityType.Unblocked,
            source: ActivityCorrelationSource.TaskRelationship,
            count: changes,
            firstOccurredAt: lastOccurredAt,
            lastOccurredAt,
          },
        ]
      : []),
    ...(views > 0
      ? [
          {
            activityType: ActivityCorrelationActivityType.Viewed,
            source: ActivityCorrelationSource.AttentionEvent,
            count: views,
            firstOccurredAt: lastOccurredAt,
            lastOccurredAt,
          },
        ]
      : []),
  ];
  return {
    subject: { entityType: EntityType.Task, entityId: uuid(next) },
    title: `Subject ${next}`,
    activity,
    latestActivityEvidenceKey: `selected-period-${next}`,
    ...(placement ? { placement } : {}),
  };
};

const planned = { plan: PLAN, features: [REPORTS, ROOT] };
const reportsOnly = { features: [REPORTS, ROOT] };
const billingOnly = { features: [BILLING, ROOT] };

describe('planProjectReportGroups', () => {
  it('groups by owning plan, then parent feature, then unplaced, ranked by changes, activity and recency', () => {
    const plan = planProjectReportGroups({
      subjects: [
        subject(reportsOnly, 1, 4),
        subject(planned, 3),
        subject(billingOnly, 1, 4, '2026-09-01T00:00:00.000Z'),
        subject({ features: [] }, 0, 9),
        subject(undefined, 0, 1),
      ],
    });
    expect(
      plan.sections.map(({ group }) => [group.kind, group.title, group.subjects.length]),
    ).toEqual([
      ['PLAN', 'Report plan', 1],
      ['FEATURE', 'Reports', 1],
      ['FEATURE', 'Billing', 1],
      ['UNPLACED', 'Other work', 2],
    ]);
    expect(plan.mentions).toEqual([]);
  });

  it('lifts the lowest-ranked groups to their nearest shared feature ancestor when sections are scarce', () => {
    const plan = planProjectReportGroups({
      subjects: [subject(planned, 9), subject(reportsOnly, 5), subject(billingOnly, 1)],
      maxSections: 2,
    });
    // Billing climbs to Workspace; it can climb no further, so the next-lowest
    // group (Reports) climbs and merges there, at its shared ancestor with Billing.
    expect(plan.sections.map(({ group }) => [group.title, group.subjects.length])).toEqual([
      ['Report plan', 1],
      ['Workspace', 2],
    ]);
    expect(plan.mentions).toEqual([]);
  });

  it('turns groups that cannot climb further into ranked mentions', () => {
    const plan = planProjectReportGroups({
      subjects: [
        subject({ features: [REPORTS] }, 5),
        subject({ features: [BILLING] }, 3),
        subject(undefined, 1),
      ],
      maxSections: 1,
    });
    expect(plan.sections.map(({ group }) => group.title)).toEqual(['Reports']);
    expect(plan.mentions.map((group) => group.title)).toEqual(['Billing', 'Other work']);
  });

  it('splits one budget into a parent reserve and weighted section shares that never exceed it', () => {
    const plan = planProjectReportGroups({
      subjects: [subject(reportsOnly, 30), subject(billingOnly, 10), subject(undefined, 0, 10)],
      totalTokenBudget: 4_000_000,
      parentReserveRatio: 0.25,
      minSectionTokens: 250_000,
    });
    expect(plan.parentTokenBudget).toBe(1_000_000);
    const shares = plan.sections.map(({ tokenBudget }) => tokenBudget);
    expect(shares.every((share) => share >= 250_000)).toBe(true);
    expect(shares[0]).toBeGreaterThan(shares[1]!);
    expect(shares.reduce((sum, share) => sum + share, 0)).toBeLessThanOrEqual(3_000_000);
    expect(
      plan.parentTokenBudget + shares.reduce((sum, share) => sum + share, 0),
    ).toBeLessThanOrEqual(plan.totalTokenBudget);
  });

  it('funds only as many sections as the minimum share allows', () => {
    const plan = planProjectReportGroups({
      subjects: [
        subject({ features: [REPORTS] }, 3),
        subject({ features: [BILLING] }, 2),
        subject(undefined, 1),
      ],
      totalTokenBudget: 1_000_000,
      parentReserveRatio: 0.5,
      minSectionTokens: 250_000,
    });
    expect(plan.sections).toHaveLength(2);
    expect(plan.mentions.map((group) => group.title)).toEqual(['Other work']);
  });
});
