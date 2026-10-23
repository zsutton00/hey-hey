import {
  Alert,
  Box,
  Button,
  ButtonGroup,
  Chip,
  Stack,
  Typography,
} from "@mui/material";
import React from "react";
import { Link } from "react-router-dom";
import { EntityIcon } from "../../Entity/EntityIcon";
import { parseFinalAssessmentResponseFromText } from "../../../agents/coordination/parser";
import type { FinalAssessmentResponse } from "../../../agents/coordination/types";
import {
  CreateImplementationHintDtoSourceTypeEnum,
  DesignDocSectionUpdateSource as DesignDocSectionUpdateSourceEnum,
  SuggestionType as SuggestionTypeEnum,
  TaskSectionUpdateSource as TaskSectionUpdateSourceEnum,
  UpdateImplementationHintDtoSourceTypeEnum,
  WorkStatus,
  type CodingPromptFinalAssessmentPayload,
  type CodingPromptFinalAssessmentV1Payload,
  type CodingPromptFinalAssessmentV2Payload,
  type CreateImplementationHintDto,
  type DesignDocDraftSection,
  type DesignDocResponseDto,
  type ImplementationHintDto,
  type TaskResponseDto,
  type UpdateDesignDocDto,
  type UpdateImplementationHintDto,
  type WorkStatus as WorkStatusType,
} from "../../../api";
import { unifiedApiClient } from "../../../clients/serviceClients";
import { useAgentSession } from "../../../data/hooks/useAgentSession";
import { useDesignDoc } from "../../../data/hooks/useDesignDoc";
import { useSuggestionDecision } from "../../../data/hooks/useSuggestionDecision";
import { useWorkItem } from "../../../data/hooks/useWorkItem";
import { useWorkItemUpdateMethods } from "../../../data/hooks/useWorkItemUpdateMethods";
import { useUpdateDesignDoc } from "../../../data/hooks/useUpdateDesignDoc";
import { getWorkItemSectionContent } from "../../../utils/workItemSections";
import { parseStructuredResponseFromText } from "../../AgentSession/structured-response";
import { useConversationContext } from "../../Conversation/Components/ConversationContext";
import { usePathService } from "../../../contexts/PathServiceContext";
import {
  buildSuggestionId,
  type SuggestionDecisionStatus,
} from "../../Conversation/hooks/useSuggestionDecisions";
import { DiffRenderer } from "../../SuggestedContent/DiffRenderer";
import type { FieldComponentProps } from "./types";

type LegacyStructuredResponseContainer = {
  response?: string;
  structuredResponse?: {
    responseType?: string;
    parsed?: unknown;
  };
};

export type FinalAssessmentStructuredFieldProps = FieldComponentProps<
  CodingPromptFinalAssessmentPayload | LegacyStructuredResponseContainer
>;

type FinalAssessmentV1Response = {
  responseType: "final_assessment_v1";
  taskAssessment: {
    target: {
      entityType: "task";
      entityId: string;
    };
    verdict: FinalAssessmentResponse["taskAssessment"]["verdict"];
    statusRecommendation: {
      status: string;
      reason: string;
    };
    summary: string;
  };
  artifactUpdateSuggestions: unknown[];
  evidenceCorrections: unknown[];
  openQuestions: unknown[];
};

type FinalAssessmentStructuredResponse =
  | FinalAssessmentResponse
  | FinalAssessmentV1Response
  | CodingPromptFinalAssessmentV1Payload
  | CodingPromptFinalAssessmentV2Payload;

type ApplyStatus = "idle" | "applying" | "applied" | "failed";

interface SuggestionTarget<T extends string = string> {
  entityType: T;
  entityId: string;
}

interface ArtifactSuggestionBase {
  suggestionId: string;
  index: number;
  title: string;
  rawUpdateType: string;
  target: SuggestionTarget;
  reasoning: string | null;
}

interface UnsupportedArtifactSuggestion extends ArtifactSuggestionBase {
  kind: "unsupported";
  unsupportedReason: string;
}

interface TaskStatusArtifactSuggestion extends ArtifactSuggestionBase {
  kind: "task_status";
  target: SuggestionTarget<"task">;
  updatePayload: {
    status: WorkStatusType;
    sectionUpdateSource?: (typeof TaskSectionUpdateSourceEnum)[keyof typeof TaskSectionUpdateSourceEnum];
  };
}

interface TaskDetailsArtifactSuggestion extends ArtifactSuggestionBase {
  kind: "task_details";
  target: SuggestionTarget<"task">;
  updatePayload: {
    description?: string;
    acceptanceCriteria?: string;
  };
}

interface TaskAcceptanceCriteriaArtifactSuggestion
  extends ArtifactSuggestionBase {
  kind: "task_acceptance_criteria";
  target: SuggestionTarget<"task">;
  updatePayload: {
    acceptanceCriteria: string;
  };
}

interface DesignDocRevisionArtifactSuggestion extends ArtifactSuggestionBase {
  kind: "design_doc_revision";
  target: SuggestionTarget<"designDoc">;
  updatePayload: {
    status?: string;
    summary?: string | null;
    sections?: DesignDocDraftSection[];
    sectionUpdateSource?: (typeof DesignDocSectionUpdateSourceEnum)[keyof typeof DesignDocSectionUpdateSourceEnum];
  };
}

interface ImplementationHintCreateArtifactSuggestion
  extends ArtifactSuggestionBase {
  kind: "implementation_hint_create";
  target: SuggestionTarget<"implementationHint">;
  updatePayload: {
    featureName: string;
    description: string;
    sourceType: (typeof CreateImplementationHintDtoSourceTypeEnum)[keyof typeof CreateImplementationHintDtoSourceTypeEnum];
    agentSessionIds?: string[];
  };
}

interface ImplementationHintUpdateArtifactSuggestion
  extends ArtifactSuggestionBase {
  kind: "implementation_hint_update";
  target: SuggestionTarget<"implementationHint">;
  updatePayload: {
    featureName?: string;
    description?: string;
    sourceType?: (typeof CreateImplementationHintDtoSourceTypeEnum)[keyof typeof CreateImplementationHintDtoSourceTypeEnum];
    agentSessionIds?: string[];
  };
}

type ActionableArtifactSuggestion =
  | TaskStatusArtifactSuggestion
  | TaskDetailsArtifactSuggestion
  | TaskAcceptanceCriteriaArtifactSuggestion
  | DesignDocRevisionArtifactSuggestion
  | ImplementationHintCreateArtifactSuggestion
  | ImplementationHintUpdateArtifactSuggestion;

type ParsedArtifactSuggestion =
  | ActionableArtifactSuggestion
  | UnsupportedArtifactSuggestion;

interface DiffReviewRow {
  key: string;
  label: string;
  oldValue: string;
  newValue: string;
}

interface TaskContextValue {
  id: string;
  initiativeId: string;
  status: WorkStatusType;
  sections?: TaskResponseDto["sections"];
}

const WORK_STATUS_VALUES = new Set<string>(Object.values(WorkStatus));
const IMPLEMENTATION_HINT_SOURCE_TYPES = new Set<string>(
  Object.values(CreateImplementationHintDtoSourceTypeEnum)
);
const TASK_SECTION_UPDATE_SOURCE_TYPES = new Set<string>(
  Object.values(TaskSectionUpdateSourceEnum)
);
const DESIGN_DOC_SECTION_UPDATE_SOURCE_TYPES = new Set<string>(
  Object.values(DesignDocSectionUpdateSourceEnum)
);
const DIFF_DELETE_BLOCK_PATTERN =
  /<\s*(?:del|delete)\b[^>]*>[\s\S]*?<\/\s*(?:del|delete)\s*>/giu;
const DIFF_INSERT_TAG_PATTERN = /<\/?\s*(?:ins|insert)\b[^>]*>/giu;
const DIFF_DELETE_TAG_PATTERN = /<\/?\s*(?:del|delete)\b[^>]*>/giu;
const ASSESSMENT_SUGGESTION_TYPE = SuggestionTypeEnum.CodingPromptAccept;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object";

const isWorkStatus = (value: unknown): value is WorkStatusType =>
  typeof value === "string" && WORK_STATUS_VALUES.has(value);

