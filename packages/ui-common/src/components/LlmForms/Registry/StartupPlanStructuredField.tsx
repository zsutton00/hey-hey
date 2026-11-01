import {
  Alert,
  Box,
  Button,
  Chip,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import React from "react";
import { parseStartupSessionPlanResponseFromText } from "../../../agents/coordination/parser";
import type {
  CodingPlanReviewAnswerPayload,
  CodingPlanReviewDiscrepancyFeedbackEntry,
  CodingPlanReviewQuestionAnswerEntry,
  CodingPlanReviewStepFeedbackEntry,
  CodingPromptStartupPlanPayload,
  CodingPromptStartupSourceRef,
  ServiceDto,
} from "../../../api";
import { usePathService } from "../../../contexts";
import { useAgentSession } from "../../../data/hooks/useAgentSession";
import { useDesignDoc } from "../../../data/hooks/useDesignDoc";
import { useServices } from "../../../data/hooks/useServices";
import { useWorkItem } from "../../../data/hooks/useWorkItem";
import { EntityLinkWithPreview } from "../../Entity";
import { RuntimeModelSelector } from "../../AgentSession/RuntimeModelSelector";
import {
  listEfforts,
  listModels,
  listProviders,
  supportsFastMode,
} from "../../AgentSession/capabilityCatalog";
import {
  buildDefaultSurfaceSelection,
  PLAN_APPROVAL_SURFACE_ID,
  readSurfaceSelection,
  writeSurfaceSelection,
  type SurfaceSelection,
} from "../../AgentSession/surfaceSelectionMemory";
import { useRuntimeModelCatalog } from "../../AgentSession/useRuntimeModelCatalog";
import type { ReasoningEffort } from "../../AgentSession/runtime/types";
import type { ConversationStartRunRequestDtoProviderEnum } from "../../../api";
import { renderInlineMentions } from "../../SmarterTextAreaCard/renderInlineMentions";
import { MessageAuthorCaption } from "../../Conversation/Components/MessageAuthorCaption";
import { PrimaryImplementationList } from "../../CodingPlan/PrimaryImplementationList";
import type { FieldComponentProps } from "./types";

export type StartupServiceScopeReview =
  | { status: "loading"; message: string }
  | { status: "invalid"; message: string }
  | {
      status: "valid";
      alreadySelected: ReadonlyArray<ServiceDto>;
      addedOnApproval: ReadonlyArray<ServiceDto>;
    };

const isUsableProjectService = (service: ServiceDto): boolean =>
  service.status !== "ARCHIVED" &&
  !service.archivedAt &&
  service.name.trim().length > 0;

export const classifyStartupServiceScope = (input: {
  requiredServiceIds: Iterable<string>;
  projectServices: readonly ServiceDto[];
  selectedServiceIds: readonly string[];
  servicesReady: boolean;
  servicesError: boolean;
}): StartupServiceScopeReview => {
  if (input.servicesError) {
    return {
      status: "invalid",
      message:
        "The required Service scope could not be verified for this project.",
    };
  }

  if (!input.servicesReady) {
    return {
      status: "loading",
      message: "Loading the Services required by this plan.",
    };
  }

  const requiredServiceIds = [...new Set(input.requiredServiceIds)];
  const servicesById = new Map(
    input.projectServices
      .filter(isUsableProjectService)
      .map((service) => [service.id, service]),
  );
  const hasUnresolvedService = requiredServiceIds.some(
    (serviceId) => !servicesById.has(serviceId),
  );

  if (hasUnresolvedService) {
    return {
      status: "invalid",
      message:
        "One or more required Services are unavailable in this project; approval is blocked until the scope resolves.",
    };
  }

  const selectedServiceIds = new Set(input.selectedServiceIds);
  const alreadySelected: ServiceDto[] = [];
  const addedOnApproval: ServiceDto[] = [];

  requiredServiceIds.forEach((serviceId) => {
    const service = servicesById.get(serviceId);
    if (!service) {
      return;
    }

    (selectedServiceIds.has(serviceId)
      ? alreadySelected
      : addedOnApproval
    ).push(service);
  });

  return { status: "valid", alreadySelected, addedOnApproval };
};

const isLocalRunProvider = (
  value: unknown,
): value is ConversationStartRunRequestDtoProviderEnum =>
  typeof value === "string" &&
  listProviders().includes(value as ConversationStartRunRequestDtoProviderEnum);

const buildSelectionForProvider = (
  provider: ConversationStartRunRequestDtoProviderEnum,
): SurfaceSelection => {
  const models = listModels(provider);
  const model = models[0]?.id ?? "";
  const efforts = listEfforts(provider, model);
  return {
    provider,
    model,
    reasoningEffort: efforts.includes("medium")
      ? "medium"
      : (efforts[0] ?? null),
    fastMode: false,
  };
};

type StartupDiscrepancyFeedbackEntry = CodingPlanReviewDiscrepancyFeedbackEntry;
type StartupStepFeedbackEntry = CodingPlanReviewStepFeedbackEntry;
type StartupQuestionAnswerEntry = CodingPlanReviewQuestionAnswerEntry;

type StartupExecutionPlanStep =
  CodingPromptStartupPlanPayload["executionPlan"][number];
type StartupPlanDiscrepancy =
  CodingPromptStartupPlanPayload["discrepancies"][number];
type StartupPlanClarificationQuestion =
  CodingPromptStartupPlanPayload["clarificationQuestions"][number];

interface StartupFeedbackDraftState {
  discrepancyByIndex: Record<number, string>;
  stepById: Record<string, string>;
  questionByIndex: Record<number, string>;
}

export type StartupPlanStructuredResponseValue = CodingPlanReviewAnswerPayload;

export const isStartupPlanStructuredResponseValue = (
  value: unknown,
): value is StartupPlanStructuredResponseValue =>
  isRecord(value) &&
  value.responseType === "startup_plan_v1" &&
  typeof value.sessionTitle === "string" &&
  ((Array.isArray(value.requiredServiceIds) &&
    value.requiredServiceIds.every(
      (serviceId: unknown) => typeof serviceId === "string",
    )) ||
    (value.requiredServiceIds instanceof Set &&
      [...value.requiredServiceIds].every(
        (serviceId: unknown) => typeof serviceId === "string",
      ))) &&
  Array.isArray(value.primaryImplementations) &&
  Array.isArray(value.executionPlan) &&
  Array.isArray(value.discrepancies) &&
  Array.isArray(value.clarificationQuestions);

type LegacyStructuredResponseContainer = {
  response?: string;
  structuredResponse?: {
    responseType?: string;
    parsed?: unknown;
  };
};

type StartupPlanStructuredFieldValue =
  | StartupPlanStructuredResponseValue
  | LegacyStructuredResponseContainer;

export type StartupPlanStructuredFieldProps =
  FieldComponentProps<StartupPlanStructuredFieldValue>;

interface StartupPlanStructuredFieldContentProps extends StartupPlanStructuredFieldProps {
  response: CodingPromptStartupPlanPayload;
  rootTestId: string;
  messageScopedRootTestId?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object";

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

const readOptionalString = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

const readOptionalBoolean = (value: unknown): boolean | undefined =>
  typeof value === "boolean" ? value : undefined;

const isRequiredServiceIdCollection = (
  value: unknown,
): value is Iterable<string> => {
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
    )
  );
};

