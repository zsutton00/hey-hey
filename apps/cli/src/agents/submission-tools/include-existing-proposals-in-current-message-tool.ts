import type {
  PassThroughSubmissionToolDeclaration,
  SubmissionToolExecuteContext,
} from './types';

export const INCLUDE_EXISTING_PROPOSALS_TOOL_NAME =
  'include_existing_proposals_in_current_message';

export class IncludeExistingProposalsInCurrentMessageTool
  implements PassThroughSubmissionToolDeclaration
{
  public readonly kind = 'pass_through' as const;
  public readonly name = INCLUDE_EXISTING_PROPOSALS_TOOL_NAME;
  public readonly description =
    'Include existing canonical Proposal IDs in the current final Message, preserving first-seen order.';
  public readonly inputSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      proposalIds: {
        type: 'array',
        minItems: 1,
        items: { type: 'string', format: 'uuid' },
      },
    },
    required: ['proposalIds'],
  } as const;

  public execute(ctx: SubmissionToolExecuteContext) {
    const turn = ctx.run?.activeTurn;
    if (!turn) throw new Error('No active Turn is available for Proposal inclusion');
    const proposalIds = ctx.args['proposalIds'];
    if (!Array.isArray(proposalIds)) throw new Error('proposalIds must be an array');
    turn.includeExistingProposals(proposalIds as string[]);
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({ proposalIds: turn.readCreatedProposalIds() }),
        },
      ],
    };
  }
}
