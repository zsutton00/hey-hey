/**
 * message.service — the wire-edge adapter for the `sendMessage` entrypoint
 * (reached via the signed-trigger dispatcher).
 *
 * This service owns ZERO Session/Run/Turn behavior. Its job is:
 *
 *   1. Translate the `workflow-defined` wire sentinel into a concrete
 *      `LocalPromptType` via the platform's `getConversationPromptType`
 *      endpoint. This is genuinely an edge concern — the CLI's Run layer
 *      has no knowledge of the platform's workflow-node registry.
 *   2. Look up (or register) the active Run for the incoming request.
 *   3. Hand the concrete request to `run.handleMessage(input)`.
 *   4. Build the HTTP-shape acknowledgment response.
 *
 * Everything else — prompt resolution, message posting, handler lookup,
 * submission-tool registration, runner pick, Turn construction, queue
 * draining, coalesced batching, state persistence — lives on `Run`.
 */

import type { PromptTypeRegistry } from '../../agents/prompt-type-registry';
import type {
  DefaultApiGetMessageRequest,
  WorkflowsApiGetConversationPromptTypeRequest,
} from '../../shared/api';
import type { AgenticSession } from '../../session/index';
import type {
  LocalRunPromptRequest,
  LocalSubmitPromptResponse,
  SendMessageOptions,
} from '../../shared/agent-bridge-contract/contract';
import {
  resolvePromptText,
  toInternalRunPromptRequest,
} from '../../shared/agent-bridge-contract/contract';
import { LocalPromptType } from '../../shared/agent-bridge-contract/generated/api';
import { LocalAgentApiError } from '../../shared/agent-bridge-contract/errors';
import type { ServerLogger } from '../logger';
import { requestContext } from '../request-context';
import type { Run } from '../../run/run';
import type { RunRegistry } from '../../run/run-registry';
import type { OperationTimelineRegistry } from '../input-admission/operation-timeline';
import { createRunArgsFromSession } from '../../run/run-activation';
import {
  TriggerPayloadValidationError,
  validateTriggerPayload,
} from '../conversation-dispatch/trigger-payload-schemas';
import { toLocalRun, toRunPromptResult } from './run.service';
import type { RunService } from './run.service';
import {
  interpretPromptTypeResponse,
  type PromptTypeResponseRaw,
  type WorkflowDispatchIdentity,
  type WorkflowDispatchVerdict,
} from './workflow-dispatch-verdict';

/**
 * Narrow interface for the platform's workflow prompt-type lookup. Accepts
 * the generated `WorkflowsApi.getConversationPromptType` shape without
 * requiring a nominal `Pick<WorkflowsApi, ...>` — the CLI and ui-common
 * each generate their own `WorkflowsApi` from the same OpenAPI spec but
 * bundle slightly different axios versions, so the `Pick` types are not
 * assignable across them even though the shape matches.
 */
export interface WorkflowsPromptTypeApiClient {
  getConversationPromptType(
    request: WorkflowsApiGetConversationPromptTypeRequest,
  ): Promise<PromptTypeResponseRaw>;
}

/**
 * Narrow interface for the platform's single-message lookup. The CLI
 * fetches the canonical trigger message when the workflow-defined
 * sentinel resolves to a non-null `triggerMessageId` so the trigger's
 * `data.triggersAgent` payload becomes the source of truth — the wire
 * payload is treated as advisory and may drift across multi-tab UIs.
 *
 * Typed structurally rather than against the full generated
 * `MessageResponseDto` for the same reason as `WorkflowsPromptTypeApiClient`:
 * the CLI and ui-common each generate their own client from the same OpenAPI
 * spec, and `triggersAgent.payload` now `$ref`s the shared `RunCreatePayload`
 * union on the CLI side while ui-common's copy is still the loose object — so
 * the full DTO is not assignable across the two even though the shape matches.
 * The consumer re-derives and zod-validates `triggersAgent` anyway, so it
 * only needs the discriminator and the raw `triggersAgent` here.
 */