const isStartupPlanResponse = (
  value: unknown,
): value is StartupPlanStructuredResponseValue => {
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

const extractStartupPlan = (
  value: StartupPlanStructuredFieldValue | undefined,
): CodingPromptStartupPlanPayload | null => {
  if (!isRecord(value)) {
    return null;
  }

  if (isStartupPlanResponse(value)) {
    return value;
  }

  if (typeof value.response === "string") {
    const parsedFromText = parseStartupSessionPlanResponseFromText(
      value.response,
    );
    if (parsedFromText.ok) {
      return parsedFromText.value;
    }
  }

  const structured = value.structuredResponse;
  if (!isRecord(structured)) {
    return null;
  }

  if (structured.responseType !== "startup_plan_v1") {
    return null;
  }

  return isStartupPlanResponse(structured.parsed) ? structured.parsed : null;
};

const extractDiscrepancyFeedback = (
  value: StartupPlanStructuredFieldValue | undefined,
  discrepancyCount: number,
): StartupDiscrepancyFeedbackEntry[] => {
  if (!isRecord(value)) {
    return [];
  }

  const recordValue: Record<string, unknown> = value;
  const rawDiscrepancyFeedback = recordValue["discrepancyFeedback"];
  if (Array.isArray(rawDiscrepancyFeedback)) {
    const feedbackByIndex = new Map<number, StartupDiscrepancyFeedbackEntry>();
    rawDiscrepancyFeedback.forEach((entry: unknown) => {
      if (!isRecord(entry)) {
        return;
      }

      const discrepancyIndex = readNonNegativeInteger(entry.discrepancyIndex);
      if (discrepancyIndex === null || discrepancyIndex >= discrepancyCount) {
        return;
      }

      const note = readOptionalString(entry.note);
      if (note === undefined) {
        return;
      }

      feedbackByIndex.set(discrepancyIndex, {
        discrepancyIndex,
        note,
      });
    });

    return [...feedbackByIndex.values()].sort(
      (left, right) => left.discrepancyIndex - right.discrepancyIndex,
    );
  }

  const rawDiscrepancyDispositions = recordValue["discrepancyDispositions"];
  if (!Array.isArray(rawDiscrepancyDispositions)) {
    return [];
  }

  const feedbackByIndex = new Map<number, StartupDiscrepancyFeedbackEntry>();

  rawDiscrepancyDispositions.forEach((entry: unknown) => {
    if (!isRecord(entry)) {
      return;
    }

    const discrepancyIndex = readNonNegativeInteger(entry.discrepancyIndex);
    if (discrepancyIndex === null || discrepancyIndex >= discrepancyCount) {
      return;
    }

    const note = readOptionalString(entry.note);
    if (note === undefined) {
      return;
    }

    feedbackByIndex.set(discrepancyIndex, {
      discrepancyIndex,
      note,
    });
  });

  return [...feedbackByIndex.values()].sort(
    (left, right) => left.discrepancyIndex - right.discrepancyIndex,
  );
};

const extractStepFeedback = (
  value: StartupPlanStructuredFieldValue | undefined,
  executionStepIds: string[],
): StartupStepFeedbackEntry[] => {
  if (!isRecord(value)) {
    return [];
  }

  const recordValue: Record<string, unknown> = value;
  const rawStepFeedback = recordValue["stepFeedback"];
  if (!Array.isArray(rawStepFeedback)) {
    return [];
  }

  const allowedStepIds = new Set(executionStepIds);
  const stepFeedbackById = new Map<string, StartupStepFeedbackEntry>();

  rawStepFeedback.forEach((entry: unknown) => {
    if (!isRecord(entry)) {
      return;
    }

    const stepId = readOptionalTrimmedString(entry.stepId);
    if (!stepId || !allowedStepIds.has(stepId)) {
      return;
    }

    const note = readOptionalString(entry.note);
    if (note === undefined) {
      return;
    }

    stepFeedbackById.set(stepId, {
      stepId,
      note,
    });
  });

  return executionStepIds
    .map((stepId) => stepFeedbackById.get(stepId))
    .filter((entry): entry is StartupStepFeedbackEntry => entry !== undefined);
};

const extractQuestionAnswers = (
  value: StartupPlanStructuredFieldValue | undefined,
  questionCount: number,
): StartupQuestionAnswerEntry[] => {
  if (!isRecord(value)) {
    return [];
  }

  const recordValue: Record<string, unknown> = value;
  const rawQuestionAnswers = recordValue["questionAnswers"];
  if (!Array.isArray(rawQuestionAnswers)) {
    return [];
  }

  const answersByIndex = new Map<number, StartupQuestionAnswerEntry>();
  rawQuestionAnswers.forEach((entry: unknown) => {
    if (!isRecord(entry)) {
      return;
    }

    const questionIndex = readNonNegativeInteger(entry.questionIndex);
    if (questionIndex === null || questionIndex >= questionCount) {
      return;
    }

    const answer = readOptionalString(entry.answer);
    if (answer === undefined) {
      return;
    }

    answersByIndex.set(questionIndex, {
      questionIndex,
      answer,
    });
  });

  return [...answersByIndex.values()].sort(
    (left, right) => left.questionIndex - right.questionIndex,
  );
};

const toDiscrepancyDraftMap = (
  discrepancyFeedback: StartupDiscrepancyFeedbackEntry[],
): Record<number, string> => {
  const nextDraft: Record<number, string> = {};
  discrepancyFeedback.forEach((entry) => {
    nextDraft[entry.discrepancyIndex] = entry.note;
  });
  return nextDraft;
};

const toStepDraftMap = (
  stepFeedback: StartupStepFeedbackEntry[],
): Record<string, string> => {
  const nextDraft: Record<string, string> = {};
  stepFeedback.forEach((entry) => {
    nextDraft[entry.stepId] = entry.note;
  });
  return nextDraft;
};

const toQuestionDraftMap = (
  questionAnswers: StartupQuestionAnswerEntry[],
): Record<number, string> => {
  const nextDraft: Record<number, string> = {};
  questionAnswers.forEach((entry) => {
    nextDraft[entry.questionIndex] = entry.answer;
  });
  return nextDraft;
};

const toFeedbackDraftState = (input: {
  discrepancyFeedback: StartupDiscrepancyFeedbackEntry[];
  stepFeedback: StartupStepFeedbackEntry[];
  questionAnswers: StartupQuestionAnswerEntry[];
}): StartupFeedbackDraftState => ({
  discrepancyByIndex: toDiscrepancyDraftMap(input.discrepancyFeedback),
  stepById: toStepDraftMap(input.stepFeedback),
  questionByIndex: toQuestionDraftMap(input.questionAnswers),
});

const toDiscrepancyFeedbackFromDraft = (
  draft: Record<number, string>,
  discrepancyCount: number,
): StartupDiscrepancyFeedbackEntry[] =>
  Object.entries(draft)
    .map(([discrepancyIndex, note]) => ({
      discrepancyIndex: Number(discrepancyIndex),
      note,
    }))
    .filter(
      (entry) =>
        Number.isInteger(entry.discrepancyIndex) &&
        entry.discrepancyIndex >= 0 &&
        entry.discrepancyIndex < discrepancyCount &&
        entry.note.length > 0,
    )
    .sort((left, right) => left.discrepancyIndex - right.discrepancyIndex);

const toStepFeedbackFromDraft = (
  draft: Record<string, string>,
  executionStepIds: string[],
): StartupStepFeedbackEntry[] =>
  executionStepIds
    .map((stepId) => {
      const note = draft[stepId];
      if (typeof note !== "string" || note.length === 0) {
        return null;
      }

      return {
        stepId,
        note,
      } satisfies StartupStepFeedbackEntry;
    })
    .filter((entry): entry is StartupStepFeedbackEntry => entry !== null);

const toQuestionAnswersFromDraft = (
  draft: Record<number, string>,
  questionCount: number,
): StartupQuestionAnswerEntry[] =>
  Object.entries(draft)
    .map(([questionIndex, answer]) => ({
      questionIndex: Number(questionIndex),
      answer,
    }))
    .filter(
      (entry) =>
        Number.isInteger(entry.questionIndex) &&
        entry.questionIndex >= 0 &&
        entry.questionIndex < questionCount &&
        entry.answer.length > 0,
    )
    .sort((left, right) => left.questionIndex - right.questionIndex);

const toFeedbackSnapshot = (input: {
  discrepancyFeedback: StartupDiscrepancyFeedbackEntry[];
  stepFeedback: StartupStepFeedbackEntry[];
  questionAnswers: StartupQuestionAnswerEntry[];
  provider?: ConversationStartRunRequestDtoProviderEnum;
  model?: string;
  reasoningEffort?: string;
  fastMode?: boolean;
}): string =>
  JSON.stringify({
    discrepancyFeedback: input.discrepancyFeedback,
    stepFeedback: input.stepFeedback,
    questionAnswers: input.questionAnswers,
    provider: input.provider,
    model: input.model,
    reasoningEffort: input.reasoningEffort,
    fastMode: input.fastMode,
  });

const toStartupPlanStructuredResponseValue = (input: {
  response: CodingPromptStartupPlanPayload;
  discrepancyFeedback: StartupDiscrepancyFeedbackEntry[];
  stepFeedback: StartupStepFeedbackEntry[];
  questionAnswers: StartupQuestionAnswerEntry[];
  provider?: ConversationStartRunRequestDtoProviderEnum;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  fastMode?: boolean;
}): StartupPlanStructuredResponseValue => ({
  ...input.response,
  ...(input.discrepancyFeedback.length > 0
    ? { discrepancyFeedback: input.discrepancyFeedback }
    : {}),
  ...(input.stepFeedback.length > 0
    ? { stepFeedback: input.stepFeedback }
    : {}),
  ...(input.questionAnswers.length > 0
    ? { questionAnswers: input.questionAnswers }
    : {}),
  ...(input.provider ? { provider: input.provider } : {}),
  ...(input.model ? { model: input.model } : {}),
  ...(input.reasoningEffort ? { reasoningEffort: input.reasoningEffort } : {}),
  ...(input.fastMode !== undefined ? { fastMode: input.fastMode } : {}),
});

const STARTUP_SOURCE_KIND = {
  Task: "task",
  Initiative: "initiative",
  DesignDoc: "design_doc",
  Plan: "plan",
  EvidenceItem: "evidence_item",
  Unknown: "unknown",
} as const;

type StartupSourceKind =
  (typeof STARTUP_SOURCE_KIND)[keyof typeof STARTUP_SOURCE_KIND];

const STARTUP_SOURCE_KIND_LABELS: Record<StartupSourceKind, string> = {
  [STARTUP_SOURCE_KIND.Task]: "Task",
  [STARTUP_SOURCE_KIND.Initiative]: "Initiative",
  [STARTUP_SOURCE_KIND.DesignDoc]: "Design Doc",
  [STARTUP_SOURCE_KIND.Plan]: "Plan",
  [STARTUP_SOURCE_KIND.EvidenceItem]: "Evidence Item",
  [STARTUP_SOURCE_KIND.Unknown]: "Source",
};

const normalizeStartupSourceType = (sourceType: string): StartupSourceKind => {
  const normalized = sourceType
    .trim()
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .replace(/[-\s]+/g, "_")
    .toLowerCase();

  if (normalized === "task") {
    return STARTUP_SOURCE_KIND.Task;
  }
  if (normalized === "initiative") {
    return STARTUP_SOURCE_KIND.Initiative;
  }
  if (normalized === "design_doc") {
    return STARTUP_SOURCE_KIND.DesignDoc;
  }
  if (normalized === "plan") {
    return STARTUP_SOURCE_KIND.Plan;
  }
  if (normalized === "evidence_item") {
    return STARTUP_SOURCE_KIND.EvidenceItem;
  }
  return STARTUP_SOURCE_KIND.Unknown;
};

interface StartupSourceReferenceInlineProps {
  sourceRef: Partial<CodingPromptStartupSourceRef> | null | undefined;
  organizationId: string;
  projectId: string;
  testId?: string;
}

const readRequiredSourceId = (value: unknown): string => {
  const trimmed = readOptionalTrimmedString(value);
  return trimmed ?? "unknown-source-id";
};

const readSourceTypeLabel = (value: unknown): string => {
  const trimmed = readOptionalTrimmedString(value);
  return trimmed ?? "unknown-source-type";
};

export const StartupSourceReferenceInline: React.FC<StartupSourceReferenceInlineProps> =
  React.memo(({ sourceRef, organizationId, projectId, testId }) => {
    const sourceId = readRequiredSourceId(sourceRef?.sourceId);
    const sourceType = readSourceTypeLabel(sourceRef?.sourceType);
    const sourceKind = normalizeStartupSourceType(sourceType);
    const pathService = usePathService();

    const isTaskSource = sourceKind === STARTUP_SOURCE_KIND.Task;
    const isInitiativeSource = sourceKind === STARTUP_SOURCE_KIND.Initiative;
    const isDesignDocSource = sourceKind === STARTUP_SOURCE_KIND.DesignDoc;

    const taskQuery = useWorkItem(
      organizationId,
      "task",
      isTaskSource ? sourceId : "",
      {
        enabled: isTaskSource,
        preferStale: true,
      },
    );
    const initiativeQuery = useWorkItem(
      organizationId,
      "initiative",
      isInitiativeSource ? sourceId : "",
      {
        enabled: isInitiativeSource,
        preferStale: true,
      },
    );
    const designDocQuery = useDesignDoc(
      organizationId,
      isDesignDocSource ? sourceId : undefined,
      {
        enabled: isDesignDocSource,
        preferStale: true,
      },
    );
    const sourceLabel = STARTUP_SOURCE_KIND_LABELS[sourceKind];
    const sourceTitle = `${sourceType}:${sourceId}`;
    const resolvedName =
      (isTaskSource ? taskQuery.workItem?.name : null) ??
      (isInitiativeSource ? initiativeQuery.workItem?.name : null) ??
      (isDesignDocSource ? designDocQuery.data?.name : null) ??
      null;

    const isLoadingName =
      (!resolvedName &&
        isTaskSource &&
        (taskQuery.isLoading || taskQuery.isFetching)) ||
      (!resolvedName &&
        isInitiativeSource &&
        (initiativeQuery.isLoading || initiativeQuery.isFetching)) ||
      (!resolvedName &&
        isDesignDocSource &&
        (designDocQuery.isLoading || designDocQuery.isFetching));

    const sourceName =
      resolvedName ?? (isLoadingName ? "Loading..." : sourceId);

    const previewEntityType =
      sourceKind === STARTUP_SOURCE_KIND.Task
        ? "task"
        : sourceKind === STARTUP_SOURCE_KIND.Initiative
          ? "initiative"
          : sourceKind === STARTUP_SOURCE_KIND.DesignDoc
            ? "design_doc"
            : null;

    const sourceHref =
      sourceKind === STARTUP_SOURCE_KIND.Task
        ? pathService.task({
            projectId,
            taskId: sourceId,
          })
        : sourceKind === STARTUP_SOURCE_KIND.Initiative
          ? pathService.initiativeDetail({
              projectId,
              initiativeId: sourceId,
            })
          : sourceKind === STARTUP_SOURCE_KIND.DesignDoc
            ? pathService.designDoc({
                projectId,
                designDocId: sourceId,
              })
            : sourceKind === STARTUP_SOURCE_KIND.Plan
              ? pathService.plan({
                  projectId,
                  planId: sourceId,
                })
              : null;
    const isLinkableSource = sourceHref !== null;
    const shouldRenderMetadata =
      !isLinkableSource && Boolean(resolvedName) && resolvedName !== sourceId;

    return (
      <Box
        component="span"
        data-testid={testId}
        sx={{
          display: "inline-flex",
          alignItems: "center",
          gap: 0.5,
          flexWrap: "wrap",
        }}
      >
        <Typography component="span" variant="inherit" color="inherit">
          {sourceLabel}:
        </Typography>
        {previewEntityType && sourceName !== "Loading..." ? (
          <EntityLinkWithPreview
            label={sourceName}
            entityId={sourceId}
            entityType={previewEntityType}
            organizationId={organizationId}
            projectId={projectId}
            sx={{
              fontSize: "inherit",
              fontWeight: 600,
              color: "inherit",
            }}
          />
        ) : sourceHref && sourceName !== "Loading..." ? (
          <Box
            component="a"
            href={sourceHref}
            title={sourceTitle}
            sx={{
              fontSize: "inherit",
              fontWeight: 600,
              color: "inherit",
              textDecoration: "none",
              "&:hover": {
                textDecoration: "underline",
              },
            }}
          >
            {sourceName}
          </Box>
        ) : (
          <Typography
            component="span"
            variant="inherit"
            color="inherit"
            title={sourceTitle}
            sx={{ fontWeight: 600 }}
          >
            {sourceName}
          </Typography>
        )}
        {shouldRenderMetadata ? (
          <Typography
            component="span"
            variant="inherit"
            color="text.secondary"
            sx={{ opacity: 0.75 }}
            title={sourceTitle}
          >
            {`(${sourceType}:${sourceId})`}
          </Typography>
        ) : null}
      </Box>
    );
  });

interface StartupSourceReferenceListInlineProps {
  sourceRefs: Array<Partial<CodingPromptStartupSourceRef> | null | undefined>;
  organizationId: string;
  projectId: string;
  testIdPrefix?: string;
}

const StartupSourceReferenceListInline: React.FC<StartupSourceReferenceListInlineProps> =
  React.memo(({ sourceRefs, organizationId, projectId, testIdPrefix }) => (
    <Box component="span">
      {sourceRefs.map((sourceRef, index) => {
        const sourceType = readSourceTypeLabel(sourceRef?.sourceType);
        const sourceId = readRequiredSourceId(sourceRef?.sourceId);

        return (
          <React.Fragment key={`${sourceType}-${sourceId}-${String(index)}`}>
            {index > 0 ? ", " : null}
            <StartupSourceReferenceInline
              sourceRef={sourceRef}
              organizationId={organizationId}
              projectId={projectId}
              {...(testIdPrefix
                ? { testId: `${testIdPrefix}-${String(index)}` }
                : {})}
            />
          </React.Fragment>
        );
      })}
    </Box>
  ));

interface InlineCommentFieldProps {
  value: string;
  label: string;
  placeholder: string;
  disabled: boolean;
  onChange: (
    event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => void;
  onBlur: () => void;
  testId?: string;
  sx?: object;
}

const InlineCommentField: React.FC<InlineCommentFieldProps> = React.memo(
  ({ value, label, placeholder, disabled, onChange, onBlur, testId, sx }) => {
    const [isOpen, setIsOpen] = React.useState(value.length > 0);

    React.useEffect(() => {
      if (value.length > 0) {
        setIsOpen(true);
      }
    }, [value]);

    if (!isOpen) {
      return (
        <Button
          size="small"
          variant="text"
          disabled={disabled}
          onClick={() => setIsOpen(true)}
          sx={{ alignSelf: "flex-start", textTransform: "none", ...sx }}
        >
          Add comment
        </Button>
      );
    }

    return (
      <TextField
        size="small"
        fullWidth
        multiline
        minRows={2}
        label={label}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={onChange}
        onBlur={onBlur}
        data-testid={testId}
        autoFocus={value.length === 0}
        sx={sx}
      />
    );
  },
);

interface StartupExecutionPlanRowProps {
  step: StartupExecutionPlanStep;
  stepIndex: number;
  organizationId: string;
  projectId: string;
  feedback: string;
  isFeedbackLocked: boolean;
  onFeedbackChange: (stepId: string, note: string) => void;
  onFeedbackBlur: () => void;
}

const StartupExecutionPlanRow: React.FC<StartupExecutionPlanRowProps> =
  React.memo(
    ({
      step,
      stepIndex,
      organizationId: _organizationId,
      projectId: _projectId,
      feedback,
      isFeedbackLocked,
      onFeedbackChange,
      onFeedbackBlur,
    }) => {
      const handleChange = React.useCallback(
        (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
          onFeedbackChange(step.stepId, event.target.value);
        },
        [onFeedbackChange, step.stepId],
      );

      const targetFiles = step.targetFiles ?? [];

      return (
        <Box
          sx={{
            border: 1,
            borderColor: "divider",
            borderRadius: 1,
            p: 1.25,
          }}
        >
          <Stack
            direction="row"
            spacing={1}
            alignItems="center"
            flexWrap="wrap"
            useFlexGap
          >
            <Typography variant="body1" fontSize="1.1rem" fontWeight={600}>
              {`${String(stepIndex + 1)}. ${step.title}`}
            </Typography>
          </Stack>
          <Typography component="div" variant="body1" sx={{ mt: 0.5 }}>
            {renderInlineMentions(step.description)}
          </Typography>
          {targetFiles.length > 0 && (
            <Stack
              direction="row"
              flexWrap="wrap"
              useFlexGap
              spacing={0.5}
              sx={{ mt: 0.75 }}
              data-testid={`startup-plan-step-target-files-${step.stepId}`}
            >
              {targetFiles.map((path) => (
                <Chip
                  key={path}
                  label={path}
                  size="small"
                  variant="outlined"
                  sx={{
                    fontFamily: "monospace",
                    "& .MuiChip-label": { fontFamily: "monospace" },
                  }}
                />
              ))}
            </Stack>
          )}
          <InlineCommentField
            value={feedback}
            label="Step feedback (optional)"
            placeholder="Add feedback for this step. This will be sent to the agent."
            disabled={isFeedbackLocked}
            onChange={handleChange}
            onBlur={onFeedbackBlur}
            testId={`startup-plan-step-feedback-${step.stepId}`}
            sx={{ mt: 1 }}
          />
        </Box>
      );
    },
  );

interface StartupDiscrepancyRowProps {
  discrepancy: StartupPlanDiscrepancy;
  discrepancyIndex: number;
  organizationId: string;
  projectId: string;
  feedback: string;
  isFeedbackLocked: boolean;
  onFeedbackChange: (discrepancyIndex: number, note: string) => void;
  onFeedbackBlur: () => void;
}

const StartupDiscrepancyRow: React.FC<StartupDiscrepancyRowProps> = React.memo(
  ({
    discrepancy,
    discrepancyIndex,
    organizationId,
    projectId,
    feedback,
    isFeedbackLocked,
    onFeedbackChange,
    onFeedbackBlur,
  }) => {
    const handleChange = React.useCallback(
      (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        onFeedbackChange(discrepancyIndex, event.target.value);
      },
      [discrepancyIndex, onFeedbackChange],
    );

    return (
      <Box
        sx={{
          border: 1,
          borderColor: "divider",
          borderRadius: 1,
          p: 1.25,
        }}
      >
        <Stack spacing={1}>
          <Stack
            direction="row"
            spacing={1}
            alignItems="center"
            flexWrap="wrap"
            useFlexGap
          >
            <Chip
              size="small"
              label={discrepancy.severity}
              color={
                discrepancy.severity === "high"
                  ? "error"
                  : discrepancy.severity === "medium"
                    ? "warning"
                    : "default"
              }
            />
            <Typography component="div" variant="body2" fontWeight={600}>
              {renderInlineMentions(discrepancy.discrepancyText)}
            </Typography>
          </Stack>
          <Typography
            component="div"
            variant="body2"
            color="text.secondary"
            sx={{ mt: 0.5 }}
          >
            {renderInlineMentions(discrepancy.reasoning)}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
            Source:{" "}
            <StartupSourceReferenceInline
              sourceRef={discrepancy.sourceRef}
              organizationId={organizationId}
              projectId={projectId}
              testId={`startup-plan-discrepancy-source-${String(
                discrepancyIndex,
              )}`}
            />
            {discrepancy.sourceField ? ` (${discrepancy.sourceField})` : ""}
          </Typography>
          <InlineCommentField
            value={feedback}
            label="Discrepancy feedback (optional)"
            placeholder="Add feedback for this discrepancy. This will be sent to the agent."
            disabled={isFeedbackLocked}
            onChange={handleChange}
            onBlur={onFeedbackBlur}
            testId={`startup-plan-discrepancy-feedback-${String(
              discrepancyIndex,
            )}`}
          />
        </Stack>
      </Box>
    );
  },
);

interface StartupClarificationQuestionRowProps {
  question: StartupPlanClarificationQuestion;
  questionIndex: number;
  organizationId: string;
  projectId: string;
  answer: string;
  isFeedbackLocked: boolean;
  onAnswerChange: (questionIndex: number, answer: string) => void;
  onAnswerBlur: () => void;
}

const StartupClarificationQuestionRow: React.FC<StartupClarificationQuestionRowProps> =
  React.memo(
    ({
      question,
      questionIndex,
      organizationId,
      projectId,
      answer,
      isFeedbackLocked,
      onAnswerChange,
      onAnswerBlur,
    }) => {
      const handleChange = React.useCallback(
        (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
          onAnswerChange(questionIndex, event.target.value);
        },
        [onAnswerChange, questionIndex],
      );

      return (
        <Box
          sx={{
            border: 1,
            borderColor: "divider",
            borderRadius: 1,
            p: 1.25,
          }}
        >
          <Typography component="div" variant="body2" fontWeight={600}>
            {renderInlineMentions(question.question)}
          </Typography>
          {question.reason ? (
            <Typography
              component="div"
              variant="body2"
              color="text.secondary"
              sx={{ mt: 0.5 }}
            >
              {renderInlineMentions(question.reason)}
            </Typography>
          ) : null}
          {question.relatedSourceRefs &&
          question.relatedSourceRefs.length > 0 ? (
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ mt: 0.5 }}
            >
              Related sources:{" "}
              <StartupSourceReferenceListInline
                sourceRefs={question.relatedSourceRefs}
                organizationId={organizationId}
                projectId={projectId}
                testIdPrefix={`startup-plan-clarification-source-${String(
                  questionIndex,
                )}`}
              />
            </Typography>
          ) : null}
          <InlineCommentField
            value={answer}
            label="Clarification answer (optional)"
            placeholder="Add your answer to this question. This will be sent to the agent."
            disabled={isFeedbackLocked}
            onChange={handleChange}
            onBlur={onAnswerBlur}
            testId={`startup-plan-clarification-answer-${String(
              questionIndex,
            )}`}
            sx={{ mt: 1 }}
          />
        </Box>
      );
    },
  );

