import { projectFeatureListSubmission } from "./Registry/featureListSubmission";
import { zodResolver } from "@hookform/resolvers/zod";
import { Box, Stack } from "@mui/material";
import React, { useCallback, useMemo } from "react";
import { Controller, useForm, useWatch, type Resolver } from "react-hook-form";
import type { BaseSyntheticEvent } from "react";
import { z } from "zod";
import type {
  CodingPromptUserMessage,
  ReportDto,
  SecondaryActionConfig,
  UIElement,
  UIHints,
} from "../../api";
import {
  CodingPromptUserMessageNextActionEnum,
  CodingPromptUserMessageTypeEnum,
  DesignDocTemplate,
  MultipleChoiceAction,
  WorkflowReviewAction,
} from "../../api";
import { useFormTracking, useUserAction } from "../../contexts/TrackingContext";
import { useSecondaryActions } from "../../data/hooks/useSecondaryActions";
import type { ConversationMessage } from "../../types/conversation";
import { log } from "../../utils/logger";
import { SecondaryActionRenderer } from "../Conversation/SecondaryActionRenderer";
import { useConversationEvents } from "../Conversation/hooks/useConversationEvents";
import {
  createSecondActionFromAPI,
  getMessageInlineSecondaryActions,
  getUIElementInlineSecondaryActions,
} from "../Conversation/utils/conversationFormHelpers";
import { projectStartupPlanSubmission } from "./Registry/startupPlanApprovalMarkdown";
import {
  isStartupPlanStructuredResponseValue,
  type StartupPlanStructuredResponseValue,
} from "./Registry/StartupPlanStructuredField";
import type { SaveStatus } from "../SmartTextAreaCard";
import { DynamicFormButtons } from "./DynamicFormButtons";
import { FIELD_REGISTRY } from "./Registry";
import type {
  FieldComponentContext,
  FieldConfig,
  FieldValidity,
  SecondaryActionSubmitOptions,
} from "./Registry/types";
import {
  PlanGapDiscoveryNextAction,
  PlanServiceSelectionNextAction,
  PlanStageProposalNextAction,
  isFeatureListValue,
} from "./Registry/types";
import { SkeletonForm } from "./SkeletonForm";
import type { FormValue, SecondAction } from "./types";
import { useFormDefaultValues } from "./useFormDefaultValues";
import { useLocalSubmissionState } from "./useLocalSubmissionState";
import { useFormDraftAutoSave } from "./useFormDraftAutoSave";
import { useFormStateLogging } from "./useFormStateLogging";
import { getRegistryType } from "./utils";

// Re-export SecondAction for consumers who import from DynamicForm
export type { SecondAction } from "./types";

interface DynamicFormProps {
  context: FieldComponentContext;
  uiElements: UIElement[];
  inlineReports?: ReportDto[];
  isSubmitted: boolean;
  isSubmittable: boolean;
  secondActions?: SecondAction[];
  onNext: (
    data: Record<string, FormValue>,
    options?: SecondaryActionSubmitOptions,
  ) => void;
  initialData?: Record<string, FormValue>;
  disabled?: boolean;
  showSkeleton: boolean;
  conversationMessage: ConversationMessage;
  status?: SaveStatus;
  uiHints?: UIHints;
  composerResetMode?: "preserve" | "clearOnSuccess";
}

