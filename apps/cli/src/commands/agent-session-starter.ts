import { findLaunchCheckoutConflict } from '../repo/launch-checkout';
import crypto from 'node:crypto';
import { toServiceId, type RepoMappingStore } from '../repo/index';
import type { RunStore } from '../run-store';
import { SessionValidationError } from '../session/errors';
import type {
  AgenticSession,
  AgenticSessionContextMetadata,
  CreateAgenticSessionInput,
} from '../session/index';
import type {
  LocalPendingRunContext,
  LocalReasoningEffort,
  LocalRunScope,
  LocalWorktreeConfig,
  AgentSessionConfig,
  RunEntityReference,
  ResolvedServiceBinding,
} from '../shared/agent-bridge-contract/contract';
import {
  LocalPromptTaskType,
  LocalPromptType,
  RunCreatePayloadFreeFormPromptTypeEnum,
  RunCreatePayloadQuickPromptTypeEnum,
  RunCreatePayloadWorkflowKickoffPromptTypeEnum,
  RunEntityReferenceEntityTypeEnum,
  type TaskMonitorPlanGuidance,
  type TaskMonitorLaunchConfig,
} from '../shared/agent-bridge-contract/generated';
import {
  AgentSessionConfigV2TypeEnum,
  AgentSessionConfigV2VersionEnum,
  ConversationStartRunRequestDtoProviderEnum,
  CreateAgentSessionDtoProviderEnum,
  MessageType,
  WorkflowName,
  type AgentSessionConfigV2,
  type ConversationStartRunRequestDto,
  type TaskMonitorRunEffectPayload,
} from '../shared/api/generated/api';
import { canonicalizeJson } from '../server/trigger-verification/jcs';

export type AgentSessionStartResult =
  | { status: 'started'; session: AgenticSession }
  | { status: 'repo-required'; serviceIds: string[]; launchServiceId: string };

export interface StartAgenticSessionArgs {
  context: LocalPendingRunContext;
  entity: RunEntityReference | null;
  runStore: RunStore;
  repoStore: RepoMappingStore;
  contextMetadata: AgenticSessionContextMetadata;
  scope?: LocalRunScope;
  worktree?: LocalWorktreeConfig;
  conversationId: string;
  promptType?: string;
  config?: AgentSessionConfig | null;
  model?: string;
  reasoningEffort?: LocalReasoningEffort;
  fastMode?: boolean;
  inert?: boolean;
  createProviderSessionId?: () => string;
}

const defaultCreateProviderSessionId = (): string => `pending_${crypto.randomUUID()}`;

/**
 * Normalize the pending-run context's services set. The wire shape allows
 * either `serviceIds: string[]` + `launchServiceId` or no services at all.
 * The launch-from invariant (`launchServiceId ∈ serviceIds`) is enforced at
 * the schema layer, so we trust it here. Returns `null` when no services are
 * in scope.
 */
const readPendingServices = (
  context: LocalPendingRunContext,
): { ids: string[]; launchServiceId: string } | null => {
  const ids = Array.isArray(context.serviceIds) ? context.serviceIds.filter(Boolean) : [];
  if (ids.length === 0) return null;
  const launchServiceId = context.launchServiceId ?? ids[0]!;
  return { ids, launchServiceId };
};