const readNonEmptyString = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const stripDiffMarkupTags = (value: string): string =>
  value
    .replace(DIFF_DELETE_BLOCK_PATTERN, "")
    .replace(DIFF_INSERT_TAG_PATTERN, "")
    .replace(DIFF_DELETE_TAG_PATTERN, "");

const readNonEmptyPersistedText = (value: unknown): string | null => {
  const raw = readNonEmptyString(value);
  if (raw === null) {
    return null;
  }

  const cleaned = stripDiffMarkupTags(raw).trim();
  return cleaned.length > 0 ? cleaned : null;
};

const readOptionalStringArray = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const strings = value
    .map((entry) => readNonEmptyString(entry))
    .filter((entry): entry is string => entry !== null);

  return strings;
};

const readImplementationHintSourceType = (
  value: unknown
):
  | (typeof CreateImplementationHintDtoSourceTypeEnum)[keyof typeof CreateImplementationHintDtoSourceTypeEnum]
  | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }

  return IMPLEMENTATION_HINT_SOURCE_TYPES.has(value)
    ? (value as (typeof CreateImplementationHintDtoSourceTypeEnum)[keyof typeof CreateImplementationHintDtoSourceTypeEnum])
    : undefined;
};

const readTaskSectionUpdateSourceType = (
  value: unknown
):
  | (typeof TaskSectionUpdateSourceEnum)[keyof typeof TaskSectionUpdateSourceEnum]
  | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }

  return TASK_SECTION_UPDATE_SOURCE_TYPES.has(value)
    ? (value as (typeof TaskSectionUpdateSourceEnum)[keyof typeof TaskSectionUpdateSourceEnum])
    : undefined;
};

const readDesignDocSectionUpdateSourceType = (
  value: unknown
):
  | (typeof DesignDocSectionUpdateSourceEnum)[keyof typeof DesignDocSectionUpdateSourceEnum]
  | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }

  return DESIGN_DOC_SECTION_UPDATE_SOURCE_TYPES.has(value)
    ? (value as (typeof DesignDocSectionUpdateSourceEnum)[keyof typeof DesignDocSectionUpdateSourceEnum])
    : undefined;
};

const toSentenceCase = (value: string): string =>
  value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());

const toArtifactUpdateTitle = (value: unknown): string => {
  if (!isRecord(value)) {
    return "Artifact update";
  }

  const rawUpdateType = readNonEmptyString(value.updateType);
  if (!rawUpdateType) {
    return "Artifact update";
  }

  return toSentenceCase(rawUpdateType);
};

const summarizeArtifactUpdatePayload = (value: unknown): string | null => {
  if (!isRecord(value)) {
    return null;
  }

  const updatePayload = value.updatePayload;
  if (!isRecord(updatePayload)) {
    return null;
  }

  const status = readNonEmptyString(updatePayload.status);
  if (status) {
    return `Status: ${status}`;
  }

  const acceptanceCriteria = readNonEmptyString(
    updatePayload.acceptanceCriteria
  );
  if (acceptanceCriteria) {
    return `Acceptance criteria: ${acceptanceCriteria}`;
  }

  const description = readNonEmptyString(updatePayload.description);
  if (description) {
    return `Description: ${description}`;
  }

  const legacyDetails = readNonEmptyString(updatePayload.details);
  if (legacyDetails) {
    return `Details: ${legacyDetails}`;
  }

  const featureName = readNonEmptyString(updatePayload.featureName);
  if (featureName) {
    return `Feature: ${featureName}`;
  }

  const summary = readNonEmptyString(updatePayload.summary);
  if (summary) {
    return `Summary: ${summary}`;
  }

  const sections = updatePayload.sections;
  if (Array.isArray(sections) && sections.length > 0) {
    return `Sections: ${String(sections.length)}`;
  }

  return null;
};

const toArtifactUpdateKey = (value: unknown, index: number): string => {
  if (!isRecord(value)) {
    return `artifact-update-${String(index)}`;
  }

  const target = isRecord(value.target) ? value.target : null;
  const targetEntityType = target
    ? readNonEmptyString(target.entityType)
    : null;
  const targetEntityId = target ? readNonEmptyString(target.entityId) : null;
  const updateType = readNonEmptyString(value.updateType);

  return [
    updateType ?? "artifact-update",
    targetEntityType ?? "unknown-target-type",
    targetEntityId ?? "unknown-target-id",
    String(index),
  ].join("-");
};

const readOpenQuestion = (
  value: unknown,
  index: number
): { question: string; reason?: string } => {
  if (!isRecord(value)) {
    return {
      question: `Open question ${String(index + 1)}`,
    };
  }

  const question = readNonEmptyString(value.question) ?? "Open question";
  const reason = readNonEmptyString(value.reason) ?? undefined;

  return { question, reason };
};

const isFinalAssessmentV2Response = (
  value: unknown
): value is FinalAssessmentResponse => {
  if (!isRecord(value)) {
    return false;
  }

  const taskAssessment = value.taskAssessment;
  if (!isRecord(taskAssessment)) {
    return false;
  }

  const statusRecommendation = taskAssessment.statusRecommendation;
  if (!isRecord(statusRecommendation)) {
    return false;
  }
  const implementationNotes = value.implementationNotes;

  return (
    value.responseType === "final_assessment_v2" &&
    typeof taskAssessment.summary === "string" &&
    typeof taskAssessment.verdict === "string" &&
    typeof statusRecommendation.status === "string" &&
    typeof statusRecommendation.reason === "string" &&
    (implementationNotes === undefined ||
      typeof implementationNotes === "string") &&
    (value.artifactUpdateSuggestions === undefined ||
      Array.isArray(value.artifactUpdateSuggestions)) &&
    (value.evidenceCorrections === undefined ||
      Array.isArray(value.evidenceCorrections)) &&
    (value.validationRecommendations === undefined ||
      Array.isArray(value.validationRecommendations)) &&
    (value.openQuestions === undefined || Array.isArray(value.openQuestions)) &&
    (value.hierarchyWalk === undefined || Array.isArray(value.hierarchyWalk)) &&
    (value.dependentTaskWalk === undefined ||
      Array.isArray(value.dependentTaskWalk))
  );
};

const isFinalAssessmentV1Response = (
  value: unknown
): value is FinalAssessmentV1Response => {
  if (!isRecord(value)) {
    return false;
  }

  const taskAssessment = value.taskAssessment;
  if (!isRecord(taskAssessment)) {
    return false;
  }

  const target = taskAssessment.target;
  if (!isRecord(target)) {
    return false;
  }

  const statusRecommendation = taskAssessment.statusRecommendation;
  if (!isRecord(statusRecommendation)) {
    return false;
  }

  return (
    value.responseType === "final_assessment_v1" &&
    target.entityType === "task" &&
    typeof target.entityId === "string" &&
    typeof taskAssessment.summary === "string" &&
    typeof taskAssessment.verdict === "string" &&
    typeof statusRecommendation.status === "string" &&
    typeof statusRecommendation.reason === "string" &&
    Array.isArray(value.artifactUpdateSuggestions) &&
    Array.isArray(value.evidenceCorrections) &&
    Array.isArray(value.openQuestions)
  );
};

const isFinalAssessmentStructuredResponse = (
  value: unknown
): value is FinalAssessmentStructuredResponse =>
  isFinalAssessmentV2Response(value) || isFinalAssessmentV1Response(value);

const normalizeArrayFields = (
  value: FinalAssessmentStructuredResponse
): FinalAssessmentStructuredResponse => {
  if (value.responseType !== "final_assessment_v2") return value;
  const v2 = value as CodingPromptFinalAssessmentV2Payload;
  return {
    ...value,
    artifactUpdateSuggestions: value.artifactUpdateSuggestions ?? [],
    evidenceCorrections: value.evidenceCorrections ?? [],
    validationRecommendations: value.validationRecommendations ?? [],
    openQuestions: value.openQuestions ?? [],
    hierarchyWalk: v2.hierarchyWalk ?? [],
  };
};

