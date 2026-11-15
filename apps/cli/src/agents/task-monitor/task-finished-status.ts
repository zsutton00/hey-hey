import { z } from 'zod';
import {
  WorkItemStatusCompletionBehavior,
  WorkItemStatusMeaning,
} from '../../shared/api/generated/api';

const typeStatusSchema = z.object({
  name: z.string().min(1),
  meaning: z.enum(Object.values(WorkItemStatusMeaning) as [string, ...string[]]),
  completionBehavior: z
    .enum(Object.values(WorkItemStatusCompletionBehavior) as [string, ...string[]])
    .optional(),
});

export const workItemTypeStatusesEnvelopeSchema = z
  .object({
    data: z
      .object({
        definition: z.object({ statuses: z.array(typeStatusSchema) }).passthrough(),
      })
      .passthrough(),
  })
  .passthrough();

export type TaskTypeStatus = z.infer<typeof typeStatusSchema>;

/** A status counts as delivered when it means finished and is not a cancellation. */
export const isDeliveredStatus = (
  statuses: readonly TaskTypeStatus[],
  statusName: string,
): boolean =>
  statuses.some(
    ({ name, meaning, completionBehavior }) =>
      name === statusName &&
      meaning === WorkItemStatusMeaning.Finished &&
      completionBehavior !== WorkItemStatusCompletionBehavior.Cancelled,
  );

export type FinishedStatusResolution =
  | { readonly ok: true; readonly status: string }
  | { readonly ok: false; readonly reason: string };

/** Picks the one finished, non-cancelled status the type defines, or explains why none can be chosen. */
export const resolveCompletionStatus = (
  statuses: readonly TaskTypeStatus[],
  task: { readonly id: string; readonly type: string },
): FinishedStatusResolution => {
  const candidates = statuses.filter(({ name }) => isDeliveredStatus(statuses, name));
  const [only] = candidates;
  if (candidates.length === 1 && only) {
    return { ok: true, status: only.name };
  }

  const problem = candidates.length === 0 ? 'no' : 'more than one';
  return {
    ok: false,
    reason: `Task ${task.id} of type ${task.type} has ${problem} finished, non-cancelled status to complete with.`,
  };
};
