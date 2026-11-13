import { z } from 'zod';
import type { EvalCaseInputs } from '@hey-hey/contracts/api/models';

export const EVAL_CASE_INPUTS_SCHEMA_REF =
  '#/components/schemas/EvalCaseInputs';

const textMessageInputSchema = z
  .object({
    kind: z.literal('text_message'),
    text: z
      .string()
      .refine((text) => text.trim().length > 0, 'text must not be blank'),
  })
  .strict();

const evalCaseInputsSchema: z.ZodType<EvalCaseInputs> = z
  .object({
    inputs: z.array(textMessageInputSchema).min(1, 'at least one input'),
  })
  .strict();

export type EvalCaseInputsValidationResult =
  | { success: true; value: EvalCaseInputs; canonicalContent: string }
  | { success: false; message: string };

export function validateEvalCaseInputsContent(
  content: unknown,
): EvalCaseInputsValidationResult {
  let value = content;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return { success: false, message: 'root: content must be valid JSON' };
    }
  }

  const result = evalCaseInputsSchema.safeParse(value);
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