const extractFinalAssessment = (
  value:
    | CodingPromptFinalAssessmentPayload
    | LegacyStructuredResponseContainer
    | undefined
): FinalAssessmentStructuredResponse | null => {
  if (!isRecord(value)) {
    return null;
  }

  if (isFinalAssessmentStructuredResponse(value)) {
    return normalizeArrayFields(value);
  }

  if (typeof value.response === "string") {
    const parsedV2 = parseFinalAssessmentResponseFromText(value.response);
    if (parsedV2.ok) {
      return parsedV2.value;
    }

    const structuredText = parseStructuredResponseFromText(value.response);
    if (
      structuredText?.contract?.type === "final_assessment" &&
      structuredText.contract.version === 1 &&
      isFinalAssessmentV1Response(structuredText.value)
    ) {
      return structuredText.value;
    }
  }

  const structured = value.structuredResponse;
  if (!isRecord(structured)) {
    return null;
  }

  if (
    structured.responseType !== "final_assessment_v1" &&
    structured.responseType !== "final_assessment_v2"
  ) {
    return null;
  }

  return isFinalAssessmentStructuredResponse(structured.parsed)
    ? structured.parsed
    : null;
};

const toVerdictChipColor = (
  verdict: FinalAssessmentResponse["taskAssessment"]["verdict"]
): "default" | "success" | "warning" | "error" => {
  switch (verdict) {
    case "completed":
      return "success";
    case "partiallyCompleted":
      return "warning";
    case "blocked":
    case "notCompleted":
      return "error";
    case "unknown":
    default:
      return "default";
  }
};

const toStatusChipColor = (
  status: string
): "default" | "success" | "warning" | "error" => {
  if (status === "COMPLETED") {
    return "success";
  }

  if (status === "ACTIVE") {
    return "warning";
  }

  if (status === "CANCELLED") {
    return "error";
  }

  return "default";
};

const toApplyStatusChipColor = (
  status: ApplyStatus
): "default" | "success" | "warning" | "error" | "info" => {
  switch (status) {
    case "applied":
      return "success";
    case "failed":
      return "error";
    case "applying":
      return "info";
    case "idle":
    default:
      return "default";
  }
};

const toSuggestionTarget = (value: unknown): SuggestionTarget => {
  if (!isRecord(value)) {
    return {
      entityType: "unknown-target-type",
      entityId: "unknown-target-id",
    };
  }

  return {
    entityType: readNonEmptyString(value.entityType) ?? "unknown-target-type",
    entityId:
      typeof value.entityId === "string" ? value.entityId : "unknown-target-id",
  };
};

const toSuggestionId = (input: {
  messageId: string | undefined;
  updateType: string;
  target: SuggestionTarget;
  index: number;
}): string =>
  buildSuggestionId(
    input.messageId,
    [
      input.updateType,
      input.target.entityType,
      input.target.entityId,
      String(input.index),
    ].join(":")
  ) ??
  [
    input.updateType,
    input.target.entityType,
    input.target.entityId,
    String(input.index),
  ].join(":");

const parseDesignDocDraftSections = (
  value: unknown
): DesignDocDraftSection[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const sections = value
    .map((entry) => {
      if (!isRecord(entry)) {
        return null;
      }

      const key = readNonEmptyString(entry.key);
      if (!key) {
        return null;
      }

      const order =
        typeof entry.order === "number" && Number.isInteger(entry.order)
          ? entry.order
          : null;

      const content =
        typeof entry.content === "string"
          ? stripDiffMarkupTags(entry.content)
          : undefined;

      return {
        key,
        order,
        ...(content !== undefined ? { content } : {}),
      } satisfies DesignDocDraftSection;
    })
    .filter((entry): entry is DesignDocDraftSection => entry !== null);

  return sections;
};

const toBaseSuggestion = (
  value: unknown,
  index: number,
  messageId: string | undefined
): ArtifactSuggestionBase => {
  const target = isRecord(value)
    ? toSuggestionTarget(value.target)
    : {
        entityType: "unknown-target-type",
        entityId: "unknown-target-id",
      };
  const rawUpdateType =
    isRecord(value) && readNonEmptyString(value.updateType)
      ? (readNonEmptyString(value.updateType) as string)
      : "unknown_update";

  return {
    suggestionId: toSuggestionId({
      messageId,
      updateType: rawUpdateType,
      target,
      index,
    }),
    index,
    title: isRecord(value) ? toArtifactUpdateTitle(value) : "Artifact update",
    rawUpdateType,
    target,
    reasoning:
      isRecord(value) && readNonEmptyString(value.reasoning)
        ? readNonEmptyString(value.reasoning)
        : null,
  };
};

const toUnsupportedSuggestion = (
  value: unknown,
  index: number,
  messageId: string | undefined,
  unsupportedReason: string
): UnsupportedArtifactSuggestion => ({
  ...toBaseSuggestion(value, index, messageId),
  kind: "unsupported",
  unsupportedReason,
});

