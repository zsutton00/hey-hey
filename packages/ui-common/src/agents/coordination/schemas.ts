import { z } from "zod";
import {
  CreateImplementationHintDtoSourceTypeEnum,
  DesignDocSectionUpdateSource,
  EvidenceItemSourceEnum,
  EvidenceItemTypeEnum,
  TaskSectionUpdateSource,
  WorkStatus,
} from "../../api";
import type {
  ChildTaskDescriptionUpdateResponse,
  FinalAssessmentResponse,
  SetSplittingResponse,
  StartupSessionPlanResponse,
  VerificationPlanResponse,
} from "./types";

const evidenceItemTypeSchema = z.nativeEnum(EvidenceItemTypeEnum);

const startupSourceTypeSchema = z.enum([
  "evidenceItem",
  "task",
  "designDoc",
  "plan",
  "initiative",
]);

const startupSourceRefSchema = z.object({
  sourceType: startupSourceTypeSchema,
  sourceId: z.string().min(1),
});

const startupPlanReferenceSchema = z.object({
  sourceType: startupSourceTypeSchema,
  sourceId: z.string().min(1),
  rationale: z.string().min(1),
});

const startupPlanStepSchema = z.object({
  stepId: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  targetFiles: z.array(z.string().min(1)).optional(),
  references: z.array(startupPlanReferenceSchema),
  phase: z.number().int().min(1),
});

const startupPrimaryImplementationConnectionSchema = z.object({
  entityType: z.enum(["workflowStep", "contract"]),
  entityId: z.string().uuid(),
  entityTitle: z.string().min(1),
  relationship: z.enum(["fulfills", "authors", "enforces", "consumes"]),
  sourceField: z.string().min(1),
  sourceExcerpt: z.string().min(1),
  rationale: z.string().min(1),
});

const startupPrimaryImplementationSchema = z.object({
  title: z.string().min(1),
  content: z.string().min(1),
  rationale: z.string().min(1),
  location: z.string().min(1).optional(),
  language: z.string().min(1).optional(),
  connections: z
    .array(startupPrimaryImplementationConnectionSchema)
    .min(1)
    .optional(),
});

const startupDiscrepancySchema = z.object({
  sourceRef: startupSourceRefSchema,
  sourceField: z.string().min(1).optional(),
  sourceExcerpt: z.string().min(1),
  reasoning: z.string().min(1),
  discrepancyText: z.string().min(1),
  severity: z.enum(["low", "medium", "high"]),
});

const startupClarificationQuestionSchema = z.object({
  question: z.string().min(1),
  reason: z.string().min(1).optional(),
  relatedSourceRefs: z.array(startupSourceRefSchema).optional(),
});

const startupRequiredServiceIdsSchema = z
  .array(z.string().min(1))
  .min(1)
  .refine((serviceIds) => new Set(serviceIds).size === serviceIds.length, {
    message: "requiredServiceIds must contain unique Service IDs",
  })
  .transform((serviceIds) => new Set(serviceIds));

export const startupEvidenceItemSchema = z.object({
  id: z.string().min(1),
  type: evidenceItemTypeSchema,
  title: z.string().min(1).optional(),
  content: z.string().min(1).optional(),
  topologySummary: z.string().min(1).optional(),
  score: z.number().finite().optional(),
  source: z.nativeEnum(EvidenceItemSourceEnum).optional(),
});

export const startupSessionPlanResponseSchema = z.object({
  responseType: z.literal("startup_plan_v1"),
  sessionTitle: z.string().min(1),
  requiredServiceIds: startupRequiredServiceIdsSchema,
  primaryImplementations: z.array(startupPrimaryImplementationSchema).min(1),
  executionPlan: z.array(startupPlanStepSchema),
  discrepancies: z.array(startupDiscrepancySchema),
  clarificationQuestions: z.array(startupClarificationQuestionSchema),
});

const finalAssessmentSourceTypeSchema = z.enum([
  "evidenceItem",
  "task",
  "designDoc",
  "plan",
  "initiative",
  "sessionOutput",
]);

