import type { AssistantCompleteEvent } from '../../run/types';
import type { AgenticSession } from '../../session/types';
import {
  LocalPromptType,
  type WorkTrackerImportCompletion,
  type WorkTrackerImportRequest,
} from '../../shared/agent-bridge-contract/generated/api';
import {
  MessageStatus,
  SystemMessageDataTypeEnum,
  type UpdateMessageDto,
  type WorkTrackerImportCompletion as WorkTrackerConversationCompletion,
} from '../../shared/api/generated/api';
import type {
  CompletionAction,
  CompletionValidationResult,
  OnCompleteContext,
  OnCompleteDeps,
  PromptTypeHandler,
  PromptTypeHandlerDeps,
  PromptTypeHandlerContext,
} from '../prompt-type-handler';
import { buildWorkTrackerConnectPrompt } from '../prompts/work-tracker-connect';
import { buildWorkTrackerImportPrompt } from '../prompts/work-tracker-import';
import { buildWorkTrackerConnectionInstructions } from './connection-instructions';
import { parseWorkTrackerCompletion, workTrackerRequestSchema } from './schemas';

function mapWorkTrackerCompletion(completion: WorkTrackerImportCompletion) {
  return { ...completion } satisfies WorkTrackerConversationCompletion;
}

class WorkTrackerImportHandler implements PromptTypeHandler<WorkTrackerImportRequest> {
  readonly service = 'optional';
  readonly launchEntity = 'none';
  readonly implementationReadiness = 'none';
  readonly runnerKind = 'provider_session' as const;
  readonly providerSessionCountsForContext = true;
  readonly providerSessionStart = 'fresh' as const;
  readonly providerSessionLifetime = 'turn' as const;
  readonly readOnlyFilesystem = true;
  readonly builtinTools = [];
  readonly submissionTools = [];
  readonly mcpToolUseCase = 'work_tracker_import' as const;
  readonly omitServiceContextNote = true;
  readonly reports = [];
  readonly id: string;

  constructor(
    readonly promptType:
      | typeof LocalPromptType.WorkTrackerConnect
      | typeof LocalPromptType.WorkTrackerImport,
  ) {
    this.id =
      promptType === LocalPromptType.WorkTrackerConnect
        ? 'work-tracker-connect'
        : 'work-tracker-import';
  }

  resolveProviderExecution(payload: WorkTrackerImportRequest) {
    return { provider: payload.provider, model: payload.resolvedFrontierModel };
  }

  async prepare(
    run: AgenticSession,
    payload: WorkTrackerImportRequest,
    deps: PromptTypeHandlerDeps,
  ) {
    deps.logger.debug('work_tracker.prepare.started', {
      runId: run.agentic_session_id,
      phase: this.promptType,
    });
    const parsed = workTrackerRequestSchema.safeParse(payload);
    if (!parsed.success) {
      deps.logger.warn('work_tracker.prepare.invalid_request', {
        runId: run.agentic_session_id,
        phase: this.promptType,
      });
      throw new Error('Invalid work-tracker import request.');
    }
    const accepted = parsed.data;
    deps.logger.info('work_tracker.prepare.completed', {
      runId: run.agentic_session_id,
      phase: this.promptType,
      source: accepted.source,
      provider: accepted.provider,
      model: accepted.resolvedFrontierModel,
      connectionConfirmed: accepted.connectionConfirmed === true,
    });
    return { payload: accepted };
  }

  buildPrompt(payload: WorkTrackerImportRequest, ctx?: PromptTypeHandlerContext): string {
    ctx?.logger?.debug('work_tracker.prompt.building', {
      runId: ctx.runId,
      phase: this.promptType,
      source: payload.source,
    });
    return this.promptType === LocalPromptType.WorkTrackerConnect
      ? buildWorkTrackerConnectPrompt(payload)
      : buildWorkTrackerImportPrompt(payload);
  }

  buildStartingMessage(): string {
    return this.promptType === LocalPromptType.WorkTrackerConnect
      ? 'Checking work-tracker access...'
      : 'Reading work-tracker capabilities...';
  }

