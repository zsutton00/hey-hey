import { AsyncLocalStorage } from 'node:async_hooks';
import type { Prisma, ReportType as PrismaReportType } from '@prisma/client';
import { WORK_ITEM_TYPE_KEYS } from '../services/tasks/work-item-type-keys';
import { ReadRestriction } from '@hey-hey/contracts/api/models';

/** Header a trusted CLI Run sets on its platform requests; the model never controls it. */
export const READ_RESTRICTION_HEADER = 'x-read-restriction';

/** Work items that hold an Eval's grading material. */
const EVAL_DEFINITION_TYPES: readonly string[] = [
  WORK_ITEM_TYPE_KEYS.Eval,
  WORK_ITEM_TYPE_KEYS.EvalCase,
];

/** Reports that record how an attempt was graded. */
const EVAL_GRADING_REPORT_TYPES = [
  'EVAL_RUN',
  'EVAL_ATTEMPT',
  'EVAL_HUMAN_REVIEW',
] as const satisfies readonly PrismaReportType[];

/** What a request can no longer discover or read. Empty lists mean an ordinary, unrestricted read. */
export interface ReadPolicy {
  readonly excludedTaskTypes: readonly string[];
  readonly excludedReportTypes: readonly PrismaReportType[];
  /** Stable identity of the effective exclusions, for scoping caches. */
  readonly scope: string;
}

const buildPolicy = (
  excludedTaskTypes: readonly string[],
  excludedReportTypes: readonly PrismaReportType[],
): ReadPolicy => ({
  excludedTaskTypes,
  excludedReportTypes,
  scope: `tasks:${[...excludedTaskTypes].sort().join(',')}|reports:${[...excludedReportTypes].sort().join(',')}`,
});

export const UNRESTRICTED_READ_POLICY: ReadPolicy = buildPolicy([], []);

/** Derived only from the restriction, so callers cannot choose which types are hidden. */
export function readPolicyFor(
  restriction: ReadRestriction | undefined,
): ReadPolicy {
  if (restriction === ReadRestriction.EvalTarget) {
    return buildPolicy(EVAL_DEFINITION_TYPES, EVAL_GRADING_REPORT_TYPES);
  }

  if (restriction === ReadRestriction.EvalJudge) {
    return buildPolicy([], EVAL_GRADING_REPORT_TYPES);
  }

  return UNRESTRICTED_READ_POLICY;
}

export function isReadRestriction(value: unknown): value is ReadRestriction {
  return Object.values(ReadRestriction).some((known) => known === value);
}

const storage = new AsyncLocalStorage<ReadPolicy>();

/**
 * The read policy of the request being served. Read services consult it so one restriction,
 * set once at the edge, reaches every path that can return a record.
 */
export const ReadPolicyContext = {
  run<T>(policy: ReadPolicy, callback: () => T): T {
    return storage.run(policy, callback);
  },

  current(): ReadPolicy {
    return storage.getStore() ?? UNRESTRICTED_READ_POLICY;
  },
};

/** A Prisma `where` fragment that keeps hidden work items out of a task query. */
export function visibleTaskWhere(): Prisma.TaskWhereInput {
  const { excludedTaskTypes } = ReadPolicyContext.current();

  return excludedTaskTypes.length === 0
    ? {}
    : { type: { notIn: [...excludedTaskTypes] } };
}

/** A Prisma `where` fragment that keeps hidden reports out of a report query. */
export function visibleReportWhere(): Prisma.ReportWhereInput {
  const { excludedReportTypes } = ReadPolicyContext.current();

  return excludedReportTypes.length === 0
    ? {}
    : { reportType: { notIn: [...excludedReportTypes] } };
}

/** Narrows a task query to visible work items; an unrestricted request keeps its query untouched. */
export function restrictTaskWhere(
  where: Prisma.TaskWhereInput,
): Prisma.TaskWhereInput {
  const visible = visibleTaskWhere();

  return Object.keys(visible).length === 0 ? where : { AND: [where, visible] };
}

/** Narrows a report query to visible reports; an unrestricted request keeps its query untouched. */
export function restrictReportWhere(
  where: Prisma.ReportWhereInput,
): Prisma.ReportWhereInput {
  const visible = visibleReportWhere();

  return Object.keys(visible).length === 0 ? where : { AND: [where, visible] };
}