// Generate Zod schema from UIElements
const generateSchemaFromUIElements = (uiElements: UIElement[]) => {
  const schemaFields: Record<string, z.ZodTypeAny> = {};

  uiElements.forEach((uiElement) => {
    const registryType = getRegistryType(uiElement);
    let fieldSchema: z.ZodTypeAny;

    switch (registryType) {
      case "textarea":
        // Textarea now supports files, so it can be either string or object
        fieldSchema = z.union([
          z.string(),
          z.object({
            text: z.string(),
            files: z.array(z.any()),
          }),
        ]);
        break;
      case "text":
      case "select":
      case "datepicker":
        fieldSchema = z.string();
        break;
      case "currency":
      case "number":
      case "priority":
        fieldSchema = z.number();
        break;
      case "integrations":
        fieldSchema = z.any(); // Integrations field handles complex object data
        break;
      case "team_members":
        fieldSchema = z.string(); // Team members field stores JSON string
        break;
      case "initiative":
        fieldSchema = z.object({
          content: z.string(),
          organizationId: z.string(),
          projectId: z.string(),
          initiativeId: z.string(),
          conversationId: z.string(),
        });
        break;
      case "initiative_list":
        fieldSchema = z.any(); // Initiative list handles InitiativesSystemMessageData
        break;
      case "initiative_intro":
        fieldSchema = z.string();
        break;
      case "suggested_edit":
        fieldSchema = z.object({
          edits: z.array(
            z.object({
              id: z.string(),
              label: z.string(),
              originalText: z.string(),
              proposedText: z.string(),
              description: z.string().optional(),
            }),
          ),
          globalAcceptText: z.string().optional(),
          globalRejectText: z.string().optional(),
          accepted: z.boolean().optional(),
        });
        break;
      case "task_generation":
        fieldSchema = z.string(); // Task generation field stores text input
        break;
      case "task_list":
        {
          const sectionSchema = z.object({
            id: z.string(),
            key: z.string(),
            order: z.number(),
            materializedMarkdown: z.string(),
            crdtSnapshotSeq: z.number().nullable().optional(),
          });

          const taskSchema = z
            .object({
              id: z.string(),
              name: z.string(),
              sections: z.array(sectionSchema).optional(),
              organizationId: z.string(),
              initiativeId: z.string(),
              status: z.string(),
              priority: z.string().optional(),
              dueDate: z.string().optional(),
              assigneeId: z.string().optional(),
              reporterId: z.string().optional(),
              parentTaskId: z.string().optional(),
              childCounts: z
                .object({
                  total: z.number().optional(),
                  done: z.number().optional(),
                  inProgress: z.number().optional(),
                  backlog: z.number().optional(),
                })
                .optional(),
              designDocCount: z.number().optional(),
              agentSessionCount: z.number().optional(),
              createdAt: z.string().optional(),
              updatedAt: z.string().optional(),
              archivedAt: z.string().optional(),
            })
            .passthrough();

          fieldSchema = z
            .object({
              type: z.literal("TASKS"),
              flowId: z.string().optional(),
              nodeId: z.string().optional(),
              response: z.string().optional(),
              title: z.string().optional(),
              detectedIntent: z.string(),
              intentConfidence: z.number(),
              reasoning: z.string().optional(),
              generatedTaskIds: z.array(z.string()),
              tasks: z.array(taskSchema),
              uiElements: z.array(z.unknown()).optional(),
              actions: z.array(z.unknown()).optional(),
            })
            .passthrough();
        }
        break;
      case "task_stub":
        fieldSchema = z.object({
          userMessage: z.string(),
          stubReviews: z.array(
            z.object({
              stubId: z.string(),
              action: z.enum(["accept", "reject", "pending"]),
            }),
          ),
          manuallyAdded: z.array(
            z.object({
              title: z.string(),
              shortDescription: z.string(),
            }),
          ),
        });
        break;
      case "task_priority":
        fieldSchema = z.object({
          userMessage: z.string(),
        });
        break;
      case "plan_document_view":
        fieldSchema = z.object({
          entityId: z.string(),
          template: z
            .enum([
              DesignDocTemplate.PlanDocument,
              DesignDocTemplate.Brainstorm,
            ])
            .optional(),
          responseType: z.literal("plan_document_view_v1").optional(),
          userMessage: z.string().optional(),
        });
        break;
      case "coding_prompt":
        fieldSchema = z
          .object({
            userMessage: z.string(),
            type: z.literal("CODING_PROMPTS"),
            nextAction: z.string(),
            promptData: z.any().optional(),
          })
          .passthrough();
        break;
      case "question_group":
        fieldSchema = z.object({
          clarifyingAnswers: z
            .array(
              z.object({
                question: z.string(),
                answer: z.string(),
              }),
            )
            .optional(),
        });
        break;
      case "multiple_choice":
        fieldSchema = z.enum([
          MultipleChoiceAction.CreatePlan,
          MultipleChoiceAction.CreateInitiative,
        ]);
        break;
      case "goal_pm_action":
        fieldSchema = z.any();
        break;
      case "adr_context_starter":
        fieldSchema = z.string(); // ADR context starter field stores text input
        break;
      case "adr_agent_response":
        fieldSchema = z.string();
        break;
      case "agent_complete":
        fieldSchema = z.any();
        break;
      case "service_selector":
        fieldSchema = z.object({
          type: z.literal("PLAN_SERVICE_SELECTION"),
          nextAction: z.enum(["SERVICES_READY", "ANALYZE_SERVICES"]),
          services: z.array(
            z.object({
              source: z.literal("user_added"),
              kind: z.literal("existing"),
              entityType: z.literal("services"),
              entityId: z.string(),
              name: z.string(),
              description: z.string().optional(),
            }),
          ),
        });
        break;
      case "repository_grounding_intent":
        fieldSchema = z.object({
          choice: z.enum(["yes", "no"]),
        });
        break;
      case "repository_grounding":
        fieldSchema = z
          .object({
            entryMode: z.enum(["existing", "new"]),
            serviceId: z.string().nullable(),
            brief: z.string(),
            machineId: z.string().nullable(),
            scope: z.enum(["focused", "comprehensive"]).nullable(),
            focus: z.string(),
            provider: z.string().nullable(),
            model: z.string().nullable(),
            usageClass: z.string().nullable(),
            phase: z.string(),
            progress: z.number().nullable(),
            statusMessage: z.string().nullable(),
            errorMessage: z.string().nullable(),
            resultSummary: z.string().nullable(),
            nextAction: z.string().optional(),
          })
          .passthrough();
        break;
      case "plan_gaps_services":
        fieldSchema = z.object({
          type: z.literal("PLAN_GAPS"),
          nextAction: z.enum(["READY_FOR_NEXT_STEP", "CONTINUE_REVISING"]),
          gapReviews: z.array(
            z.object({
              title: z.string(),
              action: z.enum(["accept", "reject", "pending"]),
              comment: z.string().optional(),
              coverageReviews: z.array(
                z.object({
                  entityId: z.string(),
                  action: z.enum(["accept", "reject", "pending"]),
                  comment: z.string().optional(),
                }),
              ),
            }),
          ),
          manuallyAdded: z.array(
            z.object({
              source: z.literal("user_added"),
              kind: z.literal("existing"),
              entityType: z.literal("services"),
              entityId: z.string(),
              name: z.string(),
              description: z.string().optional(),
            }),
          ),
          clarifyingAnswers: z.array(
            z.object({
              question: z.string(),
              answer: z.string(),
            }),
          ),
        });
        break;
      case "plan_gaps_design_docs":
        fieldSchema = z.object({
          type: z.literal("PLAN_GAPS"),
          nextAction: z.enum(["READY_FOR_NEXT_STEP", "CONTINUE_REVISING"]),
          gapReviews: z.array(
            z.object({
              title: z.string(),
              action: z.enum(["accept", "reject", "pending"]),
              comment: z.string().optional(),
              coverageReviews: z.array(
                z.object({
                  entityId: z.string(),
                  action: z.enum(["accept", "reject", "pending"]),
                  comment: z.string().optional(),
                }),
              ),
            }),
          ),
          manuallyAdded: z.array(
            z.object({
              source: z.literal("user_added"),
              kind: z.literal("existing"),
              entityType: z.literal("design_docs"),
              entityId: z.string(),
              name: z.string(),
              description: z.string().optional(),
            }),
          ),
          clarifyingAnswers: z.array(
            z.object({
              question: z.string(),
              answer: z.string(),
            }),
          ),
        });
        break;
      case "plan_gaps_tasks":
        fieldSchema = z.object({
          type: z.literal("PLAN_GAPS"),
          nextAction: z.enum(["READY_FOR_NEXT_STEP", "CONTINUE_REVISING"]),
          gapReviews: z.array(
            z.object({
              title: z.string(),
              action: z.enum(["accept", "reject", "pending"]),
              comment: z.string().optional(),
              coverageReviews: z.array(
                z.object({
                  entityId: z.string(),
                  action: z.enum(["accept", "reject", "pending"]),
                  comment: z.string().optional(),
                }),
              ),
            }),
          ),
          manuallyAdded: z.array(
            z.discriminatedUnion("kind", [
              z.object({
                source: z.literal("user_added"),
                kind: z.literal("manual"),
                entityType: z.literal("tasks"),
                title: z.string(),
                description: z.string().optional(),
              }),
              z.object({
                source: z.literal("user_added"),
                kind: z.literal("existing"),
                entityType: z.literal("tasks"),
                entityId: z.string(),
                name: z.string(),
                description: z.string().optional(),
              }),
            ]),
          ),
          clarifyingAnswers: z.array(
            z.object({
              question: z.string(),
              answer: z.string(),
            }),
          ),
        });
        break;
      case "plan_approval":
        fieldSchema = z.object({
          type: z.literal("PLAN_APPROVAL"),
          nextAction: z.enum(["APPROVE", "CONTINUE_REVISING"]),
          userMessage: z.string(),
          description: z.object({
            approach: z.string(),
            outcome: z.string(),
            verification: z.string(),
          }),
          workstreams: z.array(
            z.object({
              id: z.string(),
              name: z.string(),
              focus: z.string(),
              isNew: z.boolean().optional(),
              isDeleted: z.boolean().optional(),
            }),
          ),
        });
        break;
      case "plan_stage_proposal":
        fieldSchema = z.object({
          type: z.literal("PLAN_STAGE_PROPOSAL"),
          nextAction: z.enum(["READY_FOR_NEXT_STEP", "CONTINUE_REVISING"]),
          userMessage: z.string(),
          stages: z.array(
            z.object({
              title: z.string(),
              description: z.string(),
              purpose: z.string(),
              timing: z.string(),
              sequenceOrder: z.number(),
              action: z.enum(["accept", "reject", "pending"]),
              comment: z.string().optional(),
            }),
          ),
          stageFeedback: z.array(
            z.object({
              sequenceOrder: z.number(),
              title: z.string(),
              action: z.enum(["accept", "reject", "pending"]),
              comment: z.string().optional(),
            }),
          ),
        });
        break;
        fieldSchema = z.object({
          type: z.literal("PLAN_STEP_PROPOSAL"),
          nextAction: z.enum(["READY_FOR_NEXT_STEP", "CONTINUE_REVISING"]),
          userMessage: z.string(),
          stages: z.array(
            z.object({
              title: z.string(),
              sequenceOrder: z.number(),
              comment: z.string().optional(),
              steps: z.array(
                z.object({
                  type: z.enum(["TASK", "DESIGN_DOC", "SERVICE", "OTHER"]),
                  title: z.string(),
                  description: z.string(),
                  sequenceOrder: z.number(),
                  comment: z.string().optional(),
                  action: z.enum(["accept", "reject", "pending"]),
                }),
              ),
            }),
          ),
          stageFeedback: z.array(
            z.object({
              sequenceOrder: z.number(),
              title: z.string(),
              comment: z.string().optional(),
            }),
          ),
          stepFeedback: z.array(
            z.object({
              stageSequenceOrder: z.number(),
              stepSequenceOrder: z.number(),
              title: z.string(),
              comment: z.string().optional(),
              action: z.enum(["accept", "reject", "pending"]),
            }),
          ),
        });
        break;
      case "agent_search_results":
        fieldSchema = z.any();
        break;
      case "feature_list":
        fieldSchema = z.object({
          type: z.literal("FEATURE_LIST"),
          generatedProposalIds: z.array(z.string()).optional(),
          narrative: z.string().optional(),
          topLevels: z.array(z.unknown()).optional(),
          refinement: z.object({
            sections: z.record(z.string(), z.string()),
            overall: z.string(),
          }),
        });
        break;
      case "plan_generation_visual_preview":
        // Display-only preview fields do not contribute user-submitted data.
        fieldSchema = z.object({}).passthrough().optional();
        break;
      default:
        fieldSchema = z.any();
    }

    if (!uiElement.required) {
      fieldSchema = fieldSchema.optional();
    }

    schemaFields[uiElement.id] = fieldSchema;
  });

  return z.object(schemaFields);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object";

const isPlanStageProposalValue = (
  value: FormValue,
): value is Record<string, unknown> & { type: "PLAN_STAGE_PROPOSAL" } =>
  isRecord(value) &&
  value.type === "PLAN_STAGE_PROPOSAL" &&
  "nextAction" in value;

const isPlanGapDiscoveryValue = (
  value: FormValue,
): value is Record<string, unknown> & { type: "PLAN_GAPS" } =>
  isRecord(value) && value.type === "PLAN_GAPS" && "nextAction" in value;

const isPlanServiceSelectionValue = (
  value: FormValue,
): value is Record<string, unknown> & { type: "PLAN_SERVICE_SELECTION" } =>
  isRecord(value) &&
  value.type === "PLAN_SERVICE_SELECTION" &&
  "nextAction" in value;

const isStartupPlanFieldValue = (
  value: FormValue,
): value is StartupPlanStructuredResponseValue =>
  isStartupPlanStructuredResponseValue(value);

const isCodingPromptFormValue = (
  value: FormValue,
): value is CodingPromptUserMessage =>
  isRecord(value) &&
  typeof value.userMessage === "string" &&
  typeof value.type === "string" &&
  typeof value.nextAction === "string";

const applySubmissionValueShaping = (
  values: Record<string, FormValue>,
): Record<string, FormValue> => {
  const updated = { ...values };

  return updated;
};

export const applyPrimaryNextActionOverrides = (
  values: Record<string, FormValue>,
  options?: SecondaryActionSubmitOptions,
): Record<string, FormValue> => {
  if (options?.handler) {
    return values;
  }

  const updated = { ...values };

  Object.entries(updated).forEach(([key, value]) => {
    if (isPlanStageProposalValue(value)) {
      updated[key] = {
        ...value,
        nextAction: PlanStageProposalNextAction.ReadyForNextStep,
      };
      return;
    }

    if (isPlanGapDiscoveryValue(value)) {
      updated[key] = {
        ...value,
        nextAction: PlanGapDiscoveryNextAction.ReadyForNextStep,
      };
      return;
    }

    if (isPlanServiceSelectionValue(value)) {
      updated[key] = {
        ...value,
        nextAction: PlanServiceSelectionNextAction.ServicesReady,
      };
      return;
    }

    if (isStartupPlanFieldValue(value)) {
      const projection = projectStartupPlanSubmission(
        value,
        WorkflowReviewAction.Approved,
      );
      updated[key] = projection.value;
      if (projection.comment) {
        updated.comment = projection.comment;
      }
      return;
    }

    if (isFeatureListValue(value)) {
      updated[key] = projectFeatureListSubmission(value, "APPROVED");
      return;
    }
  });

  return updated;
};

export const DynamicForm: React.FC<DynamicFormProps> = ({
  context,
  conversationMessage,
  uiElements: baseUiElements,
  inlineReports,
  onNext,
  secondActions,
  isSubmitted,
  isSubmittable,
  initialData,
  disabled,
  status = "draft",
  showSkeleton,
  uiHints,
  composerResetMode = "preserve",
}) => {
  const { on } = useConversationEvents(context.conversationId);
  const uiElements = React.useMemo(
    () => baseUiElements.filter(Boolean),
    [baseUiElements],
  );

  // Resolve dynamic secondary actions config from registry entries.
  // Uses first-match-wins: if multiple fields declare dynamicSecondaryActions,
  // only the first one's config is used for the API query.
  const dynamicActionsConfig = useMemo(() => {
    for (const el of uiElements) {
      const type = getRegistryType(el);
      const entry = type ? FIELD_REGISTRY[type] : undefined;
      if (entry?.dynamicSecondaryActions) {
        return entry.dynamicSecondaryActions;
      }
    }
    return undefined;
  }, [uiElements]);

  const dynamicActions = useSecondaryActions(
    context.organizationId,
    dynamicActionsConfig?.uiElement,
    {
      enabled: !!dynamicActionsConfig,
      actionHint: dynamicActionsConfig?.actionHint,
    },
  );

  // Initialize form tracking
  const formName = `dynamic-form-${uiElements.length}-fields`;
  const { trackFormStart, trackSubmitSuccess } = useFormTracking(formName);
  const { trackUI } = useUserAction();

  // Storage key for localStorage
  const storageKey = `form-draft-${context.projectId}-${context.conversationId}`;

  // Load persisted data from localStorage synchronously on mount
  const getPersistedValues = React.useCallback(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const parsed = JSON.parse(stored);
        return parsed.values || {};
      }
    } catch (error) {
      console.error("Failed to load form draft:", error);
    }
    return {};
  }, [storageKey]);

  // Component mount logging
  React.useEffect(() => {
    const fieldTypes = uiElements.map((el) => getRegistryType(el));
    const requiredFields = uiElements
      .filter((el) => el.required)
      .map((el) => el.id);

    log.info("dynamic_form", "DynamicForm mounted", {
      context,
      fieldCount: uiElements.length,
      fieldTypes,
      requiredFields,
      hasSecondActions: secondActions && secondActions.length > 0,
      secondActionCount: secondActions?.length ?? 0,
      isSubmitted,
      disabled,
      status,
      hasInitialData: !!initialData,
      initialDataKeys: initialData ? Object.keys(initialData) : [],
    });

    return () => {
      log.info("dynamic_form", "DynamicForm unmounting", {
        conversationId: context.conversationId,
        fieldCount: uiElements.length,
      });
    };
  }, [
    context,
    uiElements,
    secondActions,
    isSubmitted,
    disabled,
    status,
    initialData,
  ]);

  // Generate schema and default values from UIElements
  const schema = React.useMemo(
    () => generateSchemaFromUIElements(uiElements),
    [uiElements],
  );
  const resolverRef = React.useRef<Resolver<Record<string, FormValue>>>(
    zodResolver(schema),
  );
  React.useEffect(() => {
    resolverRef.current = zodResolver(schema);
  }, [schema]);
  const resolver = React.useCallback<Resolver<Record<string, FormValue>>>(
    (values, context, options) => resolverRef.current(values, context, options),
    [],
  );
  const defaultValues = useFormDefaultValues({
    uiElements,
    isSubmitted: isSubmitted ?? false,
    initialData,
    getPersistedValues,
  });

  const {
    control,
    handleSubmit,
    watch,
    reset,
    getValues,
    setValue,
    formState: { isSubmitting },
  } = useForm({
    resolver,
    defaultValues,
    mode: "onChange",
  });

  // Local submission state for immediate UI feedback
  const { effectiveIsSubmitted, setHasLocallySubmitted } =
    useLocalSubmissionState({
      isSubmitted,
      conversationId: context.conversationId,
    });

  const [hasSecondaryActionInFlight, setHasSecondaryActionInFlight] =
    React.useState(false);
  const secondaryActionInFlightRef = React.useRef(false);
  const [fieldValidity, setFieldValidity] = React.useState<
    Record<string, FieldValidity>
  >({});

  const handleFieldValidityChange = React.useCallback(
    (fieldId: string, validity: FieldValidity) => {
      setFieldValidity((previous) =>
        previous[fieldId] === validity
          ? previous
          : { ...previous, [fieldId]: validity },
      );
    },
    [],
  );

  React.useEffect(() => {
    setFieldValidity((previous) => {
      const next: Record<string, FieldValidity> = {};
      uiElements.forEach((uiElement) => {
        next[uiElement.id] = previous[uiElement.id] ?? "valid";
      });

      const previousIds = Object.keys(previous);
      const nextIds = Object.keys(next);
      const unchanged =
        previousIds.length === nextIds.length &&
        nextIds.every((fieldId) => previous[fieldId] === next[fieldId]);

      return unchanged ? previous : next;
    });
  }, [uiElements]);

  const hasUnresolvedFieldValidity = Object.values(fieldValidity).some(
    (validity) => validity !== "valid",
  );

  React.useEffect(() => {
    const unsubscribeError = on("submission-error", () => {
      secondaryActionInFlightRef.current = false;
      setHasSecondaryActionInFlight(false);
    });
    const unsubscribeSuccess = on("submission-success", () => {
      secondaryActionInFlightRef.current = false;
      setHasSecondaryActionInFlight(false);
    });
    return () => {
      unsubscribeError();
      unsubscribeSuccess();
    };
  }, [on]);

  // Auto-save to localStorage with debouncing and guards
  const { saveToLocalStorage, saveTimeoutRef } = useFormDraftAutoSave({
    storageKey,
    isSubmitted: effectiveIsSubmitted,
    disabled: disabled ?? false,
  });

  React.useEffect(() => {
    reset(defaultValues, { keepDirtyValues: true, keepDefaultValues: true });
  }, [defaultValues, reset]);

  React.useEffect(() => {
    const unsubscribeSuccess = on("submission-success", (event) => {
      if (event.type !== "submission-success") {
        return;
      }

      const targetMessageId = conversationMessage.message.id;
      const eventMessageId = event.payload.messageId;
      const matchesSubmittedMessage = eventMessageId === targetMessageId;

      log.info("dynamic_form", "Received submission-success event", {
        conversationId: context.conversationId,
        eventMessageId,
        targetMessageId,
        matchesSubmittedMessage,
      });

      if (!matchesSubmittedMessage) {
        return;
      }

      try {
        localStorage.removeItem(storageKey);
      } catch (error) {
        console.error("Failed to clear form draft:", error);
      }

      if (composerResetMode !== "clearOnSuccess") {
        return;
      }

      log.info("dynamic_form", "Clearing composer on submission success", {
        conversationId: context.conversationId,
        messageId: eventMessageId,
        fieldCount: uiElements.length,
      });

      const clearedFieldIds: string[] = [];
      uiElements.forEach((uiElement) => {
        const registryType = getRegistryType(uiElement);
        if (registryType === "textarea" || registryType === "text") {
          setValue(uiElement.id, "");
          clearedFieldIds.push(uiElement.id);
          return;
        }

        if (registryType === "coding_prompt") {
          const currentValue = getValues(uiElement.id);
          const clearedValue: CodingPromptUserMessage = isCodingPromptFormValue(
            currentValue,
          )
            ? {
                ...currentValue,
                userMessage: "",
              }
            : {
                type: CodingPromptUserMessageTypeEnum.CodingPrompts,
                nextAction: CodingPromptUserMessageNextActionEnum.Accept,
                userMessage: "",
                serviceId: undefined,
                selectedHintIds: [],
              };

          setValue(uiElement.id, clearedValue);
          clearedFieldIds.push(uiElement.id);
        }
      });

      log.info("dynamic_form", "Composer clear applied", {
        conversationId: context.conversationId,
        messageId: eventMessageId,
        clearedFieldIds,
        registryTypes: uiElements.map((uiElement) =>
          getRegistryType(uiElement),
        ),
      });
    });

    return () => {
      unsubscribeSuccess();
    };
  }, [
    composerResetMode,
    context.conversationId,
    conversationMessage.message.id,
    getValues,
    on,
    setValue,
    uiElements,
  ]);

  // Watch all form values to determine if any content has been entered
  const watchedValues = watch();
  const lastUiElement = uiElements[uiElements.length - 1];
  const watchedLastElementValue = useWatch({
    control,
    name: lastUiElement?.id ?? "__unused_last_field__",
  });

  // Auto-save to localStorage via watch subscription to avoid effect work on each rerender.
  React.useEffect(() => {
    const subscription = watch((nextValues) => {
      saveToLocalStorage(nextValues as Record<string, FormValue>);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [saveToLocalStorage, watch]);

  const hasContent = React.useMemo(() => {
    if (!lastUiElement) {
      return false;
    }

    const registryType = getRegistryType(lastUiElement);
    const entry = registryType ? FIELD_REGISTRY[registryType] : undefined;
    if (!entry) {
      return false;
    }

    return entry.getHasContent(watchedLastElementValue);
  }, [lastUiElement, watchedLastElementValue]);
  const showButtons = React.useMemo(() => {
    if (!lastUiElement) {
      return true;
    }

    const registryType = getRegistryType(lastUiElement);
    const entry = registryType ? FIELD_REGISTRY[registryType] : undefined;
    if (!entry?.shouldShowButtons) {
      return true;
    }

    return entry.shouldShowButtons(watchedLastElementValue);
  }, [lastUiElement, watchedLastElementValue]);

  // Form state logging
  useFormStateLogging({
    watchedValues,
    hasContent,
    isSubmitting,
    disabled: disabled ?? false,
    status,
    uiElements,
    conversationId: context.conversationId,
  });

  // Track form start when component mounts
  React.useEffect(() => {
    if (!effectiveIsSubmitted && !disabled) {
      trackFormStart();
    }
  }, [trackFormStart, effectiveIsSubmitted, disabled]);

  // Enhanced onNext with tracking
  const submitPayload = useCallback(
    (
      data: Record<string, FormValue>,
      options?: SecondaryActionSubmitOptions,
    ) => {
      const payload = applySubmissionValueShaping(
        applyPrimaryNextActionOverrides(data, options),
      );
      // Set local state IMMEDIATELY for instant UI feedback
      setHasLocallySubmitted(true);

      log.info("dynamic_form", "Form submission attempted", {
        conversationId: context.conversationId,
        fieldCount: Object.keys(payload).length,
        submittedData: Object.keys(payload).reduce(
          (acc, key) => {
            const value = payload[key];
            if (typeof value === "string") {
              acc[key] =
                value.length > 100 ? `${value.substring(0, 100)}...` : value;
            } else if (typeof value === "object" && value !== null) {
              acc[key] = `object with ${Object.keys(value).length} keys`;
            } else {
              acc[key] = value;
            }
            return acc;
          },
          {} as Record<string, unknown>,
        ),
      });

      // Track successful form submission
      const fieldCount = Object.keys(payload).length;
      const filledFields = Object.values(payload).filter(
        (value) => value !== undefined && value !== null && value !== "",
      ).length;
      const completionRate = Math.round((filledFields / fieldCount) * 100);

      log.info("dynamic_form", "Form submission success", {
        conversationId: context.conversationId,
        completionRate,
        filledFields,
        totalFields: fieldCount,
      });

      trackSubmitSuccess(completionRate);

      // Track initiative creation if this form contains initiative data
      const hasInitiativeField = uiElements.some(
        (el) => getRegistryType(el) === "initiative",
      );
      if (hasInitiativeField) {
        log.info("dynamic_form", "Initiative form submission", {
          conversationId: context.conversationId,
        });
        trackUI("button_click", {
          elementType: "initiative_form",
          elementText: "create_initiative",
        });
      }

      // Track Next button click
      trackUI("button_click", {
        elementType: "form_navigation",
        elementText: "next",
      });

      onNext(payload, options);
    },
    [
      onNext,
      trackSubmitSuccess,
      trackUI,
      uiElements,
      context.conversationId,
      storageKey,
      setHasLocallySubmitted,
    ],
  );

  const handleSubmitNext = useCallback(
    (data: Record<string, FormValue>, _event?: BaseSyntheticEvent) => {
      if (hasUnresolvedFieldValidity) {
        return;
      }

      submitPayload(data);
    },
    [hasUnresolvedFieldValidity, submitPayload],
  );

  const handleSecondaryActionNext = useCallback(
    (
      data: Record<string, FormValue>,
      _messageId: string,
      options?: SecondaryActionSubmitOptions,
    ) => {
      submitPayload(data, options);
    },
    [submitPayload],
  );

  const handleFooterSecondActionExecute = React.useCallback(
    (action: SecondAction, formValues: Record<string, FormValue>) => {
      if (secondaryActionInFlightRef.current) {
        return;
      }

      secondaryActionInFlightRef.current = true;
      if (action.submitsForm) {
        setHasLocallySubmitted(true);
      }
      setHasSecondaryActionInFlight(true);
      action.onExecute(formValues);
    },
    [setHasLocallySubmitted],
  );

  // Cleanup on unmount - save any pending changes
  React.useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        // Force immediate save on unmount
        try {
          localStorage.setItem(
            storageKey,
            JSON.stringify({
              values: watch(),
              savedAt: new Date().toISOString(),
            }),
          );
        } catch (error) {
          console.error("Failed to save form draft on unmount:", error);
        }
      }
    };
  }, [storageKey, watch]);

  // Get inline secondary actions to render before form fields
  // Only render for the current message awaiting response (not old messages)
  const messageInlineActions = useMemo(
    () =>
      conversationMessage.message.type === "SYSTEM" &&
      conversationMessage.message.awaitingResponse
        ? getMessageInlineSecondaryActions(
            conversationMessage.message.data as {
              secondaryActions?: SecondaryActionConfig[];
            },
            conversationMessage.message.id,
            trackUI,
            handleSecondaryActionNext,
            context,
          )
        : ([] as SecondaryActionConfig[]),
    [conversationMessage.message, trackUI, handleSecondaryActionNext, context],
  );

  // Split dynamic actions by presentation type
  const { dynamicInlineActions, dynamicButtonActions } = useMemo(() => {
    const inline: SecondaryActionConfig[] = [];
    const button: SecondaryActionConfig[] = [];
    for (const action of dynamicActions.actions) {
      if (action.presentation === "INLINE") {
        inline.push(action);
      } else {
        button.push(action);
      }
    }
    return { dynamicInlineActions: inline, dynamicButtonActions: button };
  }, [dynamicActions.actions]);

  // Merge INLINE dynamic actions into the inline actions list
  const allInlineActions = useMemo(() => {
    if (!dynamicInlineActions.length) return messageInlineActions;
    return [...messageInlineActions, ...dynamicInlineActions];
  }, [messageInlineActions, dynamicInlineActions]);

  // Convert BUTTON dynamic actions to SecondAction objects for the footer
  const allButtonActions = useMemo(() => {
    if (!dynamicButtonActions.length) return secondActions ?? [];
    const converted = dynamicButtonActions
      .filter((a) => !!a.handler)
      .map((a) =>
        createSecondActionFromAPI(
          a,
          context,
          trackUI,
          conversationMessage.message.id,
          handleSecondaryActionNext,
          uiElements,
        ),
      );
    return [...(secondActions ?? []), ...converted];
  }, [
    dynamicButtonActions,
    secondActions,
    context,
    trackUI,
    conversationMessage.message.id,
    handleSecondaryActionNext,
    uiElements,
  ]);

  return (
    <Box
      component="form"
      onSubmit={handleSubmit(handleSubmitNext)}
      data-testid="dynamic-form"
    >
      <Stack spacing={3}>
        {allInlineActions.length > 0 && (
          <Box sx={{ mb: 2 }}>
            {allInlineActions.map((action) => (
              <SecondaryActionRenderer
                key={action.id}
                action={action}
                context={context}
                messageId={conversationMessage.message.id}
                trackUI={trackUI}
                handleNext={handleSecondaryActionNext}
                formValues={watchedValues}
                isSubmissionLocked={
                  Boolean(isSubmitting) || hasSecondaryActionInFlight
                }
                uiElements={uiElements}
              />
            ))}
          </Box>
        )}

        {uiElements.map((uiElement) => {
          const registryType = getRegistryType(uiElement);
          const registryEntry = registryType
            ? FIELD_REGISTRY[registryType]
            : undefined;
          const FieldComponent = registryEntry?.Component;

          if (!FieldComponent) {
            console.warn(`Unknown field type: ${registryType}`);
            return null;
          }

          const showSubmitted =
            effectiveIsSubmitted && !["integrations"].includes(registryType);

          const uiElementInlineActions = getUIElementInlineSecondaryActions(
            uiElement,
            conversationMessage.message.id,
            trackUI,
            handleSecondaryActionNext,
            context,
          );

          const fieldSubmitAction = registryEntry?.fieldSubmitHandler
            ? allButtonActions.find(
                (action) =>
                  action.handler === registryEntry.fieldSubmitHandler &&
                  action.fieldId === uiElement.id,
              )
            : undefined;
          const onFieldSubmit = fieldSubmitAction
            ? () => {
                if (
                  disabled ||
                  effectiveIsSubmitted ||
                  isSubmitting ||
                  hasUnresolvedFieldValidity ||
                  hasSecondaryActionInFlight ||
                  secondaryActionInFlightRef.current ||
                  fieldSubmitAction.disabled ||
                  fieldSubmitAction.getAvailability?.(watchedValues).disabled
                ) {
                  return;
                }

                handleFooterSecondActionExecute(
                  fieldSubmitAction,
                  watchedValues,
                );
              }
            : undefined;

          // Create compatible config for field component
          const fieldConfig: FieldConfig = {
            field: uiElement.id,
            description: uiElement.label,
            type: registryType,
            required: uiElement.required || false,
            placeholder: uiElement.placeholder || undefined,
            options:
              uiElement.options?.map((opt) => opt.label || opt.value || "") ||
              undefined,
            selectOptions:
              registryType === "select" ? uiElement.options : undefined,
            secondaryAction: uiElement.secondaryAction,
            payload: uiElement.payload,
          };

          const inlineActions =
            uiElementInlineActions.length > 0 ? (
              <Box
                sx={registryType === "verify_feature" ? { mt: 2 } : { mb: 2 }}
              >
                {uiElementInlineActions.map((action) => (
                  <SecondaryActionRenderer
                    key={action.id}
                    action={action}
                    context={context}
                    messageId={conversationMessage.message.id}
                    trackUI={trackUI}
                    handleNext={handleSecondaryActionNext}
                    formValues={watchedValues}
                    isSubmissionLocked={
                      Boolean(isSubmitting) || hasSecondaryActionInFlight
                    }
                    uiElements={uiElements}
                  />
                ))}
              </Box>
            ) : null;

          const fieldElement = (
            <Controller
              name={uiElement.id}
              control={control}
              render={({
                field: { onChange, value },
                fieldState: { error },
              }) => {
                return (
                  <Box
                    data-testid={`dynamic-form-field-${uiElement.id}`}
                    data-registry-type={registryType}
                    data-message-id={conversationMessage.message.id}
                    data-ui-element-id={uiElement.id}
                    sx={
                      showSubmitted
                        ? {
                            borderRadius: "var(--mui-shape-borderRadius)",
                          }
                        : {}
                    }
                  >
                    <Box
                      data-testid={`registry-field-root-${registryType}-${uiElement.id}`}
                      data-message-id={conversationMessage.message.id}
                      data-registry-type={registryType}
                      data-ui-element-id={uiElement.id}
                    >
                      <Box
                        data-testid={`registry-field-root-message-${conversationMessage.message.id}-${registryType}-${uiElement.id}`}
                        data-message-id={conversationMessage.message.id}
                        data-registry-type={registryType}
                        data-ui-element-id={uiElement.id}
                        sx={
                          registryType === "verify_feature"
                            ? {
                                border: "1px solid",
                                borderColor: "divider",
                                borderRadius: 1,
                                p: 2,
                                mt: 1,
                                backgroundColor: "transparent",
                              }
                            : undefined
                        }
                      >
                        <FieldComponent
                          context={context}
                          config={fieldConfig}
                          conversationMessage={conversationMessage}
                          inlineReports={inlineReports}
                          value={value}
                          onChange={disabled ? () => {} : onChange}
                          error={error?.message}
                          disabled={disabled}
                          isSubmitted={effectiveIsSubmitted}
                          status={status}
                          isSubmittable={isSubmittable}
                          onSubmit={onFieldSubmit}
                          onSubmitValue={(value) => {
                            if (
                              disabled ||
                              effectiveIsSubmitted ||
                              isSubmitting ||
                              hasUnresolvedFieldValidity ||
                              hasSecondaryActionInFlight ||
                              secondaryActionInFlightRef.current
                            ) {
                              return;
                            }

                            submitPayload({
                              ...getValues(),
                              [uiElement.id]: value,
                            });
                          }}
                          onValidityChange={(validity) =>
                            handleFieldValidityChange(uiElement.id, validity)
                          }
                        />
                        {registryType === "verify_feature"
                          ? inlineActions
                          : null}
                      </Box>
                    </Box>
                  </Box>
                );
              }}
            />
          );

          return (
            <React.Fragment key={uiElement.id}>
              {registryType === "verify_feature" ? fieldElement : inlineActions}
              {registryType === "verify_feature" ? null : fieldElement}
            </React.Fragment>
          );
        })}

        {showSkeleton && (
          <SkeletonForm
            deliveredElementCount={uiElements.length}
            {...(uiHints
              ? { uiHints }
              : {
                  uiHints: {
                    expectedElements: [
                      {
                        type: "textarea",
                        count: 3,
                      },
                    ],
                    estimatedCount: 3,
                    layoutHint: "form",
                  },
                })}
          />
        )}

        <DynamicFormButtons
          uiElements={uiElements}
          secondActions={allButtonActions}
          onSecondActionExecute={handleFooterSecondActionExecute}
          hasContent={hasContent}
          isSubmitted={effectiveIsSubmitted}
          isSubmitting={isSubmitting}
          disabled={disabled || hasUnresolvedFieldValidity}
          showSkeleton={showSkeleton}
          formValues={watchedValues}
          showButtons={showButtons}
          hasSecondaryActionInFlight={hasSecondaryActionInFlight}
        />
      </Stack>
    </Box>
  );
};