export interface MessagesGetMessageApiClient {
  getMessage(request: DefaultApiGetMessageRequest): Promise<{
    data?: {
      data?: {
        id?: string;
        projectId?: string;
        conversationId?: string;
        type?: string;
        data: {
          type?: string;
          response?: string;
          comment?: string;
          agentInput?: { userMessage?: string };
          triggersAgent?: unknown;
        };
      };
    };
  }>;
}

export interface MessageServiceDependencies {
  logger: ServerLogger;
  runService: RunService;
  runRegistry: RunRegistry;
  promptTypeRegistry: PromptTypeRegistry;
  workflowsApi: WorkflowsPromptTypeApiClient;
  messagesApi: MessagesGetMessageApiClient;
  operationTimeline?: OperationTimelineRegistry;
}

export class MessageService {
  public constructor(private readonly dependencies: MessageServiceDependencies) {}

  public async readWorkflowVerdict(
    identity: WorkflowDispatchIdentity,
  ): Promise<WorkflowDispatchVerdict> {
    const response = await this.dependencies.workflowsApi.getConversationPromptType(identity);
    const actions = response.data?.data?.actions;
    if (
      actions != null &&
      (!Array.isArray(actions) ||
        !actions.every((action) => typeof action === 'string' && action.length > 0))
    ) {
      this.dependencies.logger.error('message_service.workflow_verdict.actions_invalid', {
        conversationId: identity.conversationId,
        actionsType: Array.isArray(actions) ? 'array' : typeof actions,
      });
      throw new Error('Workflow verdict included an invalid current action vocabulary.');
    }
    return interpretPromptTypeResponse(response);
  }

  public async readAssistantMessage(input: {
    organizationId: string;
    projectId: string;
    conversationId: string;
    messageId: string;
  }): Promise<{ messageId: string; content: string } | null> {
    const response = await this.dependencies.messagesApi.getMessage({
      organizationId: input.organizationId,
      projectId: input.projectId,
      id: input.messageId,
    });
    const message = response.data?.data;
    if (
      message?.id !== input.messageId ||
      message.projectId !== input.projectId ||
      message.conversationId !== input.conversationId ||
      message.type !== 'SYSTEM' ||
      message.data.type !== 'AGENT' ||
      typeof message.data.response !== 'string' ||
      message.data.response.length === 0
    ) {
      return null;
    }
    return { messageId: message.id, content: message.data.response };
  }

  public async readUserMessage(input: {
    organizationId: string;
    projectId: string;
    conversationId: string;
    messageId: string;
  }): Promise<{ messageId: string; content: string } | null> {
    const response = await this.dependencies.messagesApi.getMessage({
      organizationId: input.organizationId,
      projectId: input.projectId,
      id: input.messageId,
    });
    const message = response.data?.data;
    const content = message?.data.agentInput?.userMessage ?? message?.data.comment;
    if (
      message?.id !== input.messageId ||
      message.projectId !== input.projectId ||
      message.conversationId !== input.conversationId ||
      message.type !== 'USER' ||
      typeof content !== 'string' ||
      content.trim().length === 0
    ) {
      return null;
    }
    return { messageId: message.id, content };
  }

