import { Configuration, ConversationsApi } from '../../shared/api/generated';
import { MessageStatus, MessageType, type CreateSystemMessage } from '../../shared/api';
import { MessagePoster } from '../../run/message-poster';
import { resolveProfileDataDir } from '../../session/paths';
import type { AgenticSession } from '../../session/types';
import type { AgentOutputHandler } from '../agent-event-stream';
import { mapAgentOutputToSystemMessage } from '../message-mapping';
import { dispatchResponseType } from '../response-dispatch';
import type { PromptTypeHandlerDeps } from '../prompt-type-handler';
import { agentSearchHandler } from '../agent-search/agent-search.handler';
import type {
  CreateUserMessage,
  SubmitExecutableUserMessageRequestDto,
} from '../../shared/api/generated/api';

import type { EvalExecutionContext } from './eval-execution-context';

const isSystemMessage = (
  dto: CreateSystemMessage | CreateUserMessage | SubmitExecutableUserMessageRequestDto,
): dto is CreateSystemMessage => dto.type === MessageType.System;

/** Saves live target messages through the ordinary mapping and message transport. */
export class EvalTargetMessages {
  private pending: Promise<void> = Promise.resolve();
  private completedProviderText: string | null = null;

  public constructor(
    private readonly poster: MessagePoster,
    private readonly session: AgenticSession,
    private readonly execution: EvalExecutionContext,
    private readonly handlerId: string,
    private readonly logger: PromptTypeHandlerDeps['logger'],
  ) {}

  public static async create(
    session: AgenticSession,
    execution: EvalExecutionContext,
    handlerId: string,
    deps: PromptTypeHandlerDeps,
  ): Promise<EvalTargetMessages> {
    const client = new ConversationsApi(
      new Configuration({
        accessToken: await deps.auth.getAccessToken(),
        basePath: deps.apiBaseUrl,
      }),
    );
    const poster = new MessagePoster({
      logger: deps.logger,
      dataDir: resolveProfileDataDir(),
      apiClient: {
        postMessage: ({ organizationId, projectId, createMessageDto }) => {
          if (!isSystemMessage(createMessageDto)) {
            throw new Error('Eval target evidence must be an inert system message.');
          }
          return client.postMessage(
            {
              organizationId,
              projectId,
              postMessageRequest: {
                ...createMessageDto,
                type: 'SYSTEM',
                data: createMessageDto.data,
              },
            },
            {
              headers: {
                'X-Agent-Session-ID': execution.targetSessionId,
                'X-Conversation-ID': execution.targetConversationId,
              },
            },
          );
        },
        updateMessage: (request) => client.updateMessage(request),
      },
    });
    return new EvalTargetMessages(poster, session, execution, handlerId, deps.logger);
  }

  public async savePrompt(text: string): Promise<void> {
    await this.save(text, new Date().toISOString(), null, true);
  }

  public readonly onAgentOutput: AgentOutputHandler = ({ event }) => {
    let text: string;
    if (event.eventType === 'agent_message') {
      // Codex emits each completed message, then echoes the final one as agent_output.
      const canonical = event.payload['canonical_event'];
      if (typeof canonical !== 'object' || canonical === null || !('status' in canonical)) return;
      const status = canonical.status;
      if (
        typeof status !== 'object' ||
        status === null ||
        !('message' in status) ||
        typeof status.message !== 'string'
      )
        return;
      text = status.message;
      this.completedProviderText = text;
    } else {
      if (event.eventType !== 'agent_output' || event.payload['messageType'] !== 'assistant')
        return;
      const summary = event.payload['summary'];
      if (typeof summary !== 'string') return;
      if (summary === this.completedProviderText) {
        this.completedProviderText = null;
        return;
      }
      text = summary;
    }
    this.pending = this.pending.then(() =>
      this.save(text, event.timestamp, event.sessionId, false),
    );
    // Provider callbacks are synchronous; surface persistence failures when the launch drains.
    void this.pending.catch(() => {});
  };

  public async drain(): Promise<void> {
    await this.pending;
  }

  private async save(
    text: string,
    timestamp: string,
    providerSessionId: string | null,
    prompt: boolean,
  ): Promise<void> {
    const { projectId, organizationId } = this.session.contextMetadata;
    const mapped = mapAgentOutputToSystemMessage({
      text,
      timestamp,
      projectId,
      conversationId: this.execution.targetConversationId,
      expectedResponseTypes: [],
    });
    if (!mapped) return;
    const dispatched = prompt
      ? null
      : dispatchResponseType(
          text,
          {
            taskId: null,
            promptType: this.handlerId,
            expectedResponseTypes:
              this.handlerId === agentSearchHandler.id
                ? (agentSearchHandler.expectedResponseTypes ?? [])
                : [],
            emitLegacyStartupPlanUiElement: false,
          },
          this.logger,
        );
    const dto: CreateSystemMessage = {
      ...mapped.message,
      parentMessageId: null,
      status: MessageStatus.Completed,
      data: {
        ...(dispatched?.matched
          ? (dispatched.updateData.data as CreateSystemMessage['data'])
          : mapped.message.data),
        ...(prompt ? { title: 'Starting Prompt', response: text, uiElements: [] } : {}),
        ragEnabled: false,
      },
    };
    await this.poster.createOutOfBand({
      organizationId,
      projectId,
      conversationId: this.execution.targetConversationId,
      dto,
      stamp: prompt ? null : { providerSessionId, promptHandler: this.handlerId },
    });
  }
}
