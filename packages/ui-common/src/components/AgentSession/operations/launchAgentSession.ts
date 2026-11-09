import type {
  AgentSessionConfig,
  AgentSessionDto,
  ConversationStartRunRequestDtoProviderEnum,
  CreateAgentSessionConversationDto,
  CreateAgentSessionConversationResponseDto,
  CreateAgentSessionDto,
  RunCreatePayload,
  RunContextMetadata,
} from "../../../api";
import {
  AgentSessionType,
  MessageType,
  type ConversationStartRunRequestDtoReasoningEffortEnum,
} from "../../../api";
import type {
  AgentOperationResult,
  AgentSessionInteractionAccess,
  BoundStartSessionInput,
} from "./AgentOperationCoordinator";
import {
  toOpenApiConversationId,
  toOpenApiProjectId,
  toOpenApiWorkflowId,
} from "../../../clients/contractIdentifierAdapters";
import type { MachinePingResult } from "../runtime/hooks/submitMachinePingViaPlatform";
import type {
  UpdateAgentSessionRecordInput,
  UpdateAgentSessionRecordResult,
} from "../runtime/coding/update-agent-session-record";

/**
 * What a screen declares once about the agent session it launches. The
 * invocation then supplies only the machine and the first prompt.
 */
export interface AgentSessionLaunchBinding {
  organizationId: string;
  projectId: string;
  /** Session identity and entity context; `serviceIds` omitted means graph-only. */
  session: Omit<
    CreateAgentSessionDto,
    | "projectId"
    | "sessionDate"
    | "provider"
    | "config"
    | "existingWorkflowBinding"
    | "type"
  > & { type?: AgentSessionType };
  runtime: {
    provider: ConversationStartRunRequestDtoProviderEnum;
    model: string;
    reasoningEffort?: ConversationStartRunRequestDtoReasoningEffortEnum;
    fastMode?: boolean;
    /** Typed, versioned configuration persisted on the session and sent with the start. */
    config: AgentSessionConfig;
  };
  conversation:
    | { kind: "new"; body: CreateAgentSessionConversationDto }
    | { kind: "existingWorkflow"; conversationId: string; workflowId: string };
  start: {
    handlerPromptType?: string;
    workflowName?: string;
    /** Builds the typed start payload from the first prompt. */
    payload: (prompt: string, conversationId: string) => RunCreatePayload;
    initialMessage?: boolean;
  };
}

export interface AgentSessionLaunchRequest {
  machineId: string;
  prompt: string;
}

/**
 * What survives between attempts of one launch gesture, so a retry follows the
 * same session, Conversation and operation instead of creating new ones.
 */
export interface AgentSessionLaunchAttempt {
  readonly operationId: string;
  session: AgentSessionDto | null;
  conversationId: string | null;
  boundMachineId: string | null;
  /** Recorded once a start was submitted; a retry returns it instead of resubmitting. */
  outcome: AgentOperationResult | null;
  inFlight: Promise<AgentSessionLaunchResult> | null;
}

export const newAgentSessionLaunchAttempt = (): AgentSessionLaunchAttempt => ({
  operationId: crypto.randomUUID(),
  session: null,
  conversationId: null,
  boundMachineId: null,
  outcome: null,
  inFlight: null,
});

export type AgentSessionLaunchStage =
  | "machine"
  | "ping"
  | "create_session"
  | "bind_machine"
  | "create_conversation"
  | "start";

export type AgentSessionLaunchResult =
  | {
      ok: true;
      session: AgentSessionDto;
      conversationId: string;
      /** Accepted or succeeded; acceptance is not proof the run is executing. */
      operation: Extract<
        AgentOperationResult,
        { state: "accepted" | "succeeded" }
      >;
    }
  | {
      ok: false;
      stage: AgentSessionLaunchStage;
      error: string;
      session: AgentSessionDto | null;
      conversationId: string | null;
      /** Present when the platform recorded a terminal outcome for the start. */
      operation?: AgentOperationResult;
    };

export interface AgentSessionLaunchDependencies {
  getAccess(machineId: string): AgentSessionInteractionAccess;
  pingMachine(machineId: string): Promise<MachinePingResult>;
  createSession(variables: {
    organizationId: string;
    agentSession: CreateAgentSessionDto;
  }): Promise<AgentSessionDto>;
  bindMachine(
    input: Pick<
      UpdateAgentSessionRecordInput,
      "organizationId" | "projectId" | "agentSessionId" | "machineId"
    >,
  ): Promise<UpdateAgentSessionRecordResult>;
  createConversation(variables: {
    organizationId: string;
    projectId: string;
    agentSessionId: string;
    body: CreateAgentSessionConversationDto;
  }): Promise<CreateAgentSessionConversationResponseDto>;
}

