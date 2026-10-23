import {
  MessageType,
  type AgentSkillSelection,
  AgentSkillCatalogScope,
  AgentSkillProvider,
  type CodingPromptStartupPlanPayload,
  type CreateUserMessage,
  type RunAttachmentReference,
} from "../../../../api";
import { renderStartupPlanReviewMarkdown } from "../../../../agents/coordination/startupPlanRendering";
import {
  CODING_METHOD_ACTION_ID,
  CODING_PROMPT_FOLLOWUP_INPUT_ID,
} from "../../../AgentSession/codingPromptConversationContracts";
import type {
  AgentProvider,
  ReasoningEffort,
  StartupPlanDecision,
  StartupPlanSubmission,
} from "../types";

type StartupDiscrepancyDisposition = "acknowledged" | "blocker";

interface StartupDiscrepancyDispositionEntry {
  discrepancyIndex: number;
  disposition: StartupDiscrepancyDisposition;
  note?: string;
}

interface StartupDiscrepancyFeedbackEntry {
  discrepancyIndex: number;
  note: string;
}

interface StartupStepFeedbackEntry {
  stepId: string;
  note: string;
}

interface StartupQuestionAnswerEntry {
  questionIndex: number;
  answer: string;
}

type StartupPlanFieldValue = CodingPromptStartupPlanPayload & {
  discrepancyDispositions?: StartupDiscrepancyDispositionEntry[];
  discrepancyFeedback?: StartupDiscrepancyFeedbackEntry[];
  stepFeedback?: StartupStepFeedbackEntry[];
  questionAnswers?: StartupQuestionAnswerEntry[];
  decision?: StartupPlanDecision;
  feedback?: string;
  provider?: AgentProvider;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  fastMode?: boolean;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isStartupDiscrepancyDisposition = (
  value: unknown,
): value is StartupDiscrepancyDisposition =>
  value === "acknowledged" || value === "blocker";

const isStartupPlanDecision = (value: unknown): value is StartupPlanDecision =>
  value === "approve" || value === "improve";

const readNonNegativeInteger = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : null;

const readOptionalTrimmedString = (value: unknown): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const isAgentSkillProvider = (value: unknown): value is AgentSkillProvider =>
  value === AgentSkillProvider.Claude ||
  value === AgentSkillProvider.Codex ||
  value === AgentSkillProvider.Opencode;

const isAgentSkillCatalogScope = (
  value: unknown,
): value is AgentSkillSelection["catalogScope"] =>
  value === AgentSkillCatalogScope.User ||
  value === AgentSkillCatalogScope.Repo ||
  value === AgentSkillCatalogScope.System ||
  value === AgentSkillCatalogScope.Admin;

const readSkillSelection = (
  data: Record<string, unknown>,
): AgentSkillSelection | undefined => {
  const agentInput = data.agentInput;
  if (!isRecord(agentInput)) return undefined;

  const selection = agentInput.skillSelection;
  if (!isRecord(selection)) return undefined;
  if (
    !isAgentSkillProvider(selection.provider) ||
    !isAgentSkillCatalogScope(selection.catalogScope) ||
    typeof selection.name !== "string" ||
    selection.name.trim().length === 0 ||
    selection.name.length > 200
  ) {
    return undefined;
  }

  return {
    provider: selection.provider,
    name: selection.name,
    catalogScope: selection.catalogScope,
  };
};

const readFollowupPromptText = (
  data: Record<string, unknown>,
): string | undefined => {
  const agentInput = data.agentInput;
  if (isRecord(agentInput)) {
    const userMessage = readOptionalTrimmedString(agentInput.userMessage);
    if (userMessage) {
      return userMessage;
    }
  }

  return readOptionalTrimmedString(data[CODING_PROMPT_FOLLOWUP_INPUT_ID]);
};

const isRequiredServiceIdCollection = (value: unknown): boolean => {
  const serviceIds = Array.isArray(value)
    ? value
    : value instanceof Set
      ? [...value]
      : null;

  return (
    serviceIds !== null &&
    serviceIds.length > 0 &&
    serviceIds.every(
      (serviceId) => typeof serviceId === "string" && serviceId.length > 0,
    ) &&
    new Set(serviceIds).size === serviceIds.length
  );
};

const isStartupPlanFieldValue = (
  value: unknown,
): value is StartupPlanFieldValue => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    value.responseType === "startup_plan_v1" &&
    typeof value.sessionTitle === "string" &&
    isRequiredServiceIdCollection(value.requiredServiceIds) &&
    Array.isArray(value.primaryImplementations) &&
    Array.isArray(value.executionPlan) &&
    Array.isArray(value.discrepancies) &&
    Array.isArray(value.clarificationQuestions)
  );
};

