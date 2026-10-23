import { describe, expect, it } from "vitest";
import {
  parseFinalAssessmentResponse,
  parseSetSplittingResponse,
  parseStartupSessionPlanResponse,
  parseVerificationPlanResponse,
} from "../schemas";

describe("parseStartupSessionPlanResponse", () => {
  it("parses valid startup response payload", () => {
    const result = parseStartupSessionPlanResponse({
      responseType: "startup_plan_v1",
      requiredServiceIds: ["service-1"],
      primaryImplementations: [
        {
          title: "Core implementation",
          content: "Implementation details",
          rationale: "Primary plan outcome",
        },
      ],
      sessionTitle: "Inspect startup task readiness",
      executionPlan: [
        {
          stepId: "step-1",
          title: "Inspect task implementation points",
          description:
            "Locate files referenced by task and verify current implementation.",
          phase: 1,
          references: [
            {
              sourceType: "task",
              sourceId: "task-1",
              rationale: "Task requirements drive file inspection.",
            },
          ],
        },
      ],
      discrepancies: [
        {
          sourceRef: {
            sourceType: "evidenceItem",
            sourceId: "ev-1",
          },
          sourceField: "topologySummary",
          sourceExcerpt:
            "The summary references src/old-path.ts as the integration entrypoint.",
          reasoning:
            "The codebase no longer has src/old-path.ts and uses src/new-path.ts.",
          discrepancyText:
            "Evidence points to a deprecated path and should be updated before implementation.",
          severity: "medium",
        },
      ],
      clarificationQuestions: [],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.responseType).toBe("startup_plan_v1");
    expect(result.value.executionPlan).toHaveLength(1);
    expect(result.value.discrepancies).toHaveLength(1);
  });

  it("returns validation errors for missing discrepancy sourceRef fields", () => {
    const result = parseStartupSessionPlanResponse({
      responseType: "startup_plan_v1",
      requiredServiceIds: ["service-1"],
      primaryImplementations: [
        {
          title: "Core implementation",
          content: "Implementation details",
          rationale: "Primary plan outcome",
        },
      ],
      sessionTitle: "Inspect startup task readiness",
      executionPlan: [],
      discrepancies: [
        {
          sourceRef: {
            sourceType: "evidenceItem",
          },
          sourceExcerpt: "A sentence.",
          reasoning: "A sentence.",
          discrepancyText: "A sentence.",
          severity: "low",
        },
      ],
      clarificationQuestions: [],
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error).toContain("sourceRef.sourceId");
  });

  it("rejects an empty or duplicate required Service scope", () => {
    const emptyResult = parseStartupSessionPlanResponse({
      responseType: "startup_plan_v1",
      requiredServiceIds: [],
      primaryImplementations: [
        {
          title: "Core implementation",
          content: "Implementation details",
          rationale: "Primary plan outcome",
        },
      ],
      sessionTitle: "Inspect startup task readiness",
      executionPlan: [],
      discrepancies: [],
      clarificationQuestions: [],
    });
    expect(emptyResult.ok).toBe(false);

    const duplicateResult = parseStartupSessionPlanResponse({
      responseType: "startup_plan_v1",
      requiredServiceIds: ["service-1", "service-1"],
      primaryImplementations: [
        {
          title: "Core implementation",
          content: "Implementation details",
          rationale: "Primary plan outcome",
        },
      ],
      sessionTitle: "Inspect startup task readiness",
      executionPlan: [],
      discrepancies: [],
      clarificationQuestions: [],
    });
    expect(duplicateResult.ok).toBe(false);
    if (!duplicateResult.ok) {
      expect(duplicateResult.error).toContain("requiredServiceIds");
    }
  });

  it("returns validation errors when sessionTitle is missing", () => {
    const result = parseStartupSessionPlanResponse({
      responseType: "startup_plan_v1",
      requiredServiceIds: ["service-1"],
      primaryImplementations: [
        {
          title: "Core implementation",
          content: "Implementation details",
          rationale: "Primary plan outcome",
        },
      ],
      executionPlan: [],
      discrepancies: [],
      clarificationQuestions: [],
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error).toContain("sessionTitle");
  });
});

describe("parseFinalAssessmentResponse", () => {
  it("parses valid final assessment payload", () => {
    const result = parseFinalAssessmentResponse({
      responseType: "final_assessment_v2",
      taskAssessment: {
        target: { entityType: "task", entityId: "task-1" },
        verdict: "completed",
        statusRecommendation: {
          status: "COMPLETED",
          reason: "All required work is implemented.",
        },
        summary: "Implemented prompt and parser contracts.",
      },
      implementationNotes:
        "Updated final assessment prompt rules and startup discrepancy context wiring.",
      artifactUpdateSuggestions: [
        {
          target: { entityType: "designDoc", entityId: "doc-1" },
          updateType: "design_doc_revision",
          updatePayload: {
            summary: "Update lifecycle notes.",
          },
          reasoning: "Execution introduced final-assessment contracts.",
          sourceRefs: [
            { sourceType: "sessionOutput", sourceId: "sessionOutput" },
          ],
        },
      ],
      evidenceCorrections: [
        {
          target: { entityType: "evidenceItem", entityId: "ev-1" },
          severity: "high",
          issueType: "outdated",
          reasoning: "Referenced path was removed.",
          suggestedReplacement: "Point to src/agents/coordination/prompts.",
          sourceExcerpt: "Evidence references src/old-path.ts.",
        },
      ],
      validationRecommendationsSummary:
        "Prioritize parser and prompt regression checks before release.",
      validationRecommendations: [
        {
          stepId: "validation-step-1",
          title: "Validate parser accepts v2 output",
          stepDescription:
            "Run parser tests to confirm final assessment v2 payloads parse successfully.",
          target: {
            filePath: "src/agents/coordination/schemas.ts",
          },
          preconditions: ["Dependencies are installed."],
          expectedResult: "All parser tests pass for v2 payloads.",
          executionType: "automated",
          estimatedEffort: 10,
          confidence: 0.95,
          provenance: {
            sessionId: "session-1",
            agentResponseId: "response-1",
          },
          fileReferences: [
            {
              filePath: "src/agents/coordination/schemas.ts",
              startLine: 100,
              endLine: 320,
            },
          ],
        },
      ],
      openQuestions: [],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.responseType).toBe("final_assessment_v2");
    expect(result.value.implementationNotes).toContain(
      "startup discrepancy context"
    );
    expect(result.value.artifactUpdateSuggestions).toHaveLength(1);
  });

  it("system-populates validation recommendation provenance and ignores model-supplied values", () => {
    const result = parseFinalAssessmentResponse({
      responseType: "final_assessment_v2",
      taskAssessment: {
        target: { entityType: "task", entityId: "task-1" },
        verdict: "completed",
        statusRecommendation: {
          status: "COMPLETED",
          reason: "Done.",
        },
        summary: "Done.",
      },
      artifactUpdateSuggestions: [],
      evidenceCorrections: [],
      validationRecommendationsSummary: "Run two checks.",
      validationRecommendations: [
        {
          stepId: "validation-step-1",
          title: "Missing provenance",
          stepDescription: "Parser should default missing provenance fields.",
          target: {
            filePath: "src/agents/coordination/schemas.ts",
          },
          preconditions: [],
          expectedResult: "Recommendation remains valid.",
          executionType: "automated",
          estimatedEffort: 5,
          confidence: 0.8,
        },
        {
          stepId: "validation-step-2",
          title: "Model-supplied provenance",
          stepDescription:
            "Parser should ignore model-supplied provenance fields.",
          target: {
            serviceId: "service-1",
          },
          preconditions: [],
          expectedResult: "Recommendation remains valid.",
          executionType: "manual",
          estimatedEffort: 5,
          confidence: 0.7,
          provenance: {
            sessionId: "session-from-model",
            agentResponseId: "response-from-model",
          },
        },
      ],
      openQuestions: [],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.validationRecommendations[0]?.provenance).toEqual({
      sessionId: "",
      agentResponseId: "",
    });
    expect(result.value.validationRecommendations[1]?.provenance).toEqual({
      sessionId: "",
      agentResponseId: "",
    });
  });

  it("accepts payloads when implementationNotes is omitted", () => {
    const result = parseFinalAssessmentResponse({
      responseType: "final_assessment_v2",
      taskAssessment: {
        target: { entityType: "task", entityId: "task-1" },
        verdict: "completed",
        statusRecommendation: {
          status: "COMPLETED",
          reason: "Done.",
        },
        summary: "Done.",
      },
      artifactUpdateSuggestions: [],
      evidenceCorrections: [],
      validationRecommendationsSummary: "Run one smoke check.",
      validationRecommendations: [],
      openQuestions: [],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.implementationNotes).toBeUndefined();
  });

  it("normalizes implementation_hint_create when featureName/sourceType are missing", () => {
    const result = parseFinalAssessmentResponse({
      responseType: "final_assessment_v2",
      taskAssessment: {
        target: { entityType: "task", entityId: "task-1" },
        verdict: "partiallyCompleted",
        statusRecommendation: {
          status: "ACTIVE",
          reason: "Work remains.",
        },
        summary: "Some work is complete.",
      },
      artifactUpdateSuggestions: [
        {
          target: { entityType: "implementationHint", entityId: "" },
          updateType: "implementation_hint_create",
          updatePayload: {
            description: "Close remaining onboarding agent-node contract gaps.",
          },
          reasoning: "Follow-up implementation is still required.",
          sourceRefs: [
            { sourceType: "sessionOutput", sourceId: "sessionOutput" },
          ],
        },
      ],
      evidenceCorrections: [],
      validationRecommendationsSummary:
        "Use a lightweight manual smoke-check for remaining gaps.",
      validationRecommendations: [
        {
          stepId: "validation-step-2",
          title: "Run manual smoke check",
          stepDescription:
            "Confirm the UI still renders expected agent output sections.",
          target: {
            uiFlow: "Open prompt output and inspect rendered sections.",
          },
          preconditions: ["App is running locally."],
          expectedResult: "Sections render without schema errors.",
          executionType: "manual",
          estimatedEffort: 15,
          confidence: 0.75,
          provenance: {
            sessionId: "session-1",
            agentResponseId: "response-2",
          },
        },
      ],
      openQuestions: [],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const suggestion = result.value.artifactUpdateSuggestions[0];
    expect(suggestion?.updateType).toBe("implementation_hint_create");
    if (!suggestion || suggestion.updateType !== "implementation_hint_create") {
      return;
    }

    expect(suggestion.updatePayload.sourceType).toBe("SYSTEM");
    expect(suggestion.updatePayload.featureName).toMatch(
      /^final-assessment\/unknown-target\/[0-9a-f]{8}$/u
    );
  });

  it("returns validation errors for mismatched target/update type", () => {
    const result = parseFinalAssessmentResponse({
      responseType: "final_assessment_v2",
      taskAssessment: {
        target: { entityType: "task", entityId: "task-1" },
        verdict: "completed",
        statusRecommendation: {
          status: "COMPLETED",
          reason: "Done.",
        },
        summary: "Done.",
      },
      artifactUpdateSuggestions: [
        {
          target: { entityType: "task", entityId: "task-1" },
          updateType: "design_doc_revision",
          updatePayload: {
            summary: "Wrong target type",
          },
          reasoning: "Bad mapping.",
          sourceRefs: [{ sourceType: "task", sourceId: "task-1" }],
        },
      ],
      evidenceCorrections: [],
      validationRecommendationsSummary:
        "Run at least one automated check before marking complete.",
      validationRecommendations: [
        {
          stepId: "validation-step-3",
          title: "Execute script validation",
          stepDescription:
            "Run script-based verification for endpoint contract consistency.",
          target: {
            endpoint: "POST /final-recommendations",
          },
          preconditions: ["Service is available in test environment."],
          expectedResult:
            "Endpoint accepts v2 payload without validation errors.",
          executionType: "automated",
          estimatedEffort: 20,
          confidence: 0.8,
          provenance: {
            sessionId: "session-1",
            agentResponseId: "response-3",
          },
        },
      ],
      openQuestions: [],
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.error.length).toBeGreaterThan(0);
  });

  it("returns validation errors when validation recommendation confidence is out of range", () => {
    const result = parseFinalAssessmentResponse({
      responseType: "final_assessment_v2",
      taskAssessment: {
        target: { entityType: "task", entityId: "task-1" },
        verdict: "completed",
        statusRecommendation: {
          status: "COMPLETED",
          reason: "Done.",
        },
        summary: "Done.",
      },
      artifactUpdateSuggestions: [],
      evidenceCorrections: [],
      validationRecommendationsSummary: "Single recommendation summary.",
      validationRecommendations: [
        {
          stepId: "validation-step-4",
          title: "Validate confidence bounds",
          stepDescription: "Ensure confidence stays within 0-1.",
          target: {
            serviceId: "api-service",
          },
          preconditions: [],
          expectedResult: "Parser rejects invalid confidence values.",
          executionType: "automated",
          estimatedEffort: 5,
          confidence: 1.1,
          provenance: {
            sessionId: "session-1",
            agentResponseId: "response-4",
          },
        },
      ],
      openQuestions: [],
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.error).toContain("validationRecommendations.0.confidence");
  });

  it("returns validation errors when validation recommendation target is empty", () => {
    const result = parseFinalAssessmentResponse({
      responseType: "final_assessment_v2",
      taskAssessment: {
        target: { entityType: "task", entityId: "task-1" },
        verdict: "completed",
        statusRecommendation: {
          status: "COMPLETED",
          reason: "Done.",
        },
        summary: "Done.",
      },
      artifactUpdateSuggestions: [],
      evidenceCorrections: [],
      validationRecommendationsSummary: "Single recommendation summary.",
      validationRecommendations: [
        {
          stepId: "validation-step-5",
          title: "Reject empty target",
          stepDescription:
            "Ensure parser rejects recommendation targets without any identifiers.",
          target: {},
          preconditions: [],
          expectedResult:
            "Parser rejects target objects without target fields.",
          executionType: "automated",
          estimatedEffort: 5,
          confidence: 0.8,
          provenance: {
            sessionId: "session-1",
            agentResponseId: "response-5",
          },
        },
      ],
      openQuestions: [],
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.error).toContain("validationRecommendations.0.target");
  });

  it("returns validation errors when fileReferences endLine is before startLine", () => {
    const result = parseFinalAssessmentResponse({
      responseType: "final_assessment_v2",
      taskAssessment: {
        target: { entityType: "task", entityId: "task-1" },
        verdict: "completed",
        statusRecommendation: {
          status: "COMPLETED",
          reason: "Done.",
        },
        summary: "Done.",
      },
      artifactUpdateSuggestions: [],
      evidenceCorrections: [],
      validationRecommendationsSummary: "Single recommendation summary.",
      validationRecommendations: [
        {
          stepId: "validation-step-6",
          title: "Reject invalid fileReference range",
          stepDescription:
            "Ensure parser rejects file references where endLine is before startLine.",
          target: {
            filePath: "src/agents/coordination/schemas.ts",
          },
          preconditions: [],
          expectedResult: "Parser rejects invalid file reference ranges.",
          executionType: "automated",
          estimatedEffort: 5,
          confidence: 0.8,
          provenance: {
            sessionId: "session-1",
            agentResponseId: "response-6",
          },
          fileReferences: [
            {
              filePath: "src/agents/coordination/schemas.ts",
              startLine: 20,
              endLine: 10,
            },
          ],
        },
      ],
      openQuestions: [],
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.error).toContain(
      "validationRecommendations.0.fileReferences.0.endLine"
    );
  });
});

describe("parseVerificationPlanResponse", () => {
  it("parses valid verification plan payload", () => {
    const result = parseVerificationPlanResponse({
      responseType: "verification_plan_v1",
      verificationChecks: [
        {
          checkId: "check-1",
          tier: "product_walkthrough",
          priority: 1,
          goal: "Verify end-to-end prompt flow in UI.",
          target: { entityType: "task", entityId: "task-1" },
          steps: [
            "Open workflow screen",
            "Start agent prompt",
            "Confirm preview output",
          ],
          expectedResult: "Prompt output is visible and structured.",
          fallback: {
            tier: "api_or_script",
            trigger: "UI environment unavailable",
            steps: [
              "Run CLI command with session payload",
              "Validate structured JSON output",
            ],
          },
          evidenceRefs: [{ sourceType: "task", sourceId: "task-1" }],
        },
      ],
      coverageSummary: {
        verifiedBehaviors: ["Prompt generation", "Structured output rendering"],
        remainingRisks: ["User confirmation flow not manually run yet"],
        recommendedNextAction: "Run walkthrough on staging.",
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.responseType).toBe("verification_plan_v1");
    expect(result.value.verificationChecks[0]?.tier).toBe(
      "product_walkthrough"
    );
  });

  it("returns validation errors for invalid fallback tier", () => {
    const result = parseVerificationPlanResponse({
      responseType: "verification_plan_v1",
      verificationChecks: [
        {
          checkId: "check-1",
          tier: "api_or_script",
          priority: 1,
          goal: "Verify command path.",
          target: { entityType: "service", entityId: "service-1" },
          steps: ["Run script"],
          expectedResult: "Output is present.",
          fallback: {
            tier: "product_walkthrough",
            trigger: "Never",
            steps: ["N/A"],
          },
          evidenceRefs: [
            { sourceType: "sessionOutput", sourceId: "sessionOutput" },
          ],
        },
      ],
      coverageSummary: {
        verifiedBehaviors: ["Script execution"],
        remainingRisks: [],
        recommendedNextAction: "Proceed.",
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.error).toContain("verificationChecks.0.fallback");
  });
});

describe("parseSetSplittingResponse", () => {
  it("parses valid set_splitting response with feature mode", () => {
    const result = parseSetSplittingResponse({
      responseType: "set_splitting_v1",
      splitMode: "feature",
      tasks: [
        {
          title: "Implement user authentication",
          description: "Build login and registration flows.",
          acceptanceCriteria: "Users can register and log in.",
        },
        {
          title: "Implement user profile",
          description: "Build profile viewing and editing.",
          acceptanceCriteria: "Users can view and edit their profile.",
        },
      ],
      reasoning: "Split by functional area: auth vs profile management.",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.responseType).toBe("set_splitting_v1");
    expect(result.value.splitMode).toBe("feature");
    expect(result.value.tasks).toHaveLength(2);
    expect(result.value.reasoning).toBeTruthy();
  });

  it("parses valid set_splitting response with service mode", () => {
    const result = parseSetSplittingResponse({
      responseType: "set_splitting_v1",
      splitMode: "service",
      tasks: [
        {
          title: "API gateway changes",
          description: "Update routing in the API gateway service.",
          acceptanceCriteria:
            "New routes are registered and forwarding correctly.",
        },
        {
          title: "Auth service changes",
          description: "Add token validation endpoint.",
          acceptanceCriteria: "Token validation returns correct responses.",
        },
      ],
      reasoning: "One task per service boundary.",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.splitMode).toBe("service");
    expect(result.value.tasks).toHaveLength(2);
  });

  it("rejects response with fewer than 2 tasks", () => {
    const result = parseSetSplittingResponse({
      responseType: "set_splitting_v1",
      splitMode: "feature",
      tasks: [
        {
          title: "Only one task",
          description: "This should fail validation.",
          acceptanceCriteria: "Minimum 2 tasks required.",
        },
      ],
      reasoning: "Insufficient split.",
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error).toContain("tasks");
  });

  it("rejects response with empty task title", () => {
    const result = parseSetSplittingResponse({
      responseType: "set_splitting_v1",
      splitMode: "feature",
      tasks: [
        {
          title: "",
          description: "Description present.",
          acceptanceCriteria: "Criteria present.",
        },
        {
          title: "Second task",
          description: "Description present.",
          acceptanceCriteria: "Criteria present.",
        },
      ],
      reasoning: "One task has empty title.",
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error).toContain("tasks.0.title");
  });

  it("rejects response with invalid splitMode", () => {
    const result = parseSetSplittingResponse({
      responseType: "set_splitting_v1",
      splitMode: "unknown_mode",
      tasks: [
        {
          title: "Task A",
          description: "Desc A.",
          acceptanceCriteria: "AC A.",
        },
        {
          title: "Task B",
          description: "Desc B.",
          acceptanceCriteria: "AC B.",
        },
      ],
      reasoning: "Invalid mode.",
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error).toContain("splitMode");
  });

  it("rejects response with wrong responseType", () => {
    const result = parseSetSplittingResponse({
      responseType: "startup_plan_v1",
      primaryImplementations: [
        {
          title: "Core implementation",
          content: "Implementation details",
          rationale: "Primary plan outcome",
        },
      ],
      splitMode: "feature",
      tasks: [
        {
          title: "Task A",
          description: "Desc A.",
          acceptanceCriteria: "AC A.",
        },
        {
          title: "Task B",
          description: "Desc B.",
          acceptanceCriteria: "AC B.",
        },
      ],
      reasoning: "Wrong type.",
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error).toContain("responseType");
  });
});
