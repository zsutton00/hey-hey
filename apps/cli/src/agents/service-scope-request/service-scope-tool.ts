import type {
  PassThroughSubmissionToolDeclaration,
  SubmissionToolExecuteContext,
  SubmissionToolPassThroughResult,
} from '../submission-tools/types';
import type { RequestAgentSessionServiceScopeArgs } from './service-scope-types';

const REQUEST_SERVICE_SCOPE_INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['serviceIds', 'reason'],
  properties: {
    serviceIds: {
      type: 'array',
      minItems: 1,
      uniqueItems: true,
      items: { type: 'string', minLength: 1 },
    },
    reason: { type: 'string', minLength: 1 },
  },
} satisfies Record<string, unknown>;

const parseArguments = (ctx: SubmissionToolExecuteContext): RequestAgentSessionServiceScopeArgs => {
  const rawServiceIds = ctx.args['serviceIds'];
  if (
    !Array.isArray(rawServiceIds) ||
    rawServiceIds.length === 0 ||
    rawServiceIds.some(
      (serviceId) => typeof serviceId !== 'string' || serviceId.trim().length === 0,
    )
  ) {
    throw new Error('request_agent_session_service_scope requires non-empty serviceIds.');
  }

  const rawReason = ctx.args['reason'];
  if (typeof rawReason !== 'string' || rawReason.trim().length === 0) {
    throw new Error('request_agent_session_service_scope requires a non-empty reason.');
  }

  return {
    serviceIds: rawServiceIds.map((serviceId) => serviceId.trim()),
    reason: rawReason.trim(),
  };
};

class RequestAgentSessionServiceScopeTool implements PassThroughSubmissionToolDeclaration {
  public readonly name = 'request_agent_session_service_scope';
  public readonly kind = 'pass_through' as const;
  public readonly description =
    'Ask the user to approve adding project Services to the current coding session when a repository change requires work outside the selected Service scope.';
  public readonly inputSchema = REQUEST_SERVICE_SCOPE_INPUT_SCHEMA;

  public async execute(
    ctx: SubmissionToolExecuteContext,
  ): Promise<SubmissionToolPassThroughResult> {
    const run = ctx.run;
    if (!run) {
      throw new Error('request_agent_session_service_scope requires an active Run.');
    }

    const result = await run.serviceScopeCoordinator.request(parseArguments(ctx));
    if (result.status === 'already_in_scope') {
      return {
        content: [
          {
            type: 'text',
            text: `All requested Services are already in scope: ${result.serviceIds.join(', ')}.`,
          },
        ],
      };
    }

    return {
      content: [
        {
          type: 'text',
          text:
            result.status === 'already_requested'
              ? 'The same Service-scope request is already awaiting user review. Pause until the user decides.'
              : 'Service-scope review is now awaiting user approval. Pause repository changes until the user decides.',
        },
      ],
    };
  }
}

export const requestAgentSessionServiceScopeTool = new RequestAgentSessionServiceScopeTool();
