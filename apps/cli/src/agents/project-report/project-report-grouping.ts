/**
 * Groups report subjects by the work they belong to and splits one report
 * token budget across those groups.
 *
 * A subject's lineage is its owning plan, then its feature ancestors nearest
 * first. Subjects start in their nearest group. While there are more groups
 * than the budget can fund, the lowest-ranked group that can climb moves to
 * its next feature ancestor, merging with any group already there. Groups that
 * still don't fit become one-line mentions.
 */

import { ActivityCorrelationActivityType } from '../../shared/api/generated/api';
import type { ProjectReportSubjectDigest } from './project-report-evidence-reader';

/** Total provider tokens one report may spend across the parent and every section. */
const PROJECT_REPORT_TOKEN_BUDGET = 4_000_000;
/** Share of the budget kept for the parent that merges sections and submits. */
const PROJECT_REPORT_PARENT_RESERVE_RATIO = 0.25;
/** A section below this share can't read enough of its group to be worth running. */
const PROJECT_REPORT_MIN_SECTION_TOKENS = 250_000;
/** Upper bound on section sub-agents per report, whatever the budget. */
const PROJECT_REPORT_MAX_SECTIONS = 12;

export type ProjectReportGroupKind = 'PLAN' | 'FEATURE' | 'UNPLACED';

export interface ProjectReportGroup {
  key: string;
  kind: ProjectReportGroupKind;
  title: string;
  subjects: ProjectReportSubjectDigest[];
  changeCount: number;
  activityCount: number;
  lastOccurredAt: string;
}

interface ProjectReportFundedGroup {
  group: ProjectReportGroup;
  tokenBudget: number;
}

export interface ProjectReportGroupPlan {
  totalTokenBudget: number;
  parentTokenBudget: number;
  /** Funded groups in rank order, each with its token share. */
  sections: ProjectReportFundedGroup[];
  /** Unfunded groups in rank order; each gets a one-line mention. */
  mentions: ProjectReportGroup[];
}

export interface PlanProjectReportGroupsInput {
  subjects: readonly ProjectReportSubjectDigest[];
  totalTokenBudget?: number;
  parentReserveRatio?: number;
  minSectionTokens?: number;
  maxSections?: number;
}

interface LineageStep {
  key: string;
  kind: ProjectReportGroupKind;
  title: string;
}

const UNPLACED: LineageStep = { key: 'unplaced', kind: 'UNPLACED', title: 'Other work' };

const compareGroups = (a: ProjectReportGroup, b: ProjectReportGroup): number =>
  b.changeCount - a.changeCount ||
  b.activityCount - a.activityCount ||
  b.lastOccurredAt.localeCompare(a.lastOccurredAt) ||
  a.key.localeCompare(b.key);

/** A subject and how far up its lineage it has been lifted. */
interface PlacedSubject {
  subject: ProjectReportSubjectDigest;
  /** Remaining lineage; the first step is the subject's current group. */
  lineage: [LineageStep, ...LineageStep[]];
}

const lineageOf = (subject: ProjectReportSubjectDigest): PlacedSubject['lineage'] => {
  const steps: LineageStep[] = [];
  const plan = subject.placement?.plan;
  if (plan) steps.push({ key: `plan:${plan.id}`, kind: 'PLAN', title: plan.title });
  for (const feature of subject.placement?.features ?? []) {
    steps.push({ key: `feature:${feature.id}`, kind: 'FEATURE', title: feature.title });
  }
  const [first, ...rest] = steps;
  return first ? [first, ...rest] : [UNPLACED];
};

const canClimb = (placed: PlacedSubject): boolean => placed.lineage.length > 1;

const climb = (placed: PlacedSubject): void => {
  const [, next, ...rest] = placed.lineage;
  if (next) placed.lineage = [next, ...rest];
};

const buildGroups = (
  placedSubjects: readonly PlacedSubject[],
): Array<ProjectReportGroup & { members: PlacedSubject[] }> => {
  const groups = new Map<string, ProjectReportGroup & { members: PlacedSubject[] }>();
  for (const placed of placedSubjects) {
    const [step] = placed.lineage;
    const group = groups.get(step.key) ?? {
      key: step.key,
      kind: step.kind,
      title: step.title,
      subjects: [],
      members: [],
      changeCount: 0,
      activityCount: 0,
      lastOccurredAt: '',
    };
    group.subjects.push(placed.subject);
    group.members.push(placed);
    for (const activity of placed.subject.activity) {
      group.activityCount += activity.count;
      if (activity.activityType !== ActivityCorrelationActivityType.Viewed) {
        group.changeCount += activity.count;
      }
      if (activity.lastOccurredAt > group.lastOccurredAt) {
        group.lastOccurredAt = activity.lastOccurredAt;
      }
    }
    groups.set(step.key, group);
  }
  return [...groups.values()].sort(compareGroups);
};

export const planProjectReportGroups = (
  input: PlanProjectReportGroupsInput,
): ProjectReportGroupPlan => {
  const totalTokenBudget = input.totalTokenBudget ?? PROJECT_REPORT_TOKEN_BUDGET;
  const parentReserveRatio = input.parentReserveRatio ?? PROJECT_REPORT_PARENT_RESERVE_RATIO;
  const minSectionTokens = input.minSectionTokens ?? PROJECT_REPORT_MIN_SECTION_TOKENS;
  const parentTokenBudget = Math.floor(totalTokenBudget * parentReserveRatio);
  const sectionPool = totalTokenBudget - parentTokenBudget;
  const maxSections = Math.min(
    input.maxSections ?? PROJECT_REPORT_MAX_SECTIONS,
    Math.floor(sectionPool / minSectionTokens),
  );

  const placedSubjects = input.subjects.map((subject) => ({
    subject,
    lineage: lineageOf(subject),
  }));
  let groups = buildGroups(placedSubjects);

  // Each climb moves one group a level up, so the loop ends once every
  // remaining group sits at the top of its lineage.
  while (groups.length > maxSections) {
    const climber = [...groups].reverse().find((group) => group.members.some(canClimb));
    if (!climber) break;
    climber.members.forEach(climb);
    groups = buildGroups(placedSubjects);
  }

  const ranked = groups.map(
    (group): ProjectReportGroup => ({
      key: group.key,
      kind: group.kind,
      title: group.title,
      subjects: group.subjects,
      changeCount: group.changeCount,
      activityCount: group.activityCount,
      lastOccurredAt: group.lastOccurredAt,
    }),
  );
  const funded = ranked.slice(0, Math.max(0, maxSections));
  const mentions = ranked.slice(funded.length);
  const weightOf = (group: ProjectReportGroup) => group.changeCount + group.activityCount;
  const totalWeight = funded.reduce((sum, group) => sum + weightOf(group), 0);
  const weightedPool = sectionPool - funded.length * minSectionTokens;
  const sections = funded.map((group) => ({
    group,
    tokenBudget:
      minSectionTokens +
      (totalWeight > 0 ? Math.floor((weightedPool * weightOf(group)) / totalWeight) : 0),
  }));

  return { totalTokenBudget, parentTokenBudget, sections, mentions };
};
