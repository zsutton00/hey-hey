import { z } from 'zod';
import type { ServiceFolderNotBoundFailure } from '@hey-hey/contracts/api/models';

const startFailureSchema = z.object({
  failure: z.object({
    reason: z.literal('service_folder_not_bound'),
    serviceIds: z.array(z.string().uuid()).min(1),
  }),
});

/** The reason a failed input recorded for ending, when it recorded one. */
export const startFailureOf = (settlement: unknown): ServiceFolderNotBoundFailure | null => {
  const parsed = startFailureSchema.safeParse(settlement);
  return parsed.success ? parsed.data.failure : null;
};

export const failureProjection = (
  settlement: unknown,
): { failure?: ServiceFolderNotBoundFailure } => {
  const failure = startFailureOf(settlement);
  return failure ? { failure } : {};
};
