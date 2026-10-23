import type { ResponseBehavior } from "../Conversation/Components/conversationFormTypes";
import {
  ExtendedUIFieldType,
  ReportType,
  type ReportDto,
  type UIElement,
} from "../../api";

export type ReportAttachmentPresentation = "inline" | "modal" | "interactive";

interface DisplayReportConfig {
  presentation: "inline" | "modal";
}

interface ReportAttachmentHostPolicy {
  readonly requiredMessageType: "SYSTEM";
  readonly requiredDataType: "AGENT";
  readonly requiredPromptHandler?: "startup_session";
  readonly matchProviderSessionToReportAgent: true;
  readonly excludeCarrier: true;
  readonly excludeInterstitial: true;
}

interface InteractiveReportConfig {
  presentation: "interactive";
  responseBehavior: ResponseBehavior;
  responseUiElement: UIElement;
  hostPolicy?: ReportAttachmentHostPolicy;
}

export type ReportConfig = DisplayReportConfig | InteractiveReportConfig;

const DEFAULT_REPORT_CONFIG: ReportConfig = { presentation: "inline" };

export const REPORT_CONFIG: Partial<Record<ReportType, ReportConfig>> = {
  [ReportType.Plan]: {
    presentation: "interactive",
    responseBehavior: { ownership: "exclusive", submissionKind: "report" },
    responseUiElement: {
      id: ExtendedUIFieldType.CodingPromptStartupPlan,
      type: ExtendedUIFieldType.CodingPromptStartupPlan,
      label: "Startup plan",
    },
    hostPolicy: {
      requiredMessageType: "SYSTEM",
      requiredDataType: "AGENT",
      requiredPromptHandler: "startup_session",
      matchProviderSessionToReportAgent: true,
      excludeCarrier: true,
      excludeInterstitial: true,
    },
  },
  [ReportType.FeatureSyncDecision]: {
    presentation: "interactive",
    responseBehavior: { ownership: "exclusive", submissionKind: "report" },
    responseUiElement: {
      id: "feature-sync-decision-response",
      type: ExtendedUIFieldType.AgentReplyTextarea,
      label: "Feature Sync decision response",
    },
    hostPolicy: {
      requiredMessageType: "SYSTEM",
      requiredDataType: "AGENT",
      matchProviderSessionToReportAgent: true,
      excludeCarrier: true,
      excludeInterstitial: true,
    },
  },
};

export interface InteractiveReportAttachment {
  report: ReportDto;
  responseUiElement: UIElement;
}

export const getReportConfig = (reportType: ReportType): ReportConfig =>
  REPORT_CONFIG[reportType] ?? DEFAULT_REPORT_CONFIG;

/**
 * Feature Sync decisions always belong to the response attachment surface.
 * Keep this invariant explicit at the presentation boundary so a fetched
 * report mention cannot expand the interactive decision viewer inside prose.
 */
export const getReportPresentation = (
  reportType: ReportType,
): ReportAttachmentPresentation =>
  reportType === ReportType.FeatureSyncDecision
    ? "interactive"
    : getReportConfig(reportType).presentation;

export const resolveInteractiveReportResponseUiElement = (
  config: InteractiveReportConfig,
  uiElements: readonly UIElement[] | undefined,
): UIElement =>
  uiElements?.find(
    (element) => element.type === config.responseUiElement.type,
  ) ?? config.responseUiElement;