const extractDiscrepancyDispositions = (
  value: StartupPlanFieldValue,
): StartupDiscrepancyDispositionEntry[] => {
  if (!Array.isArray(value.discrepancyDispositions)) {
    return [];
  }

  const entriesByIndex = new Map<number, StartupDiscrepancyDispositionEntry>();

  value.discrepancyDispositions.forEach((entry) => {
    if (!isRecord(entry)) {
      return;
    }

    const discrepancyIndex = readNonNegativeInteger(entry.discrepancyIndex);
    if (discrepancyIndex === null) {
      return;
    }

    if (!isStartupDiscrepancyDisposition(entry.disposition)) {
      return;
    }

    const note = readOptionalTrimmedString(entry.note);
    entriesByIndex.set(discrepancyIndex, {
      discrepancyIndex,
      disposition: entry.disposition,
      ...(note ? { note } : {}),
    });
  });

  return [...entriesByIndex.values()].sort(
    (left, right) => left.discrepancyIndex - right.discrepancyIndex,
  );
};

const extractDiscrepancyFeedback = (input: {
  value: StartupPlanFieldValue;
  discrepancyCount: number;
}): StartupDiscrepancyFeedbackEntry[] => {
  if (!Array.isArray(input.value.discrepancyFeedback)) {
    return [];
  }

  const entriesByIndex = new Map<number, StartupDiscrepancyFeedbackEntry>();

  input.value.discrepancyFeedback.forEach((entry) => {
    if (!isRecord(entry)) {
      return;
    }

    const discrepancyIndex = readNonNegativeInteger(entry.discrepancyIndex);
    if (
      discrepancyIndex === null ||
      discrepancyIndex >= input.discrepancyCount
    ) {
      return;
    }

    const note = readOptionalTrimmedString(entry.note);
    if (!note) {
      return;
    }

    entriesByIndex.set(discrepancyIndex, {
      discrepancyIndex,
      note,
    });
  });

  return [...entriesByIndex.values()].sort(
    (left, right) => left.discrepancyIndex - right.discrepancyIndex,
  );
};

const extractStepFeedback = (input: {
  value: StartupPlanFieldValue;
  executionSteps: StartupPlanFieldValue["executionPlan"];
}): StartupStepFeedbackEntry[] => {
  if (!Array.isArray(input.value.stepFeedback)) {
    return [];
  }

  const executionStepIds = input.executionSteps.map((step) => step.stepId);
  const executionStepIdSet = new Set(executionStepIds);
  const entriesById = new Map<string, StartupStepFeedbackEntry>();

  input.value.stepFeedback.forEach((entry) => {
    if (!isRecord(entry)) {
      return;
    }

    const stepId = readOptionalTrimmedString(entry.stepId);
    if (!stepId || !executionStepIdSet.has(stepId)) {
      return;
    }

    const note = readOptionalTrimmedString(entry.note);
    if (!note) {
      return;
    }

    entriesById.set(stepId, {
      stepId,
      note,
    });
  });

  return executionStepIds
    .map((stepId) => entriesById.get(stepId))
    .filter((entry): entry is StartupStepFeedbackEntry => entry !== undefined);
};

const extractQuestionAnswers = (input: {
  value: StartupPlanFieldValue;
  clarificationQuestions: StartupPlanFieldValue["clarificationQuestions"];
}): StartupQuestionAnswerEntry[] => {
  if (!Array.isArray(input.value.questionAnswers)) {
    return [];
  }

  const questionCount = input.clarificationQuestions.length;
  const entriesByIndex = new Map<number, StartupQuestionAnswerEntry>();

  input.value.questionAnswers.forEach((entry) => {
    if (!isRecord(entry)) {
      return;
    }

    const questionIndex = readNonNegativeInteger(entry.questionIndex);
    if (questionIndex === null || questionIndex >= questionCount) {
      return;
    }

    const answer = readOptionalTrimmedString(entry.answer);
    if (!answer) {
      return;
    }

    entriesByIndex.set(questionIndex, {
      questionIndex,
      answer,
    });
  });

  return [...entriesByIndex.values()].sort(
    (left, right) => left.questionIndex - right.questionIndex,
  );
};

