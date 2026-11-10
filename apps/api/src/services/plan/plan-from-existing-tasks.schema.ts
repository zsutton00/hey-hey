import { z } from 'zod';

/** Discriminator carried on the CREATE/TASK proposal payload. */
export const PLAN_FROM_EXISTING_TASKS_KIND = 'PLAN_FROM_EXISTING_TASKS';

const uuid = z.string().uuid();

/**
 * Validator for the OpenAPI `CreatePlanFromExistingTasksProposalUpdates`
 * contract; the type check in the validation engine keeps them aligned.
 */
export const planFromExistingTasksPayloadSchema = z
  .object({
    proposalKind: z.literal(PLAN_FROM_EXISTING_TASKS_KIND),
    planTitle: z.string().min(1),
    designDocMarkdown: z.string().min(1),
    parentFeatureId: uuid,
    stages: z
      .array(
        z
          .object({
            title: z.string().min(1),
            taskIds: z.array(uuid).min(1),
          })
          .strict(),
      )
      .min(1),
    taskPrerequisites: z
      .array(z.object({ taskId: uuid, dependsOnTaskId: uuid }).strict())
      .optional(),
  })
  .strict();

export type PlanFromExistingTasksPayload = z.infer<
  typeof planFromExistingTasksPayloadSchema
>;

export function isPlanFromExistingTasksPayload(
  updates: unknown,
): updates is Record<string, unknown> {
  return (
    updates !== null &&
    typeof updates === 'object' &&
    (updates as Record<string, unknown>).proposalKind ===
      PLAN_FROM_EXISTING_TASKS_KIND
  );
}