interface StartupServiceScopeSectionProps {
  review: StartupServiceScopeReview;
}

export const StartupServiceScopeSection: React.FC<
  StartupServiceScopeSectionProps
> = ({ review }) => {
  if (review.status === "loading") {
    return (
      <Alert severity="info" data-testid="startup-plan-service-scope-loading">
        {review.message}
      </Alert>
    );
  }

  if (review.status === "invalid") {
    return (
      <Alert severity="error" data-testid="startup-plan-service-scope-error">
        {review.message}
      </Alert>
    );
  }

  return (
    <Stack
      alignItems="center"
      data-testid="startup-plan-service-scope"
      direction="row"
      flexWrap="wrap"
      gap={0.75}
    >
      <Typography variant="caption" color="text.secondary">
        Required Services
      </Typography>
      <Stack
        data-testid="startup-plan-service-scope-already-selected"
        direction="row"
        flexWrap="wrap"
        gap={0.75}
      >
        {review.alreadySelected.map((service) => (
          <Chip
            data-service-id={service.id}
            data-service-state="already-selected"
            key={service.id}
            label={service.name}
            size="small"
            variant="outlined"
          />
        ))}
      </Stack>
      <Stack
        data-testid="startup-plan-service-scope-added"
        direction="row"
        flexWrap="wrap"
        gap={0.75}
      >
        {review.addedOnApproval.map((service) => (
          <Chip
            color="primary"
            data-service-id={service.id}
            data-service-state="added-by-plan"
            key={service.id}
            label={service.name}
            size="small"
          />
        ))}
      </Stack>
    </Stack>
  );
};