const finalAssessmentSourceRefSchema = z.object({
  sourceType: finalAssessmentSourceTypeSchema,
  sourceId: z.string().min(1),
});

const finalTaskTargetSchema = z.object({
  entityType: z.literal("task"),
  entityId: z.string(),
});

const finalDesignDocTargetSchema = z.object({
  entityType: z.literal("designDoc"),
  entityId: z.string(),
});

const finalImplementationHintTargetSchema = z.object({
  entityType: z.literal("implementationHint"),
  entityId: z.string(),
});

const finalEvidenceItemTargetSchema = z.object({
  entityType: z.literal("evidenceItem"),
  entityId: z.string(),
});

const finalValidationRecommendationTargetOptionalFieldsSchema = z.object({
  filePath: z.string().min(1).optional(),
  serviceId: z.string().min(1).optional(),
  endpoint: z.string().min(1).optional(),
  uiFlow: z.string().min(1).optional(),
});

const finalValidationRecommendationTargetSchema = z.union([
  finalValidationRecommendationTargetOptionalFieldsSchema.extend({
    filePath: z.string().min(1),
  }),
  finalValidationRecommendationTargetOptionalFieldsSchema.extend({
    serviceId: z.string().min(1),
  }),
  finalValidationRecommendationTargetOptionalFieldsSchema.extend({
    endpoint: z.string().min(1),
  }),
  finalValidationRecommendationTargetOptionalFieldsSchema.extend({
    uiFlow: z.string().min(1),
  }),
]);

const finalValidationRecommendationFileReferenceSchema = z
  .object({
    filePath: z.string().min(1),
    startLine: z.number().int().min(1),
    endLine: z.number().int().min(1),
  })
  .refine((value) => value.endLine >= value.startLine, {
    message:
      "fileReferences.endLine must be greater than or equal to startLine",
    path: ["endLine"],
  });

const finalValidationRecommendationSchema = z
  .object({
    stepId: z.string().min(1),
    title: z.string().min(1),
    stepDescription: z.string().min(1),
    target: finalValidationRecommendationTargetSchema,
    preconditions: z.array(z.string().min(1)),
    expectedResult: z.string().min(1),
    executionType: z.enum(["manual", "automated"]),
    estimatedEffort: z.number().int().min(1),
    confidence: z.number().min(0).max(1),
    fileReferences: z
      .array(finalValidationRecommendationFileReferenceSchema)
      .optional(),
  })
  .transform((recommendation) => ({
    ...recommendation,
    provenance: {
      sessionId: "",
      agentResponseId: "",
    },
  }));

