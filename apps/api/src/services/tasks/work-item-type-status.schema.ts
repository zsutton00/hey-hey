import { z } from 'zod';
import type { WorkItemTypeStatus } from '@hey-hey/contracts/api/models';
import { WorkItemStatusMeaning } from '@hey-hey/contracts/api/models';
import { WorkItemStatusCompletionBehavior } from '@hey-hey/contracts/api/models';

export const workItemTypeStatusSchema = z
  .object({
    name: z.string().trim().min(1),
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
