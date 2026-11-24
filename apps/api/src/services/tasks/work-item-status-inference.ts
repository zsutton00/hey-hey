import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import type {
  WorkItemStatusAuthoringRequest,
  WorkItemStatusAuthoringResponse,
  WorkItemTypeStatus,
} from '@hey-hey/contracts/api/models';
import {
  MISSING_MEANING_FIX,
  workItemStatusMeaningSchema,
  workItemTypeStatusesSchema,
} from './work-item-type-status.schema';

export const statusAuthoringRequestSchema = z
  .object({
    purpose: z.string(),
    statuses: z
      .array(
        z
          .object({
            name: z.string().refine((name) => name.trim().length > 0),
            meaning: workItemStatusMeaningSchema.optional(),
          })
          .strict(),
      )
      .min(1)
      .optional(),
  })
  .strict();

const custom = (text: string) => ({ kind: 'CUSTOM' as const, text });

const standardStatuses: WorkItemTypeStatus[] = [
  { name: 'BACKLOG', meaning: custom('Backlog') },
  { name: 'REFINING', meaning: custom('Refining') },
  { name: 'READY', meaning: custom('Ready') },
  { name: 'ACTIVE', meaning: { kind: 'IN_PROGRESS' } },
  { name: 'BLOCKED', meaning: custom('Blocked') },
  { name: 'ON_HOLD', meaning: custom('On hold') },
  { name: 'VERIFYING', meaning: { kind: 'IN_PROGRESS' } },
  { name: 'COMPLETED', meaning: { kind: 'COMPLETED' } },
  { name: 'CANCELLED', meaning: { kind: 'CANCELLED' } },
];

/**
 * The single shared validator for REST status authoring and the MCP tool.
 * Standard statuses, with their meanings, are offered only when no statuses
 * are submitted. A submitted status without a meaning is rejected with its
 * name and the fix, whatever the name is: no meaning is ever inferred.
 */
export function resolveWorkItemStatusAuthoring(
  input: WorkItemStatusAuthoringRequest,
): WorkItemStatusAuthoringResponse {
  const parsed = statusAuthoringRequestSchema.safeParse(input);
  if (!parsed.success) {
    throw new BadRequestException(parsed.error.message);
  }

  const suggestions = standardStatuses.map((status) => status.name);
  const statuses = parsed.data.statuses ?? standardStatuses;

  const missing = statuses
    .filter((status) => status.meaning === undefined)
    .map((status) => status.name);
  if (missing.length > 0) {
    throw new BadRequestException(
      `Every status needs a meaning. Statuses without one: ${missing.join(', ')}. ` +
        `For each, ${MISSING_MEANING_FIX}; a Custom meaning needs a short text of your own words.`,
    );
  }

  const valid = workItemTypeStatusesSchema.safeParse(statuses);
  if (!valid.success) {
    throw new BadRequestException(valid.error.message);
  }

  return { suggestions, statuses: valid.data };
}
