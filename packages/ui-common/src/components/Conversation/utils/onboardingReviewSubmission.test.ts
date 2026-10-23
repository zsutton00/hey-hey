import { applyPrimaryNextActionOverrides } from "../../LlmForms/DynamicForm";
import { tryUpdateFeatureListAction } from "../../LlmForms/Registry/secondaryActionBehaviors";
import { WorkflowReviewAction } from "../../../api";
import type {
  FeatureListValue,
  PlanStageProposalValue,
} from "../../LlmForms/Registry/types";
import type { FormValue } from "../../LlmForms/types";
import { RepositoryGroundingNextAction } from "../../LlmForms/Registry/repositoryGroundingUtils";
import {
  projectOnboardingReviewAnswers,
  projectRepositoryImportReviewAnswers,
} from "./onboardingReviewSubmission";

describe("projectOnboardingReviewAnswers", () => {
  it("projects feature-list approval to an empty canonical payload", () => {
    const submitted = applyPrimaryNextActionOverrides({
      "feature-list": {
        type: "FEATURE_LIST",
        narrative: "Display-only narrative",
        generatedProposalIds: ["proposal-1"],
        refinement: { sections: {}, overall: "" },
      } satisfies FeatureListValue,
    });

    const answers = projectOnboardingReviewAnswers(submitted);
    expect(submitted["feature-list"]).toEqual({
      action: "APPROVED",
      payload: {},
    });
    expect(answers["feature-list"]).toEqual({
      action: WorkflowReviewAction.Approved,
      payload: {},
    });
  });

  it("submits feature-list refinement without display-only proposal data", () => {
    const draft: FeatureListValue = {
      type: "FEATURE_LIST",
      narrative: "Display-only narrative",
      topLevels: [],
      refinement: {
        sections: { "top-level-1": "Split this capability." },
        overall: "Keep the scope narrow.",
      },
    };
    const result = tryUpdateFeatureListAction(
      { "feature-list": draft },
      "feature-list",
      "REFINE",
    );
    expect(result.updated).toBe(true);
    const answers = projectOnboardingReviewAnswers(result.values);
    expect(answers["feature-list"]).toEqual({
      action: WorkflowReviewAction.Refine,
      payload: draft.refinement,
    });
    expect(
      projectRepositoryImportReviewAnswers(result.values)["feature-list"],
    ).toEqual(answers["feature-list"]);
  });

  it("projects onboarding candidate-plan review while preserving selection feedback", () => {
    const answers = projectOnboardingReviewAnswers({
      onboarding_plan_candidate_proposals: {
        type: "PLAN_STAGE_PROPOSAL",
        nextAction: "READY_FOR_NEXT_STEP",
        userMessage: "Keep the first plan.",
        stages: [],
        stageFeedback: [
          {
            sequenceOrder: 1,
            title: "Plan A",
            action: "accept",
            comment: "This one is grounded.",
          },
        ],
      } satisfies PlanStageProposalValue,
    });

    expect(answers.onboarding_plan_candidate_proposals).toEqual({
      action: WorkflowReviewAction.Approved,
      payload: {
        userMessage: "Keep the first plan.",
        stageFeedback: [
          {
            sequenceOrder: 1,
            title: "Plan A",
            action: "accept",
            comment: "This one is grounded.",
          },
        ],
      },
    });
  });

  it("preserves ordinary and already-canonical onboarding answers", () => {
    const canonical = {
      action: WorkflowReviewAction.Refine,
      payload: { sections: {}, overall: "Rebucket the top levels." },
    } as const;
    const answers = projectOnboardingReviewAnswers({
      project_concept: "A graph-backed workspace",
      "feature-list": canonical,
    });

    expect(answers).toEqual({
      project_concept: "A graph-backed workspace",
      "feature-list": canonical,
    });
  });

  it("preserves the typed existing-work intent without adding execution fields", () => {
    const answers = projectOnboardingReviewAnswers({
      repository_grounding_intent: { choice: "yes" },
    });

    expect(answers).toEqual({
      repository_grounding_intent: { choice: "yes" },
    });
    expect(answers).not.toHaveProperty("controllerCredentialId");
    expect(answers).not.toHaveProperty("machineId");
    expect(answers).not.toHaveProperty("repository_prerequisites");
    expect(answers).not.toHaveProperty("repository_analysis_configuration");
    expect(answers).not.toHaveProperty("repository_grounding_action");
  });

  it("projects repository-grounding editor state into the typed answer keys", () => {
    const answers = projectRepositoryImportReviewAnswers({
      repository_grounding: {
        entryMode: "existing",
        serviceId: "service-1",
        brief: "The API service",
        machineId: "machine-1",
        scope: "focused",
        focus: "Public API boundaries",
        provider: "codex",
        model: "frontier-model-1",
        reasoningEffort: "high",
        fastMode: true,
        bounds: {
          maxFiles: 100,
          maxTotalBytes: 1_000_000,
          maxFileBytes: 100_000,
          maxDepth: 8,
          maxGeneratedFiles: 20,
          maxIgnoredFiles: 20,
          maxUnsupportedFiles: 20,
          maxBinaryFiles: 20,
        },
        nextAction: RepositoryGroundingNextAction.StartAnalysis,
      },
    });

    expect(answers).toEqual({
      repository_prerequisites: {
        entryMode: "existing_project",
        serviceId: "service-1",
        confirmedServiceBrief: "The API service",
        machineId: "machine-1",
      },
      repository_analysis_configuration: {
        scope: { scope: "focused", focus: "Public API boundaries" },
        provider: "codex",
        resolvedFrontierModel: "frontier-model-1",
        reasoningEffort: "high",
        fastMode: true,
        bounds: {
          maxFiles: 100,
          maxTotalBytes: 1_000_000,
          maxFileBytes: 100_000,
          maxDepth: 8,
          maxGeneratedFiles: 20,
          maxIgnoredFiles: 20,
          maxUnsupportedFiles: 20,
          maxBinaryFiles: 20,
        },
      },
      repository_grounding_action: "START_ANALYSIS",
    });
  });

  it("does not project malformed repository-grounding editor state", () => {
    const malformed: FormValue = {
      entryMode: "existing",
      serviceId: "service-1",
      brief: "The API service",
      machineId: "machine-1",
      scope: "comprehensive",
      provider: "codex",
      model: "frontier-model-1",
      bounds: {},
      nextAction: "UNKNOWN_ACTION",
    };

    const answers = projectOnboardingReviewAnswers({
      repository_grounding: malformed,
    });

    expect(answers.repository_grounding).toBe(malformed);
  });
});

describe("repository import first-work replies", () => {
  it("submits the work request and follow-up answers unchanged", () => {
    const followUp = {
      clarifyingAnswers: [{ question: "Which format?", answer: "CSV." }],
    };
    const answers = projectRepositoryImportReviewAnswers({
      repository_first_work_request: "Add CSV export",
      repository_first_work_follow_up: followUp,
    } as unknown as Record<string, FormValue>);

    expect(answers).toEqual({
      repository_first_work_request: "Add CSV export",
      repository_first_work_follow_up: followUp,
    });
  });
});
