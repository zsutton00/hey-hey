import { AdrStatus, BrainstormStatus, DecisionStatus } from "../api";
import { DesignDocTemplate as DesignDocTemplateValues } from "../api/api";
import type { AdrStatusInfo } from "./adr";
import { ADR_STATUS_INFO } from "./adr";

export type SupportedDesignDocTemplate =
  | typeof DesignDocTemplateValues.Adr
  | typeof DesignDocTemplateValues.Brainstorm
  | typeof DesignDocTemplateValues.Decision
  | typeof DesignDocTemplateValues.PlanDocument;

type SingleStageStatus = BrainstormStatus | DecisionStatus;

export type DesignDocStatusByTemplate = {
  [DesignDocTemplateValues.Adr]: AdrStatus;
  [DesignDocTemplateValues.Brainstorm]: BrainstormStatus;
  [DesignDocTemplateValues.Decision]: DecisionStatus;
  [DesignDocTemplateValues.PlanDocument]: BrainstormStatus;
};

export type DesignDocStatus =
  DesignDocStatusByTemplate[SupportedDesignDocTemplate];

export interface DesignDocStatusInfo {
  label: string;
  color: AdrStatusInfo["color"];
  description: string;
}

const SINGLE_STAGE_STATUS_INFO: Record<SingleStageStatus, DesignDocStatusInfo> =
  {
    [BrainstormStatus.RefiningContent]: {
      label: "Refining",
      color: "warning",
      description: "Refining the content",
    },
    [BrainstormStatus.InReview]: {
      label: "In Review",
      color: "info",
      description: "Ready for review",
    },
    [BrainstormStatus.Ready]: {
      label: "Ready",
      color: "success",
      description: "Complete and ready",
    },
  };

const ADR_SELECTABLE_STATUSES: AdrStatus[] = [
  AdrStatus.AdrContext,
  AdrStatus.AdrDecision,
  AdrStatus.AdrConsequences,
  AdrStatus.Ready,
];

const BRAINSTORM_SELECTABLE_STATUSES: BrainstormStatus[] = [
  BrainstormStatus.RefiningContent,
  BrainstormStatus.InReview,
  BrainstormStatus.Ready,
];

const DECISION_SELECTABLE_STATUSES: DecisionStatus[] = [
  DecisionStatus.RefiningContent,
  DecisionStatus.InReview,
  DecisionStatus.Ready,
];

const PLAN_DOCUMENT_SELECTABLE_STATUSES: BrainstormStatus[] = [
  BrainstormStatus.RefiningContent,
  BrainstormStatus.InReview,
  BrainstormStatus.Ready,
];

export function getDesignDocSelectableStatuses(
  template: typeof DesignDocTemplateValues.Adr,
): AdrStatus[];
export function getDesignDocSelectableStatuses(
  template: typeof DesignDocTemplateValues.Brainstorm,
): BrainstormStatus[];
export function getDesignDocSelectableStatuses(
  template: typeof DesignDocTemplateValues.Decision,
): DecisionStatus[];
export function getDesignDocSelectableStatuses(
  template: typeof DesignDocTemplateValues.PlanDocument,
): BrainstormStatus[];
export function getDesignDocSelectableStatuses(
  template: SupportedDesignDocTemplate,
): DesignDocStatus[];
export function getDesignDocSelectableStatuses(
  template: SupportedDesignDocTemplate,
): DesignDocStatus[] {
  switch (template) {
    case DesignDocTemplateValues.Adr:
      return ADR_SELECTABLE_STATUSES;
    case DesignDocTemplateValues.Brainstorm:
      return BRAINSTORM_SELECTABLE_STATUSES;
    case DesignDocTemplateValues.Decision:
      return DECISION_SELECTABLE_STATUSES;
    case DesignDocTemplateValues.PlanDocument:
      return PLAN_DOCUMENT_SELECTABLE_STATUSES;
  }

  const exhaustiveTemplate: never = template;
  return exhaustiveTemplate;
}

export function getDesignDocStatusInfo(
  template: typeof DesignDocTemplateValues.Adr,
  status: AdrStatus,
): DesignDocStatusInfo;
export function getDesignDocStatusInfo(
  template: typeof DesignDocTemplateValues.Brainstorm,
  status: BrainstormStatus,
): DesignDocStatusInfo;
export function getDesignDocStatusInfo(
  template: typeof DesignDocTemplateValues.Decision,
  status: DecisionStatus,
): DesignDocStatusInfo;
export function getDesignDocStatusInfo(
  template: typeof DesignDocTemplateValues.PlanDocument,
  status: BrainstormStatus,
): DesignDocStatusInfo;
export function getDesignDocStatusInfo(
  template: SupportedDesignDocTemplate,
  status: DesignDocStatus,
): DesignDocStatusInfo;
export function getDesignDocStatusInfo(
  template: SupportedDesignDocTemplate,
  status: DesignDocStatus,
): DesignDocStatusInfo {
  switch (template) {
    case DesignDocTemplateValues.Adr:
      return (
        ADR_STATUS_INFO[status as AdrStatus] ?? {
          label: status,
          color: "default",
          description: "",
        }
      );
    case DesignDocTemplateValues.Brainstorm:
    case DesignDocTemplateValues.Decision:
    case DesignDocTemplateValues.PlanDocument:
      return (
        SINGLE_STAGE_STATUS_INFO[status as SingleStageStatus] ?? {
          label: status,
          color: "default",
          description: "",
        }
      );
  }

  const exhaustiveTemplate: never = template;
  return exhaustiveTemplate;
}
