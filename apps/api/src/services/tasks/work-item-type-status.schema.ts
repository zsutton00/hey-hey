import { z } from 'zod';
import type {
  WorkItemStatusMeaning,
  WorkItemTypeStatus,
} from '@hey-hey/contracts/api/models';

export const CUSTOM_MEANING_MAX_LENGTH = 50;

export const MISSING_MEANING_FIX =
  'choose Completed, Cancelled, In progress or Custom';

const builtInMeaningNames = new Map([
  ['completed', 'Completed'],
  ['cancelled', 'Cancelled'],
  ['canceled', 'Cancelled'],
  ['in progress', 'In progress'],
  ['in-progress', 'In progress'],
  ['in_progress', 'In progress'],
]);

export const workItemStatusMeaningSchema = z.discriminatedUnion('kind', [
  z
    .object({ kind: z.enum(['COMPLETED', 'CANCELLED', 'IN_PROGRESS']) })
    .strict(),
  z
    .object({
      kind: z.literal('CUSTOM'),
      text: z
        .string()
        .trim()
        .min(1)
        .superRefine((text, context) => {
          if (Array.from(text).length > CUSTOM_MEANING_MAX_LENGTH) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              message: `A Custom meaning is at most ${CUSTOM_MEANING_MAX_LENGTH} characters.`,
            });
          }

          const builtIn = builtInMeaningNames.get(text.toLowerCase());
          if (builtIn) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              message: `"${text}" is a built-in meaning: choose ${builtIn} instead of Custom.`,
            });
          }
        }),
    })
    .strict(),
]) satisfies z.ZodType<WorkItemStatusMeaning>;

export const workItemTypeStatusSchema = z
  .object({
    name: z.string().trim().min(1),
    meaning: workItemStatusMeaningSchema,
  })
  .strict();

export const workItemTypeStatusesSchema = z
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
  ) satisfies z.ZodType<WorkItemTypeStatus[]>;