const parseArtifactSuggestion = (
  value: unknown,
  index: number,
  messageId: string | undefined
): ParsedArtifactSuggestion => {
  if (!isRecord(value)) {
    return toUnsupportedSuggestion(
      value,
      index,
      messageId,
      "Suggestion payload is not an object."
    );
  }

  const base = toBaseSuggestion(value, index, messageId);
  const updateType = base.rawUpdateType;
  const updatePayload = value.updatePayload;

  if (!isRecord(updatePayload)) {
    return toUnsupportedSuggestion(
      value,
      index,
      messageId,
      "Suggestion is missing updatePayload details."
    );
  }

  switch (updateType) {
    case "task_status": {
      if (base.target.entityType !== "task") {
        return toUnsupportedSuggestion(
          value,
          index,
          messageId,
          "task_status update must target a task."
        );
      }

      if (!readNonEmptyString(base.target.entityId)) {
        return toUnsupportedSuggestion(
          value,
          index,
          messageId,
          "task_status update is missing a target task id."
        );
      }

      const status = updatePayload.status;
      if (!isWorkStatus(status)) {
        return toUnsupportedSuggestion(
          value,
          index,
          messageId,
          "task_status update is missing a valid task status."
        );
      }

      const sectionUpdateSource =
        readTaskSectionUpdateSourceType(updatePayload.sectionUpdateSource) ??
        undefined;

      return {
        ...base,
        kind: "task_status",
        target: {
          entityType: "task",
          entityId: base.target.entityId,
        },
        updatePayload: {
          status,
          ...(sectionUpdateSource ? { sectionUpdateSource } : {}),
        },
      };
    }
    case "task_details": {
      if (base.target.entityType !== "task") {
        return toUnsupportedSuggestion(
          value,
          index,
          messageId,
          "task_details update must target a task."
        );
      }

      if (!readNonEmptyString(base.target.entityId)) {
        return toUnsupportedSuggestion(
          value,
          index,
          messageId,
          "task_details update is missing a target task id."
        );
      }

      const description = readNonEmptyPersistedText(updatePayload.description);
      const acceptanceCriteria = readNonEmptyPersistedText(
        updatePayload.acceptanceCriteria
      );
      const legacyDetails = readNonEmptyPersistedText(updatePayload.details);

      if (!description && !acceptanceCriteria && !legacyDetails) {
        return toUnsupportedSuggestion(
          value,
          index,
          messageId,
          "task_details update must include description or acceptance criteria."
        );
      }

      const normalizedDescription = description
        ? legacyDetails && legacyDetails !== description
          ? `${description}\n\n${legacyDetails}`
          : description
        : legacyDetails ?? undefined;

      return {
        ...base,
        kind: "task_details",
        target: {
          entityType: "task",
          entityId: base.target.entityId,
        },
        updatePayload: {
          ...(normalizedDescription
            ? { description: normalizedDescription }
            : {}),
          ...(acceptanceCriteria ? { acceptanceCriteria } : {}),
        },
      };
    }
    case "task_acceptance_criteria": {
      if (base.target.entityType !== "task") {
        return toUnsupportedSuggestion(
          value,
          index,
          messageId,
          "task_acceptance_criteria update must target a task."
        );
      }

      if (!readNonEmptyString(base.target.entityId)) {
        return toUnsupportedSuggestion(
          value,
          index,
          messageId,
          "task_acceptance_criteria update is missing a target task id."
        );
      }

      const acceptanceCriteria = readNonEmptyPersistedText(
        updatePayload.acceptanceCriteria
      );
      if (!acceptanceCriteria) {
        return toUnsupportedSuggestion(
          value,
          index,
          messageId,
          "task_acceptance_criteria update is missing acceptance criteria."
        );
      }

      return {
        ...base,
        kind: "task_acceptance_criteria",
        target: {
          entityType: "task",
          entityId: base.target.entityId,
        },
        updatePayload: {
          acceptanceCriteria,
        },
      };
    }
    case "design_doc_revision": {
      if (base.target.entityType !== "designDoc") {
        return toUnsupportedSuggestion(
          value,
          index,
          messageId,
          "design_doc_revision update must target a design doc."
        );
      }

      if (!readNonEmptyString(base.target.entityId)) {
        return toUnsupportedSuggestion(
          value,
          index,
          messageId,
          "design_doc_revision update is missing a target design doc id."
        );
      }

      const status = readNonEmptyString(updatePayload.status) ?? undefined;
      const summaryRaw = updatePayload.summary;
      const summary =
        typeof summaryRaw === "string"
          ? stripDiffMarkupTags(summaryRaw)
          : summaryRaw === null
          ? summaryRaw
          : undefined;
      const sections = parseDesignDocDraftSections(updatePayload.sections);
      const sectionUpdateSource =
        readDesignDocSectionUpdateSourceType(
          updatePayload.sectionUpdateSource
        ) ?? undefined;

      if (status === undefined && summary === undefined && !sections?.length) {
        return toUnsupportedSuggestion(
          value,
          index,
          messageId,
          "design_doc_revision update has no actionable fields."
        );
      }

      return {
        ...base,
        kind: "design_doc_revision",
        target: {
          entityType: "designDoc",
          entityId: base.target.entityId,
        },
        updatePayload: {
          ...(status !== undefined ? { status } : {}),
          ...(summary !== undefined ? { summary } : {}),
          ...(sections ? { sections } : {}),
          ...(sectionUpdateSource ? { sectionUpdateSource } : {}),
        },
      };
    }
    case "implementation_hint_create": {
      if (base.target.entityType !== "implementationHint") {
        return toUnsupportedSuggestion(
          value,
          index,
          messageId,
          "implementation_hint_create update must target an implementation hint."
        );
      }

      const featureName = readNonEmptyPersistedText(updatePayload.featureName);
      const description = readNonEmptyPersistedText(updatePayload.description);
      const sourceType =
        readImplementationHintSourceType(updatePayload.sourceType) ??
        CreateImplementationHintDtoSourceTypeEnum.System;

      if (!featureName || !description) {
        return toUnsupportedSuggestion(
          value,
          index,
          messageId,
          "implementation_hint_create update is missing featureName or description."
        );
      }

      const agentSessionIds = readOptionalStringArray(
        updatePayload.agentSessionIds
      );
      return {
        ...base,
        kind: "implementation_hint_create",
        target: {
          entityType: "implementationHint",
          entityId: base.target.entityId,
        },
        updatePayload: {
          featureName,
          description,
          sourceType,
          ...(agentSessionIds ? { agentSessionIds } : {}),
        },
      };
    }
    case "implementation_hint_update": {
      if (base.target.entityType !== "implementationHint") {
        return toUnsupportedSuggestion(
          value,
          index,
          messageId,
          "implementation_hint_update update must target an implementation hint."
        );
      }

      if (!readNonEmptyString(base.target.entityId)) {
        return toUnsupportedSuggestion(
          value,
          index,
          messageId,
          "implementation_hint_update update is missing a target hint id."
        );
      }

      const featureName =
        readNonEmptyPersistedText(updatePayload.featureName) ?? undefined;
      const description =
        readNonEmptyPersistedText(updatePayload.description) ?? undefined;
      const sourceType = readImplementationHintSourceType(
        updatePayload.sourceType
      );
      const agentSessionIds = readOptionalStringArray(
        updatePayload.agentSessionIds
      );
      if (
        featureName === undefined &&
        description === undefined &&
        sourceType === undefined &&
        agentSessionIds === undefined
      ) {
        return toUnsupportedSuggestion(
          value,
          index,
          messageId,
          "implementation_hint_update update has no fields to apply."
        );
      }

      return {
        ...base,
        kind: "implementation_hint_update",
        target: {
          entityType: "implementationHint",
          entityId: base.target.entityId,
        },
        updatePayload: {
          ...(featureName ? { featureName } : {}),
          ...(description ? { description } : {}),
          ...(sourceType ? { sourceType } : {}),
          ...(agentSessionIds ? { agentSessionIds } : {}),
        },
      };
    }
    default:
      return toUnsupportedSuggestion(
        value,
        index,
        messageId,
        `Unsupported update type: ${updateType}.`
      );
  }
};

const isActionableSuggestion = (
  suggestion: ParsedArtifactSuggestion
): suggestion is ActionableArtifactSuggestion =>
  suggestion.kind !== "unsupported";

const toReviewRows = (input: {
  suggestion: ActionableArtifactSuggestion;
  activeTask: TaskContextValue | null;
  designDoc: DesignDocResponseDto | null;
  implementationHintBaseline: ImplementationHintDto | null;
}): DiffReviewRow[] => {
  const { suggestion, activeTask, designDoc, implementationHintBaseline } =
    input;

  switch (suggestion.kind) {
    case "task_details":
      return [
        ...(suggestion.updatePayload.description
          ? [
              {
                key: "task-description",
                label: "Description",
                oldValue: getWorkItemSectionContent(
                  activeTask?.sections,
                  "description"
                ),
                newValue: suggestion.updatePayload.description,
              },
            ]
          : []),
        ...(suggestion.updatePayload.acceptanceCriteria
          ? [
              {
                key: "task-acceptance-criteria",
                label: "Acceptance Criteria",
                oldValue: getWorkItemSectionContent(
                  activeTask?.sections,
                  "acceptanceCriteria"
                ),
                newValue: suggestion.updatePayload.acceptanceCriteria,
              },
            ]
          : []),
      ];
    case "task_acceptance_criteria":
      return [
        {
          key: "task-acceptance-criteria",
          label: "Acceptance Criteria",
          oldValue: getWorkItemSectionContent(
            activeTask?.sections,
            "acceptanceCriteria"
          ),
          newValue: suggestion.updatePayload.acceptanceCriteria,
        },
      ];
    case "design_doc_revision": {
      const designDocSections = designDoc?.sections ?? [];

      const sectionRows = (suggestion.updatePayload.sections ?? [])
        .filter((section) => typeof section.content === "string")
        .map((section) => {
          const currentSection = designDocSections.find(
            (designDocSection) =>
              designDocSection.key.toLowerCase() === section.key.toLowerCase()
          );

          return {
            key: `design-doc-section-${section.key}`,
            label: `Section: ${section.key}`,
            oldValue: currentSection?.materializedMarkdown ?? "",
            newValue: section.content ?? "",
          } satisfies DiffReviewRow;
        });

      return [
        ...(suggestion.updatePayload.summary !== undefined
          ? [
              {
                key: "design-doc-summary",
                label: "Summary",
                oldValue: designDoc?.summary ?? "",
                newValue: suggestion.updatePayload.summary ?? "",
              } satisfies DiffReviewRow,
            ]
          : []),
        ...sectionRows,
      ];
    }
    case "implementation_hint_create":
      return [
        {
          key: "implementation-hint-feature-name",
          label: "Feature Name",
          oldValue: "",
          newValue: suggestion.updatePayload.featureName,
        },
        {
          key: "implementation-hint-description",
          label: "Description",
          oldValue: "",
          newValue: suggestion.updatePayload.description,
        },
      ];
    case "implementation_hint_update":
      return [
        ...(suggestion.updatePayload.featureName
          ? [
              {
                key: "implementation-hint-update-feature-name",
                label: "Feature Name",
                oldValue: implementationHintBaseline?.featureName ?? "",
                newValue: suggestion.updatePayload.featureName,
              },
            ]
          : []),
        ...(suggestion.updatePayload.description
          ? [
              {
                key: "implementation-hint-update-description",
                label: "Description",
                oldValue: implementationHintBaseline?.description ?? "",
                newValue: suggestion.updatePayload.description,
              },
            ]
          : []),
      ];
    case "task_status":
    default:
      return [];
  }
};

