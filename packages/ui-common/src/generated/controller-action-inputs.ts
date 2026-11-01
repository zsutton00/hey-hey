// Generated from the shared OpenAPI action-input mapping.
import type {
  ConversationStartRunRequestDto,
  ControllerStartInputs,
  ControllerMessageInputs,
  UserMessageData,
} from "../api";
/** Build the delivered start payload before approval. Keep this mapping shared
 * with the API producer, so newly introduced execution inputs have one owner. */
export function startControllerInputs(
  request:
    | ConversationStartRunRequestDto
    | Omit<
        ConversationStartRunRequestDto,
        "authorization" | "operationId" | "operationFingerprint" | "machineId"
      >,
): ControllerStartInputs {
  const semanticRequest =
    "authorization" in request
      ? (({
          authorization: _proof,
          operationId: _operation,
          operationFingerprint: _fingerprint,
          machineId: _machine,
          ...inputs
        }) => inputs)(request)
      : request;
  const { initialMessage, ...payload } = semanticRequest;
  const {
    serviceIds,
    launchServiceId,
    triggersAgent,
    attachments,
    stagedBrowserTab,
    runId: _legacyRunId,
    skillSelection: _unusedStartSkill,
    ...common
  } = payload;
  const services =
    serviceIds && serviceIds.length > 0
      ? {
          serviceIds,
          ...(launchServiceId !== undefined ? { launchServiceId } : {}),
        }
      : {};
  if (request.workflowName) {
    return { kind: "START_RUN", payload: { ...common, ...services } };
  }
  const suppressDispatch =
    triggersAgent === false ||
    (initialMessage?.role === "SYSTEM" &&
      initialMessage.triggersAgent === false);
  return {
    kind: "START_RUN",
    payload: {
      ...common,
      ...services,
      ...(attachments !== undefined ? { attachments } : {}),
      ...(stagedBrowserTab !== undefined ? { stagedBrowserTab } : {}),
      ...(suppressDispatch ? { triggersAgent: false } : {}),
    },
  };
}

function controllerMessageText(data: UserMessageData): string {
  const inputText = data.agentInput?.userMessage;
  if (typeof inputText === "string" && inputText.trim())
    return inputText.trim();
  for (const text of [data["message"], data["comment"], data["feedback"]]) {
    if (typeof text === "string" && text) return text.trim();
  }
  for (const [key, value] of Object.entries(data)) {
    if (
      typeof value === "string" &&
      value.trim() &&
      ["message", "response", "input", "text", "content"].some((word) =>
        key.toLowerCase().includes(word),
      )
    )
      return value.trim();
  }
  for (const value of Object.values(data)) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

export function messageControllerInputs(
  data: UserMessageData,
): ControllerMessageInputs {
  const input = data.agentInput;
  if (!input || !("promptType" in input))
    throw new Error("Direct messages require a typed prompt input");
  const featureSyncContext =
    input.promptType === "feature_sync_iterate"
      ? { discrepancies: input.discrepancies }
      : input.promptType === "plan_shaping_feature_sync_iterate"
        ? {
            planId: input.planId,
            designDocId: input.designDocId,
            discrepancies: input.discrepancies,
            decisions: input.decisions,
          }
        : undefined;
  return {
    kind: "USER_MESSAGE",
    payload: {
      handlerPromptType: input.promptType,
      userMessage: controllerMessageText(data),
      attachments: data.attachments ?? [],
      ...(input.skillSelection ? { skillSelection: input.skillSelection } : {}),
      ...(input.promptType === "task_monitor"
        ? {
            taskMonitorPayload: {
              monitorId: input.monitorId,
              cause: input.cause,
              correlationId: input.correlationId,
              ...(input.userMessage ? { userMessage: input.userMessage } : {}),
              ...(input.launchConfig
                ? { launchConfig: input.launchConfig }
                : {}),
              ...(input.judgment ? { judgment: input.judgment } : {}),
            },
          }
        : {}),
      ...(featureSyncContext ? { featureSyncContext } : {}),
      ...((input.promptType === "commit" ||
        input.promptType === "code_review") &&
      input.runtime
        ? { runtime: input.runtime }
        : {}),
    },
  };
}