const toDiscrepancyDispositionsFromFeedback = (input: {
  discrepancyFeedback: StartupDiscrepancyFeedbackEntry[];
  decision: StartupPlanDecision;
}): StartupDiscrepancyDispositionEntry[] =>
  input.discrepancyFeedback.map((entry) => ({
    discrepancyIndex: entry.discrepancyIndex,
    disposition: input.decision === "improve" ? "blocker" : "acknowledged",
    note: entry.note,
  }));

const buildStartupPlanFeedbackText = (input: {
  baseFeedback?: string;
  stepFeedback: StartupStepFeedbackEntry[];
  executionPlan: StartupPlanFieldValue["executionPlan"];
  discrepancyFeedback: StartupDiscrepancyFeedbackEntry[];
  discrepancies: StartupPlanFieldValue["discrepancies"];
}): string | null => {
  const sections: string[] = [];

  if (input.baseFeedback) {
    sections.push(input.baseFeedback);
  }

  if (input.stepFeedback.length > 0) {
    const stepById = new Map(
      input.executionPlan.map((step) => [step.stepId, step]),
    );
    const lines = input.stepFeedback.map((entry) => {
      const title = stepById.get(entry.stepId)?.title ?? entry.stepId;
      return `- ${title}: ${entry.note}`;
    });
    sections.push(`Execution Step Feedback:\n${lines.join("\n")}`);
  }

  if (input.discrepancyFeedback.length > 0) {
    const lines = input.discrepancyFeedback.map((entry) => {
      const discrepancyText =
        input.discrepancies[entry.discrepancyIndex]?.discrepancyText ??
        `Discrepancy #${String(entry.discrepancyIndex + 1)}`;
      return `- ${discrepancyText}: ${entry.note}`;
    });
    sections.push(`Discrepancy Feedback:\n${lines.join("\n")}`);
  }

  if (sections.length === 0) {
    return null;
  }

  return sections.join("\n\n");
};

const buildStartupPlanReviewPromptText = (input: {
  decision: StartupPlanDecision;
  baseFeedback?: string;
  stepFeedback: StartupStepFeedbackEntry[];
  executionPlan: StartupPlanFieldValue["executionPlan"];
  discrepancyFeedback: StartupDiscrepancyFeedbackEntry[];
  discrepancies: StartupPlanFieldValue["discrepancies"];
  questionAnswers: StartupQuestionAnswerEntry[];
  clarificationQuestions: StartupPlanFieldValue["clarificationQuestions"];
}): string =>
  // Decision header is always emitted, so this never returns null.
  renderStartupPlanReviewMarkdown({
    plan: {
      sessionTitle: "",
      executionPlan: input.executionPlan,
      discrepancies: input.discrepancies,
      clarificationQuestions: input.clarificationQuestions,
    },
    feedback: {
      generalFeedback: input.baseFeedback,
      stepFeedback: input.stepFeedback,
      discrepancyFeedback: input.discrepancyFeedback,
      questionAnswers: input.questionAnswers,
    },
    decision: input.decision,
  }) ?? "";

