import { z } from 'zod';

const actionCompletionSchema = z
  .object({ action: z.string().min(1), response: z.string().min(1).optional() })
  .strict();
const responseCompletionSchema = z.object({ response: z.string().min(1) }).strict();

const buildSessionMonitorDecisionSchema = (allowedActions: readonly string[]) =>
  z
    .discriminatedUnion('disposition', [
      z
        .object({
          disposition: z.literal('CONTINUE'),
          content: z.string().min(1),
          continuationCompletion: z.union([actionCompletionSchema, responseCompletionSchema]),
        })
        .strict(),
      z
        .object({
          disposition: z.literal('DEFER'),
          content: z.string().min(1),
          reasoning: z.string().min(1),
        })
        .strict(),
    ])
    .superRefine((value, ctx) => {
      if (value.disposition !== 'CONTINUE') return;
      const completion = value.continuationCompletion;
      if (allowedActions.length === 0) {
        if ('action' in completion) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'empty action vocabulary requires the response-only arm',
            path: ['continuationCompletion'],
          });
        }
        return;
      }
      if (!('action' in completion) || !allowedActions.includes(completion.action)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `continuation action must be one of: ${allowedActions.join(', ')}`,
          path: ['continuationCompletion', 'action'],
        });
      }
    });

type SessionMonitorDecision = z.infer<ReturnType<typeof buildSessionMonitorDecisionSchema>>;

export type SessionMonitorDecisionParseResult =
  | { ok: true; value: SessionMonitorDecision }
  | { ok: false; error: string };

export const parseSessionMonitorDecision = (
  text: string,
  allowedActions: readonly string[],
): SessionMonitorDecisionParseResult => {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/u.exec(trimmed);
  const candidate = fenced?.[1] ?? trimmed;
  if (!candidate.startsWith('{') || !candidate.endsWith('}')) {
    return { ok: false, error: 'Exactly one JSON object is required' };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(candidate);
  } catch {
    return { ok: false, error: 'Decision JSON could not be parsed' };
  }
  const parsed = buildSessionMonitorDecisionSchema(allowedActions).safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.message };
  return { ok: true, value: parsed.data };
};
