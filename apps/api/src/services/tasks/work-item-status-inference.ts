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

const normalized = (name: string) =>
  name.trim().toLowerCase().replace(/[_-]+/g, ' ');

const standardStatuses: WorkItemTypeStatus[] = [
  { name: 'BACKLOG', label: 'Backlog', meaning: 'NOT_STARTED' },
  { name: 'REFINING', label: 'Refining', meaning: 'NOT_STARTED' },
  { name: 'READY', label: 'Ready', meaning: 'NOT_STARTED' },
  { name: 'ACTIVE', label: 'In progress', meaning: 'IN_PROGRESS' },
  { name: 'BLOCKED', label: 'Blocked', meaning: 'UNFINISHED' },
  { name: 'ON_HOLD', label: 'On Hold', meaning: 'UNFINISHED' },
  { name: 'VERIFYING', label: 'Verifying', meaning: 'IN_PROGRESS' },
  {
    name: 'COMPLETED',
    label: 'Completed',
    meaning: 'FINISHED',
    completionBehavior: 'COMPLETED',
  },
  {
    name: 'CANCELLED',
    label: 'Cancelled',
    meaning: 'FINISHED',
    completionBehavior: 'CANCELLED',
  },
];

function findKnownStatus(
  name: string,
  candidates: readonly WorkItemTypeStatus[],
): WorkItemTypeStatus | undefined {
  const key = normalized(name);

  return candidates.find(
    (status) =>
      normalized(status.name) === key ||
      (status.label !== undefined && normalized(status.label) === key),
  );
}

export function resolveWorkItemStatusAuthoring(
  input: WorkItemStatusAuthoringRequest,
): WorkItemStatusAuthoringResponse {
  const parsed = statusAuthoringRequestSchema.safeParse(input);
  if (!parsed.success) {
    throw new BadRequestException(parsed.error.message);
  }

  const { existingStatuses = [], finishedNames } = parsed.data;
  if (existingStatuses.length > 0) {
    const validExisting =
      workItemTypeStatusesSchema.safeParse(existingStatuses);
    if (!validExisting.success) {
      throw new BadRequestException(validExisting.error.message);
    }
  }

  const suggestions = standardStatuses.map((status) => status.name);
  const defaultNames = (
    existingStatuses.length > 0 ? existingStatuses : standardStatuses
  ).map((status) => status.name);
  const names = parsed.data.names ?? defaultNames;
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

  // A saved meaning wins over the standard one of the same name.
  const known = names.map(
    (name) =>
      findKnownStatus(name, existingStatuses) ??
      findKnownStatus(name, standardStatuses),
  );
  const knownFinishedNames = (finishedNames ?? []).filter(
    (name) => known[names.indexOf(name)],
  );
  if (knownFinishedNames.length > 0) {
    throw new BadRequestException(
      `Known statuses keep their existing meaning and cannot be listed in finishedNames: ${knownFinishedNames.join(', ')}. ` +
        'List only new statuses that mean the work is finished.',
    );
  }

  const needsClarification =
    finishedNames === undefined && known.some((status) => !status);
  if (needsClarification) {
    return {
      suggestions,
      state: 'CLARIFICATION',
      question: 'Which of these mean the work is finished?',
    };
  }

  const statuses: WorkItemTypeStatus[] = names.map((name, index) => {
    const prior = known[index];
    if (prior) {
      return prior;
    }

    return {
      name,
      meaning: finishedNames?.includes(name)
        ? WorkItemStatusMeaning.Finished
        : WorkItemStatusMeaning.Unfinished,
    };
  });

  return { suggestions, state: 'RESOLVED', statuses };
}
