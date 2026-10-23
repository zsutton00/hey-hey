import { createContext, type PropsWithChildren, useMemo } from "react";
import {
  AgentOperationKind,
  AgentOperationState,
  HostActionCategory,
  HostActionTargetKind,
  HostAffectingActionType,
  MessageType,
  AgentInteractionState,
  AgentInteractionMode,
  SubagentCapability,
  type ConversationStartRunRequestDto,
  type ConversationStartRunResponseDto,
  ConversationStartRunResponseDtoOperationStateEnum,
  type PostMessageRequest,
  type AgentOperationSnapshot as ApiAgentOperationSnapshot,
  type AgentInteractionAdmissionResponse,
  type AgentInteraction,
  type InputCancellationResponse,
} from "../../../api";
import {
  projectsClient,
  machinesClient,
  agentSessionsClient,
  unifiedApiClient,
} from "../../../clients/serviceClients";
import { executeControllerAuthorizedAction } from "../../../data/hooks/useControllerAuthorizedAction";
import { fingerprintAgentOperation } from "./agentOperationFingerprint";
import type {
  AgentOperationCoordinator,
  AgentOperationDependencies,
  AgentOperationId,
  SubagentInteractionInput,
} from "./AgentOperationCoordinator";
import { DefaultAgentOperationCoordinator } from "./AgentOperationCoordinator";
import type { AgentOperationSnapshot } from "./agentOperationReducer";
import type { MessageAgentCommandIntent } from "../../SmarterTextAreaCard/slashCommands/messageAgentCommand";

export const requestSessionMessageInteraction = async (input: {
  organizationId: string;
  projectId: string;
  agentSessionId: string;
  interactionId: string;
  intent: MessageAgentCommandIntent;
}): Promise<void> => {
  const scope = {
    organizationId: input.organizationId,
    projectId: input.projectId,
  };
  const response = await agentSessionsClient.requestSessionMessageInteraction({
    ...scope,
    agentSessionId: input.agentSessionId,
    sessionMessageInteractionAdmissionRequest: {
      id: input.interactionId,
      attemptId: input.interactionId,
      sourceSessionId: input.agentSessionId,
      targetSessionId: input.intent.targetSessionId,
      commandText: input.intent.commandText,
      idempotencyKey: input.interactionId,
      expectedRevision: 0,
    },
  });
  const admitted = (
    response.data as unknown as { data: AgentInteractionAdmissionResponse }
  ).data?.interaction;
  if (
    !admitted ||
    admitted.id !== input.interactionId ||
    admitted.targetSessionId !== input.intent.targetSessionId
  ) {
    throw new Error("The platform did not confirm the target Agent Session.");
  }
  let state = admitted.state;
  while (
    state === AgentInteractionState.Dispatching ||
    state === AgentInteractionState.Waiting ||
    state === AgentInteractionState.ResultReady ||
    state === AgentInteractionState.Delivering
  ) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const current = await agentSessionsClient.getAgentInteraction({
      ...scope,
      interactionId: input.interactionId,
    });
    state = (current.data as unknown as { data: AgentInteraction }).data.state;
  }
  if (state !== AgentInteractionState.Delivered) {
    throw new Error(
      `The Agent Session message did not deliver a result: ${state}`,
    );
  }
};

/**
 * Authorize a typed child intent on the source session's machine, submit it,
 * then wait for durable dispatch acceptance.
 */