  validateCompletion(
    event: AssistantCompleteEvent,
    payload: WorkTrackerImportRequest,
  ): CompletionValidationResult {
    const parsed = parseWorkTrackerCompletion(event.summary);
    if (!parsed.ok)
      return { ok: false, error: { code: 'INVALID_COMPLETION', message: parsed.error } };
    const result = parsed.value;
    if (
      result.source !== payload.source ||
      (this.promptType === LocalPromptType.WorkTrackerConnect && result.outcome === 'success') ||
      (this.promptType === LocalPromptType.WorkTrackerImport && result.outcome === 'connected')
    ) {
      return {
        ok: false,
        error: {
          code: 'INVALID_COMPLETION',
          message: 'The completion does not match the accepted source and phase.',
        },
      };
    }
    if (result.outcome === 'success') {
      const ids = result.hierarchy.topLevels.flatMap((root) => [
        root.id,
        ...root.children.map((child) => child.id),
      ]);
      if (new Set(ids).size !== ids.length) {
        return {
          ok: false,
          error: {
            code: 'INVALID_COMPLETION',
            message: 'Candidate Feature identities must be unique.',
          },
        };
      }
    }
    return { ok: true };
  }

  getCompletionAction(
    event: AssistantCompleteEvent,
    payload?: WorkTrackerImportRequest,
  ): CompletionAction | null {
    const parsed = parseWorkTrackerCompletion(event.summary);
    if (!payload || !parsed.ok || !this.validateCompletion(event, payload).ok) return null;
    return {
      action: {
        action: parsed.value.outcome,
        payload: { ...mapWorkTrackerCompletion(parsed.value) },
      },
      hidden: parsed.value.outcome !== 'connection_required',
      userFacingResponse:
        parsed.value.outcome === 'connection_required'
          ? buildWorkTrackerConnectionInstructions(payload)
          : parsed.value.outcome === 'connected'
            ? 'Work-tracker access is ready. Start the import when ready.'
            : 'Work-tracker outline is ready for review.',
    };
  }

  transformCompletionOutput(
    event: AssistantCompleteEvent,
    payload?: WorkTrackerImportRequest,
  ): UpdateMessageDto | null {
    const action = this.getCompletionAction(event, payload);
    if (!action) return null;
    return {
      status: MessageStatus.Completed,
      data: {
        type: SystemMessageDataTypeEnum.Agent,
        response: action.userFacingResponse ?? '',
        detectedIntent: 'agent_response',
        intentConfidence: 1,
      },
    } satisfies UpdateMessageDto;
  }

  async onComplete(
    event: AssistantCompleteEvent,
    ctx: OnCompleteContext,
    deps: OnCompleteDeps,
  ): Promise<void> {
    const request = workTrackerRequestSchema.safeParse(ctx.payload);
    const completion = parseWorkTrackerCompletion(event.summary);
    if (!request.success || !completion.ok || !this.validateCompletion(event, request.data).ok)
      return;
    deps.logger.info('work_tracker.completion.accepted', {
      runId: ctx.runId,
      phase: this.promptType,
      source: request.data.source,
      outcome: completion.value.outcome,
    });
    if (request.data.connectionConfirmed === true && ctx.run) {
      ctx.run.appendMemo({
        source: this.id,
        content: `The user confirmed the ${request.data.source} connection. Accepted runtime: ${request.data.provider}, model: ${request.data.resolvedFrontierModel}, reasoning effort: ${request.data.reasoningEffort}${request.data.fastMode === undefined ? '' : `, fast mode: ${String(request.data.fastMode)}`}. Recheck tools in every fresh import context.`,
        writtenAt: new Date().toISOString(),
      });
      deps.logger.debug('work_tracker.connection_confirmation.memo_appended', {
        runId: ctx.runId,
        source: request.data.source,
      });
    }
  }
}

export const workTrackerConnectHandler = new WorkTrackerImportHandler(
  LocalPromptType.WorkTrackerConnect,
);
export const workTrackerImportHandler = new WorkTrackerImportHandler(
  LocalPromptType.WorkTrackerImport,
);
