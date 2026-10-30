import { z } from 'zod';
import type { WorkItemTypeStatus } from '../../generated/model/workItemTypeStatus';
import { WorkItemStatusMeaning } from '../../generated/model/workItemStatusMeaning';
import { WorkItemStatusCompletionBehavior } from '../../generated/model/workItemStatusCompletionBehavior';

export const workItemTypeStatusesSchema: z.ZodType<WorkItemTypeStatus[]> = z
  .array(
    z.object({
      name: z.string().min(1),
      label: z.string().min(1).optional(),
      meaning: z.nativeEnum(WorkItemStatusMeaning),
      completionBehavior: z
        .nativeEnum(WorkItemStatusCompletionBehavior)
        .optional(),
    }),
  )
  .min(1)
  .refine(
    (statuses) =>
      new Set(statuses.map((status) => status.name)).size === statuses.length,
    'Ordinary status names must be unique.',
  )
  .refine(
    (statuses) =>
      statuses.every(
        (status) =>
          !['ARCHIVED', 'SUPERSEDED'].includes(status.name.toUpperCase()),
      ),
    'Archived and Superseded are reserved platform statuses.',
  );