const buildContextMetadata = (
  binding: AgentSessionLaunchBinding,
  agentSessionId: string,
): RunContextMetadata => ({
  capturedAt: new Date().toISOString(),
  organizationId: binding.organizationId,
  projectId: binding.projectId,
  agentSessionId,
  userComments: [],
  fileReferences: { resolved: [], unresolved: [] },
});

const buildIntent = (
  binding: AgentSessionLaunchBinding,
  prompt: string,
  session: AgentSessionDto,
  conversationId: string,
): BoundStartSessionInput["intent"] => {
  const { runtime, start, session: scope } = binding;
  return {
    ...(start.handlerPromptType
      ? { handlerPromptType: start.handlerPromptType }
      : {}),
    ...(start.workflowName ? { workflowName: start.workflowName } : {}),
    payload: start.payload(prompt, conversationId),
    provider: runtime.provider,
    model: runtime.model,
    ...(runtime.reasoningEffort
      ? { reasoningEffort: runtime.reasoningEffort }
      : {}),
    ...(runtime.fastMode !== undefined ? { fastMode: runtime.fastMode } : {}),
    config: runtime.config,
    ...(start.initialMessage
      ? { initialMessage: { role: MessageType.User } }
      : {}),
    ...(scope.serviceIds && scope.serviceIds.length > 0
      ? { serviceIds: scope.serviceIds }
      : {}),
    ...(scope.launchServiceId
      ? { launchServiceId: scope.launchServiceId }
      : {}),
    contextMetadata: buildContextMetadata(binding, session.id),
  };
};

const failure = (
  stage: AgentSessionLaunchStage,
  error: string,
  attempt: AgentSessionLaunchAttempt,
  operation?: AgentOperationResult,
): AgentSessionLaunchResult => ({
  ok: false,
  stage,
  error,
  session: attempt.session,
  conversationId: attempt.conversationId,
  ...(operation ? { operation } : {}),
});

const settled = (
  attempt: AgentSessionLaunchAttempt,
  operation: AgentOperationResult,
): AgentSessionLaunchResult => {
  if (
    attempt.session &&
    attempt.conversationId &&
    (operation.state === "accepted" || operation.state === "succeeded")
  ) {
    return {
      ok: true,
      session: attempt.session,
      conversationId: attempt.conversationId,
      operation,
    };
  }
  const error =
    operation.state === "cancelled"
      ? "The operation was cancelled."
      : operation.state === "denied" || operation.state === "failed"
        ? operation.message
        : "The launch did not complete.";
  return failure("start", error, attempt, operation);
};

type Prepared<T> =
  | { ok: true; value: T }
  | { ok: false; result: AgentSessionLaunchResult };

const prepareSession = async (
  deps: AgentSessionLaunchDependencies,
  binding: AgentSessionLaunchBinding,
  attempt: AgentSessionLaunchAttempt,
): Promise<Prepared<AgentSessionDto>> => {
  if (attempt.session) {
    return { ok: true, value: attempt.session };
  }
  const { runtime, conversation, session } = binding;
  try {
    const created = await deps.createSession({
      organizationId: binding.organizationId,
      agentSession: {
        ...session,
        projectId: toOpenApiProjectId(binding.projectId),
        sessionDate: new Date().toISOString(),
        type: session.type ?? AgentSessionType.Coding,
        provider: runtime.provider,
        config: runtime.config,
        ...(conversation.kind === "existingWorkflow"
          ? {
              existingWorkflowBinding: {
                conversationId: toOpenApiConversationId(
                  conversation.conversationId,
                ),
                workflowId: toOpenApiWorkflowId(conversation.workflowId),
              },
            }
          : {}),
      },
    });
    attempt.session = created;
    return { ok: true, value: created };
  } catch (error) {
    return {
      ok: false,
      result: failure(
        "create_session",
        error instanceof Error
          ? error.message
          : "Failed to create the session.",
        attempt,
      ),
    };
  }
};