const finalAssessmentResponseSchema = z.object({
  responseType: z.literal("final_assessment_v2"),
  taskAssessment: z.object({
    target: finalTaskTargetSchema,
    verdict: z.enum([
      "completed",
      "partiallyCompleted",
      "blocked",
      "notCompleted",
      "unknown",
    ]),
    statusRecommendation: z.object({
      status: z.nativeEnum(WorkStatus),
      reason: z.string().min(1),
    }),
    summary: z.string().min(1),
  }),
  implementationNotes: z.string().min(1).optional(),
  artifactUpdateSuggestions: z.array(
    z.discriminatedUnion("updateType", [
      z.object({
        target: finalTaskTargetSchema,
        updateType: z.literal("task_status"),
        updatePayload: z.object({
          status: z.nativeEnum(WorkStatus),
          sectionUpdateSource: z.nativeEnum(TaskSectionUpdateSource).optional(),
        }),
        reasoning: z.string().min(1),
        sourceRefs: z.array(finalAssessmentSourceRefSchema),
      }),
      z.object({
        target: finalTaskTargetSchema,
        updateType: z.literal("task_details"),
        updatePayload: z
          .object({
            description: z.string().min(1).optional(),
            acceptanceCriteria: z.string().min(1).optional(),
          })
          .refine(
            (value) =>
              typeof value.description === "string" ||
              typeof value.acceptanceCriteria === "string",
            {
              message:
                "task_details updatePayload must include description or acceptanceCriteria",
            }
          ),
        reasoning: z.string().min(1),
        sourceRefs: z.array(finalAssessmentSourceRefSchema),
      }),
      z.object({
        target: finalTaskTargetSchema,
        updateType: z.literal("task_acceptance_criteria"),
        updatePayload: z.object({
          acceptanceCriteria: z.string().min(1),
        }),
        reasoning: z.string().min(1),
        sourceRefs: z.array(finalAssessmentSourceRefSchema),
      }),
      z.object({
        target: finalDesignDocTargetSchema,
        updateType: z.literal("design_doc_revision"),
        updatePayload: z.object({
          status: z.string().min(1).optional(),
          summary: z.string().nullable().optional(),
          sections: z
            .array(
              z.object({
                id: z.string().min(1).optional(),
                key: z.string().min(1),
                order: z.number().int().nullable(),
                content: z.string().optional(),
              })
            )
            .optional(),
          sectionUpdateSource: z
            .nativeEnum(DesignDocSectionUpdateSource)
            .optional(),
        }),
        reasoning: z.string().min(1),
        sourceRefs: z.array(finalAssessmentSourceRefSchema),
      }),
      z.object({
        target: finalImplementationHintTargetSchema,
        updateType: z.literal("implementation_hint_create"),
        updatePayload: z.object({
          featureName: z.string().min(1),
          description: z.string().min(1),
          sourceType: z.nativeEnum(CreateImplementationHintDtoSourceTypeEnum),
          agentSessionIds: z.array(z.string().min(1)).optional(),
        }),
        reasoning: z.string().min(1),
        sourceRefs: z.array(finalAssessmentSourceRefSchema),
      }),
      z.object({
        target: finalImplementationHintTargetSchema,
        updateType: z.literal("implementation_hint_update"),
        updatePayload: z
          .object({
            featureName: z.string().min(1).optional(),
            description: z.string().min(1).optional(),
            sourceType: z
              .nativeEnum(CreateImplementationHintDtoSourceTypeEnum)
              .optional(),
            agentSessionIds: z.array(z.string().min(1)).optional(),
          })
          .refine(
            (value) =>
              typeof value.featureName === "string" ||
              typeof value.description === "string" ||
              typeof value.sourceType === "string" ||
              Array.isArray(value.agentSessionIds),
            {
              message:
                "implementation_hint_update updatePayload must include at least one field",
            }
          ),
        reasoning: z.string().min(1),
        sourceRefs: z.array(finalAssessmentSourceRefSchema),
      }),
    ])
  ),
  evidenceCorrections: z.array(
    z.object({
      target: finalEvidenceItemTargetSchema,
      severity: z.enum(["low", "medium", "high"]),
      issueType: z.enum([
        "outdated",
        "incorrect",
        "conflicting",
        "missing_context",
      ]),
      reasoning: z.string().min(1),
      suggestedReplacement: z.string().min(1),
      sourceExcerpt: z.string().min(1),
    })
  ),
  validationRecommendationsSummary: z.string().min(1),
  validationRecommendations: z.array(finalValidationRecommendationSchema),
  openQuestions: z.array(
    z.object({
      question: z.string().min(1),
      reason: z.string().min(1),
    })
  ),
});

const verificationResponseSourceTypeSchema = z.enum([
  "task",
  "designDoc",
  "plan",
  "initiative",
  "evidenceItem",
  "sessionOutput",
]);