const StartupPlanStructuredFieldContent: React.FC<
  StartupPlanStructuredFieldContentProps
> = ({
  config,
  value,
  onChange,
  onValidityChange,
  disabled = false,
  isSubmitted,
  context,
  response,
  rootTestId,
  messageScopedRootTestId,
}) => {
  const executionStepIds = React.useMemo(
    () => response.executionPlan.map((step) => step.stepId),
    [response.executionPlan],
  );
  const discrepancyFeedback = React.useMemo(
    () => extractDiscrepancyFeedback(value, response.discrepancies.length),
    [response.discrepancies.length, value],
  );
  const stepFeedback = React.useMemo(
    () => extractStepFeedback(value, executionStepIds),
    [executionStepIds, value],
  );
  const questionAnswers = React.useMemo(
    () => extractQuestionAnswers(value, response.clarificationQuestions.length),
    [response.clarificationQuestions.length, value],
  );
  const [feedbackDraftState, setFeedbackDraftState] =
    React.useState<StartupFeedbackDraftState>(() =>
      toFeedbackDraftState({
        discrepancyFeedback,
        stepFeedback,
        questionAnswers,
      }),
    );
  const feedbackDraftStateRef =
    React.useRef<StartupFeedbackDraftState>(feedbackDraftState);

  const agentSessionQuery = useAgentSession(
    context.organizationId,
    context.projectId,
    context.agentSessionId,
  );
  const servicesQuery = useServices(context.organizationId, {
    projectId: context.projectId,
  });
  const serviceScopeReview = React.useMemo(
    () =>
      classifyStartupServiceScope({
        requiredServiceIds: response.requiredServiceIds,
        projectServices: servicesQuery.services,
        selectedServiceIds: agentSessionQuery.agentSession?.serviceIds ?? [],
        servicesReady:
          servicesQuery.isFetched === true &&
          !servicesQuery.isLoading &&
          !servicesQuery.isFetching,
        servicesError: Boolean(servicesQuery.error),
      }),
    [
      agentSessionQuery.agentSession?.serviceIds,
      response.requiredServiceIds,
      servicesQuery.error,
      servicesQuery.isFetched,
      servicesQuery.isFetching,
      servicesQuery.isLoading,
      servicesQuery.services,
    ],
  );

  const sessionProvider = isLocalRunProvider(
    agentSessionQuery.agentSession?.provider,
  )
    ? (agentSessionQuery.agentSession
        ?.provider as ConversationStartRunRequestDtoProviderEnum)
    : null;

  const existingProvider =
    isRecord(value) &&
    isLocalRunProvider((value as Record<string, unknown>).provider)
      ? ((value as Record<string, unknown>)
          .provider as ConversationStartRunRequestDtoProviderEnum)
      : undefined;
  const existingModel = isRecord(value)
    ? readOptionalString((value as Record<string, unknown>).model)
    : undefined;
  const existingEffort = isRecord(value)
    ? readOptionalString((value as Record<string, unknown>).reasoningEffort)
    : undefined;
  const existingFastMode = isRecord(value)
    ? readOptionalBoolean((value as Record<string, unknown>).fastMode)
    : undefined;

  // The approval runs on the machine the session is bound to, so that
  // machine's CLI decides which models are offered.
  const sessionMachineId = agentSessionQuery.agentSession?.machineId ?? null;
  const catalogSource = React.useMemo(
    () =>
      sessionMachineId
        ? {
            organizationId: context.organizationId,
            projectId: context.projectId,
            machineId: sessionMachineId,
          }
        : null,
    [context.organizationId, context.projectId, sessionMachineId],
  );
  const catalogState = useRuntimeModelCatalog(catalogSource);

  // Nothing is preselected until the CLI's catalog has loaded. Then the field's
  // own value wins, then what this surface remembered, then the session's
  // provider, then the catalog's default.
  const seededSelection = React.useMemo((): SurfaceSelection | null => {
    if (catalogState.status !== "ready") {
      return null;
    }
    if (
      existingProvider &&
      existingModel &&
      listModels(existingProvider).some((row) => row.id === existingModel)
    ) {
      const efforts = listEfforts(existingProvider, existingModel);
      const reasoningEffort =
        existingEffort && efforts.includes(existingEffort as ReasoningEffort)
          ? (existingEffort as ReasoningEffort)
          : efforts.includes("medium")
            ? "medium"
            : (efforts[0] ?? null);
      return {
        provider: existingProvider,
        model: existingModel,
        reasoningEffort,
        fastMode:
          supportsFastMode(existingProvider, existingModel) &&
          existingFastMode === true,
      };
    }

    const stored = readSurfaceSelection(PLAN_APPROVAL_SURFACE_ID);
    if (stored) {
      return { ...stored, fastMode: stored.fastMode ?? false };
    }

    if (sessionProvider && listModels(sessionProvider).length > 0) {
      return buildSelectionForProvider(sessionProvider);
    }
    const catalogDefault = buildDefaultSurfaceSelection();
    return catalogDefault ? { ...catalogDefault, fastMode: false } : null;
  }, [
    catalogState,
    existingEffort,
    existingFastMode,
    existingModel,
    existingProvider,
    sessionProvider,
  ]);

  const [chosenSelection, setChosenSelection] =
    React.useState<SurfaceSelection | null>(null);
  const selection = chosenSelection ?? seededSelection;
  const selectionRef = React.useRef<SurfaceSelection | null>(selection);

  // Approval waits for the Service scope and for a model to be chosen from the
  // CLI's catalog; a catalog that failed to load blocks it outright.
  const approvalValidity =
    serviceScopeReview.status !== "valid"
      ? serviceScopeReview.status
      : selection
        ? "valid"
        : catalogState.status === "error"
          ? "invalid"
          : "loading";
  React.useEffect(() => {
    onValidityChange?.(approvalValidity);
  }, [onValidityChange, approvalValidity]);

  const selectedProvider = selection?.provider ?? null;
  const selectedModel = selection?.model ?? null;
  const selectedEffort = selection?.reasoningEffort ?? null;
  const selectedFastMode = selection?.fastMode ?? false;

  const canonicalSnapshot = React.useMemo(
    () =>
      toFeedbackSnapshot({
        discrepancyFeedback,
        stepFeedback,
        questionAnswers,
        provider: existingProvider,
        model: existingModel,
        reasoningEffort: existingEffort,
        fastMode: existingFastMode,
      }),
    [
      discrepancyFeedback,
      existingEffort,
      existingFastMode,
      existingModel,
      existingProvider,
      questionAnswers,
      stepFeedback,
    ],
  );
  const latestCommittedSnapshotRef = React.useRef<string>(canonicalSnapshot);

  const isFeedbackLocked =
    disabled || isSubmitted || typeof onChange !== "function";

  React.useEffect(() => {
    feedbackDraftStateRef.current = feedbackDraftState;
  }, [feedbackDraftState]);

  React.useEffect(() => {
    latestCommittedSnapshotRef.current = canonicalSnapshot;
  }, [canonicalSnapshot]);

  React.useEffect(() => {
    selectionRef.current = selection;
  }, [selection]);

  const updateDraftState = React.useCallback(
    (
      updater: (
        previous: StartupFeedbackDraftState,
      ) => StartupFeedbackDraftState,
    ): void => {
      setFeedbackDraftState((previous) => {
        const next = updater(previous);
        feedbackDraftStateRef.current = next;
        return next;
      });
    },
    [],
  );

  const commitDraftState = React.useCallback(() => {
    if (typeof onChange !== "function") {
      return;
    }

    const nextDiscrepancyFeedback = toDiscrepancyFeedbackFromDraft(
      feedbackDraftStateRef.current.discrepancyByIndex,
      response.discrepancies.length,
    );
    const nextStepFeedback = toStepFeedbackFromDraft(
      feedbackDraftStateRef.current.stepById,
      executionStepIds,
    );
    const nextQuestionAnswers = toQuestionAnswersFromDraft(
      feedbackDraftStateRef.current.questionByIndex,
      response.clarificationQuestions.length,
    );
    // Without a selection (the CLI's catalog has not loaded) no model is sent.
    const currentSelection = selectionRef.current;
    const provider = currentSelection?.provider;
    const model = currentSelection?.model || undefined;
    const reasoningEffort = currentSelection?.reasoningEffort ?? undefined;
    const fastMode =
      currentSelection &&
      supportsFastMode(currentSelection.provider, currentSelection.model)
        ? (currentSelection.fastMode ?? false)
        : undefined;
    const nextSnapshot = toFeedbackSnapshot({
      discrepancyFeedback: nextDiscrepancyFeedback,
      stepFeedback: nextStepFeedback,
      questionAnswers: nextQuestionAnswers,
      provider,
      model,
      reasoningEffort,
      fastMode,
    });

    if (nextSnapshot === latestCommittedSnapshotRef.current) {
      return;
    }

    latestCommittedSnapshotRef.current = nextSnapshot;
    onChange(
      toStartupPlanStructuredResponseValue({
        response,
        discrepancyFeedback: nextDiscrepancyFeedback,
        stepFeedback: nextStepFeedback,
        questionAnswers: nextQuestionAnswers,
        provider,
        model,
        reasoningEffort,
        fastMode,
      }),
    );
  }, [executionStepIds, onChange, response]);

  const commitOnBlur = React.useCallback(() => {
    if (typeof onChange !== "function") {
      return;
    }

    commitDraftState();
  }, [commitDraftState, onChange]);

  // The selection seeded from per-surface memory (or the session provider) is
  // shown in the ModelSelector immediately, but commitDraftState previously
  // wrote it into the field value only on user interaction. Approving the
  // remembered model without touching the dropdowns therefore submitted no
  // model, and the run silently fell back to the SDK default (Sonnet). Commit
  // the seeded/changed selection so the displayed model always reaches the
  // submission envelope. commitDraftState reads selectionRef.current and is
  // idempotent via its snapshot guard, so re-running on selection changes
  // never double-commits or loops.
  React.useEffect(() => {
    if (isFeedbackLocked) {
      return;
    }
    commitDraftState();
  }, [selection, isFeedbackLocked, commitDraftState]);

  const handleDiscrepancyFeedbackChange = React.useCallback(
    (discrepancyIndex: number, note: string): void => {
      const currentNote =
        feedbackDraftStateRef.current.discrepancyByIndex[discrepancyIndex] ??
        "";
      if (currentNote === note) {
        return;
      }

      updateDraftState((previous) => {
        const nextDiscrepancyByIndex = { ...previous.discrepancyByIndex };
        if (note.length === 0) {
          delete nextDiscrepancyByIndex[discrepancyIndex];
        } else {
          nextDiscrepancyByIndex[discrepancyIndex] = note;
        }

        return {
          ...previous,
          discrepancyByIndex: nextDiscrepancyByIndex,
        };
      });
    },
    [updateDraftState],
  );

  const handleStepFeedbackChange = React.useCallback(
    (stepId: string, note: string): void => {
      const currentNote = feedbackDraftStateRef.current.stepById[stepId] ?? "";
      if (currentNote === note) {
        return;
      }

      updateDraftState((previous) => {
        const nextStepById = { ...previous.stepById };
        if (note.length === 0) {
          delete nextStepById[stepId];
        } else {
          nextStepById[stepId] = note;
        }

        return {
          ...previous,
          stepById: nextStepById,
        };
      });
    },
    [updateDraftState],
  );

  const handleQuestionAnswerChange = React.useCallback(
    (questionIndex: number, answer: string): void => {
      const currentAnswer =
        feedbackDraftStateRef.current.questionByIndex[questionIndex] ?? "";
      if (currentAnswer === answer) {
        return;
      }

      updateDraftState((previous) => {
        const nextQuestionByIndex = { ...previous.questionByIndex };
        if (answer.length === 0) {
          delete nextQuestionByIndex[questionIndex];
        } else {
          nextQuestionByIndex[questionIndex] = answer;
        }

        return {
          ...previous,
          questionByIndex: nextQuestionByIndex,
        };
      });
    },
    [updateDraftState],
  );

  const applySelection = React.useCallback(
    (next: SurfaceSelection) => {
      selectionRef.current = next;
      setChosenSelection(next);
      writeSurfaceSelection(PLAN_APPROVAL_SURFACE_ID, next);
      if (typeof onChange === "function") {
        commitDraftState();
      }
    },
    [commitDraftState, onChange],
  );

  const handleProviderChange = React.useCallback(
    (provider: ConversationStartRunRequestDtoProviderEnum) => {
      if (
        selectionRef.current?.provider === provider ||
        listModels(provider).length === 0
      ) {
        return;
      }
      applySelection(buildSelectionForProvider(provider));
    },
    [applySelection],
  );

  const handleModelChange = React.useCallback(
    (model: string) => {
      const current = selectionRef.current;
      if (!current || current.model === model) {
        return;
      }
      const efforts = listEfforts(current.provider, model);
      const reasoningEffort =
        current.reasoningEffort !== null &&
        efforts.includes(current.reasoningEffort)
          ? current.reasoningEffort
          : efforts.includes("medium")
            ? "medium"
            : (efforts[0] ?? null);
      applySelection({
        provider: current.provider,
        model,
        reasoningEffort,
        fastMode: supportsFastMode(current.provider, model)
          ? (current.fastMode ?? false)
          : false,
      });
    },
    [applySelection],
  );

  const handleEffortChange = React.useCallback(
    (effort: ReasoningEffort | null) => {
      const current = selectionRef.current;
      if (!current || current.reasoningEffort === effort) {
        return;
      }
      applySelection({ ...current, reasoningEffort: effort });
    },
    [applySelection],
  );

  const handleFastModeChange = React.useCallback(
    (fastMode: boolean) => {
      const current = selectionRef.current;
      if (!current || current.fastMode === fastMode) {
        return;
      }
      applySelection({ ...current, fastMode });
    },
    [applySelection],
  );

  return (
    <Box
      data-testid={rootTestId}
      data-message-id={context.messageId}
      data-registry-type={config.type}
      data-ui-element-id={config.field}
    >
      <Stack
        spacing={1.5}
        {...(messageScopedRootTestId
          ? { "data-testid": messageScopedRootTestId }
          : {})}
      >
        {context.messageId && context.messageCreatedAt ? (
          <MessageAuthorCaption
            messageId={context.messageId}
            createdAt={context.messageCreatedAt}
            messageData={context.messageData}
            renderTimestamp
            projectId={context.projectId}
          />
        ) : null}

        <Typography component="div" variant="body2">
          {renderInlineMentions(response.sessionTitle)}
        </Typography>

        <StartupServiceScopeSection review={serviceScopeReview} />

        <Stack spacing={1} data-testid="startup-plan-primary-implementations">
          <Typography variant="subtitle2" fontWeight={600}>
            Primary Implementations
          </Typography>
          <PrimaryImplementationList
            implementations={response.primaryImplementations}
            testId="startup-plan-primary-implementation-list"
          />
        </Stack>

        <Stack spacing={1} data-testid="startup-plan-execution-plan">
          <Typography variant="subtitle2" fontWeight={600}>
            Execution Plan
          </Typography>
          {response.executionPlan.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No execution steps were provided.
            </Typography>
          ) : (
            <Stack spacing={1}>
              {response.executionPlan.map((step, index) => (
                <StartupExecutionPlanRow
                  key={step.stepId}
                  step={step}
                  stepIndex={index}
                  organizationId={context.organizationId}
                  projectId={context.projectId}
                  feedback={feedbackDraftState.stepById[step.stepId] ?? ""}
                  isFeedbackLocked={isFeedbackLocked}
                  onFeedbackChange={handleStepFeedbackChange}
                  onFeedbackBlur={commitOnBlur}
                />
              ))}
            </Stack>
          )}
        </Stack>

        <Stack spacing={1} data-testid="startup-plan-discrepancies">
          <Typography variant="subtitle2" fontWeight={600}>
            Discrepancies
          </Typography>
          {response.discrepancies.length > 0 ? (
            <Stack spacing={1}>
              {response.discrepancies.map((discrepancy, discrepancyIndex) => (
                <StartupDiscrepancyRow
                  key={`${discrepancy.sourceRef.sourceId}-${String(
                    discrepancyIndex,
                  )}`}
                  discrepancy={discrepancy}
                  discrepancyIndex={discrepancyIndex}
                  organizationId={context.organizationId}
                  projectId={context.projectId}
                  feedback={
                    feedbackDraftState.discrepancyByIndex[discrepancyIndex] ??
                    ""
                  }
                  isFeedbackLocked={isFeedbackLocked}
                  onFeedbackChange={handleDiscrepancyFeedbackChange}
                  onFeedbackBlur={commitOnBlur}
                />
              ))}
            </Stack>
          ) : (
            <Typography variant="body2" color="text.secondary">
              No discrepancies were identified.
            </Typography>
          )}
        </Stack>

        <Stack spacing={1} data-testid="startup-plan-clarification-questions">
          <Typography variant="subtitle2" fontWeight={600}>
            Clarification Questions
          </Typography>
          {response.clarificationQuestions.length > 0 ? (
            <Stack spacing={1}>
              {response.clarificationQuestions.map(
                (question, questionIndex) => (
                  <StartupClarificationQuestionRow
                    key={`${question.question}-${String(questionIndex)}`}
                    question={question}
                    questionIndex={questionIndex}
                    organizationId={context.organizationId}
                    projectId={context.projectId}
                    answer={
                      feedbackDraftState.questionByIndex[questionIndex] ?? ""
                    }
                    isFeedbackLocked={isFeedbackLocked}
                    onAnswerChange={handleQuestionAnswerChange}
                    onAnswerBlur={commitOnBlur}
                  />
                ),
              )}
            </Stack>
          ) : (
            <Typography variant="body2" color="text.secondary">
              No blocking clarification questions.
            </Typography>
          )}
        </Stack>

        <Stack spacing={1} data-testid="startup-plan-model-effort">
          <Typography variant="subtitle2" fontWeight={600}>
            Model &amp; Reasoning Effort
          </Typography>
          <RuntimeModelSelector
            testIdPrefix="startup-plan"
            catalogSource={catalogSource}
            provider={selectedProvider}
            model={selectedModel}
            reasoningEffort={selectedEffort}
            fastMode={selectedFastMode}
            disabled={isFeedbackLocked}
            onProviderChange={handleProviderChange}
            onModelChange={handleModelChange}
            onReasoningEffortChange={handleEffortChange}
            onFastModeChange={handleFastModeChange}
          />
        </Stack>
        <Typography
          data-testid="startup-plan-feedback-notice"
          variant="caption"
          color="text.secondary"
        >
          Any feedback you enter below is sent to the agent, including when you
          approve.
        </Typography>
      </Stack>
    </Box>
  );
};

export const StartupPlanStructuredField: React.FC<
  StartupPlanStructuredFieldProps
> = ({
  config,
  value,
  onChange,
  onValidityChange,
  disabled = false,
  isSubmitted,
  context,
}) => {
  const response = React.useMemo(() => extractStartupPlan(value), [value]);
  const rootTestId = `startup-plan-structured-field-${config.field}`;
  const messageScopedRootTestId = context.messageId
    ? `${rootTestId}-message-${context.messageId}`
    : undefined;

  React.useEffect(() => {
    if (!response) {
      onValidityChange?.("invalid");
    }
  }, [onValidityChange, response]);

  if (!response) {
    return (
      <Alert
        severity="info"
        data-testid={`startup-plan-structured-field-empty-${config.field}`}
        data-message-id={context.messageId}
      >
        Startup plan details are unavailable.
      </Alert>
    );
  }

  return (
    <StartupPlanStructuredFieldContent
      config={config}
      value={value}
      onChange={onChange}
      onValidityChange={onValidityChange}
      disabled={disabled}
      isSubmitted={isSubmitted}
      context={context}
      response={response}
      rootTestId={rootTestId}
      messageScopedRootTestId={messageScopedRootTestId}
    />
  );
};
