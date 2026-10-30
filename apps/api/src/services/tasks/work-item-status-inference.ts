import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import type { WorkItemTypeStatus } from '../../generated/model/workItemTypeStatus';
import type { WorkItemStatusAuthoringRequest } from '../../generated/model/workItemStatusAuthoringRequest';
import type { WorkItemStatusAuthoringResponse } from '../../generated/model/workItemStatusAuthoringResponse';
import { WorkItemStatusMeaning } from '../../generated/model/workItemStatusMeaning';
import {
  workItemTypeStatusSchema,
  workItemTypeStatusesSchema,
} from './work-item-type-status.schema';

const nameSchema = z
  .string()
  .min(1)
  .refine((name) => name.trim().length > 0);
export const statusAuthoringRequestSchema = z
  .object({
    purpose: z.string(),
    names: z.array(nameSchema).min(1).optional(),
    existingStatuses: z.array(workItemTypeStatusSchema).optional(),
    finishedNames: z.array(nameSchema).optional(),
  })
  .strict();

const knownFinished = new Set([
  'done',
  'complete',
  'completed',
  'finished',
  'made',
  'rejected',
  'cancelled',
  'canceled',
]);
const knownUnfinished = new Set([
  'idea',
  'backlog',
  'planned',
  'todo',
  'to do',
  'testing',
  'active',
  'in progress',
  'verifying',
  'review',
  'blocked',
  'on hold',
  'refining',
]);
const notStartedNames = new Set([
  'idea',
  'backlog',
  'planned',
  'todo',
  'to do',
  'refining',
]);
const inProgressNames = new Set([
  'testing',
  'active',
  'in progress',
  'verifying',
  'review',
]);
const normalized = (name: string) =>
  name.trim().toLowerCase().replace(/[_-]+/g, ' ');

export function resolveWorkItemStatusAuthoring(
  input: WorkItemStatusAuthoringRequest,
): WorkItemStatusAuthoringResponse {
  const parsed = statusAuthoringRequestSchema.safeParse(input);
  if (!parsed.success) {
    throw new BadRequestException(parsed.error.message);
  }
  const { purpose, existingStatuses = [], finishedNames } = parsed.data;
  if (existingStatuses.length > 0) {
    const validExisting =
      workItemTypeStatusesSchema.safeParse(existingStatuses);
    if (!validExisting.success) {
      throw new BadRequestException(validExisting.error.message);
    }
  }
  const suggestions = /recipe|recipes|cooking/i.test(purpose)
    ? ['Idea', 'Testing', 'Made', 'Rejected']
    : ['Backlog', 'In progress', 'Done'];
  const names = parsed.data.names ?? suggestions;
  const placeholders = names.map((name) => ({
    name,
    meaning: WorkItemStatusMeaning.Unfinished,
  }));
  const validNames = workItemTypeStatusesSchema.safeParse(placeholders);
  if (!validNames.success) {
    throw new BadRequestException(validNames.error.message);
  }
  if (
    finishedNames &&
    (new Set(finishedNames).size !== finishedNames.length ||
      finishedNames.some((name) => !names.includes(name)))
  ) {
    throw new BadRequestException(
      'Finished selections must be distinct names from the status list.',
    );
  }
  const existing = new Map(
    existingStatuses.map((status) => [status.name, status]),
  );
  const needsClarification =
    finishedNames === undefined &&
    names.some((name) => {
      const key = normalized(name);
      return (
        !existing.has(name) &&
        !knownFinished.has(key) &&
        !knownUnfinished.has(key)
      );
    });
  if (needsClarification) {
    return {
      suggestions,
      state: 'CLARIFICATION',
      question: 'Which of these mean the work is finished?',
    };
  }
  const statuses: WorkItemTypeStatus[] = names.map((name, index) => {
    const prior = existing.get(name);
    const key = normalized(name);
    const finished = finishedNames
      ? finishedNames.includes(name)
      : prior
        ? prior.meaning === WorkItemStatusMeaning.Finished
        : knownFinished.has(key);
    if (
      prior &&
      (finishedNames === undefined ||
        finished === (prior.meaning === WorkItemStatusMeaning.Finished))
    ) {
      return prior;
    }
    const meaning = finished
      ? WorkItemStatusMeaning.Finished
      : key === 'blocked' || key === 'on hold'
        ? WorkItemStatusMeaning.Unfinished
        : notStartedNames.has(key)
          ? WorkItemStatusMeaning.NotStarted
          : inProgressNames.has(key)
            ? WorkItemStatusMeaning.InProgress
            : index === 0
              ? WorkItemStatusMeaning.NotStarted
              : WorkItemStatusMeaning.InProgress;
    return { name, ...(prior?.label ? { label: prior.label } : {}), meaning };
  });
  return { suggestions, state: 'RESOLVED', statuses };
}
