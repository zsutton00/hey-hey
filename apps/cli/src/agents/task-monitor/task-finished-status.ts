import { z } from 'zod';

export const statusMeaningSchema = z.object({
  kind: z.enum(['COMPLETED', 'CANCELLED', 'IN_PROGRESS', 'CUSTOM']),
  text: z.string().optional(),
});

const typeStatusSchema = z.object({
  name: z.string().min(1),
  meaning: statusMeaningSchema,
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

/** A status counts as delivered when its meaning is Completed; Cancelled is finished but not delivered. */
export const isDeliveredStatus = (
  statuses: readonly TaskTypeStatus[],
  statusName: string,
): boolean =>
  statuses.some(({ name, meaning }) => name === statusName && meaning.kind === 'COMPLETED');

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
