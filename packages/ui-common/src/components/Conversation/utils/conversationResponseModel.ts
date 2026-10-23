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
  isFormSubmitted,
} from "./conversationFormHelpers";
import { shouldShowForm } from "./messageStateUtils";

export const NO_RESPONSE_TARGET: ConversationResponseTarget = {
  ownership: "none",
};

export interface ResolvedConversationForm {
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
  resolver?: ConversationFormResolver;
  workflowCanSubmit: boolean;
  isSubmitting: boolean;
  readOnly: boolean;
  isCliInputDisabled: boolean;
}

const declareResponse = (
  behavior: ResponseBehavior,
  element: UIElement
): ConversationResponseDeclaration =>
  behavior.ownership === "display-only"
    ? behavior
    : { ...behavior, currentFieldId: element.id };

const resolveReports = (
  message: MessageResponseDto,
  uiElements: UIElement[]
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
      .map((mention) => mention.entityId)
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
          uiElements
        );
        interactiveReportAttachments.push({ report, responseUiElement });
        declarations.push(
          declareResponse(config.responseBehavior, responseUiElement)
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
  options: FormModelOptions
): ResolvedConversationForm => {
  const resolution = options.resolver?.(entry) ?? null;
  const uiElements = (
    resolution?.uiElements ??
    (entry.message.type === MessageType.System
      ? entry.message.data.uiElements ?? []
      : [])
  ).filter(Boolean);
  const reports = resolveReports(entry.message, uiElements);
  const reportFieldIds = new Set(
    reports.interactiveReportAttachments.map(
      ({ responseUiElement }) => responseUiElement.id
    )
  );
  const formUiElements = uiElements.filter(
    (element) => !reportFieldIds.has(element.id)
  );
  const fieldDeclarations = formUiElements.map((element) => {
    return declareResponse(
      getFieldResponseBehavior(element) ?? {
        ownership: "display-only",
      },
      element
    );
  });
  const isSubmitted =
    resolution?.isSubmitted ??
    isFormSubmitted(entry, options.workflowCanSubmit);
  const isCompleted =
    !entry.canEdit ||
    Boolean(resolution?.isSubmitted) ||
    hasPersistedFormResponse(entry);
  const showForm = resolution ? true : shouldShowForm(entry);
  return {
    ...reports,
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
      isCompleted ||
      (resolution
        ? resolution.disabled || options.isSubmitting
        : isFormSubmissionDisabled(
            entry,
            options.workflowCanSubmit,
            options.isSubmitting
          ) || options.isCliInputDisabled),
  };
};

const collectCanonicalIds = (
  messages: readonly MessageResponseDto[],
  ids = new Set<string>()
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
  canonicalIds: Set<string>
): ConversationResponseTarget => {
  if (
    !entry ||
    !form ||
    entry.message.type !== MessageType.System ||
    !canonicalIds.has(entry.message.id) ||
    form.isCompleted ||
    (!form.shouldRenderForm && form.interactiveReportAttachments.length === 0)
  )
    return NO_RESPONSE_TARGET;
  const declaration =
    form.declarations.find((item) => item.ownership === "exclusive") ??
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
  options: FormModelOptions
) => {
  const forms = new Map(
    timeline.map((entry, index) => [
      entry.message.id,
      resolveConversationForm(entry, index === timeline.length - 1, options),
    ])
  );
  // Never search backwards for an older unanswered field.
  const current = timeline[timeline.length - 1];
  return {
    forms,
    target: deriveTarget(
      current,
      current ? forms.get(current.message.id) : undefined,
      collectCanonicalIds(canonicalMessages)
    ),
  };
};