const toStatusDisplayRows = (input: {
  suggestion: ActionableArtifactSuggestion;
  activeTask: TaskContextValue | null;
  designDoc: DesignDocResponseDto | null;
  implementationHintBaseline: ImplementationHintDto | null;
}): Array<{ label: string; current: string; suggested: string }> => {
  const { suggestion, activeTask, designDoc, implementationHintBaseline } =
    input;

  switch (suggestion.kind) {
    case "task_status":
      return [
        {
          label: "Status",
          current: activeTask?.status ?? "Unknown",
          suggested: suggestion.updatePayload.status,
        },
      ];
    case "design_doc_revision":
      return suggestion.updatePayload.status
        ? [
            {
              label: "Status",
              current: designDoc?.status ?? "Unknown",
              suggested: suggestion.updatePayload.status,
            },
          ]
        : [];
    case "implementation_hint_create":
      return [
        {
          label: "Source type",
          current: "",
          suggested: suggestion.updatePayload.sourceType,
        },
      ];
    case "implementation_hint_update":
      return suggestion.updatePayload.sourceType
        ? [
            {
              label: "Source type",
              current: implementationHintBaseline?.sourceType ?? "",
              suggested: suggestion.updatePayload.sourceType,
            },
          ]
        : [];
    case "task_details":
    case "task_acceptance_criteria":
    default:
      return [];
  }
};

const toDiffOperationPrefix = (
  suggestionId: string,
  rowKey: string
): string => {
  const safeSuggestionId = suggestionId.replace(/[^a-zA-Z0-9_-]/g, "-");
  const safeRowKey = rowKey.replace(/[^a-zA-Z0-9_-]/g, "-");
  return `final-assessment-diff-${safeSuggestionId}-${safeRowKey}`;
};

const toUpdateSourceType = (
  value:
    | (typeof CreateImplementationHintDtoSourceTypeEnum)[keyof typeof CreateImplementationHintDtoSourceTypeEnum]
    | undefined
):
  | (typeof UpdateImplementationHintDtoSourceTypeEnum)[keyof typeof UpdateImplementationHintDtoSourceTypeEnum]
  | undefined => {
  if (value === CreateImplementationHintDtoSourceTypeEnum.System) {
    return UpdateImplementationHintDtoSourceTypeEnum.System;
  }

  if (value === CreateImplementationHintDtoSourceTypeEnum.User) {
    return UpdateImplementationHintDtoSourceTypeEnum.User;
  }

  return undefined;
};

const isTaskSection = (
  value: unknown
): value is NonNullable<TaskResponseDto["sections"]>[number] => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    typeof value.key === "string" &&
    typeof value.order === "number" &&
    typeof value.materializedMarkdown === "string"
  );
};

const toTaskWorkItem = (value: unknown): TaskContextValue | null => {
  if (!isRecord(value)) {
    return null;
  }

  if (
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    typeof value.organizationId !== "string" ||
    typeof value.initiativeId !== "string" ||
    !isWorkStatus(value.status)
  ) {
    return null;
  }

  const sections = Array.isArray(value.sections)
    ? value.sections.filter(isTaskSection)
    : undefined;

  return {
    id: value.id,
    initiativeId: value.initiativeId,
    status: value.status,
    ...(sections ? { sections } : {}),
  };
};

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return "Update failed.";
};

interface ArtifactSuggestionCardProps {
  suggestion: ParsedArtifactSuggestion;
  selected: boolean;
  rejected: boolean;
  applyStatus: ApplyStatus;
  applyError?: string;
  isLocked: boolean;
  onAcceptSuggestion: (suggestionId: string) => void;
  onRejectSuggestion: (suggestionId: string) => void;
  organizationId: string;
  activeTask: TaskContextValue | null;
}

const ArtifactSuggestionCard: React.FC<ArtifactSuggestionCardProps> = ({
  suggestion,
  selected,
  rejected,
  applyStatus,
  applyError,
  isLocked,
  onAcceptSuggestion,
  onRejectSuggestion,
  organizationId,
  activeTask,
}) => {
  const isDesignDocSuggestion = suggestion.kind === "design_doc_revision";
  const designDocQuery = useDesignDoc(
    organizationId,
    isDesignDocSuggestion ? suggestion.target.entityId : undefined,
    {
      enabled: isDesignDocSuggestion,
      preferStale: true,
    }
  );

  const [implementationHintBaseline, setImplementationHintBaseline] =
    React.useState<ImplementationHintDto | null>(null);
  const [implementationHintBaselineError, setImplementationHintBaselineError] =
    React.useState<string | null>(null);
  const [
    isImplementationHintBaselineLoading,
    setIsImplementationHintBaselineLoading,
  ] = React.useState(false);

  React.useEffect(() => {
    let isCancelled = false;

    const loadBaseline = async (): Promise<void> => {
      if (suggestion.kind !== "implementation_hint_update") {
        setImplementationHintBaseline(null);
        setImplementationHintBaselineError(null);
        setIsImplementationHintBaselineLoading(false);
        return;
      }

      const hintId = readNonEmptyString(suggestion.target.entityId);
      if (!hintId) {
        setImplementationHintBaseline(null);
        setImplementationHintBaselineError(
          "Cannot load current implementation hint content: missing target hint id."
        );
        setIsImplementationHintBaselineLoading(false);
        return;
      }

      setIsImplementationHintBaselineLoading(true);
      setImplementationHintBaselineError(null);

      try {
        const response = await unifiedApiClient.getImplementationHint({
          organizationId,
          hintId,
        });
        if (isCancelled) {
          return;
        }

        const hint = response.data?.data ?? null;
        setImplementationHintBaseline(hint);
      } catch (error) {
        if (isCancelled) {
          return;
        }
        setImplementationHintBaseline(null);
        setImplementationHintBaselineError(getErrorMessage(error));
      } finally {
        if (!isCancelled) {
          setIsImplementationHintBaselineLoading(false);
        }
      }
    };

    void loadBaseline();

    return () => {
      isCancelled = true;
    };
  }, [organizationId, suggestion]);

  const actionableSuggestion = isActionableSuggestion(suggestion)
    ? suggestion
    : null;

  const reviewRows = React.useMemo(() => {
    if (!actionableSuggestion) {
      return [];
    }

    return toReviewRows({
      suggestion: actionableSuggestion,
      activeTask,
      designDoc: designDocQuery.data ?? null,
      implementationHintBaseline,
    });
  }, [
    actionableSuggestion,
    activeTask,
    designDocQuery.data,
    implementationHintBaseline,
  ]);

  const statusRows = React.useMemo(() => {
    if (!actionableSuggestion) {
      return [];
    }

    return toStatusDisplayRows({
      suggestion: actionableSuggestion,
      activeTask,
      designDoc: designDocQuery.data ?? null,
      implementationHintBaseline,
    });
  }, [
    actionableSuggestion,
    activeTask,
    designDocQuery.data,
    implementationHintBaseline,
  ]);

  const canSelect = actionableSuggestion !== null;

  return (
    <Box
      sx={{
        border: 1,
        borderColor: "divider",
        borderRadius: 1,
        p: 1.25,
      }}
      data-testid={`final-assessment-artifact-update-${String(
        suggestion.index
      )}`}
    >
      <Stack spacing={1}>
        <Stack
          direction="row"
          spacing={1}
          alignItems="center"
          flexWrap="wrap"
          useFlexGap
        >
          <Typography variant="body2" fontWeight={600}>
            {`${String(suggestion.index + 1)}. ${suggestion.title}`}
          </Typography>
          <Chip
            size="small"
            variant="outlined"
            label={`Target: ${suggestion.target.entityType}:${suggestion.target.entityId}`}
          />
          <Chip
            size="small"
            color={toApplyStatusChipColor(applyStatus)}
            label={toSentenceCase(applyStatus)}
          />
        </Stack>

        {suggestion.reasoning ? (
          <Typography variant="body2" color="text.secondary">
            {suggestion.reasoning}
          </Typography>
        ) : null}

        {!canSelect ? (
          <Alert
            severity="warning"
            data-testid={`final-assessment-artifact-update-unsupported-${String(
              suggestion.index
            )}`}
          >
            {(suggestion as UnsupportedArtifactSuggestion).unsupportedReason}
          </Alert>
        ) : null}

        {designDocQuery.error && isDesignDocSuggestion ? (
          <Alert severity="warning">
            Failed to load current design doc content for diff rendering.
          </Alert>
        ) : null}

        {isImplementationHintBaselineLoading &&
        suggestion.kind === "implementation_hint_update" ? (
          <Typography variant="caption" color="text.secondary">
            Loading current implementation hint content...
          </Typography>
        ) : null}

        {implementationHintBaselineError &&
        suggestion.kind === "implementation_hint_update" ? (
          <Alert severity="warning">{implementationHintBaselineError}</Alert>
        ) : null}

        {statusRows.map((row) => (
          <Box
            key={`${suggestion.suggestionId}-${row.label}`}
            sx={{
              border: 1,
              borderColor: "divider",
              borderRadius: 1,
              p: 1,
            }}
          >
            <Typography variant="caption" color="text.secondary">
              {row.label}
            </Typography>
            <Stack
              direction={{ xs: "column", md: "row" }}
              spacing={1}
              sx={{ mt: 0.5 }}
            >
              <Typography variant="body2">
                Current: {row.current || "-"}
              </Typography>
              <Typography variant="body2" fontWeight={600}>
                Suggested: {row.suggested || "-"}
              </Typography>
            </Stack>
          </Box>
        ))}

        {reviewRows.map((row) => (
          <Stack
            key={`${suggestion.suggestionId}-${row.key}`}
            spacing={0.75}
            data-testid={`final-assessment-artifact-update-diff-${String(
              suggestion.index
            )}-${row.key}`}
          >
            <Typography variant="caption" color="text.secondary">
              {row.label}
            </Typography>
            <DiffRenderer
              oldContent={row.oldValue}
              newContent={row.newValue}
              showViewModeToggle
              defaultViewMode={
                suggestion.kind === "implementation_hint_create" ||
                suggestion.kind === "implementation_hint_update"
                  ? "inline"
                  : "split"
              }
              operationTestIdPrefix={toDiffOperationPrefix(
                suggestion.suggestionId,
                row.key
              )}
            />
          </Stack>
        ))}

        {canSelect ? (
          <Box
            sx={{ pt: 0.5, display: "flex", justifyContent: "flex-start" }}
            data-testid={`final-assessment-artifact-update-controls-${String(
              suggestion.index
            )}`}
          >
            <ButtonGroup size="small" variant="outlined">
              <Button
                type="button"
                variant={selected ? "contained" : "outlined"}
                color="primary"
                disabled={isLocked}
                onClick={() => onAcceptSuggestion(suggestion.suggestionId)}
                data-testid={`final-assessment-artifact-update-select-${String(
                  suggestion.index
                )}`}
              >
                {selected ? "Accepted" : "Accept update"}
              </Button>
              <Button
                type="button"
                variant={rejected ? "contained" : "outlined"}
                color="inherit"
                disabled={isLocked}
                onClick={() => onRejectSuggestion(suggestion.suggestionId)}
                data-testid={`final-assessment-artifact-update-reject-${String(
                  suggestion.index
                )}`}
              >
                Reject
              </Button>
            </ButtonGroup>
          </Box>
        ) : null}

        {applyError ? (
          <Alert
            severity="error"
            data-testid={`final-assessment-artifact-update-error-${String(
              suggestion.index
            )}`}
          >
            {applyError}
          </Alert>
        ) : null}
      </Stack>
    </Box>
  );
};

