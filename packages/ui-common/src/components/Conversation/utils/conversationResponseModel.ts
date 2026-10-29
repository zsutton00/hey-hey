import {
  ConversationStatus,
  type AgentSessionCurrentState,
  type ConversationResponseDto,
} from "../../../api";
import type { SecondAction } from "../../LlmForms/types";
import { isAgentHiddenSystemMessage } from "../utils";
import { getAgentSessionCurrentStatePresentation } from "../../AgentSession/agentSessionCurrentStatePresentation";
import {
  MessageType,
  type MessageResponseDto,
  type ReportDto,
  type UIElement,
} from "../../../api";
import type { ConversationMessage } from "../../../types/conversation";
import { extractMentions } from "../../../utils/mentionFormatting";
import { getFieldResponseBehavior } from "../../LlmForms/Registry/fieldResponseMetadata";
import {
  getReportConfig,
  resolveInteractiveReportResponseUiElement,
  type InteractiveReportAttachment,
} from "../../Reports/reportConfig";
import type {
  CanonicalMessageId,
  ConversationFormResolution,
  ConversationFormResolver,
  ConversationResponseDeclaration,
  ConversationResponseTarget,
  ResponseBehavior,
} from "../Components/conversationFormTypes";
import {
  hasPersistedFormResponse,
  isFormSubmissionDisabled,
} from "./conversationFormHelpers";
import { shouldShowForm } from "./messageStateUtils";

export const NO_RESPONSE_TARGET: ConversationResponseTarget = {
  ownership: "none",
};

export interface ResolvedConversationForm {
  secondActions: SecondAction[];
  resolution: ConversationFormResolution | null;
  uiElements: UIElement[];
  formUiElements: UIElement[];
  inlineReports: ReportDto[];
  modalReports: ReportDto[];
  interactiveReportAttachments: InteractiveReportAttachment[];
  declarations: readonly ConversationResponseDeclaration[];
  shouldRenderForm: boolean;
  isSubmitted: boolean;
  isCompleted: boolean;
  isFormReadOnly: boolean;
  isCurrent: boolean;
}

interface FormModelOptions {
  orderedMessages?: readonly MessageResponseDto[];
  resolveActions?: (
    entry: ConversationMessage,
    elements: UIElement[],
  ) => SecondAction[];
  resolver?: ConversationFormResolver;
  workflowCanSubmit: boolean;
  isSubmitting: boolean;
  readOnly: boolean;
  isCliInputDisabled: boolean;
}

const declareResponse = (
  behavior: ResponseBehavior,
  element: UIElement,
): ConversationResponseDeclaration =>
  behavior.ownership === "display-only"
    ? behavior
    : { ...behavior, currentFieldId: element.id };

const resolveReports = (
  message: MessageResponseDto,
  uiElements: UIElement[],
) => {
  const inlineReports: ReportDto[] = [];
  const modalReports: ReportDto[] = [];
  const interactiveReportAttachments: InteractiveReportAttachment[] = [];
  const declarations: ConversationResponseDeclaration[] = [];
  if (message.type !== MessageType.System) {
    return {
      inlineReports,
      modalReports,
      interactiveReportAttachments,
      declarations,
    };
  }
  const mentioned = new Set(
    extractMentions(message.data.response ?? "", { allowMentionEscapes: true })
      .filter((mention) => mention.entityType.toLowerCase() === "report")
      .map((mention) => mention.entityId),
  );
  for (const report of message.reports ?? []) {
    const config = getReportConfig(report.reportType);
    if (config.presentation !== "interactive" && mentioned.has(report.id))
      continue;
    switch (config.presentation) {
      case "inline":
        inlineReports.push(report);
        break;
      case "modal":
        modalReports.push(report);
        break;
      case "interactive": {
        const responseUiElement = resolveInteractiveReportResponseUiElement(
          config,
          uiElements,
        );
        interactiveReportAttachments.push({ report, responseUiElement });
        declarations.push(
          declareResponse(config.responseBehavior, responseUiElement),
        );
        break;
      }
    }
  }
  return {
    inlineReports,
    modalReports,
    interactiveReportAttachments,
    declarations,
  };
};

/** Effective elements and attachment placement are resolved once for both consumers. */
export const resolveConversationForm = (
  entry: ConversationMessage,
  isCurrent: boolean,
  options: FormModelOptions,
): ResolvedConversationForm => {
  const resolution = options.resolver?.(entry) ?? null;
  const uiElements = (
    resolution?.uiElements ??
    (entry.message.type === MessageType.System
      ? (entry.message.data.uiElements ?? [])
      : [])
  ).filter(Boolean);
  const reports = resolveReports(entry.message, uiElements);
  const reportFieldIds = new Set(
    reports.interactiveReportAttachments.map(
      ({ responseUiElement }) => responseUiElement.id,
    ),
  );
  const formUiElements = uiElements.filter(
    (element) => !reportFieldIds.has(element.id),
  );
  const fieldDeclarations = formUiElements.map((element) => {
    return declareResponse(
      getFieldResponseBehavior(element) ?? {
        ownership: "display-only",
      },
      element,
    );
  });
  const isSubmitted =
    Boolean(resolution?.isSubmitted) || hasPersistedFormResponse(entry);
  const isCompleted =
    !entry.canEdit ||
    Boolean(resolution?.isSubmitted) ||
    hasPersistedFormResponse(entry);
  const hidden =
    entry.message.type === MessageType.System &&
    isAgentHiddenSystemMessage(entry.message);
  const secondActions = hidden
    ? []
    : (options.resolveActions?.(entry, formUiElements) ?? []);
  const showForm = !hidden && (resolution ? true : shouldShowForm(entry));
  return {
    ...reports,
    secondActions,
    resolution,
    uiElements,
    formUiElements,
    declarations: resolution?.responseDeclarations ?? [
      ...fieldDeclarations,
      ...reports.declarations,
    ],
    shouldRenderForm:
      showForm && (!options.readOnly || isSubmitted || uiElements.length > 0),
    isSubmitted,
    isCompleted,
    isCurrent,
    isFormReadOnly:
      options.readOnly ||
      !isCurrent ||
      options.isCliInputDisabled ||
      isCompleted ||
      (resolution
        ? resolution.disabled || options.isSubmitting
        : isFormSubmissionDisabled(
            entry,
            options.workflowCanSubmit,
            options.isSubmitting,
          )),
  };
};