export const requestSubagentInteraction = async (
  input: SubagentInteractionInput,
): Promise<void> => {
  const scope = {
    organizationId: input.organizationId,
    projectId: input.projectId,
  };
  const result = await executeControllerAuthorizedAction({
    ...scope,
    machine: input.machine,
    action: {
      requestId: crypto.randomUUID(),
      actionCategory: HostActionCategory.Conversation,
      actionType: HostAffectingActionType.ConversationTrigger,
      targetKind: HostActionTargetKind.AgentSession,
      targetId: input.agentSessionId,
    },
    submit: ({ authorization }) =>
      agentSessionsClient.requestSubagentInteraction({
        ...scope,
        agentSessionId: input.agentSessionId,
        subagentInteractionAdmissionRequest: {
          id: input.interactionId,
          attemptId: input.interactionId,
          sourceSessionId: input.agentSessionId,
          sourceRunId: input.runId,
          mode:
            input.intent.mode === "foreground"
              ? AgentInteractionMode.Foreground
              : AgentInteractionMode.Background,
          capability: SubagentCapability.Research,
          objective: input.intent.objective,
          serviceIds: input.serviceIds,
          idempotencyKey: input.interactionId,
          expectedRevision: 0,
          authorization,
        },
      }),
  });
  if (result.outcome === "DENIED") {
    throw new Error(
      `The controller denied this child request: ${result.reason}`,
    );
  }
  const response = result.data;
  const admitted = (
    response.data as unknown as { data: AgentInteractionAdmissionResponse }
  ).data?.interaction;
  if (!admitted || admitted.id !== input.interactionId) {
    throw new Error("The platform did not confirm the child interaction.");
  }
  let state = admitted.state;
  const readState = async (): Promise<AgentInteractionState> => {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const current = await agentSessionsClient.getAgentInteraction({
      ...scope,
      interactionId: input.interactionId,
    });
    return (
      (current.data as unknown as { data: AgentInteraction }).data?.state ??
      state
    );
  };
  while (state === AgentInteractionState.Dispatching) {
    state = await readState();
  }
  if (
    state !== AgentInteractionState.Waiting &&
    state !== AgentInteractionState.ResultReady &&
    state !== AgentInteractionState.Delivering &&
    state !== AgentInteractionState.Delivered
  ) {
    throw new Error(`The child interaction ended before dispatch: ${state}`);
  }
  input.onAccepted?.(input.interactionId);
  if (input.intent.mode === "foreground") {
    while (
      state === AgentInteractionState.Waiting ||
      state === AgentInteractionState.ResultReady ||
      state === AgentInteractionState.Delivering
    ) {
      state = await readState();
    }
    if (state !== AgentInteractionState.Delivered) {
      throw new Error(
        `The foreground child did not deliver a result: ${state}`,
      );
    }
  }
};

export const cancelSubagentInteraction = async (input: {
  organizationId: string;
  projectId: string;
  interactionId: string;
}): Promise<void> => {
  const scope = {
    organizationId: input.organizationId,
    projectId: input.projectId,
    interactionId: input.interactionId,
  };
  const current = await agentSessionsClient.getAgentInteraction(scope);
  const interaction = (current.data as unknown as { data: AgentInteraction })
    .data;
  if (!interaction) throw new Error("The child interaction is unavailable.");
  await agentSessionsClient.cancelSubagentInteraction({
    ...scope,
    subagentCancellationRequest: { expectedRevision: interaction.revision },
  });
};

export const AgentOperationContext =
  createContext<AgentOperationCoordinator | null>(null);
export interface AgentOperationProviderProps extends PropsWithChildren {
  dependencies?: AgentOperationDependencies;
}

const scopes = new Map<
  AgentOperationId,
  { organizationId: string; projectId: string }
>();

const mapStartResponse = (
  response: ConversationStartRunResponseDto,
): AgentOperationSnapshot => {
  const base = {
    operationId: response.operationId as AgentOperationId,
    fingerprint: response.operationFingerprint,
    kind: "start_run" as const,
  };
  switch (response.operationState) {
    case ConversationStartRunResponseDtoOperationStateEnum.Succeeded:
      return {
        ...base,
        state: "succeeded",
        messageId: response.triggerMessageId,
        triggerMessageId: response.triggerMessageId,
      };
    case ConversationStartRunResponseDtoOperationStateEnum.Cancelled:
      return { ...base, state: "cancelled" };
    case ConversationStartRunResponseDtoOperationStateEnum.Denied:
      return {
        ...base,
        state: "denied",
        code: "DENIED",
        message: "The platform denied this operation.",
      };
    case ConversationStartRunResponseDtoOperationStateEnum.Failed:
      return {
        ...base,
        state: "failed",
        code: "FAILED",
        message: "The platform failed this operation.",
      };
    case ConversationStartRunResponseDtoOperationStateEnum.DispatchPending:
      return { ...base, state: "dispatch_pending" };
    case ConversationStartRunResponseDtoOperationStateEnum.Reconciling:
      return { ...base, state: "reconciling" };
  }
};