export const FinalAssessmentStructuredField: React.FC<
  FinalAssessmentStructuredFieldProps
> = ({ config, value, disabled: _disabled = false, context }) => {
  const { suggestionDecisions } = useConversationContext();
  const pathService = usePathService();

  const response = extractFinalAssessment(value);
  const activeTaskId =
    response?.responseType === "final_assessment_v2"
      ? response.taskAssessment.target.entityId
      : undefined;

  const { workItem: rawActiveTask } = useWorkItem(
    context.organizationId,
    "task",
    activeTaskId ?? "",
    {
      enabled:
        response?.responseType === "final_assessment_v2" &&
        typeof activeTaskId === "string" &&
        activeTaskId.length > 0,
      preferStale: true,
    }
  );
  const activeTask = React.useMemo(
    () => toTaskWorkItem(rawActiveTask),
    [rawActiveTask]
  );

  const { updateTask } = useWorkItemUpdateMethods(
    context.organizationId,
    "task",
    context.projectId,
    undefined,
    {
      initiativeId: activeTask?.initiativeId,
    }
  );

  const { mutate: updateDesignDoc } = useUpdateDesignDoc();
  const agentSessionQuery = useAgentSession(
    context.organizationId,
    context.projectId,
    context.agentSessionId,
    {
      enabled: typeof context.agentSessionId === "string",
      preferStale: true,
    }
  );
  const decisionMutation = useSuggestionDecision();

  const parsedSuggestions = React.useMemo<ParsedArtifactSuggestion[]>(() => {
    if (!response) {
      return [];
    }

    return response.artifactUpdateSuggestions.map((suggestion, index) =>
      parseArtifactSuggestion(suggestion, index, context.messageId)
    );
  }, [context.messageId, response]);

  const actionableSuggestions = React.useMemo(
    () => parsedSuggestions.filter(isActionableSuggestion),
    [parsedSuggestions]
  );

  const suggestionFingerprint = React.useMemo(
    () =>
      parsedSuggestions.map((suggestion) => suggestion.suggestionId).join("|"),
    [parsedSuggestions]
  );

  const [applyStatusBySuggestionId, setApplyStatusBySuggestionId] =
    React.useState<Record<string, ApplyStatus>>({});
  const [applyErrorBySuggestionId, setApplyErrorBySuggestionId] =
    React.useState<Record<string, string>>({});
  const [isApplying, setIsApplying] = React.useState(false);
  const [applySummary, setApplySummary] = React.useState<{
    appliedCount: number;
    attemptedCount: number;
  } | null>(null);

  React.useEffect(() => {
    setApplyStatusBySuggestionId({});
    setApplyErrorBySuggestionId({});
    setIsApplying(false);
    setApplySummary(null);
  }, [suggestionFingerprint]);

  const isLocked = isApplying;

  const handleAcceptSuggestion = React.useCallback(
    (suggestionId: string) => {
      if (!context.conversationId || !context.messageId) {
        return;
      }

      const optimisticDecision: SuggestionDecisionStatus = {
        id: suggestionId,
        type: ASSESSMENT_SUGGESTION_TYPE,
        accepted: true,
        decidedBy: null,
        createdAt: new Date().toISOString(),
        sourceConversationId: context.conversationId,
        sourceMessageId: context.messageId,
      };

      suggestionDecisions.upsertDecision(optimisticDecision);
      decisionMutation
        .mutate({
          organizationId: context.organizationId,
          type: ASSESSMENT_SUGGESTION_TYPE,
          suggestionId,
          accepted: true,
          sourceConversationId: context.conversationId,
          sourceMessageId: context.messageId,
        })
        .then((decision) => {
          suggestionDecisions.upsertDecision(decision);
        })
        .catch(() => undefined);
    },
    [context, decisionMutation, suggestionDecisions]
  );

  const handleRejectSuggestion = React.useCallback(
    (suggestionId: string) => {
      if (!context.conversationId || !context.messageId) {
        return;
      }

      const optimisticDecision: SuggestionDecisionStatus = {
        id: suggestionId,
        type: ASSESSMENT_SUGGESTION_TYPE,
        accepted: false,
        decidedBy: null,
        createdAt: new Date().toISOString(),
        sourceConversationId: context.conversationId,
        sourceMessageId: context.messageId,
      };

      suggestionDecisions.upsertDecision(optimisticDecision);
      decisionMutation
        .mutate({
          organizationId: context.organizationId,
          type: ASSESSMENT_SUGGESTION_TYPE,
          suggestionId,
          accepted: false,
          sourceConversationId: context.conversationId,
          sourceMessageId: context.messageId,
        })
        .then((decision) => {
          suggestionDecisions.upsertDecision(decision);
        })
        .catch(() => undefined);
    },
    [context, decisionMutation, suggestionDecisions]
  );

  const resolveAgentSessionServiceId =
    React.useCallback(async (): Promise<string> => {
      const agentSessionId = readNonEmptyString(context.agentSessionId);
      if (!agentSessionId) {
        throw new Error("Agent session context required.");
      }

      const currentServiceId = readNonEmptyString(
        agentSessionQuery.agentSession?.launchServiceId
      );
      if (currentServiceId) {
        return currentServiceId;
      }

      const refreshedSession = await agentSessionQuery.refetch();
      const refreshedServiceId = readNonEmptyString(
        refreshedSession?.launchServiceId
      );
      if (refreshedServiceId) {
        return refreshedServiceId;
      }

      throw new Error("Agent session service context required.");
    }, [
      agentSessionQuery.agentSession?.launchServiceId,
      agentSessionQuery.refetch,
      context.agentSessionId,
    ]);

  const applySuggestion = React.useCallback(
    async (suggestion: ActionableArtifactSuggestion): Promise<void> => {
      if (suggestion.kind === "task_status") {
        if (!activeTask || activeTask.id !== suggestion.target.entityId) {
          throw new Error(
            "Task context is not available for this task_status update."
          );
        }

        await updateTask(suggestion.target.entityId, {
          status: suggestion.updatePayload.status,
          sectionUpdateSource:
            suggestion.updatePayload.sectionUpdateSource ??
            TaskSectionUpdateSourceEnum.AgentSuggested,
        });
        return;
      }

      if (suggestion.kind === "task_details") {
        if (!activeTask || activeTask.id !== suggestion.target.entityId) {
          throw new Error(
            "Task context is not available for this task_details update."
          );
        }

        const sections: Array<{
          key: "description" | "acceptanceCriteria";
          content: string;
          order: number;
        }> = [];

        if (suggestion.updatePayload.description) {
          sections.push({
            key: "description",
            content: suggestion.updatePayload.description,
            order: 0,
          });
        }

        if (suggestion.updatePayload.acceptanceCriteria) {
          sections.push({
            key: "acceptanceCriteria",
            content: suggestion.updatePayload.acceptanceCriteria,
            order: 1,
          });
        }

        await updateTask(suggestion.target.entityId, {
          sectionUpdateSource: TaskSectionUpdateSourceEnum.AgentSuggested,
          sections,
        });
        return;
      }

      if (suggestion.kind === "task_acceptance_criteria") {
        if (!activeTask || activeTask.id !== suggestion.target.entityId) {
          throw new Error(
            "Task context is not available for this task_acceptance_criteria update."
          );
        }

        await updateTask(suggestion.target.entityId, {
          sectionUpdateSource: TaskSectionUpdateSourceEnum.AgentSuggested,
          sections: [
            {
              key: "acceptanceCriteria",
              content: suggestion.updatePayload.acceptanceCriteria,
              order: 1,
            },
          ],
        });
        return;
      }

      if (suggestion.kind === "design_doc_revision") {
        const updates: UpdateDesignDocDto = {
          ...(suggestion.updatePayload.status
            ? { status: suggestion.updatePayload.status }
            : {}),
          ...(suggestion.updatePayload.summary !== undefined
            ? { summary: suggestion.updatePayload.summary }
            : {}),
          ...(suggestion.updatePayload.sections
            ? { sections: suggestion.updatePayload.sections }
            : {}),
          sectionUpdateSource:
            suggestion.updatePayload.sectionUpdateSource ??
            DesignDocSectionUpdateSourceEnum.AgentSuggested,
        };

        await updateDesignDoc({
          organizationId: context.organizationId,
          designDocId: suggestion.target.entityId,
          updates,
        });
        return;
      }

      if (suggestion.kind === "implementation_hint_create") {
        const serviceId = await resolveAgentSessionServiceId();
        const agentSessionId = readNonEmptyString(context.agentSessionId);
        if (!agentSessionId) {
          throw new Error("Agent session context required.");
        }

        const payload: CreateImplementationHintDto = {
          serviceId,
          agentSessionId,
          featureName: suggestion.updatePayload.featureName,
          description: suggestion.updatePayload.description,
          sourceType: suggestion.updatePayload.sourceType,
        };

        await unifiedApiClient.createImplementationHint({
          organizationId: context.organizationId,
          createImplementationHintDto: payload,
        });
        return;
      }

      if (suggestion.kind === "implementation_hint_update") {
        const hintId = readNonEmptyString(suggestion.target.entityId);
        if (!hintId) {
          throw new Error("Implementation hint id is required.");
        }

        const hintResponse = await unifiedApiClient.getImplementationHint({
          organizationId: context.organizationId,
          hintId,
        });

        const existingHint = hintResponse.data?.data;
        const serviceId = readNonEmptyString(existingHint?.serviceId);
        if (!serviceId) {
          throw new Error("Service context required.");
        }

        const sourceType = toUpdateSourceType(
          suggestion.updatePayload.sourceType
        );
        const agentSessionId = readNonEmptyString(context.agentSessionId);

        const updates: UpdateImplementationHintDto = {
          serviceId,
          ...(suggestion.updatePayload.featureName
            ? { featureName: suggestion.updatePayload.featureName }
            : {}),
          ...(suggestion.updatePayload.description
            ? { description: suggestion.updatePayload.description }
            : {}),
          ...(sourceType ? { sourceType } : {}),
          ...(agentSessionId ? { agentSessionId } : {}),
        };

        await unifiedApiClient.updateImplementationHint({
          organizationId: context.organizationId,
          hintId,
          updateImplementationHintDto: updates,
        });
      }
    },
    [
      activeTask,
      context.organizationId,
      context.agentSessionId,
      resolveAgentSessionServiceId,
      updateDesignDoc,
      updateTask,
    ]
  );

  const handleApplyUpdates = React.useCallback(async (): Promise<void> => {
    const selectedSuggestions = actionableSuggestions
      .filter(
        (suggestion) =>
          suggestionDecisions.getDecision(suggestion.suggestionId)?.accepted ===
          true
      )
      .filter(
        (suggestion) =>
          applyStatusBySuggestionId[suggestion.suggestionId] !== "applied"
      );

    if (selectedSuggestions.length === 0) {
      return;
    }

    setIsApplying(true);
    setApplySummary(null);
    let appliedCount = 0;

    for (const suggestion of selectedSuggestions) {
      setApplyStatusBySuggestionId((current) => ({
        ...current,
        [suggestion.suggestionId]: "applying",
      }));
      setApplyErrorBySuggestionId((current) => {
        const next = { ...current };
        delete next[suggestion.suggestionId];
        return next;
      });

      try {
        await applySuggestion(suggestion);

        appliedCount += 1;
        setApplyStatusBySuggestionId((current) => ({
          ...current,
          [suggestion.suggestionId]: "applied",
        }));
      } catch (error) {
        setApplyStatusBySuggestionId((current) => ({
          ...current,
          [suggestion.suggestionId]: "failed",
        }));
        setApplyErrorBySuggestionId((current) => ({
          ...current,
          [suggestion.suggestionId]: getErrorMessage(error),
        }));
      }
    }

    setApplySummary({
      appliedCount,
      attemptedCount: selectedSuggestions.length,
    });
    setIsApplying(false);
  }, [
    actionableSuggestions,
    applyStatusBySuggestionId,
    applySuggestion,
    suggestionDecisions,
  ]);

  const hasSelectedPendingSuggestions = React.useMemo(() => {
    return actionableSuggestions.some(
      (suggestion) =>
        suggestionDecisions.getDecision(suggestion.suggestionId)?.accepted ===
          true &&
        applyStatusBySuggestionId[suggestion.suggestionId] !== "applied"
    );
  }, [actionableSuggestions, applyStatusBySuggestionId, suggestionDecisions]);

  if (!response) {
    return (
      <Alert
        severity="info"
        data-testid={`final-assessment-structured-field-empty-${config.field}`}
      >
        Final assessment details are unavailable.
      </Alert>
    );
  }

  const isV2Response = response.responseType === "final_assessment_v2";

  return (
    <Box
      data-testid={`final-assessment-structured-field-${config.field}`}
      sx={{
        border: 1,
        borderColor: "divider",
        borderRadius: 1,
        p: 2,
      }}
    >
      <Stack spacing={1.5}>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
          <Typography variant="subtitle1" fontWeight={600}>
            {config.description || "Final Assessment"}
          </Typography>
          <Chip
            size="small"
            label={response.responseType}
            variant="outlined"
            color="primary"
          />
        </Stack>

        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <Chip
            size="small"
            color={toVerdictChipColor(response.taskAssessment.verdict)}
            label={`Verdict: ${response.taskAssessment.verdict}`}
          />
          <Chip
            size="small"
            color={toStatusChipColor(
              response.taskAssessment.statusRecommendation.status
            )}
            label={`Recommended status: ${response.taskAssessment.statusRecommendation.status}`}
          />
        </Stack>

        <Typography variant="body2">
          {response.taskAssessment.summary}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {response.taskAssessment.statusRecommendation.reason}
        </Typography>

        {(response.artifactUpdateSuggestions.length > 0 ||
          response.evidenceCorrections.length > 0 ||
          response.openQuestions.length > 0) && (
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            {response.artifactUpdateSuggestions.length > 0 && (
              <Chip
                size="small"
                variant="outlined"
                label={`Artifact updates: ${String(
                  response.artifactUpdateSuggestions.length
                )}`}
              />
            )}
            {response.evidenceCorrections.length > 0 && (
              <Chip
                size="small"
                variant="outlined"
                label={`Evidence corrections: ${String(
                  response.evidenceCorrections.length
                )}`}
              />
            )}
            {response.openQuestions.length > 0 && (
              <Chip
                size="small"
                variant="outlined"
                label={`Open questions: ${String(
                  response.openQuestions.length
                )}`}
              />
            )}
          </Stack>
        )}

        {response.artifactUpdateSuggestions.length > 0 && (
          <Stack spacing={1} data-testid="final-assessment-artifact-updates">
            <Typography variant="subtitle2" fontWeight={600}>
              Artifact Updates
            </Typography>

            {response.artifactUpdateSuggestions.length > 0 ? (
              <Stack spacing={1}>
                {isV2Response
                  ? parsedSuggestions.map((suggestion) => (
                      <ArtifactSuggestionCard
                        key={suggestion.suggestionId}
                        suggestion={suggestion}
                        selected={
                          suggestionDecisions.getDecision(
                            suggestion.suggestionId
                          )?.accepted === true
                        }
                        rejected={
                          suggestionDecisions.getDecision(
                            suggestion.suggestionId
                          )?.accepted === false
                        }
                        applyStatus={
                          applyStatusBySuggestionId[suggestion.suggestionId] ??
                          "idle"
                        }
                        applyError={
                          applyErrorBySuggestionId[suggestion.suggestionId]
                        }
                        isLocked={isLocked}
                        onAcceptSuggestion={handleAcceptSuggestion}
                        onRejectSuggestion={handleRejectSuggestion}
                        organizationId={context.organizationId}
                        activeTask={activeTask}
                      />
                    ))
                  : response.artifactUpdateSuggestions.map(
                      (suggestion, index) => {
                        const itemTitle = toArtifactUpdateTitle(suggestion);
                        const itemReasoning = isRecord(suggestion)
                          ? readNonEmptyString(suggestion.reasoning)
                          : null;
                        const payloadSummary =
                          summarizeArtifactUpdatePayload(suggestion);

                        return (
                          <Box
                            key={toArtifactUpdateKey(suggestion, index)}
                            sx={{
                              border: 1,
                              borderColor: "divider",
                              borderRadius: 1,
                              p: 1.25,
                            }}
                            data-testid={`final-assessment-artifact-update-${String(
                              index
                            )}`}
                          >
                            <Typography variant="body2" fontWeight={600}>
                              {`${String(index + 1)}. ${itemTitle}`}
                            </Typography>
                            {payloadSummary ? (
                              <Typography variant="body2" sx={{ mt: 0.5 }}>
                                {payloadSummary}
                              </Typography>
                            ) : null}
                            {itemReasoning ? (
                              <Typography
                                variant="body2"
                                color="text.secondary"
                                sx={{ mt: 0.5 }}
                              >
                                {itemReasoning}
                              </Typography>
                            ) : null}
                          </Box>
                        );
                      }
                    )}
              </Stack>
            ) : (
              <Typography variant="body2" color="text.secondary">
                No artifact updates were suggested.
              </Typography>
            )}

            {isV2Response && actionableSuggestions.length > 0 ? (
              <Stack spacing={1} sx={{ pt: 0.5 }}>
                <Button
                  type="button"
                  variant="contained"
                  onClick={() => {
                    void handleApplyUpdates();
                  }}
                  disabled={!hasSelectedPendingSuggestions || isLocked}
                  data-testid="final-assessment-apply-updates-button"
                >
                  {isApplying ? "Applying updates..." : "Apply Updates"}
                </Button>

                {applySummary ? (
                  <Alert
                    severity={
                      applySummary.appliedCount === applySummary.attemptedCount
                        ? "success"
                        : "warning"
                    }
                    data-testid="final-assessment-apply-updates-summary"
                  >
                    {`Applied ${String(applySummary.appliedCount)} of ${String(
                      applySummary.attemptedCount
                    )} selected updates.`}
                  </Alert>
                ) : null}
              </Stack>
            ) : null}
          </Stack>
        )}

        {response.openQuestions.length > 0 && (
          <Stack spacing={1} data-testid="final-assessment-open-questions">
            <Typography variant="subtitle2" fontWeight={600}>
              Open Questions
            </Typography>
            <Stack spacing={1}>
              {response.openQuestions.map((openQuestion, index) => {
                const question = readOpenQuestion(openQuestion, index);

                return (
                  <Box
                    key={`${question.question}-${String(index)}`}
                    sx={{
                      border: 1,
                      borderColor: "divider",
                      borderRadius: 1,
                      p: 1.25,
                    }}
                    data-testid={`final-assessment-open-question-${String(
                      index
                    )}`}
                  >
                    <Typography variant="body2" fontWeight={600}>
                      {question.question}
                    </Typography>
                    {question.reason ? (
                      <Typography
                        variant="body2"
                        color="text.secondary"
                        sx={{ mt: 0.5 }}
                      >
                        {question.reason}
                      </Typography>
                    ) : null}
                  </Box>
                );
              })}
            </Stack>
          </Stack>
        )}

        {isV2Response &&
          (
            (response as CodingPromptFinalAssessmentV2Payload).hierarchyWalk ??
            []
          ).length > 0 && (
            <Stack spacing={0.5} data-testid="final-assessment-hierarchy-walk">
              <Typography variant="subtitle2" fontWeight={600}>
                Hierarchy Walk
              </Typography>
              {(
                response as CodingPromptFinalAssessmentV2Payload
              ).hierarchyWalk.map((entry, index) => (
                <Box
                  key={index}
                  sx={{
                    py: 1,
                    px: 1.5,
                    borderBottom: 1,
                    borderColor: "divider",
                  }}
                >
                  <Stack direction="row" spacing={0.75} alignItems="center">
                    <EntityIcon entityType={entry.entityType} size={18} round />
                    <Typography variant="body2">
                      <Link
                        to={
                          entry.entityType === "feature"
                            ? pathService.feature({
                                projectId: context.projectId,
                                featureId: entry.entityId,
                              })
                            : pathService.task({
                                projectId: context.projectId,
                                taskId: entry.entityId,
                              })
                        }
                        style={{ color: "inherit" }}
                      >
                        {entry.name}
                      </Link>{" "}
                      [{entry.action}] - {entry.rationale}
                    </Typography>
                  </Stack>
                </Box>
              ))}
            </Stack>
          )}

        {isV2Response &&
          (
            (response as CodingPromptFinalAssessmentV2Payload)
              .dependentTaskWalk ?? []
          ).length > 0 && (
            <Stack
              spacing={0.5}
              data-testid="final-assessment-dependent-task-walk"
            >
              <Typography variant="subtitle2" fontWeight={600}>
                Dependent Task Walk
              </Typography>
              {(
                response as CodingPromptFinalAssessmentV2Payload
              ).dependentTaskWalk!.map((entry, index) => (
                <Box
                  key={index}
                  sx={{
                    py: 1,
                    px: 1.5,
                    borderBottom: 1,
                    borderColor: "divider",
                  }}
                >
                  <Stack
                    direction="row"
                    spacing={0.75}
                    alignItems="center"
                    mb={0.5}
                  >
                    <EntityIcon entityType="task" size={18} round />
                    <Typography variant="body2" fontWeight={500}>
                      <Link
                        to={pathService.task({
                          projectId: context.projectId,
                          taskId: entry.entityId,
                        })}
                        style={{ color: "inherit" }}
                      >
                        {entry.name}
                      </Link>
                    </Typography>
                    <Chip
                      size="small"
                      variant="outlined"
                      color="info"
                      label={entry.relationshipType}
                    />
                    <Chip
                      size="small"
                      variant="outlined"
                      label={entry.action}
                    />
                  </Stack>
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{ pl: 3.25 }}
                  >
                    {entry.rationale}
                  </Typography>
                </Box>
              ))}
            </Stack>
          )}
      </Stack>
    </Box>
  );
};
