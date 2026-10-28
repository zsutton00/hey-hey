/**
 * Prompt resolution — single source for building the provider prompt string
 * and the user-facing message text for one Turn.
 *
 * For `provider_session` handlers the resolved prompt is what reaches the
 * Run's persisted Claude session. For `subagent` handlers the runtime
 * `SubAgent` class rebuilds its own prompt from the same handler hooks
 * (`buildPrompt`, `addUserMessage`) inside the isolated session — the
 * resolver still runs handler.prepare so the enriched payload flows through
 * to the subagent, but it does not prepend `previousProviderSession` or the
 * report chain (the subagent path composes those itself).
 */

import type { AgenticSession, PreviousProviderSession, RunMemo } from '../session/types';
import {
  resolvePromptText,
  type LocalAnyPromptPayload,
  type InternalRunPromptRequest,
} from '../shared/agent-bridge-contract/contract';
import type {
  AgentStartupPromptInputResult,
  AgentStartupPromptTemplate,
  PromptTypeHandlerDeps,
  PromptTypeHandlerContext,
  RecentUserReply,
  PromptTypeHandler,
  UserLaunchablePromptTypeHandler,
} from '../agents/prompt-type-handler';
import {
  AgentStartupPromptInputError,
  isEntityPromptTemplateFocalType,
  type AgentStartupPromptInputRequest,
} from '../commands/agent-startup-prompt-input';
import { LocalAgentApiError } from '../shared/agent-bridge-contract/errors';
import { buildServiceContextNote, mentionFormatReminder } from '../agents/prompts/common';
import { renderReportChainBlock } from '../agents/prompts/report-chain';
import { renderMemoBlock } from '../agents/prompts/memo-block';
import { createReadinessSourceSnapshotFromStartupInput } from '../agents/implementation-readiness/source-snapshot';
import { resolvePromptString } from '../agents/prompts/resolve';
import { buildStartingMessage } from '../agents/prompts/starting-message';
import type { ReportChainEntry } from './types';
import type { RecoverableTurnCheckpoint } from '../session/types';
import type {
  CachedProviderSessionStartupSegments,
  ProviderSessionDecision,
  ProviderSessionStartupSegments,
} from './provider-session-startup-input';

export const renderServiceScopeRecovery = (checkpoint: RecoverableTurnCheckpoint): string => {
  const lines = [
    '## Interrupted work checkpoint',
    '',
    'Execution crossed a provider-session boundary after Service scope approval. Continue from this recoverable checkpoint; do not repeat completed work.',
    '',
    `Completed actions: ${checkpoint.completedActions.length > 0 ? checkpoint.completedActions.join('; ') : 'none recorded'}`,
    `Discoveries: ${checkpoint.discoveries.length > 0 ? checkpoint.discoveries.join('; ') : 'none recorded'}`,
    `Tool results: ${checkpoint.toolResults.length > 0 ? checkpoint.toolResults.join('; ') : 'none recorded'}`,
    `Changed files: ${checkpoint.changedFiles.length > 0 ? checkpoint.changedFiles.map((fact) => `${fact.serviceId}:${fact.repoRelativePath}`).join(', ') : 'none recorded'}`,
    `Next action: ${checkpoint.nextAction ?? 'continue the approved work from the visible conversation context'}`,
  ];
  return lines.join('\n');
};