const toStartupPlanSubmission = (
  message: CreateUserMessage,
): { submission: StartupPlanSubmission; promptText: string } | null => {
  if (message.type !== MessageType.User || !isRecord(message.data)) {
    return null;
  }

  const startupPlanValue = Object.values(message.data).find(
    isStartupPlanFieldValue,
  );
  if (!startupPlanValue) {
    return null;
  }

  const legacyDiscrepancyDispositions =
    extractDiscrepancyDispositions(startupPlanValue);
  const discrepancyFeedback = extractDiscrepancyFeedback({
    value: startupPlanValue,
    discrepancyCount: startupPlanValue.discrepancies.length,
  });
  const stepFeedback = extractStepFeedback({
    value: startupPlanValue,
    executionSteps: startupPlanValue.executionPlan,
  });
  const questionAnswers = extractQuestionAnswers({
    value: startupPlanValue,
    clarificationQuestions: startupPlanValue.clarificationQuestions,
  });
  const hasBlocker = legacyDiscrepancyDispositions.some(
    (entry) => entry.disposition === "blocker",
  );
  const decision = isStartupPlanDecision(startupPlanValue.decision)
    ? startupPlanValue.decision
    : hasBlocker
      ? "improve"
      : "approve";
  const discrepancyDispositions =
    legacyDiscrepancyDispositions.length > 0
      ? legacyDiscrepancyDispositions
      : toDiscrepancyDispositionsFromFeedback({
          discrepancyFeedback,
          decision,
        });
  const feedback = buildStartupPlanFeedbackText({
    baseFeedback: readOptionalTrimmedString(startupPlanValue.feedback),
    stepFeedback,
    executionPlan: startupPlanValue.executionPlan,
    discrepancyFeedback,
    discrepancies: startupPlanValue.discrepancies,
  });
  const promptText = buildStartupPlanReviewPromptText({
    decision,
    baseFeedback: readOptionalTrimmedString(startupPlanValue.feedback),
    stepFeedback,
    executionPlan: startupPlanValue.executionPlan,
    discrepancyFeedback,
    discrepancies: startupPlanValue.discrepancies,
    questionAnswers,
    clarificationQuestions: startupPlanValue.clarificationQuestions,
  });

  const selectedProvider = startupPlanValue.provider;
  const selectedModel = readOptionalTrimmedString(startupPlanValue.model);
  const selectedEffort = startupPlanValue.reasoningEffort;
  const selectedFastMode = startupPlanValue.fastMode;

  return {
    promptText,
    submission: {
      decision,
      feedback,
      review: {
        responseType: "startup_plan_review_v1",
        originalPlan: {
          responseType: startupPlanValue.responseType,
          sessionTitle: startupPlanValue.sessionTitle,
          requiredServiceIds: startupPlanValue.requiredServiceIds,
          primaryImplementations: startupPlanValue.primaryImplementations,
          executionPlan: startupPlanValue.executionPlan,
          discrepancies: startupPlanValue.discrepancies,
          clarificationQuestions: startupPlanValue.clarificationQuestions,
        },
        questionAnswers: questionAnswers.map((entry) => ({
          question:
            startupPlanValue.clarificationQuestions[entry.questionIndex]
              ?.question ?? `Question #${String(entry.questionIndex + 1)}`,
          answer: entry.answer,
        })),
        discrepancyDispositions,
      },
      ...(selectedProvider ? { provider: selectedProvider } : {}),
      ...(selectedModel ? { model: selectedModel } : {}),
      ...(selectedEffort ? { reasoningEffort: selectedEffort } : {}),
      ...(typeof selectedFastMode === "boolean"
        ? { fastMode: selectedFastMode }
        : {}),
    },
  };
};

export type RunConversationMessageSubmission =
  | {
      kind: "startup_plan_review";
      submission: StartupPlanSubmission;
      promptText: string;
    }
  | {
      kind: "followup_prompt";
      promptText: string;
      skillSelection?: AgentSkillSelection;
      attachments: RunAttachmentReference[];
    }
  | {
      kind: "method_action";
      method: string;
    }
  | {
      kind: "permission_request";
    };

export const parseRunConversationMessageSubmission = (
  message: CreateUserMessage,
): RunConversationMessageSubmission | null => {
  const startupPlanSubmission = toStartupPlanSubmission(message);
  if (startupPlanSubmission) {
    return {
      kind: "startup_plan_review",
      submission: startupPlanSubmission.submission,
      promptText: startupPlanSubmission.promptText,
    };
  }

  if (message.type !== MessageType.User || !isRecord(message.data)) {
    return null;
  }

  // Permission request submissions are handled directly by AgentPermissionRequestField,
  // which posts the decision envelope as a platform message that the server detects
  // and emits as a signed permission_decision control frame. The form-level submit
  // (with `agent-request-permission-*` keys on data) is a no-op carrier.
  const hasPermissionKey = Object.keys(message.data).some((key) =>
    key.startsWith("agent-request-permission"),
  );
  if (hasPermissionKey) {
    return { kind: "permission_request" };
  }

  const method = readOptionalTrimmedString(
    message.data[CODING_METHOD_ACTION_ID],
  );
  if (method) {
    return { kind: "method_action", method };
  }

  const promptText = readFollowupPromptText(message.data);
  if (!promptText) {
    return null;
  }

  const skillSelection = readSkillSelection(message.data);
  return {
    kind: "followup_prompt",
    promptText,
    ...(skillSelection ? { skillSelection } : {}),
    attachments: message.data.attachments ?? [],
  };
};
