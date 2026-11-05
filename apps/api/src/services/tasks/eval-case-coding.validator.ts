import { z } from 'zod';
import type { EvalCaseCoding } from '@hey-hey/contracts/api/models';

export const EVAL_CASE_CODING_SCHEMA_REF =
  '#/components/schemas/EvalCaseCoding';

const nonEmpty = z.string().trim().min(1);

const evalCaseCodingSchema: z.ZodType<EvalCaseCoding> = z
  .object({
    serviceId: z.string().uuid(),
    pinnedCommit: z
      .object({
        sha: z
          .string()
          .regex(/^[0-9a-f]{40}$/, 'must be a full 40-character lowercase SHA'),
        shortMessage: nonEmpty,
      })
      .strict(),
    testCommands: z.array(nonEmpty).optional(),
    knownGoodDiff: nonEmpty,
    knownBadDiff: nonEmpty,
  })
  .strict();

export type EvalCaseCodingValidationResult =
  | { success: true; value: EvalCaseCoding; canonicalContent: string }
  | { success: false; message: string };

export function validateEvalCaseCodingContent(
  content: unknown,
): EvalCaseCodingValidationResult {
  let value = content;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return { success: false, message: 'root: content must be valid JSON' };
    }
  }

  const result = evalCaseCodingSchema.safeParse(value);
  if (!result.success) {
    const message = result.error.issues
      .map((issue) => `${issue.path.join('.') || 'root'}: ${issue.message}`)
      .join('; ');
    return { success: false, message };
  }

  return {
    success: true,
    value: result.data,
    canonicalContent: JSON.stringify(result.data),
  };
}
