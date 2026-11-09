import { z } from 'zod';
import {
  TaskMonitorLaunchMethod,
  TaskMonitorLaunchProvider,
  TaskMonitorReasoningEffort,
  type StartRunWorktree,
  type TaskMonitorLaunchConfig,
} from '@hey-hey/contracts/api/models';

const worktreeInputSchema = z.object({
  enabled: z.boolean(),
  branch: z.string().min(1).optional(),
});

export function materializationRequest(
  input: z.infer<typeof worktreeInputSchema> | undefined,
): StartRunWorktree | undefined {
  if (!input?.enabled) {
    return undefined;
  }

  return {
    enabled: true,
    ...(input.branch === undefined ? {} : { branch: input.branch }),
  } satisfies StartRunWorktree;
}

export const startRunWorktreePayloadSchema = worktreeInputSchema
  .passthrough()
  .optional()
  .transform(materializationRequest);

export const taskMonitorLaunchConfigInputSchema = z
  .object({
    taskId: z.string().uuid(),
    method: z.nativeEnum(TaskMonitorLaunchMethod),
    provider: z.nativeEnum(TaskMonitorLaunchProvider),
    model: z.string().min(1),
    reasoningEffort: z.nativeEnum(TaskMonitorReasoningEffort),
    fastMode: z.boolean().optional(),
    worktree: worktreeInputSchema.strict().optional(),
  })
  .strict();

export function taskMonitorLaunchConfigFromInput({
  fastMode,
  worktree,
  ...required
}: z.infer<typeof taskMonitorLaunchConfigInputSchema>): TaskMonitorLaunchConfig {
  const request = materializationRequest(worktree);
  return {
    ...required,
    ...(fastMode === undefined ? {} : { fastMode }),
    ...(request === undefined ? {} : { worktree: request }),
  } satisfies TaskMonitorLaunchConfig;
}

export const taskMonitorLaunchConfigSchema = taskMonitorLaunchConfigInputSchema.transform(
  taskMonitorLaunchConfigFromInput,
);