export interface ResolvePromptRunState {
  /**
   * The promptType active on the Run before this Turn begins. Used only as
   * the "previous" value for handler-swap detection against the incoming
   * request's concrete `input.promptType`. No fallback semantics — the
   * request is authoritative for this Turn.
   */
  currentPromptType: string | null;
  /**
   * True when no provider session exists yet on the Run (this is the first
   * Turn). Drives the first-turn vs follow-up branch split.
   */
  isFirstTurn: boolean;
  /**
   * The previous provider session's final output — the last text message the
   * stream emitted — captured at assistant_complete time and stashed on the
   * session. Prepended to the resolved prompt for `provider_session` follow-ups
   * so the next phase sees the prior output as context. Null when none is
   * recorded.
   */
  previousProviderSession: PreviousProviderSession | null;
  /**
   * Snapshot of the Run's append-only report chain at Turn-construction
   * time. Sourced once per Turn from `Run.readReportChain()` and never
   * mutated by the resolver — the resolver is pure and the snapshot's
   * entries are frozen on append. Prepended to `resolvedPrompt` for
   * `provider_session` handlers so the next turn sees every prior report
   * as context. Subagent handlers compose their own chain block inside the
   * `SubAgent` class.
   */
  reportChain: ReadonlyArray<Readonly<ReportChainEntry>>;
  /**
   * The Run's accumulating, never-consumed memo list at Turn-construction
   * time. Prepended on provider-session mint for `provider_session` handlers
   * (after `previousProviderSession`, before the report chain) so each newly
   * initialized provider context sees the carried-forward memos exactly once. Never cleared — unlike
   * `previousProviderSession`, memos are not consumed when read.
   */
  memos: ReadonlyArray<RunMemo>;
  /** Cached authoritative startup projection from the first entity-scoped turn. */
  startupPromptInput?: AgentStartupPromptInputResult | null;
  /** Stable effective template retained while entity Context is refreshed. */
  startupPromptTemplate?: AgentStartupPromptTemplate | null;
  /** Stable handler instructions retained for provider-session remints. */
  cachedProviderSessionStartupSegments?: CachedProviderSessionStartupSegments | null;
  /** Prompt types of handlers that started a Turn on the Run before this one. */
  startedPromptTypes: ReadonlySet<string>;
}

export interface ResolvePromptArgs {
  handler: PromptTypeHandler<unknown>;
  /** Plain session data; no live Run instance is required. */
  run: AgenticSession;
  runState: ResolvePromptRunState;
  input: InternalRunPromptRequest;
  handlerDeps: PromptTypeHandlerDeps;
  /** The Turn this prompt is for; handlers that record work done during `prepare` key it by this. */
  turnId: string;
  /** The Run's abort signal, read when `prepare` needs it. */
  abortSignal: () => AbortSignal | undefined;
  recentUserReplies: ReadonlyArray<RecentUserReply>;
  triggerParentMessageId: string | null;
  /** Pending readiness finding when Run routed this Turn as its clarification. */
  implementationReadinessClarification?: PromptTypeHandlerContext['implementationReadinessClarification'];
  projectModeBundleDirectory?: string;
  repositorySnapshotDirectory?: string;
  /**
   * Optional Run-owned provider-session decision. When absent, resolution
   * makes no mint/resume decision and does not deliver retained memos.
   */
  providerSessionDecision?: ProviderSessionDecision;
  /** True when this Turn will mint a provider session and needs fresh Context. */
  refreshStartupPromptInput?: boolean;
  /**
   * Optional Run-only hook for Service-scope reconciliation. Omit when
   * resolving without a Run; the prepared payload is then used unchanged.
   * Run-owned pre-build transition for state declared by a prepared handler
   * payload. The returned payload is what the handler renders and what the
   * Turn receives, so prompt context cannot lag behind the reconciled Run.
   */
  onPreparedPayload?(args: {
    handler: PromptTypeHandler<unknown>;
    payload: unknown;
    requestStartupPromptInputRefresh: () => void;
  }): Promise<unknown>;
  /**
   * Optional Run-only hook for readiness admission. No admission runs when
   * omitted. Run admission must happen after authoritative startup Context is
   * loaded but before handler preparation or prompt construction. The
   * resolver invokes it again if preparation requests a fresh Context.
   */
  onStartupPromptInputResolved?(
    startupPromptInput: AgentStartupPromptInputResult | null,
  ): Promise<void>;
}

/**
 * Empty snapshot for resolving a first turn without constructing a Run.
 * Each call has fresh collections, no prior reports or memos, and no cached
 * startup input, template, or provider instructions. This does not own or
 * persist state; a live Run continues supplying its own snapshot instead.
 */
export const createFirstTurnPromptRunState = (): ResolvePromptRunState => ({
  currentPromptType: null,
  isFirstTurn: true,
  previousProviderSession: null,
  reportChain: [],
  memos: [],
  startedPromptTypes: new Set(),
});