const mapSnapshot = (
  snapshot: ApiAgentOperationSnapshot,
): AgentOperationSnapshot => {
  const kind = (() => {
    switch (snapshot.kind) {
      case AgentOperationKind.StartRun:
        return "start_run" as const;
      case AgentOperationKind.DirectTrigger:
        return "submit_message" as const;
      case AgentOperationKind.WorkflowAnswer:
        throw new Error(
          "Workflow answers are not owned by AgentOperationCoordinator.",
        );
    }
    throw new Error(`Unsupported agent operation kind: ${snapshot.kind}`);
  })();
  const base = {
    operationId: snapshot.operationId as AgentOperationId,
    fingerprint: snapshot.fingerprint,
    kind,
  };
  switch (snapshot.state) {
    case AgentOperationState.Succeeded:
      if (!snapshot.messageId || !snapshot.triggerMessageId)
        throw new Error("Succeeded operation is missing message correlation.");
      return {
        ...base,
        state: "succeeded",
        messageId: snapshot.messageId,
        triggerMessageId: snapshot.triggerMessageId,
      };
    case AgentOperationState.Cancelled:
      return { ...base, state: "cancelled" };
    case AgentOperationState.Denied:
      return {
        ...base,
        state: "denied",
        code: snapshot.code ?? "DENIED",
        message: snapshot.message ?? "Operation denied.",
      };
    case AgentOperationState.Failed:
      return {
        ...base,
        state: "failed",
        code: snapshot.code ?? "FAILED",
        message: snapshot.message ?? "Operation failed.",
      };
    case AgentOperationState.RoutingPending:
    case AgentOperationState.AwaitingWorkflowResolution:
      return { ...base, state: "submitting" };
    case AgentOperationState.Created:
      return { ...base, state: "created" };
    case AgentOperationState.ResolvingAuthorization:
      return { ...base, state: "resolving_authorization" };
    case AgentOperationState.AwaitingApproval:
      return { ...base, state: "awaiting_approval" };
    case AgentOperationState.Submitting:
      return { ...base, state: "submitting" };
    case AgentOperationState.DispatchPending:
      if (
        kind === "submit_message" &&
        snapshot.messageId &&
        snapshot.triggerMessageId
      )
        return {
          ...base,
          state: "accepted",
          messageId: snapshot.messageId,
          triggerMessageId: snapshot.triggerMessageId,
        };
      return { ...base, state: "dispatch_pending" };
    case AgentOperationState.Reconciling:
      if (
        kind === "submit_message" &&
        snapshot.messageId &&
        snapshot.triggerMessageId
      )
        return {
          ...base,
          state: "accepted",
          messageId: snapshot.messageId,
          triggerMessageId: snapshot.triggerMessageId,
        };
      return { ...base, state: "reconciling" };
  }
};

const machineFor = async (machineId: string) => {
  const response = await machinesClient.listMachines();
  const machine = response.data?.data?.machines.find(
    (candidate) => candidate.machineId === machineId,
  );
  if (!machine) throw new Error("The selected machine is no longer available.");
  return machine;
};

