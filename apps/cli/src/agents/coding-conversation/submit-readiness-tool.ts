import {
  correctReadinessArgumentFinding,
  parseReadinessDispositionForSubmission,
  readinessDispositionInputSchema,
} from '../feature-sync/submission-tools';
import {
  SubmissionToolCorrectableError,
  type PassThroughSubmissionToolDeclaration,
} from '../submission-tools/types';

export const submitCodingConversationReadinessTool: PassThroughSubmissionToolDeclaration = {
  name: 'submit_implementation_readiness',
  kind: 'pass_through',
  description:
    'Validate and record a free-form implementation-readiness outcome. CLEAR is recorded immediately; REVIEW_REQUIRED is recorded from the structured response that ends the turn. Correct any reported error and retry before ending the turn.',
  inputSchema: readinessDispositionInputSchema,
  correctArgumentFinding: correctReadinessArgumentFinding,
  async execute({ args, run }) {
    if (!run) throw new Error('submit_implementation_readiness requires an active Run.');
    const disposition = parseReadinessDispositionForSubmission(args['disposition']);
    try {
      // The Run is the authority for free-form readiness. A CLEAR turn goes on
      // to the user's request instead of ending with a structured response, so
      // it is accepted here and resolves the gate before any coding follows.
      if (disposition.state === 'CLEAR') {
        await run.persistImplementationReadinessFromAgentResponse(disposition);
        return {
          content: [
            {
              type: 'text',
              text: 'Implementation readiness recorded as CLEAR. Continue with the request.',
            },
          ],
        };
      }
      run.validateImplementationReadinessFromAgentResponse(disposition);
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Readiness admission failed.';
      throw new SubmissionToolCorrectableError({
        reason,
        findings: [
          {
            field: '/disposition/sourceSnapshot',
            reason,
            correction:
              'Use the active Run source binding and retry, or continue without a readiness finding if the gate is already complete.',
          },
        ],
      });
    }
    return {
      content: [
        {
          type: 'text',
          text: 'Implementation-readiness finding validated. End the turn with the same structured REVIEW_REQUIRED response.',
        },
      ],
    };
  },
};
