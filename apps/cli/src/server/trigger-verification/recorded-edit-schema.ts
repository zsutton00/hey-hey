import { z } from 'zod';
import {
  AgentSessionServicePlaceKind,
  type ImplementReportEdit,
} from '@hey-hey/contracts/api/models';

const range = z
  .object({ startLine: z.number().int().min(1), endLine: z.number().int().min(1) })
  .strict();
export const recordedEditSchema = z
  .object({
    path: z.string().min(1),
    occurredAt: z.string().datetime({ offset: true }),
    turnId: z.string().min(1),
    beforeObjectId: z.string().nullable(),
    afterObjectId: z.string().nullable(),
    beforeRanges: z.array(range),
    afterRanges: z.array(range),
    approximate: z.boolean(),
    versionsRecorded: z.boolean(),
    place: z
      .object({
        kind: z.nativeEnum(AgentSessionServicePlaceKind),
        branch: z.string().nullable(),
        worktreePath: z.string().optional(),
      })
      .strict()
      .transform(({ worktreePath, ...place }) =>
        worktreePath === undefined ? place : { ...place, worktreePath },
      )
      .optional(),
  })
  .strict()
  .transform(
    ({ place, ...edit }): ImplementReportEdit => (place === undefined ? edit : { ...edit, place }),
  );
