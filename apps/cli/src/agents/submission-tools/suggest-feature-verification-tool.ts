import { featureVerificationSuggestionSchema } from '../completion-reconciliation/schemas';
import { SubmissionToolCorrectableError, type PassThroughSubmissionToolDeclaration } from './types';

export const SUGGEST_FEATURE_VERIFICATION_TOOL_NAME = 'suggest_feature_verification';

const CORRECTIONS: Record<string, string> = {
  featureId: "Supply /featureId as the most affected feature's UUID, then retry.",
  discrepancy: 'Supply /discrepancy as a non-empty description of what diverges, then retry.',
  impactedEntities:
    'Supply /impactedEntities as a list (possibly empty) of { entityType, entityId } objects with a non-empty type and a UUID id, then retry.',
};

const text = (message: string) => ({ content: [{ type: 'text' as const, text: message }] });

/**
 * Optional, per-Turn signal: the reply is delivered whether or not it is called,
 * and a call that arrives too late is acknowledged but never recorded.
 */
export const suggestFeatureVerificationTool = {
  kind: 'pass_through',
  name: SUGGEST_FEATURE_VERIFICATION_TOOL_NAME,
  description:
    'Offer the user a Verify Feature session for one feature whose Diagram, Mockup or requirements the code now diverges from, or that a Decision you created or changed affects. Pass the most affected feature id, the specific discrepancy you observed (what the code does versus what the feature, Diagram or Mockup says, or the impact the Decision has), and impactedEntities: the entities of any type (features, tasks, design docs, Contracts, Mockups, Diagrams, Decisions) you think may be impacted. They are where the Verify Feature session starts looking, not the limit of its search; pass an empty list when the concern is only the code diverging from that one feature. Raise a concern once; never repeat one already suggested in this session.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      featureId: { type: 'string' },
      discrepancy: { type: 'string' },
      impactedEntities: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            entityType: { type: 'string' },
            entityId: { type: 'string' },
          },
          required: ['entityType', 'entityId'],
        },
      },
    },
    required: ['featureId', 'discrepancy', 'impactedEntities'],
  },
  execute(ctx) {
    const run = ctx.run;
    const turn = run?.activeTurn;
    if (
      ctx.runId !== run?.runId ||
      !turn ||
      turn.abortSignal.aborted ||
      turn.phase === 'ended' ||
      turn.completedAssistantMessageId !== null
    ) {
      return text('Not recorded: there is no active Turn awaiting its reply.');
    }
    const parsed = featureVerificationSuggestionSchema.safeParse(ctx.args);
    if (!parsed.success) {
      throw new SubmissionToolCorrectableError({
        reason: 'The Verify Feature suggestion is invalid and can be corrected.',
        findings: parsed.error.issues.map((issue) => {
          const field = `/${issue.path.join('/')}`;
          return {
            field,
            code: issue.code,
            reason: issue.message,
            correction: CORRECTIONS[String(issue.path[0])] ?? `Remove ${field}, then retry.`,
          };
        }),
      });
    }
    const recorded = turn.recordFeatureVerificationSuggestion({
      feature: { entityType: 'FEATURE', entityId: parsed.data.featureId },
      explanation: parsed.data.discrepancy,
      impactedEntities: parsed.data.impactedEntities,
    });
    return text(
      recorded
        ? 'Recorded. The Verify Feature action will accompany your reply.'
        : 'Already recorded for this Turn; no change made.',
    );
  },
} satisfies PassThroughSubmissionToolDeclaration;
