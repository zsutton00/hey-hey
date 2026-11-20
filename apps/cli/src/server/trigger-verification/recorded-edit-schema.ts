import { z } from 'zod';
import type { ImplementReportEdit } from '@hey-hey/contracts/api/models';

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
  })
  .strict() satisfies z.ZodType<ImplementReportEdit>;