export interface ResolvePromptResult {
  /**
   * The prompt string passed to the provider. `null` only when the handler
   * runs on the subagent runner — the runtime `SubAgent` composes its own
   * prompt inside the isolated session, so the main provider never sees one.
   */
  resolvedPrompt: string | null;
  /** Human-readable "starting…" message for the agent placeholder, if any. */
  startingMessage: string | undefined;
  /**
   * Context returned by `handler.prepare` that the caller must persist on
   * the run store. Kept out of the resolver so the function stays pure.
   */
  sessionContext: Record<string, unknown> | undefined;
  /**
   * The enriched payload returned by `handler.prepare`, or `undefined` when
   * the handler has no `prepare` step. Downstream consumers (e.g.
   * `SubagentRunner`) must prefer this over the raw `input.payload` so the
   * enrichment work done during prepare reaches the runner.
   */
  preparedPayload: unknown | undefined;
  /**
   * True when the effective promptType differs from the Run's prior
   * promptType — the caller uses this to re-ground the agent by prepending
   * the rebuilt system prompt to the user message.
   */
  promptTypeChanged: boolean;
  /** True when the handler runs on the subagent runner. */
  isSubagentOwned: boolean;
  /**
   * True when the resolver consumed `runState.previousProviderSession` by
   * prepending it to `resolvedPrompt`. The caller clears the field on the
   * Run so the same value is never threaded forward twice. False when none
   * was recorded, the handler runs on the subagent runner, or no resolved
   * prompt was produced.
   */
  consumedPreviousProviderSession: boolean;
  /** Authoritative startup projection to retain on the Run and pass to runners. */
  startupPromptInput?: AgentStartupPromptInputResult;
  /** Stable effective template retained independently from the rendered projection. */
  startupPromptTemplate?: AgentStartupPromptTemplate;
  /** Cache-aware semantic parts for a fresh provider session. */
  providerSessionStartupSegments?: ProviderSessionStartupSegments;
}

const isUserLaunchable = (
  handler: PromptTypeHandler<unknown>,
): handler is UserLaunchablePromptTypeHandler<{ userMessage?: string }> =>
  typeof (handler as { addUserMessage?: unknown }).addUserMessage === 'function';