  public async sendMessage(
    runId: string,
    input: LocalRunPromptRequest,
    options?: SendMessageOptions,
  ): Promise<LocalSubmitPromptResponse> {
    this.log('debug', 'local.service.send_message.started', {
      runId,
      promptType: input.promptType,
      hasUserMessage: Boolean(resolvePromptText(input)),
      hasPayload: input.payload != null,
    });

    const located = await this.dependencies.runService.activateRunByAnyId(runId);
    if (!located) {
      throw new LocalAgentApiError('RUN_NOT_FOUND', `Unknown coding run: ${runId}`, 404);
    }
    const session = located.agenticSession;
    if (options?.admittedInput) {
      this.dependencies.operationTimeline?.mark(options.admittedInput.turnId, 'runReady');
      this.dependencies.operationTimeline?.updateMetadata(options.admittedInput.turnId, {
        runId,
        agentSessionId: session.agentic_session_id,
      });
    }

    const workflowResolutionStartedAt = performance.now();
    let resolvedInput: LocalRunPromptRequest;
    try {
      resolvedInput = await this.resolveWireWorkflowDefined(input, session);
    } finally {
      if (options?.admittedInput) {
        this.dependencies.operationTimeline?.recordDuration(
          options.admittedInput.turnId,
          'workflowResolvedMs',
          performance.now() - workflowResolutionStartedAt,
        );
      }
    }
    if (options?.admittedInput) {
      this.dependencies.operationTimeline?.updateMetadata(options.admittedInput.turnId, {
        promptType: resolvedInput.promptType,
      });
    }

    if (!this.dependencies.promptTypeRegistry.get(resolvedInput.promptType)) {
      this.log('error', 'local.service.send_message.prompt_type_unregistered', {
        runId,
        promptType: resolvedInput.promptType,
      });
      throw new LocalAgentApiError(
        'INVALID_REQUEST',
        `No PromptHandler registered for promptType="${resolvedInput.promptType}".`,
        400,
      );
    }

    const run = this.getOrCreateRun(session);
    await run.handleMessage(toInternalRunPromptRequest(resolvedInput), options);
    return this.buildAcceptedResponse(session);
  }

  private log(
    level: 'trace' | 'debug' | 'info' | 'warn' | 'error',
    event: string,
    fields: Record<string, unknown> = {},
  ): void {
    requestContext.log(this.dependencies.logger, level, event, fields);
  }