export const startAgenticSession = async ({
  context,
  entity,
  runStore,
  repoStore,
  contextMetadata,
  scope,
  worktree,
  conversationId,
  promptType,
  config,
  model,
  reasoningEffort,
  fastMode,
  inert,
  createProviderSessionId = defaultCreateProviderSessionId,
}: StartAgenticSessionArgs): Promise<AgentSessionStartResult> => {
  const agentSessionId = contextMetadata.agentSessionId?.trim();
  if (!agentSessionId) {
    throw new SessionValidationError(
      'contextMetadata.agentSessionId is required to start an agentic session.',
    );
  }

  const pendingServices = readPendingServices(context);
  const services: ResolvedServiceBinding[] = [];
  let launchServiceId: string | undefined;

  if (pendingServices) {
    for (const id of pendingServices.ids) {
      const binding = await repoStore.getBinding(toServiceId(id));
      if (!binding) {
        // Fail fast on the first missing binding. The wire-level
        // repo-required response carries the full requested set plus the
        // launch service so the UI can drive a multi-service repo-mapping
        // step rather than guessing what's missing from one id.
        return {
          status: 'repo-required',
          serviceIds: pendingServices.ids,
          launchServiceId: pendingServices.launchServiceId,
        };
      }
      services.push({ id, path: binding.repositoryPath });
    }
    launchServiceId = pendingServices.launchServiceId;
    const launchPath = services.find((entry) => entry.id === launchServiceId)!.path;
    const conflict = await findLaunchCheckoutConflict(launchPath, worktree?.enabled === true);
    if (conflict) throw new SessionValidationError(conflict);
  }

  const sessionInput: CreateAgenticSessionInput = {
    ...(inert === undefined ? {} : { inert }),
    agentic_session_id: agentSessionId,
    entity,
    services,
    provider: context.provider ?? 'claude',
    provider_session_id: createProviderSessionId(),
    provider_conversation_id: null,
    conversationId,
    contextMetadata,
  };
  if (launchServiceId) sessionInput.launchServiceId = launchServiceId;
  if (scope) sessionInput.scope = scope;
  if (worktree) sessionInput.worktree = worktree;
  if (promptType) sessionInput.promptType = promptType;
  if (config !== undefined) sessionInput.config = config;
  if (model) sessionInput.model = model;
  if (reasoningEffort) sessionInput.reasoningEffort = reasoningEffort;
  if (fastMode !== undefined) sessionInput.fastMode = fastMode;
  const session = await runStore.createRun(sessionInput);

  return {
    status: 'started',
    session,
  };
};

interface TaskMonitorCodingSessionTask {
  id: string;
  name: string;
  type: string;
  description: string;
  acceptanceCriteria: string | null;
  serviceIds: readonly string[];
}

export interface TaskMonitorCodingSessionLaunchInput {
  organizationId: string;
  projectId: string;
  monitorId: string;
  task: TaskMonitorCodingSessionTask;
  planGuidance: TaskMonitorPlanGuidance | null;
  launchConfig: TaskMonitorLaunchConfig;
  method: TaskMonitorLaunchConfig['method'];
  userMessage: string;
}

export const toTaskPromptType = (taskType: string): LocalPromptTaskType => {
  if (taskType === LocalPromptTaskType.Standard) return LocalPromptTaskType.Standard;
  if (taskType === LocalPromptTaskType.Bug) return LocalPromptTaskType.Bug;
  throw new SessionValidationError(`Task Monitor cannot launch task type "${taskType}".`);
};

export const toCreateProvider = (
  provider: TaskMonitorLaunchConfig['provider'],
): CreateAgentSessionDtoProviderEnum => {
  if (provider === 'claude') return CreateAgentSessionDtoProviderEnum.Claude;
  if (provider === 'codex') return CreateAgentSessionDtoProviderEnum.Codex;
  return CreateAgentSessionDtoProviderEnum.Opencode;
};

const toStartProvider = (
  provider: TaskMonitorLaunchConfig['provider'],
): ConversationStartRunRequestDtoProviderEnum => {
  if (provider === 'claude') return ConversationStartRunRequestDtoProviderEnum.Claude;
  if (provider === 'codex') return ConversationStartRunRequestDtoProviderEnum.Codex;
  return ConversationStartRunRequestDtoProviderEnum.Opencode;
};

export const toTaskMonitorSessionConfig = (
  input: TaskMonitorCodingSessionLaunchInput,
): AgentSessionConfigV2 => ({
  type: AgentSessionConfigV2TypeEnum.CodingSession,
  version: AgentSessionConfigV2VersionEnum.V2,
  method: input.method,
  model: input.launchConfig.model,
  effort: input.launchConfig.reasoningEffort,
  ...(typeof input.launchConfig.fastMode === 'boolean'
    ? { fastMode: input.launchConfig.fastMode }
    : {}),
  taskMonitorId: input.monitorId,
  ...(input.launchConfig.worktree?.branch ? { worktree: input.launchConfig.worktree.branch } : {}),
});