const verificationPlanResponseSchema = z.object({
  responseType: z.literal("verification_plan_v1"),
  verificationChecks: z.array(
    z.object({
      checkId: z.string().min(1),
      tier: z.enum(["product_walkthrough", "api_or_script", "automated_test"]),
      priority: z.number().int().min(1),
      goal: z.string().min(1),
      target: z.object({
        entityType: z.enum(["task", "designDoc", "service", "artifact"]),
        entityId: z.string(),
      }),
      steps: z.array(z.string().min(1)).min(1),
      expectedResult: z.string().min(1),
      fallback: z.union([
        z.null(),
        z.object({
          tier: z.enum(["api_or_script", "automated_test"]),
          trigger: z.string().min(1),
          steps: z.array(z.string().min(1)).min(1),
        }),
      ]),
      evidenceRefs: z.array(
        z.object({
          sourceType: verificationResponseSourceTypeSchema,
          sourceId: z.string().min(1),
        })
      ),
    })
  ),
  coverageSummary: z.object({
    verifiedBehaviors: z.array(z.string().min(1)),
    remainingRisks: z.array(z.string().min(1)),
    recommendedNextAction: z.string().min(1),
  }),
});

const toErrorString = (issues: z.ZodIssue[]): string =>
  issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readNonEmptyString = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const toFvn1aHexHash = (value: string): string => {
  let hash = 0x811c9dc5;
  for (const char of value) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
};

const normalizeImplementationHintSourceType = (
  value: unknown
): CreateImplementationHintDtoSourceTypeEnum => {
  if (
    value === CreateImplementationHintDtoSourceTypeEnum.User ||
    value === CreateImplementationHintDtoSourceTypeEnum.System
  ) {
    return value;
  }
  return CreateImplementationHintDtoSourceTypeEnum.System;
};

const normalizeImplementationHintCreateSuggestion = (
  suggestion: Record<string, unknown>
): Record<string, unknown> => {
  if (suggestion["updateType"] !== "implementation_hint_create") {
    return suggestion;
  }

  const updatePayload = suggestion["updatePayload"];
  if (!isRecord(updatePayload)) {
    return suggestion;
  }

  const description = readNonEmptyString(updatePayload["description"]);
  if (!description) {
    return suggestion;
  }

  const target = isRecord(suggestion["target"]) ? suggestion["target"] : null;
  const targetEntityId = target ? readNonEmptyString(target["entityId"]) : null;

  const firstSourceRef = Array.isArray(suggestion["sourceRefs"])
    ? suggestion["sourceRefs"].find((entry) => isRecord(entry))
    : undefined;
  const sourceRef =
    firstSourceRef && isRecord(firstSourceRef) ? firstSourceRef : null;
  const sourceTypeLabel =
    (sourceRef ? readNonEmptyString(sourceRef["sourceType"]) : null) ??
    "unknown-source-type";
  const sourceIdLabel =
    (sourceRef ? readNonEmptyString(sourceRef["sourceId"]) : null) ??
    "unknown-source-id";

  const existingFeatureName = readNonEmptyString(updatePayload["featureName"]);
  const derivedFeatureName = `final-assessment/${
    targetEntityId ?? "unknown-target"
  }/${toFvn1aHexHash(
    `${
      targetEntityId ?? "unknown-target"
    }\n${sourceTypeLabel}\n${sourceIdLabel}\n${description}`
  )}`;

  return {
    ...suggestion,
    updatePayload: {
      ...updatePayload,
      featureName: existingFeatureName ?? derivedFeatureName,
      sourceType: normalizeImplementationHintSourceType(
        updatePayload["sourceType"]
      ),
    },
  };
};

const normalizeFinalAssessmentResponse = (raw: unknown): unknown => {
  if (!isRecord(raw)) {
    return raw;
  }

  const suggestions = raw["artifactUpdateSuggestions"];
  if (!Array.isArray(suggestions)) {
    return raw;
  }

  let hasChange = false;
  const normalizedSuggestions = suggestions.map((suggestion) => {
    if (!isRecord(suggestion)) {
      return suggestion;
    }

    const normalized = normalizeImplementationHintCreateSuggestion(suggestion);
    if (normalized !== suggestion) {
      hasChange = true;
    }
    return normalized;
  });

  if (!hasChange) {
    return raw;
  }

  return {
    ...raw,
    artifactUpdateSuggestions: normalizedSuggestions,
  };
};

export interface ParseStartupSessionPlanResponseError {
  ok: false;
  error: string;
}