  /**
   * Fetch the canonical workflow trigger message and re-derive its
   * promptType/nodeId/payload. Used by the workflow-defined sentinel
   * resolver to anchor the dispatch on the trigger the platform says is
   * pending — the wire payload is treated as advisory and may drift
   * across multi-tab UIs.
   *
   * 404 / missing dto / non-SYSTEM / missing `triggersAgent` all collapse
   * to a single 400 ("Workflow trigger no longer pending") — the trigger
   * we were told to honour is no longer addressable. promptType or nodeId
   * drift, and zod validation errors, surface as their own 400s so the
   * caller can distinguish.
   */
  private async fetchAndValidateTriggerPayload(args: {
    triggerMessageId: string;
    expectedPromptType: LocalPromptType;
    expectedNodeId: string | null;
    organizationId: string;
    projectId: string;
    runId: string;
    conversationId: string;
  }): Promise<{ payload: unknown; nodeId: string; triggerMessageId: string }> {
    this.log('debug', 'local.service.send_message.workflow_defined_trigger_payload.fetch_started', {
      runId: args.runId,
      conversationId: args.conversationId,
      triggerMessageId: args.triggerMessageId,
      expectedPromptType: args.expectedPromptType,
      expectedNodeId: args.expectedNodeId,
    });

    let response: Awaited<ReturnType<MessagesGetMessageApiClient['getMessage']>>;
    try {
      response = await this.dependencies.messagesApi.getMessage({
        id: args.triggerMessageId,
        projectId: args.projectId,
        organizationId: args.organizationId,
      });
    } catch (error) {
      const status = (error as { response?: { status?: number } } | null)?.response?.status;
      if (status === 404) {
        this.log(
          'warn',
          'local.service.send_message.workflow_defined_trigger_payload.fetch_not_found',
          {
            runId: args.runId,
            conversationId: args.conversationId,
            triggerMessageId: args.triggerMessageId,
          },
        );
        throw new LocalAgentApiError(
          'INVALID_REQUEST',
          'Workflow trigger no longer pending',
          400,
          error,
        );
      }
      throw error;
    }

    const dto = response.data?.data;
    if (!dto || dto.type !== 'SYSTEM' || !dto.data.triggersAgent) {
      this.log(
        'warn',
        'local.service.send_message.workflow_defined_trigger_payload.fetch_invalid_shape',
        {
          runId: args.runId,
          conversationId: args.conversationId,
          triggerMessageId: args.triggerMessageId,
          hasDto: Boolean(dto),
          dtoType: dto?.type ?? null,
          hasTriggersAgent: Boolean(dto && dto.type === 'SYSTEM' && dto.data.triggersAgent),
        },
      );
      throw new LocalAgentApiError('INVALID_REQUEST', 'Workflow trigger no longer pending', 400);
    }

    // AgentTrigger is generated as a discriminated union; some variants
    // (currently `implement`) declare no payload, so widen locally to the
    // shared wire shape so the optional-payload reads below typecheck.
    const triggersAgent = dto.data.triggersAgent as {
      promptType: string;
      nodeId: string;
      payload?: unknown;
    };
    if (triggersAgent.promptType !== args.expectedPromptType) {
      this.log(
        'error',
        'local.service.send_message.workflow_defined_trigger_payload.prompt_type_drift',
        {
          runId: args.runId,
          conversationId: args.conversationId,
          triggerMessageId: args.triggerMessageId,
          expectedPromptType: args.expectedPromptType,
          triggerPromptType: triggersAgent.promptType,
        },
      );
      throw new LocalAgentApiError(
        'INVALID_REQUEST',
        `Trigger promptType "${triggersAgent.promptType}" differs from workflow-resolved promptType "${args.expectedPromptType}" for trigger ${args.triggerMessageId}.`,
        400,
      );
    }

    if (args.expectedNodeId !== null && triggersAgent.nodeId !== args.expectedNodeId) {
      this.log(
        'error',
        'local.service.send_message.workflow_defined_trigger_payload.node_id_drift',
        {
          runId: args.runId,
          conversationId: args.conversationId,
          triggerMessageId: args.triggerMessageId,
          expectedNodeId: args.expectedNodeId,
          triggerNodeId: triggersAgent.nodeId,
        },
      );
      throw new LocalAgentApiError(
        'INVALID_REQUEST',
        `Trigger nodeId "${triggersAgent.nodeId}" differs from workflow-resolved nodeId "${args.expectedNodeId}" for trigger ${args.triggerMessageId}.`,
        400,
      );
    }

    let validatedPayload: unknown;
    try {
      validatedPayload = validateTriggerPayload(args.expectedPromptType, triggersAgent.payload);
    } catch (error) {
      if (error instanceof TriggerPayloadValidationError) {
        this.log(
          'error',
          'local.service.send_message.workflow_defined_trigger_payload.payload_invalid',
          {
            runId: args.runId,
            conversationId: args.conversationId,
            triggerMessageId: args.triggerMessageId,
            promptType: args.expectedPromptType,
            issues: error.issues,
          },
        );
        throw new LocalAgentApiError('INVALID_REQUEST', error.message, 400, error);
      }
      throw error;
    }

    this.log(
      'info',
      'local.service.send_message.workflow_defined_trigger_payload.payload_fetched',
      {
        runId: args.runId,
        conversationId: args.conversationId,
        triggerMessageId: args.triggerMessageId,
        promptType: args.expectedPromptType,
        nodeId: triggersAgent.nodeId,
        hasPayload: triggersAgent.payload !== undefined,
      },
    );

    return {
      payload: validatedPayload,
      nodeId: triggersAgent.nodeId,
      triggerMessageId: args.triggerMessageId,
    };
  }

