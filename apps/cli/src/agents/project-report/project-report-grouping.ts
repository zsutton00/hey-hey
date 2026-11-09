/**
 * Groups report subjects by the work they belong to, so one agent reads related
 * work together.
 *
 * A subject's group is its owning plan, else its nearest feature, else a
 * catch-all. Every group is kept: nothing here decides that data goes unread.
 */

import type {
  ProjectReportSubject,
  ProjectReportSubjectPlacement,
} from '@hey-hey/contracts/api/models';

export type ProjectReportGroupKind = 'PLAN' | 'FEATURE' | 'UNPLACED';

/** What the host knows about one subject once its activity and current state are read. */
export interface ProjectReportSubjectSummary {
  subject: ProjectReportSubject;
  title: string;
  changeCount: number;
  activityCount: number;
  lastOccurredAt: string;
  /** Owning plan and feature lineage; absent when current-state detail could not be read. */
  placement?: ProjectReportSubjectPlacement;
}

export interface ProjectReportGroup {
  key: string;
  kind: ProjectReportGroupKind;
  title: string;
  subjects: ProjectReportSubjectSummary[];
  changeCount: number;
  activityCount: number;
  lastOccurredAt: string;
}

const UNPLACED = { key: 'unplaced', kind: 'UNPLACED', title: 'Other work' } as const;

const compareGroups = (a: ProjectReportGroup, b: ProjectReportGroup): number =>
  b.changeCount - a.changeCount ||
  b.activityCount - a.activityCount ||
  b.lastOccurredAt.localeCompare(a.lastOccurredAt) ||
  a.key.localeCompare(b.key);

const groupStepOf = (
  subject: ProjectReportSubjectSummary,
): { key: string; kind: ProjectReportGroupKind; title: string } => {
  const plan = subject.placement?.plan;
  if (plan) {
    return { key: `plan:${plan.id}`, kind: 'PLAN', title: plan.title };
  }

  const feature = subject.placement?.features[0];
  if (feature) {
    return { key: `feature:${feature.id}`, kind: 'FEATURE', title: feature.title };
  }

  return UNPLACED;
};

/** Every subject in exactly one group; groups ranked by how much changed in them. */
export const planProjectReportGroups = (
  subjects: readonly ProjectReportSubjectSummary[],
): ProjectReportGroup[] => {
  const groups = new Map<string, ProjectReportGroup>();

  for (const subject of subjects) {
    const step = groupStepOf(subject);
    const group = groups.get(step.key) ?? {
      ...step,
      subjects: [],
      changeCount: 0,
      activityCount: 0,
      lastOccurredAt: '',
    };

    group.subjects.push(subject);
    group.changeCount += subject.changeCount;
    group.activityCount += subject.activityCount;
    if (subject.lastOccurredAt > group.lastOccurredAt) {
      group.lastOccurredAt = subject.lastOccurredAt;
    }
    groups.set(step.key, group);
  }

  return [...groups.values()].sort(compareGroups);
};
