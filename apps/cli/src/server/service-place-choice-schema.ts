import { z } from 'zod';
import type { ServicePlaceChoice } from '@hey-hey/contracts/api/models';

const mainFolderChoiceSchema = z
  .object({
    serviceId: z.string().uuid(),
    kind: z.literal('MAIN_FOLDER'),
  })
  .strict();

const worktreeChoiceSchema = z
  .object({
    serviceId: z.string().uuid(),
    kind: z.literal('WORKTREE'),
    branch: z.string().min(1),
    newBranch: z.boolean().optional(),
  })
  .strict();

/** The two valid shapes of one Service's chosen place; anything else is rejected. */
export const servicePlaceChoiceSchema: z.ZodType<ServicePlaceChoice, z.ZodTypeDef, unknown> = z
  .discriminatedUnion('kind', [mainFolderChoiceSchema, worktreeChoiceSchema])
  // An absent newBranch stays absent rather than becoming an explicit undefined.
  .transform((choice) => {
    if (choice.kind === 'WORKTREE' && choice.newBranch === undefined) {
      const { newBranch: _absent, ...withoutNewBranch } = choice;
      return withoutNewBranch;
    }
    return choice;
  });

/** One choice per Service, so the same Service cannot be placed twice. */
export const servicePlaceChoicesSchema: z.ZodType<ServicePlaceChoice[], z.ZodTypeDef, unknown> = z
  .array(servicePlaceChoiceSchema)
  .refine((choices) => new Set(choices.map((choice) => choice.serviceId)).size === choices.length, {
    message: 'servicePlaceChoices names a Service more than once',
  });