export const resolvePrompt = async (args: ResolvePromptArgs): Promise<ResolvePromptResult> => {
  const { handler, run, runState, input, handlerDeps, recentUserReplies, triggerParentMessageId } =
    args;

  const isSubagentOwned = handler.runnerKind === 'subagent';
  const serviceContextNote = handler.omitServiceContextNote
    ? ''
    : buildServiceContextNote(run.launchServiceId);

  const handlerCtx: PromptTypeHandlerContext = {
    runId: run.agentic_session_id,
    turnId: args.turnId,
    abortSignal: args.abortSignal,
    logger: handlerDeps.logger,
    entity: run.entity,
    recentUserReplies,
    triggerParentMessageId,
    awaitingUserReview: input.awaitingUserReview === true,
    startedPromptTypes: runState.startedPromptTypes,
    ...(args.implementationReadinessClarification
      ? { implementationReadinessClarification: args.implementationReadinessClarification }
      : {}),
    ...(args.projectModeBundleDirectory
      ? { projectModeBundleDirectory: args.projectModeBundleDirectory }
      : {}),
    ...(args.repositorySnapshotDirectory
      ? { repositorySnapshotDirectory: args.repositorySnapshotDirectory }
      : {}),
  };

  const launchable = isUserLaunchable(handler) ? handler : null;
  const canonicalUserMessage = resolvePromptText(input);
  const launchableUserMessage = launchable ? canonicalUserMessage : null;
  let providerSessionWillMint =
    args.providerSessionDecision !== undefined && args.providerSessionDecision !== 'resume';

  let resolvedPrompt: string | null = null;
  let startingMessage: string | undefined;
  let sessionContext: Record<string, unknown> | undefined;
  let preparedPayload: unknown | undefined;
  let promptTypeChanged = false;
  const providerPromptState: { segments: ProviderSessionStartupSegments | null } = {
    segments: null,
  };
  let requestStartupPromptInputRefresh = false;
  let loadedStartupPromptInputThisTurn = false;

  const resolveStartupPromptInput = async (
    payload: LocalAnyPromptPayload | undefined,
    forceRefresh = false,
  ): Promise<{
    payload: LocalAnyPromptPayload | undefined;
    startupPromptInput: AgentStartupPromptInputResult | null;
  }> => {
    const shouldRefresh =
      forceRefresh ||
      args.refreshStartupPromptInput === true ||
      (args.providerSessionDecision !== undefined && args.providerSessionDecision !== 'resume');
    let startupPromptInput = shouldRefresh ? null : (runState.startupPromptInput ?? null);
    const entity = run.entity;
    if (
      startupPromptInput === null &&
      entity !== null &&
      isEntityPromptTemplateFocalType(entity.entityType)
    ) {
      const organizationId = run.contextMetadata?.organizationId;
      const projectId = run.contextMetadata?.projectId;
      if (!organizationId || !projectId) {
        throw new AgentStartupPromptInputError(
          'Entity startup prompt input requires organizationId and projectId.',
          'entity_context_loader',
        );
      }
      const request: AgentStartupPromptInputRequest = {
        runEntity: entity,
        organizationId,
        projectId,
      };
      loadedStartupPromptInputThisTurn = true;
      startupPromptInput = runState.startupPromptTemplate
        ? await handlerDeps.startupPromptInput.resolve(request, {
            cachedTemplate: runState.startupPromptTemplate,
          })
        : await handlerDeps.startupPromptInput.resolve(request);
    }

    return {
      // Keep the deprecated wire field untouched for compatibility, but never
      // use it as prompt authority or copy it into the handler payload.
      payload,
      startupPromptInput,
    };
  };

  let startupPromptInputResult: AgentStartupPromptInputResult | null =
    runState.startupPromptInput ?? null;
  const payloadForPrompt = input.payload;
  const startup = await resolveStartupPromptInput(input.payload);
  startupPromptInputResult = startup.startupPromptInput;
  if (startupPromptInputResult?.loadedEntityContext) {
    handlerCtx.loadedEntityContext = startupPromptInputResult.loadedEntityContext;
  }
  handlerCtx.implementationReadinessSourceSnapshot = startupPromptInputResult
    ? createReadinessSourceSnapshotFromStartupInput({
        runId: run.agentic_session_id,
        startupPromptInput: startupPromptInputResult,
        capturedAt: new Date().toISOString(),
      })
    : null;
  if (args.onStartupPromptInputResolved) {
    await args.onStartupPromptInputResolved(startupPromptInputResult);
  }

  const allowedWorkItemTypeKeys = handler.eligibleWorkItemTypeKeys;
  if (allowedWorkItemTypeKeys !== undefined) {
    const loadedEntity = startupPromptInputResult?.loadedEntityContext?.entity;
    const resolvedWorkItemTypeKey =
      loadedEntity && 'type' in loadedEntity && typeof loadedEntity.type === 'string'
        ? loadedEntity.type
        : null;
    if (resolvedWorkItemTypeKey === null) {
      throw new LocalAgentApiError(
        'INVALID_REQUEST',
        `Handler "${handler.id}" requires an authoritative work-item type key.`,
        400,
      );
    }
    if (!allowedWorkItemTypeKeys.includes(resolvedWorkItemTypeKey)) {
      throw new LocalAgentApiError(
        'INVALID_REQUEST',
        `Handler "${handler.id}" does not accept work-item type "${resolvedWorkItemTypeKey}".`,
        400,
      );
    }
  }

  const prepareForPrompt = async (): Promise<unknown> => {
    const prepareResult = handler.prepare
      ? await handler.prepare(run, payloadForPrompt, handlerDeps, handlerCtx)
      : { payload: payloadForPrompt };

    if (prepareResult.sessionContext) {
      sessionContext = prepareResult.sessionContext;
    }

    const reconciledPayload = args.onPreparedPayload
      ? await args.onPreparedPayload({
          handler,
          payload: prepareResult.payload,
          requestStartupPromptInputRefresh: () => {
            requestStartupPromptInputRefresh = true;
          },
        })
      : prepareResult.payload;
    if (
      requestStartupPromptInputRefresh &&
      startupPromptInputResult !== null &&
      !loadedStartupPromptInputThisTurn
    ) {
      providerSessionWillMint = true;
      const startup = await resolveStartupPromptInput(
        payloadForPrompt,
        requestStartupPromptInputRefresh,
      );
      startupPromptInputResult = startup.startupPromptInput;
      if (startupPromptInputResult?.loadedEntityContext) {
        handlerCtx.loadedEntityContext = startupPromptInputResult.loadedEntityContext;
      }
      if (args.onStartupPromptInputResolved) {
        await args.onStartupPromptInputResolved(startupPromptInputResult);
      }
      handlerDeps.logger.debug('local.run.prompt.prepare_after_context_refresh', {
        runId: run.agentic_session_id,
        promptType: handler.promptType,
      });
      // Workspace reconciliation changed a resume into a new projection cycle.
      // Prepare again with that cycle's fresh context before rendering it.
      return prepareForPrompt();
    }
    if (handler.prepare) {
      preparedPayload = reconciledPayload;
    }
    return reconciledPayload;
  };

  const buildPreparedPrompt = (promptPayload: unknown): string => {
    const semanticSegments = handler.buildPromptSegments?.(promptPayload, handlerCtx);
    const injection = launchable?.addUserMessage(promptPayload as { userMessage?: string }) ?? null;
    if (!semanticSegments) {
      const systemPrompt = handler.buildPrompt(promptPayload, handlerCtx) + serviceContextNote;
      return injection ? `${systemPrompt}${injection}` : systemPrompt;
    }

    const stableInstructions =
      runState.cachedProviderSessionStartupSegments?.promptType === handler.promptType
        ? runState.cachedProviderSessionStartupSegments.stableInstructions
        : semanticSegments.stableInstructions;
    const dynamicContext = `${semanticSegments.dynamicContext}${serviceContextNote}`;
    providerPromptState.segments = {
      stableInstructions,
      dynamicContext,
      userInput: injection ?? '',
    };
    return (
      [stableInstructions, dynamicContext].filter((value) => value.length > 0).join('\n\n') +
      (injection ?? '')
    );
  };

  if (runState.isFirstTurn) {
    if (input.payload) {
      const promptPayload = await prepareForPrompt();
      resolvedPrompt = buildPreparedPrompt(promptPayload);
      startingMessage = handler.buildStartingMessage?.(promptPayload, handlerCtx) ?? undefined;
    } else {
      resolvedPrompt = resolvePromptString(input);
      startingMessage =
        buildStartingMessage(input.promptType, input.payload, handlerCtx) ?? undefined;
    }
  } else {
    const previousPromptType = runState.currentPromptType;
    promptTypeChanged = previousPromptType !== input.promptType;

    if ((promptTypeChanged || providerSessionWillMint) && input.payload) {
      const promptPayload = await prepareForPrompt();
      resolvedPrompt = buildPreparedPrompt(promptPayload);
      startingMessage = handler.buildStartingMessage?.(promptPayload, handlerCtx) ?? undefined;
    } else if (
      // A readiness clarification resumes the launch session, but its prompt
      // carries the pending finding and a freshly refreshed source binding.
      (handler.rebuildPromptOnUserMessage || args.implementationReadinessClarification) &&
      input.payload &&
      launchableUserMessage
    ) {
      const promptPayload = await prepareForPrompt();
      const systemPrompt = handler.buildPrompt(promptPayload, handlerCtx) + serviceContextNote;
      const injection =
        launchable?.addUserMessage(promptPayload as { userMessage?: string }) ?? null;
      resolvedPrompt = injection ? `${systemPrompt}${injection}` : systemPrompt;
      startingMessage = handler.buildStartingMessage?.(promptPayload, handlerCtx) ?? undefined;
    } else if (launchableUserMessage) {
      resolvedPrompt = launchableUserMessage;
    } else if (canonicalUserMessage) {
      resolvedPrompt = canonicalUserMessage;
    } else if (input.payload) {
      const promptPayload = await prepareForPrompt();
      resolvedPrompt = handler.buildPrompt(promptPayload, handlerCtx) + serviceContextNote;
      startingMessage = handler.buildStartingMessage?.(promptPayload, handlerCtx) ?? undefined;
    } else {
      resolvedPrompt = null;
    }
  }

  // A remint can arrive without a handler payload. Preserve the handler's
  // cacheable instruction prefix in that case, but keep the user input and
  // dynamic entity block owned by this Turn. Reusing the prior dynamic text
  // would reintroduce the stale-context bug this segmentation avoids.
  if (
    !isSubagentOwned &&
    providerSessionWillMint &&
    resolvedPrompt &&
    providerPromptState.segments === null &&
    runState.cachedProviderSessionStartupSegments?.promptType === handler.promptType
  ) {
    providerPromptState.segments = {
      stableInstructions: runState.cachedProviderSessionStartupSegments.stableInstructions,
      dynamicContext: '',
      userInput: resolvedPrompt,
    };
  }

  // Prepend the previous provider session's final output as context for the
  // next phase — but only for `provider_session` flows where the same shared
  // session sees both turns. Subagent flows compose their own prompt inside
  // the runtime `SubAgent` class and would never see this prepend.
  let consumedPreviousProviderSession = false;
  if (!isSubagentOwned && resolvedPrompt && runState.previousProviderSession) {
    const prior = runState.previousProviderSession;
    const previousContext = `## Previous phase (${prior.promptType})\n\n${prior.lastMessage}`;
    resolvedPrompt = `${previousContext}\n\n---\n\n${resolvedPrompt}`;
    if (providerPromptState.segments) {
      providerPromptState.segments = {
        ...providerPromptState.segments,
        dynamicContext: `${previousContext}\n\n---\n\n${providerPromptState.segments.dynamicContext}`,
      };
    }
    consumedPreviousProviderSession = true;
  }

  // Prepend the Run's accumulating memo list only when initializing a new
  // provider context. Resumes already retain this context, including after
  // process-local idle eviction. Sits after the previousProviderSession
  // prepend and before the report chain, and remains append-only for later
  // agents' provider-session mints.
  if (!isSubagentOwned && providerSessionWillMint && resolvedPrompt && runState.memos.length > 0) {
    const memoBlock = renderMemoBlock(runState.memos);
    resolvedPrompt = `${memoBlock}\n\n---\n\n${resolvedPrompt}`;
    if (providerPromptState.segments) {
      providerPromptState.segments = {
        ...providerPromptState.segments,
        dynamicContext: `${memoBlock}\n\n---\n\n${providerPromptState.segments.dynamicContext}`,
      };
    }
  }

  // Prepend the Run's append-only report chain so the next turn sees every
  // prior report (including same-phase re-entries like A→B→A). Gated by
  // `!isSubagentOwned` for the same reason as the previousProviderSession
  // prepend — subagent flows build their own prompts inside `SubAgent`.
  if (!isSubagentOwned && resolvedPrompt && runState.reportChain.length > 0) {
    const reportBlock = renderReportChainBlock(runState.reportChain);
    resolvedPrompt = `${reportBlock}\n\n---\n\n${resolvedPrompt}`;
    if (providerPromptState.segments) {
      providerPromptState.segments = {
        ...providerPromptState.segments,
        dynamicContext: `${reportBlock}\n\n---\n\n${providerPromptState.segments.dynamicContext}`,
      };
    }
  }

  // For subagent handlers the runtime `SubAgent` class composes the prompt
  // from the same handler hooks inside the isolated session; the resolver-
  // computed `resolvedPrompt` is discarded so a stale build can't leak
  // through to the SDK.
  if (isSubagentOwned) {
    resolvedPrompt = null;
    providerPromptState.segments = null;
  }

  if (resolvedPrompt) {
    const transformed = handler.transformInput?.(resolvedPrompt);
    if (transformed) {
      resolvedPrompt = transformed;
      providerPromptState.segments = null;
    }
  }

  // Re-state the entity-mention HARD STOP at the very tail of every per-turn
  // prompt — after the report-chain/last-turn prepends and any transform — so
  // it is the most recent instruction the agent reads before replying. The
  // full rule is delivered once in the session system prompt; this keeps it
  // from being forgotten as context fills. Subagent flows null `resolvedPrompt`
  // above and append their own copy in `subagent.ts`.
  if (resolvedPrompt) {
    resolvedPrompt = `${resolvedPrompt}\n\n${mentionFormatReminder}`;
    if (providerPromptState.segments) {
      providerPromptState.segments = providerPromptState.segments.userInput
        ? {
            ...providerPromptState.segments,
            userInput: `${providerPromptState.segments.userInput}\n\n${mentionFormatReminder}`,
          }
        : {
            ...providerPromptState.segments,
            dynamicContext: `${providerPromptState.segments.dynamicContext}\n\n${mentionFormatReminder}`,
          };
    }
  }

  return {
    resolvedPrompt,
    startingMessage,
    sessionContext,
    preparedPayload,
    promptTypeChanged,
    isSubagentOwned,
    consumedPreviousProviderSession,
    ...(startupPromptInputResult ? { startupPromptInput: startupPromptInputResult } : {}),
    ...(startupPromptInputResult?.template
      ? { startupPromptTemplate: startupPromptInputResult.template }
      : {}),
    ...(providerPromptState.segments
      ? { providerSessionStartupSegments: providerPromptState.segments }
      : {}),
  };
};
