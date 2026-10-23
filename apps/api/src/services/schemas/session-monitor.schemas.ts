import { z } from 'zod';
import {
  SessionMonitorContinuationCompletion,
  SessionMonitorContinuationCompletionAction,
  SessionMonitorContinuationCompletionResponse,
  SessionMonitorMessageState,
  SessionMonitorOutcome,
  SessionMonitorSystemMessageData,
} from 'src/generated';

const sessionMonitorMessageStateSchema = z.enum(['EVALUATING', 'DECISION']);
const sessionMonitorOutcomeSchema = z.enum(['CONTINUED', 'DEFERRED']);

const continuationActionArmSchema = z.object({
  action: z.string().min(1),
  response: z.string().optional(),
});

const continuationResponseArmSchema = z.object({
  response: z.string().min(1),
});

export const sessionMonitorContinuationCompletionSchema = z.union([
  continuationActionArmSchema,
  continuationResponseArmSchema,
]);

const baseFieldsSchema = z.object({
  type: z.literal('SESSION_MONITOR'),
  agentIdentity: z.string().min(1),
  content: z.string().min(1),
  reportId: z.string().uuid().optional(),
  state: sessionMonitorMessageStateSchema.optional(),
  outcome: sessionMonitorOutcomeSchema.optional(),
  continuationCompletion: sessionMonitorContinuationCompletionSchema.optional(),
  decisionOperationId: z.string().uuid().optional(),
  decisionFingerprint: z
    .string()
    .regex(/^[a-f0-9]{64}$/u)
    .optional(),
  consequenceMessageId: z.string().uuid().nullable().optional(),
});

export const sessionMonitorSystemMessageDataSchema = baseFieldsSchema
  .passthrough()
  .superRefine((value, ctx) => {
    const state = value.state ?? 'DECISION';

    if (state === 'EVALUATING') {
      if (value.outcome) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['outcome'],
          message:
            'SESSION_MONITOR state=EVALUATING forbids outcome; only terminal DECISION messages carry an outcome',
        });
      }
      if (value.continuationCompletion) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['continuationCompletion'],
          message:
            'SESSION_MONITOR state=EVALUATING forbids continuationCompletion; progress messages carry no decision evidence',
        });
      }
      return;
    }

    if (!value.outcome) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['outcome'],
        message:
          'SESSION_MONITOR state=DECISION requires outcome=CONTINUED or outcome=DEFERRED',
      });
      return;
    }

    if (value.outcome === 'CONTINUED' && !value.continuationCompletion) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['continuationCompletion'],
        message:
          'SESSION_MONITOR outcome=CONTINUED requires a continuationCompletion payload (action-bearing or response-only)',
      });
    }
    if (value.outcome === 'DEFERRED' && value.continuationCompletion) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['continuationCompletion'],
        message:
          'SESSION_MONITOR outcome=DEFERRED forbids continuationCompletion; the report is being handed back to the user',
      });
    }
  });

export type SessionMonitorMessageStateT = z.infer<
  typeof sessionMonitorMessageStateSchema
>;

export type SessionMonitorOutcomeT = z.infer<
  typeof sessionMonitorOutcomeSchema
>;

export type SessionMonitorContinuationActionT = z.infer<
  typeof continuationActionArmSchema
>;

export type SessionMonitorContinuationResponseT = z.infer<
  typeof continuationResponseArmSchema
>;

export type SessionMonitorContinuationCompletionT = z.infer<
  typeof sessionMonitorContinuationCompletionSchema
>;

export type SessionMonitorSystemMessageDataT = z.infer<
  typeof sessionMonitorSystemMessageDataSchema
>;

export const isContinuationActionArm = (
  completion: SessionMonitorContinuationCompletion,
): completion is SessionMonitorContinuationCompletionAction =>
  typeof (completion as SessionMonitorContinuationCompletionAction).action ===
  'string';

export const isContinuationResponseArm = (
  completion: SessionMonitorContinuationCompletion,
): completion is SessionMonitorContinuationCompletionResponse =>
  !isContinuationActionArm(completion);

const _assertStateCompatibility: SessionMonitorMessageStateT =
  SessionMonitorMessageState.Evaluating;
void _assertStateCompatibility;
const _assertCompatibility: SessionMonitorOutcomeT =
  SessionMonitorOutcome.Continued;
void _assertCompatibility;
const _assertDataCompatibility = (value: SessionMonitorSystemMessageData) =>
  value;
void _assertDataCompatibility;