export interface ParseStartupSessionPlanResponseSuccess {
  ok: true;
  value: StartupSessionPlanResponse;
}

export type ParseStartupSessionPlanResponseResult =
  | ParseStartupSessionPlanResponseError
  | ParseStartupSessionPlanResponseSuccess;

export const parseStartupSessionPlanResponse = (
  raw: unknown
): ParseStartupSessionPlanResponseResult => {
  const parsed = startupSessionPlanResponseSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: toErrorString(parsed.error.issues),
    };
  }

  return {
    ok: true,
    value: parsed.data,
  };
};

export interface ParseFinalAssessmentResponseError {
  ok: false;
  error: string;
}

export interface ParseFinalAssessmentResponseSuccess {
  ok: true;
  value: FinalAssessmentResponse;
}

export type ParseFinalAssessmentResponseResult =
  | ParseFinalAssessmentResponseError
  | ParseFinalAssessmentResponseSuccess;

export const parseFinalAssessmentResponse = (
  raw: unknown
): ParseFinalAssessmentResponseResult => {
  const normalizedRaw = normalizeFinalAssessmentResponse(raw);
  const parsed = finalAssessmentResponseSchema.safeParse(normalizedRaw);
  if (!parsed.success) {
    return {
      ok: false,
      error: toErrorString(parsed.error.issues),
    };
  }

  return {
    ok: true,
    value: parsed.data,
  };
};

const childTaskDescriptionUpdateResponseSchema = z.object({
  responseType: z.literal("child_task_description_update_v1"),
  updates: z.array(
    z.object({
      taskId: z.string().min(1),
      integrationNote: z.string().min(1),
    })
  ),
});

export interface ParseChildTaskDescriptionUpdateResponseError {
  ok: false;
  error: string;
}

export interface ParseChildTaskDescriptionUpdateResponseSuccess {
  ok: true;
  value: ChildTaskDescriptionUpdateResponse;
}

export type ParseChildTaskDescriptionUpdateResponseResult =
  | ParseChildTaskDescriptionUpdateResponseError
  | ParseChildTaskDescriptionUpdateResponseSuccess;

export const parseChildTaskDescriptionUpdateResponse = (
  raw: unknown
): ParseChildTaskDescriptionUpdateResponseResult => {
  const parsed = childTaskDescriptionUpdateResponseSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: toErrorString(parsed.error.issues),
    };
  }

  return {
    ok: true,
    value: parsed.data,
  };
};

export interface ParseVerificationPlanResponseError {
  ok: false;
  error: string;
}

export interface ParseVerificationPlanResponseSuccess {
  ok: true;
  value: VerificationPlanResponse;
}

export type ParseVerificationPlanResponseResult =
  | ParseVerificationPlanResponseError
  | ParseVerificationPlanResponseSuccess;

export const parseVerificationPlanResponse = (
  raw: unknown
): ParseVerificationPlanResponseResult => {
  const parsed = verificationPlanResponseSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: toErrorString(parsed.error.issues),
    };
  }

  return {
    ok: true,
    value: parsed.data,
  };
};

const setSplittingGeneratedTaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  acceptanceCriteria: z.string().min(1),
});

const setSplittingResponseSchema = z.object({
  responseType: z.literal("set_splitting_v1"),
  splitMode: z.enum(["feature", "service"]),
  tasks: z.array(setSplittingGeneratedTaskSchema).min(2),
  reasoning: z.string().min(1),
});

export interface ParseSetSplittingResponseError {
  ok: false;
  error: string;
}

export interface ParseSetSplittingResponseSuccess {
  ok: true;
  value: SetSplittingResponse;
}

export type ParseSetSplittingResponseResult =
  | ParseSetSplittingResponseError
  | ParseSetSplittingResponseSuccess;

export const parseSetSplittingResponse = (
  raw: unknown
): ParseSetSplittingResponseResult => {
  const parsed = setSplittingResponseSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: toErrorString(parsed.error.issues),
    };
  }

  return {
    ok: true,
    value: parsed.data,
  };
};