const collectCanonicalIds = (
  messages: readonly MessageResponseDto[],
  ids = new Set<string>(),
): Set<string> => {
  for (const message of messages) {
    ids.add(message.id);
    collectCanonicalIds(message.responses ?? [], ids);
  }
  return ids;
};

const deriveTarget = (
  entry: ConversationMessage | undefined,
  form: ResolvedConversationForm | undefined,
  canonicalIds: Set<string>,
): ConversationResponseTarget => {
  if (
    !entry ||
    !form ||
    entry.message.type !== MessageType.System ||
    !canonicalIds.has(entry.message.id) ||
    isAgentHiddenSystemMessage(entry.message) ||
    form.isCompleted ||
    (!form.shouldRenderForm && form.interactiveReportAttachments.length === 0)
  )
    return NO_RESPONSE_TARGET;
  const liveAction = form.shouldRenderForm
    ? form.secondActions.find(
        (action) =>
          action.submitsForm &&
          !action.disabled &&
          !form.declarations.some(
            (declaration) =>
              declaration.ownership === "contribution" &&
              declaration.currentFieldId === action.fieldId,
          ),
      )
    : undefined;
  const declaration =
    form.declarations.find((item) => item.ownership === "exclusive") ??
    (liveAction
      ? {
          ownership: "exclusive" as const,
          currentFieldId: liveAction.fieldId ?? liveAction.testId ?? "button",
          submissionKind: "field" as const,
        }
      : undefined) ??
    form.declarations.find((item) => item.ownership === "contribution");
  if (!declaration || declaration.ownership === "display-only")
    return NO_RESPONSE_TARGET;
  // Membership above proves this identity came from persisted canonical Messages.
  return {
    ...declaration,
    messageId: entry.message.id as CanonicalMessageId,
    usable: !form.isFormReadOnly,
  };
};

export const resolveConversationResponseModel = (
  timeline: readonly ConversationMessage[],
  canonicalMessages: readonly MessageResponseDto[],
  options: FormModelOptions,
) => {
  const latestCanonical = options.orderedMessages?.at(-1);
  const current = options.orderedMessages
    ? timeline.find((entry) => entry.message.id === latestCanonical?.id)
    : timeline[timeline.length - 1];
  const forms = new Map(
    timeline.map((entry) => [
      entry.message.id,
      resolveConversationForm(entry, entry === current, options),
    ]),
  );
  // Never search backwards for an older unanswered field.
  return {
    forms,
    current: current
      ? { message: current.message, form: forms.get(current.message.id)! }
      : null,
    replyParentMessageId:
      latestCanonical?.type === MessageType.System
        ? latestCanonical.id
        : !options.orderedMessages &&
            current?.message.type === MessageType.System
          ? current.message.id
          : null,
    target: deriveTarget(
      current,
      current ? forms.get(current.message.id) : undefined,
      collectCanonicalIds(canonicalMessages),
    ),
  };
};

export type ConversationResponseModel = ReturnType<
  typeof resolveConversationResponseModel
>;

/** Independent facts are combined once at the conversation boundary. */
export const deriveConversationModel = (input: {
  response: ConversationResponseModel;
  conversation: ConversationResponseDto | null;
  messages: readonly MessageResponseDto[];
  settled: boolean;
  error: Error | null;
  currentState?: AgentSessionCurrentState;
  forceProcessing: boolean;
  readOnly: boolean;
  canSubmit: boolean;
  submission: "idle" | "sending" | "awaiting-persistence";
}) => {
  const presentation = input.currentState
    ? getAgentSessionCurrentStatePresentation(input.currentState)
    : undefined;
  const processing =
    input.forceProcessing ||
    Boolean(presentation?.isActive) ||
    input.conversation?.status === ConversationStatus.GeneratingResponse;
  return {
    ...input.response,
    conversationId: input.conversation?.id ?? null,
    data: { settled: input.settled, error: input.error },
    activity: {
      currentState: input.currentState,
      presentation,
      processing,
      lifecycle: input.conversation?.status,
    },
    permission: {
      readOnly: input.readOnly,
      canSubmit:
        input.canSubmit && input.settled && !input.error && !input.readOnly,
      disabledReason: input.readOnly
        ? "read-only"
        : !input.settled
          ? "loading"
          : input.error
            ? "load-error"
            : !input.canSubmit
              ? "owner-unavailable"
              : null,
    },
    submission: input.submission,
    owner: { workflowId: input.conversation?.workflowId ?? null },
    artifacts: input.messages.map((message) => ({
      messageId: message.id,
      proposals: message.proposals ?? [],
      reports: message.reports ?? [],
      responseDeclarations:
        input.response.forms.get(message.id)?.declarations ?? [],
    })),
  };
};
export type ConversationModel = ReturnType<typeof deriveConversationModel>;