  /**
   * Translate the `workflow-defined` wire sentinel into a concrete
   * `LocalPromptType`. Null or unregistered responses are hard 400s — the
   * runtime never carries the sentinel past this point.
   *
   * When the platform also returns a non-null `triggerMessageId`, the CLI
   * fetches the canonical trigger message and re-derives the payload,
   * nodeId, and triggerMessageId from `data.triggersAgent`. The wire
   * payload is advisory — the trigger message is the source of truth.
   */
  private async resolveWireWorkflowDefined(
    input: LocalRunPromptRequest,
    session: AgenticSession,
  ): Promise<LocalRunPromptRequest> {
    if (input.promptType !== LocalPromptType.WorkflowDefined) return input;

    const orgId = session.contextMetadata?.organizationId ?? '';
    const projectId = session.contextMetadata?.projectId ?? '';
    const conversationId = session.conversationId ?? '';
    if (!orgId || !projectId || !conversationId) {
      throw new LocalAgentApiError(
        'INVALID_REQUEST',
        `Cannot resolve "workflow-defined" promptType for session ${session.agentic_session_id}: ` +
          'session is missing organization/project/conversation context.',
        400,
      );
    }

    const response = await this.dependencies.workflowsApi.getConversationPromptType({
      organizationId: orgId,
      projectId,
      conversationId,
    });
    const verdict = interpretPromptTypeResponse(response);

    if (verdict.state === 'live-non-agent') {
      // The workflow is alive but parked on a non-agent gate awaiting the
      // user. Dispatching the flow's terminalPromptType here is what produced
      // the "the plan is wrapped up" narration while the workflow was
      // actually waiting on the user: a plan-from-design-doc parked on a
      // review gate resolves to `plan_shaping_finalize`, the finalize agent.
      // Route to a conversational follow-up instead, explicitly clear the
      // completion identity (the turn answers no agent node), and mark the
      // request `awaitingUserReview` so the handler suppresses action tools
      // and the prompt states the workflow is waiting on the user.
      //
      // When the gate ships a review-aware persona (today: the feature-sync
      // review), route to that persona's prompt type instead and synthesize
      // its payload from the gate's design doc, plan, and outstanding flagged
      // items — sourced from the wire contract, never re-derived from
      // conversation text. Any other live gate keeps the generic fallback.
      const gate = verdict.gate;
      if (gate?.type === 'FEATURE_SYNC_REVIEW') {
        const userMessage =
          (input.payload as { userMessage?: string } | undefined)?.userMessage ?? '';
        this.log('info', 'local.service.send_message.workflow_defined_feature_sync_review', {
          runId: session.agentic_session_id,
          conversationId,
          planId: gate.planId,
          designDocId: gate.designDocId,
          discrepancyCount: gate.discrepancies.length,
        });
        return {
          ...input,
          promptType: LocalPromptType.PlanShapingFeatureSyncDiscuss,
          triggerContext: null,
          awaitingUserReview: true,
          payload: {
            promptType: LocalPromptType.PlanShapingFeatureSyncDiscuss,
            userMessage,
            planId: gate.planId,
            designDocId: gate.designDocId,
            discrepancies: gate.discrepancies,
          },
        };
      }

      this.log('info', 'local.service.send_message.workflow_defined_awaiting_user_review', {
        runId: session.agentic_session_id,
        conversationId,
        resolvedTerminalPromptType: verdict.promptType,
      });
      return {
        ...input,
        promptType: LocalPromptType.CodingFreeform,
        triggerContext: null,
        awaitingUserReview: true,
      };
    }

    const resolved = verdict.promptType;
    if (resolved === null) {
      this.log('warn', 'local.service.send_message.workflow_defined_resolution_null', {
        runId: session.agentic_session_id,
        conversationId,
      });
      throw new LocalAgentApiError(
        'INVALID_REQUEST',
        `No workflow-defined promptType available for conversation ${conversationId} — ` +
          'the conversation has no active workflow node with a declared promptType.',
        400,
      );
    }

    if (!this.dependencies.promptTypeRegistry.get(resolved)) {
      this.log('error', 'local.service.send_message.workflow_defined_unregistered', {
        runId: session.agentic_session_id,
        conversationId,
        resolved,
      });
      throw new LocalAgentApiError(
        'INVALID_REQUEST',
        `Workflow returned unregistered promptType "${resolved}" for conversation ${conversationId}.`,
        400,
      );
    }

    // Compare the workflow-resolved promptType against what the Run has
    // persisted from its prior turn. Drift here is the canonical
    // CLI-vs-server seam — the platform decided the next phase is X but the
    // Run was last running Y. Logged on every workflow-defined resolution so
    // the comparison is queryable per dispatch.
    const priorPersistedPromptType = session.promptType ?? null;
    this.log('info', 'local.service.send_message.workflow_defined_resolved', {
      runId: session.agentic_session_id,
      conversationId,
      resolved,
      triggerMessageId: verdict.state === 'agent-pending' ? verdict.triggerMessageId : null,
      nodeId: verdict.state === 'agent-pending' ? verdict.externalAgentNodeId : null,
      priorPersistedPromptType,
    });

    const resolvedPromptType = resolved as LocalRunPromptRequest['promptType'];

    if (verdict.state !== 'agent-pending') {
      return { ...input, promptType: resolvedPromptType, triggerContext: null };
    }

    const fetched = await this.fetchAndValidateTriggerPayload({
      triggerMessageId: verdict.triggerMessageId,
      expectedPromptType: resolvedPromptType,
      expectedNodeId: verdict.externalAgentNodeId,
      organizationId: orgId,
      projectId,
      runId: session.agentic_session_id,
      conversationId,
    });

    const wireTriggerCtx = input.triggerContext ?? null;
    if (
      (wireTriggerCtx?.externalAgentNodeId != null &&
        wireTriggerCtx.externalAgentNodeId !== fetched.nodeId) ||
      (wireTriggerCtx?.triggerMessageId != null &&
        wireTriggerCtx.triggerMessageId !== fetched.triggerMessageId)
    ) {
      this.log('warn', 'local.service.send_message.workflow_defined_trigger_drift', {
        runId: session.agentic_session_id,
        conversationId,
        wireExternalAgentNodeId: wireTriggerCtx?.externalAgentNodeId ?? null,
        resolvedExternalAgentNodeId: fetched.nodeId,
        wireTriggerMessageId: wireTriggerCtx?.triggerMessageId ?? null,
        resolvedTriggerMessageId: fetched.triggerMessageId,
      });
    }

    if (fetched.payload !== undefined && input.payload !== undefined) {
      this.log('info', 'local.service.send_message.workflow_defined_payload_merged', {
        runId: session.agentic_session_id,
        conversationId,
        triggerMessageId: fetched.triggerMessageId,
        promptType: resolvedPromptType,
      });
    }

    // Trigger payload supplies workflow-specific execution context (for example
    // plan ids); wire payload supplies user-turn context (userMessage). Wire
    // wins on conflicts so a user reply is never discarded. Deprecated
    // startupInput is not an authority and is never reconstructed here.
    // `fetched.payload` is typed `unknown`
    // because `validateTriggerPayload` returns the schema's `z.unknown()` shape;
    // narrow to a record before spreading so TS accepts the merge.
    const fetchedPayloadObj =
      fetched.payload !== undefined && fetched.payload !== null
        ? (fetched.payload as Record<string, unknown>)
        : undefined;
    const resolvedPayload =
      fetchedPayloadObj !== undefined || input.payload !== undefined
        ? ({ ...fetchedPayloadObj, ...input.payload } as LocalRunPromptRequest['payload'])
        : undefined;

    return {
      ...input,
      promptType: resolvedPromptType,
      ...(resolvedPayload !== undefined ? { payload: resolvedPayload } : {}),
      triggerContext: {
        externalAgentNodeId: fetched.nodeId,
        triggerMessageId: fetched.triggerMessageId,
      },
    };
  }

  private getOrCreateRun(session: AgenticSession): Run {
    const existing = this.dependencies.runRegistry.get(session.agentic_session_id);
    if (existing) {
      // Merge the freshly-resolved session snapshot so Turn code (which
      // reads `run.session` and never the store) sees any fields the store
      // mutated between Turns.
      existing.refreshSessionFields(session);
      return existing;
    }

    return this.dependencies.runRegistry.create(createRunArgsFromSession(session));
  }

  private buildAcceptedResponse(session: AgenticSession): LocalSubmitPromptResponse {
    return {
      result: toRunPromptResult({
        providerSessionId: session.provider_session_id,
        providerConversationId: session.provider_conversation_id,
        errorCount: 0,
      }),
      run: toLocalRun(session),
    };
  }
}
