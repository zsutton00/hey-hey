import { z } from 'zod';
import type { WorkItemTypeStatus } from '../../generated/model/workItemTypeStatus';
import { WorkItemStatusMeaning } from '../../generated/model/workItemStatusMeaning';
import { WorkItemStatusCompletionBehavior } from '../../generated/model/workItemStatusCompletionBehavior';

export const workItemTypeStatusSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .refine((name) => name.trim().length > 0),
    label: z.string().min(1).optional(),
    meaning: z.nativeEnum(WorkItemStatusMeaning),
    completionBehavior: z
      .nativeEnum(WorkItemStatusCompletionBehavior)
      .optional(),
  })
  .strict();

export const workItemTypeStatusesSchema: z.ZodType<WorkItemTypeStatus[]> = z
  .array(workItemTypeStatusSchema)
  .min(1)
  .refine(
    (statuses) =>
      new Set(statuses.map((status) => status.name.trim().toLowerCase()))
        .size === statuses.length,
    'Ordinary status names must be unique.',
  )
  .refine(
    (statuses) =>
      statuses.every(
        (status) =>
          !['ARCHIVED', 'SUPERSEDED'].includes(
            status.name.trim().toUpperCase(),
          ),
      ),
    'Archived and Superseded are reserved platform statuses.',
  )
  .refine(
    (statuses) =>
      statuses.every(
        (status) =>
          status.completionBehavior === undefined ||
          status.meaning === WorkItemStatusMeaning.Finished,
      ),
    'Completion behavior requires a finished status.',
  );
