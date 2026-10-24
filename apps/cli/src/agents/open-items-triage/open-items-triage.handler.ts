import { z } from 'zod';
import {
  LocalPromptType,
  OpenItemsTriageMode,
  type OpenItemsTriagePromptPayload,
} from '../../shared/agent-bridge-contract/generated';
import type { AgenticSession } from '../../session/types';
import type { AssistantCompleteEvent } from '../../run/types';
import {
  defaultAddUserMessage,
  type PromptTypeHandlerDeps,
  type UserLaunchablePromptTypeHandler,
  type OnInvalidCompletionContext,
  type OnCompleteDeps,
  type CompletionValidationFailure,
} from '../prompt-type-handler';
import { TriageInputOwner, type TriageInput } from './input-owner';
import { TriageInputDiagnostics } from './input-diagnostics';
import { buildTriagePrompt, type PreparedTriagePayload } from './prompts/triage-prompt';
import { parseTriageResponse } from './schemas';

const requestSchema = z.object({
  projectId: z.string().uuid(),
  requestKind: z.enum(['freshPass', 'followUp']),
  mode: z.nativeEnum(OpenItemsTriageMode),
  observedCollectionRevision: z.number().int().positive().optional(),
  userMessage: z.string().optional(),
  guidance: z.string().optional(),
});
type TriagePayload = OpenItemsTriagePromptPayload & { triageInput?: TriageInput };

export class OpenItemsTriageHandler implements UserLaunchablePromptTypeHandler<TriagePayload> {
  public readonly id = 'open_items_triage';
  public readonly promptType = LocalPromptType.OpenItemsTriage;
  public readonly service = 'optional';
  public readonly launchEntity = 'required';
  public readonly implementationReadiness = 'none';
  public readonly expectedResponseTypes = ['open_items_triage_v1'] as const;
  public readonly runnerKind = 'provider_session' as const;
  public readonly providerSessionCountsForContext = true;
  public readonly providerSessionLifetime = 'turn' as const;
  public readonly providerSessionStart = 'fresh' as const;
  public readonly rebuildPromptOnUserMessage = true;
  public readonly reports = [] as const;
  public readonly mcpToolUseCase = 'research' as const;
  public readonly builtinTools = [] as const;
  public readonly readOnlyFilesystem = true;
  public readonly omitServiceContextNote = true;
  public readonly allowsEmptyUserMessage = true as const;

  public addUserMessage(payload: TriagePayload): string | null {
    const guidance =
      payload.guidance ?? (payload.requestKind === 'freshPass' ? payload.userMessage : undefined);
    const focus = guidance?.trim()
      ? `\n\n## Review focus from the user\n\nTreat this as guidance for what the review should focus on, not a question to answer.\n\n${guidance}`
      : '';
    const message = payload.requestKind === 'followUp' ? defaultAddUserMessage(payload) : null;
    return focus || message ? `${focus}${message ?? ''}` : null;
  }

  public validateCompletion(event: AssistantCompleteEvent) {
    const parsed = parseTriageResponse(event.summary);
    return parsed.ok
      ? { ok: true as const }
      : { ok: false as const, error: { message: parsed.error } };
  }

  public async onInvalidCompletion(
    _event: AssistantCompleteEvent,
    context: OnInvalidCompletionContext,
    deps: OnCompleteDeps,
    failure: CompletionValidationFailure,
  ): Promise<void> {
    deps.logger.warn('open_items_triage.completion.rejected', {
      runId: context.runId,
      message: failure.message,
    });
  }

  public async prepare(
    run: AgenticSession,
    payload: OpenItemsTriagePromptPayload,
    deps: PromptTypeHandlerDeps,
  ) {
    const request = requestSchema.parse(payload);
    const organizationId = run.contextMetadata?.organizationId;
    if (!organizationId || run.contextMetadata?.projectId !== request.projectId) {
      deps.logger.error('open_items_triage.prepare.scope_invalid', {
        runId: run.agentic_session_id,
      });
      throw new Error('Open Items triage requires matching authenticated project scope.');
    }
    deps.logger.debug('open_items_triage.prepare.started', {
      runId: run.agentic_session_id,
      requestKind: request.requestKind,
      mode: request.mode,
    });
    const token = await deps.auth.getAccessToken();
    const diagnostics = new TriageInputDiagnostics();
    const inputOwner = new TriageInputOwner(
      deps,
      organizationId,
      request.projectId,
      token,
      Date.now(),
      diagnostics,
    );
    let triageInput: TriageInput | null = null;
    try {
      triageInput = await inputOwner.build();
    } finally {
      await diagnostics.write(
        {
          runId: run.agentic_session_id,
          projectId: request.projectId,
          requestKind: request.requestKind,
          mode: request.mode,
        },
        triageInput,
        deps.logger,
      );
    }
    return {
      payload: {
        projectId: request.projectId,
        requestKind: request.requestKind,
        mode: request.mode,
        ...(request.userMessage !== undefined ? { userMessage: request.userMessage } : {}),
        ...(request.guidance !== undefined ? { guidance: request.guidance } : {}),
        ...(request.observedCollectionRevision !== undefined
          ? { observedCollectionRevision: request.observedCollectionRevision }
          : {}),
        triageInput,
      } satisfies PreparedTriagePayload,
    };
  }

  public buildPrompt(payload: TriagePayload): string {
    if (!payload.triageInput)
      throw new Error('Open Items triage input must be prepared for every turn.');
    return buildTriagePrompt({ ...payload, triageInput: payload.triageInput });
  }
  public buildStartingMessage(): string {
    return 'Reviewing your Open Items and recent attention…';
  }
}
