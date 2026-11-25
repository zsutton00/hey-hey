import type {
  PassThroughSubmissionToolDeclaration,
  SubmissionToolExecuteContext,
  SubmissionToolPassThroughResult,
} from '../submission-tools/types';
import type {
  RequestWorktreeAttachArgs,
  WorktreeAttachRequestResult,
} from './worktree-attach-coordinator';

const REQUEST_WORKTREE_ATTACH_INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['serviceId', 'branch', 'reason'],
  properties: {
    serviceId: { type: 'string', minLength: 1 },
    branch: { type: 'string', minLength: 1 },
    reason: { type: 'string', minLength: 1 },
  },
} satisfies Record<string, unknown>;

const readRequiredString = (ctx: SubmissionToolExecuteContext, name: string): string => {
  const value = ctx.args[name];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`request_agent_session_worktree_attach requires a non-empty ${name}.`);
  }
  return value.trim();
};

const parseArguments = (ctx: SubmissionToolExecuteContext): RequestWorktreeAttachArgs => ({
  serviceId: readRequiredString(ctx, 'serviceId'),
  branch: readRequiredString(ctx, 'branch'),
  reason: readRequiredString(ctx, 'reason'),
});

const describeResult = (result: WorktreeAttachRequestResult): string => {
  switch (result.status) {
    case 'requested':
      return 'The worktree request is now awaiting user approval. Pause repository changes until the user decides.';
    case 'already_requested':
      return 'The same worktree request is already awaiting user review. Pause until the user decides.';
    case 'already_attached':
      return `Branch ${result.branch} is already attached at ${result.worktreePath}. Continue working there.`;
    case 'refused':
      return `Worktree request refused. ${result.reason}`;
  }
};

class RequestAgentSessionWorktreeAttachTool implements PassThroughSubmissionToolDeclaration {
  public readonly name = 'request_agent_session_worktree_attach';
  public readonly kind = 'pass_through' as const;
  public readonly description =
    'Ask the user to approve moving one Service already in the current coding session to an existing worktree of its repository, given the branch checked out there. It never creates a worktree or adds a repository.';
  public readonly inputSchema = REQUEST_WORKTREE_ATTACH_INPUT_SCHEMA;

  public async execute(
    ctx: SubmissionToolExecuteContext,
  ): Promise<SubmissionToolPassThroughResult> {
    const run = ctx.run;
    if (!run) {
      throw new Error('request_agent_session_worktree_attach requires an active Run.');
    }

    const result = await run.worktreeAttachCoordinator.request(parseArguments(ctx));

    return { content: [{ type: 'text', text: describeResult(result) }] };
  }
}

export const requestAgentSessionWorktreeAttachTool = new RequestAgentSessionWorktreeAttachTool();