const bindMachine = async (
  deps: AgentSessionLaunchDependencies,
  binding: AgentSessionLaunchBinding,
  attempt: AgentSessionLaunchAttempt,
  session: AgentSessionDto,
  machineId: string,
): Promise<Prepared<AgentSessionDto>> => {
  if (attempt.boundMachineId === machineId) {
    return { ok: true, value: session };
  }
  const bound = await deps.bindMachine({
    organizationId: binding.organizationId,
    projectId: binding.projectId,
    agentSessionId: session.id,
    machineId,
  });
  if (!bound.ok) {
    return {
      ok: false,
      result: failure("bind_machine", bound.error, attempt),
    };
  }
  attempt.session = bound.session;
  attempt.boundMachineId = machineId;
  return { ok: true, value: bound.session };
};

interface PreparedConversation {
  session: AgentSessionDto;
  conversationId: string;
}

const prepareConversation = async (
  deps: AgentSessionLaunchDependencies,
  binding: AgentSessionLaunchBinding,
  attempt: AgentSessionLaunchAttempt,
  session: AgentSessionDto,
): Promise<Prepared<PreparedConversation>> => {
  if (attempt.conversationId) {
    return {
      ok: true,
      value: { session, conversationId: attempt.conversationId },
    };
  }
  const { conversation } = binding;
  if (conversation.kind === "existingWorkflow") {
    const conversationId =
      session.conversationId ?? conversation.conversationId;
    attempt.conversationId = conversationId;
    return { ok: true, value: { session, conversationId } };
  }
  try {
    const created = await deps.createConversation({
      organizationId: binding.organizationId,
      projectId: binding.projectId,
      agentSessionId: session.id,
      body: conversation.body,
    });
    attempt.conversationId = created.conversation.id;
    attempt.session = created.agentSession;
    return {
      ok: true,
      value: {
        session: created.agentSession,
        conversationId: created.conversation.id,
      },
    };
  } catch (error) {
    return {
      ok: false,
      result: failure(
        "create_conversation",
        error instanceof Error
          ? error.message
          : "Failed to create the session conversation.",
        attempt,
      ),
    };
  }
};

const runLaunch = async (
  deps: AgentSessionLaunchDependencies,
  binding: AgentSessionLaunchBinding,
  request: AgentSessionLaunchRequest,
  attempt: AgentSessionLaunchAttempt,
): Promise<AgentSessionLaunchResult> => {
  if (attempt.outcome) {
    return settled(attempt, attempt.outcome);
  }

  const access = deps.getAccess(request.machineId);
  if (!access.isDeviceEnabled) {
    return failure("machine", access.unavailable.message, attempt);
  }

  const ping = await deps.pingMachine(request.machineId);
  if (!ping.ok) {
    return failure("ping", ping.error, attempt);
  }
  if (!ping.acknowledged) {
    return failure(
      "ping",
      "The selected machine is not reachable. Make sure the CLI is running and connected.",
      attempt,
    );
  }

  const created = await prepareSession(deps, binding, attempt);
  if (!created.ok) {
    return created.result;
  }

  // The exact session must carry the machine before authorization resolves.
  const bound = await bindMachine(
    deps,
    binding,
    attempt,
    created.value,
    request.machineId,
  );
  if (!bound.ok) {
    return bound.result;
  }

  const attached = await prepareConversation(
    deps,
    binding,
    attempt,
    bound.value,
  );
  if (!attached.ok) {
    return attached.result;
  }

  const { session, conversationId } = attached.value;
  const operation = await access.interactions.startSession({
    operationId: attempt.operationId,
    organizationId: binding.organizationId,
    projectId: binding.projectId,
    agentSessionId: session.id,
    conversationId,
    intent: buildIntent(binding, request.prompt, session, conversationId),
  });
  attempt.outcome = operation;
  return settled(attempt, operation);
};

/**
 * Starts an agent session in the one order the platform authorizes: ping the
 * machine, create the session, persist its machine, attach the Conversation,
 * then authorize and start. Concurrent callers share one run; once a start has
 * been submitted its recorded outcome is returned instead of resubmitting.
 */
export const launchAgentSession = (
  deps: AgentSessionLaunchDependencies,
  binding: AgentSessionLaunchBinding,
  request: AgentSessionLaunchRequest,
  attempt: AgentSessionLaunchAttempt,
): Promise<AgentSessionLaunchResult> => {
  if (attempt.inFlight) {
    return attempt.inFlight;
  }
  const run = runLaunch(deps, binding, request, attempt).finally(() => {
    attempt.inFlight = null;
  });
  attempt.inFlight = run;
  return run;
};
