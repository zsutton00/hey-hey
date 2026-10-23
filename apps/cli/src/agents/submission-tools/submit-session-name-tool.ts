/**
 * `submit_session_name` pass-through submission tool.
 *
 * Lets the entity-conversation agent self-name the active conversation by
 * updating its `title` via the platform's PATCH /conversations/{id} REST
 * endpoint. Wraps `updateConversationProxy` and forwards the platform's
 * response to the agent verbatim in an MCP `text` content block.
 *
 * The tool is registered unconditionally on the entity-conversation handler —
 * every entity-conversation surface gets the affordance, not just GOAL
 * conversations.
 */

import type { SubmissionToolAuth } from './submission-tool-auth';
import type { PassThroughSubmissionToolDeclaration, SubmissionToolExecuteContext } from './types';
import { UpdateConversationProxy } from './update-conversation-proxy';

const SUBMIT_SESSION_NAME_TOOL_NAME = 'submit_session_name';

const NAME_MIN = 3;
const NAME_MAX = 80;

const SUBMIT_SESSION_NAME_INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string', minLength: NAME_MIN, maxLength: NAME_MAX },
  },
  required: ['name'],
} as const;

export interface SubmitSessionNameToolDependencies {
  auth: SubmissionToolAuth;
  apiBaseUrl: string;
  fetchImpl: typeof fetch;
}

export class SubmitSessionNameTool implements PassThroughSubmissionToolDeclaration {
  public readonly kind = 'pass_through' as const;
  public readonly name = SUBMIT_SESSION_NAME_TOOL_NAME;
  public readonly description =
    'Rename the active conversation so it has a stable, descriptive handle. Call once the conversation has produced enough material to pick a title (a specific entity, a concrete decision, a recurring topic). `name` must be 3–80 characters.';
  public readonly inputSchema = SUBMIT_SESSION_NAME_INPUT_SCHEMA as unknown as Record<
    string,
    unknown
  >;
  private readonly updateConversationProxy: UpdateConversationProxy;

  public constructor(dependencies: SubmitSessionNameToolDependencies) {
    this.updateConversationProxy = new UpdateConversationProxy({
      auth: dependencies.auth,
      apiBaseUrl: dependencies.apiBaseUrl,
      fetchImpl: dependencies.fetchImpl,
    });
  }

  public readonly execute = async (ctx: SubmissionToolExecuteContext) => {
    const run = ctx.run;
    if (!run) {
      throw new Error('submit_session_name wrapper: ctx.run is required for pass-through tools');
    }

    const nameRaw = ctx.args['name'];
    if (typeof nameRaw !== 'string') {
      throw new Error('submit_session_name wrapper: name must be a string');
    }
    const name = nameRaw.trim();
    if (name.length < NAME_MIN || name.length > NAME_MAX) {
      throw new Error(
        `submit_session_name wrapper: name must be ${NAME_MIN}-${NAME_MAX} characters after trimming`,
      );
    }

    const result = await this.updateConversationProxy.update({
      runId: ctx.runId,
      conversationId: run.conversationId,
      projectId: run.projectId,
      title: name,
    });

    return { content: result.content };
  };
}