export const taskMonitorConversationWorkflow = (
  method: TaskMonitorLaunchConfig['method'],
): typeof WorkflowName.FeatureSync | typeof WorkflowName.AgentSession =>
  method === 'plan' ? WorkflowName.FeatureSync : WorkflowName.AgentSession;

type TaskMonitorMethodDispatch =
  | {
      workflowName: typeof WorkflowName.FeatureSync;
      payload: NonNullable<ConversationStartRunRequestDto['payload']>;
    }
  | {
      handlerPromptType: typeof LocalPromptType.FreeForm | typeof LocalPromptType.Quick;
      attachments: NonNullable<ConversationStartRunRequestDto['attachments']>;
      payload: NonNullable<ConversationStartRunRequestDto['payload']>;
    };

const resolveTaskMonitorMethodDispatch = (
  method: TaskMonitorLaunchConfig['method'],
  taskId: string,
  userMessage: string,
): TaskMonitorMethodDispatch => {
  if (!taskId) {
    throw new SessionValidationError('Task Monitor launch requires a task identity.');
  }
  const entity = {
    entityType: RunEntityReferenceEntityTypeEnum.Task,
    entityId: taskId,
  } as const;
  switch (method) {
    case 'plan':
      return {
        workflowName: WorkflowName.FeatureSync,
        payload: {
          promptType: RunCreatePayloadWorkflowKickoffPromptTypeEnum.WorkflowKickoff,
          entity,
          userMessage,
        },
      };
    case 'open':
      return {
        attachments: [],
        handlerPromptType: LocalPromptType.FreeForm,
        payload: {
          promptType: RunCreatePayloadFreeFormPromptTypeEnum.FreeForm,
          entity,
          userMessage,
        },
      };
    case 'quick':
      return {
        attachments: [],
        handlerPromptType: LocalPromptType.Quick,
        payload: {
          promptType: RunCreatePayloadQuickPromptTypeEnum.Quick,
          entity,
          userMessage,
        },
      };
  }
};

export const buildTaskMonitorRunEffectPayload = (
  input: TaskMonitorCodingSessionLaunchInput,
  agentSessionId: string,
  machineId: string,
  conversationId: string,
  operationId: string,
): TaskMonitorRunEffectPayload => {
  toTaskPromptType(input.task.type);
  const launchServiceId = input.task.serviceIds[0];
  if (!launchServiceId) {
    throw new SessionValidationError('Task Monitor task is missing its launch service.');
  }
  const userMessage = input.userMessage.trim();
  const semanticRequest = {
    ...resolveTaskMonitorMethodDispatch(input.method, input.task.id, userMessage),
    model: input.launchConfig.model,
    reasoningEffort: input.launchConfig.reasoningEffort,
    provider: toStartProvider(input.launchConfig.provider),
    ...(input.launchConfig.fastMode === undefined ? {} : { fastMode: input.launchConfig.fastMode }),
    config: toTaskMonitorSessionConfig(input),
    contextMetadata: {
      capturedAt: new Date().toISOString(),
      organizationId: input.organizationId,
      projectId: input.projectId,
      agentSessionId,
      taskMonitorId: input.monitorId,
      ...(input.planGuidance
        ? {
            launchPlanId: input.planGuidance.plan.id,
            launchStageId: input.planGuidance.stage.id,
            launchStepId: input.planGuidance.step.id,
          }
        : {}),
      userComments: [],
      fileReferences: { resolved: [], unresolved: [] },
    },
    serviceIds: [...input.task.serviceIds],
    launchServiceId,
    ...(input.launchConfig.worktree ? { worktree: input.launchConfig.worktree } : {}),
    agentSessionId,
    machineId,
    initialMessage: { role: MessageType.User },
  };
  const operationFingerprint = crypto
    .createHash('sha256')
    .update(
      canonicalizeJson({
        kind: 'START_RUN',
        organizationId: input.organizationId,
        projectId: input.projectId,
        conversationId,
        request: semanticRequest,
      }),
    )
    .digest('hex');
  return {
    ...semanticRequest,
    operationId,
    operationFingerprint,
  } satisfies TaskMonitorRunEffectPayload;
};