export const defaultAgentOperationDependencies: AgentOperationDependencies = {
  fingerprintStart: (input) =>
    fingerprintAgentOperation({
      kind: "START_RUN",
      organizationId: input.organizationId,
      projectId: input.projectId,
      conversationId: input.conversationId,
      request: {
        ...input.intent,
        agentSessionId: input.agentSessionId,
        machineId: input.machineId,
      },
    }),
  fingerprintMessage: (input) =>
    fingerprintAgentOperation({
      kind: "DIRECT_TRIGGER",
      organizationId: input.organizationId,
      projectId: input.projectId,
      message: { ...input.intent, agentSessionId: input.agentSessionId },
    }),
  async startSession({ operationId, fingerprint, input }) {
    scopes.set(operationId, {
      organizationId: input.organizationId,
      projectId: input.projectId,
    });
    const machine = await machineFor(input.machineId);
    const result = await executeControllerAuthorizedAction({
      organizationId: input.organizationId,
      projectId: input.projectId,
      machine,
      action: {
        requestId: crypto.randomUUID(),
        actionCategory: HostActionCategory.Conversation,
        actionType: HostAffectingActionType.ConversationTrigger,
        targetKind: HostActionTargetKind.AgentSession,
        targetId: input.agentSessionId,
      },
      submit: ({ authorization }) =>
        unifiedApiClient.startConversationRun({
          organizationId: input.organizationId,
          projectId: input.projectId,
          conversationId: input.conversationId,
          conversationStartRunRequestDto: {
            ...input.intent,
            agentSessionId: input.agentSessionId,
            operationId,
            operationFingerprint: fingerprint,
            machineId: input.machineId,
            authorization,
          } satisfies ConversationStartRunRequestDto,
        }),
    });
    if (result.outcome === "DENIED")
      return {
        operationId,
        fingerprint,
        kind: "start_run",
        state: "denied",
        code: result.reason,
        message: "The controller denied this local action.",
      };
    const data: ConversationStartRunResponseDto | undefined =
      result.data.data?.data;
    if (!data)
      return {
        operationId,
        fingerprint,
        kind: "start_run",
        state: "failed",
        code: "EMPTY_RESPONSE",
        message: "The platform returned no operation result.",
      };
    return mapStartResponse(data);
  },
  async submitMessage({ operationId, fingerprint, input }) {
    scopes.set(operationId, {
      organizationId: input.organizationId,
      projectId: input.projectId,
    });
    const machine = await machineFor(input.machineId);
    const result = await executeControllerAuthorizedAction({
      organizationId: input.organizationId,
      projectId: input.projectId,
      machine,
      action: {
        requestId: crypto.randomUUID(),
        actionCategory: HostActionCategory.Conversation,
        actionType: HostAffectingActionType.ConversationTrigger,
        targetKind: HostActionTargetKind.AgentSession,
        targetId: input.agentSessionId,
      },
      submit: ({ authorization }) =>
        unifiedApiClient.postMessage({
          organizationId: input.organizationId,
          projectId: input.projectId,
          postMessageRequest: {
            ...input.intent,
            type: MessageType.User,
            agentSessionId: input.agentSessionId,
            operationId,
            operationFingerprint: fingerprint,
            authorization,
          } satisfies Extract<PostMessageRequest, { type: "USER" }>,
        }),
    });
    if (result.outcome === "DENIED")
      return {
        operationId,
        fingerprint,
        kind: "submit_message",
        state: "denied",
        code: result.reason,
        message: "The controller denied this local action.",
      };
    const message = result.data.data.data;
    if (!message)
      throw new Error("The platform did not confirm the submitted message.");
    return {
      operationId,
      fingerprint,
      kind: "submit_message",
      state: "accepted",
      messageId: message.id,
      triggerMessageId: message.id,
      message,
    };
  },
  requestSubagent: requestSubagentInteraction,
  async reconcile(operationId) {
    const scope = scopes.get(operationId);
    if (!scope)
      throw new Error(
        "Agent operation scope is unavailable for reconciliation.",
      );
    const response = await unifiedApiClient.getAgentOperation({
      ...scope,
      operationId,
    });
    const snapshot = response.data.data;
    if (!snapshot)
      throw new Error("The platform returned no agent operation snapshot.");
    return mapSnapshot(snapshot);
  },
};

export const defaultAgentOperationCoordinator =
  new DefaultAgentOperationCoordinator(defaultAgentOperationDependencies);
export const AgentOperationProvider = ({
  dependencies,
  children,
}: AgentOperationProviderProps) => {
  const coordinator = useMemo(
    () =>
      dependencies
        ? new DefaultAgentOperationCoordinator(dependencies)
        : defaultAgentOperationCoordinator,
    [dependencies],
  );
  return (
    <AgentOperationContext.Provider value={coordinator}>
      {children}
    </AgentOperationContext.Provider>
  );
};

/** Cancellation is a persisted request; only the execution owner can confirm it. */
export async function cancelQueuedInput(input: {
  organizationId: string;
  projectId: string;
  agentSessionId: string;
  operationId: string;
  messageId: string;
}): Promise<InputCancellationResponse> {
  const response = await projectsClient.cancelAgentOperationInput({
    organizationId: input.organizationId,
    projectId: input.projectId,
    operationId: input.operationId,
    inputCancellationRequest: {
      agentSessionId: input.agentSessionId,
      messageId: input.messageId,
    },
  });
  if (!response.data.data)
    throw new Error("The platform did not confirm the cancellation request.");
  return response.data.data;
}
