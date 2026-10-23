import { describe, expect, it } from "vitest";
import {
  extractStructuredJsonPayload,
  parseFinalAssessmentResponseFromText,
  parseSetSplittingResponseFromText,
  parseStartupSessionPlanResponseFromText,
  parseVerificationPlanResponseFromText,
} from "../parser";

describe("parser", () => {
  it("extracts JSON from fenced response", () => {
    const payload = extractStructuredJsonPayload(
      [
        "prefix",
        "```json",
        '{"responseType":"startup_plan_v1","sessionTitle":"Implement startup workflow","executionPlan":[],"discrepancies":[],"clarificationQuestions":[]}',
        "```",
      ].join("\n")
    );

    expect(payload).toContain("responseType");
  });

  it("returns error when no JSON exists", () => {
    const result = parseStartupSessionPlanResponseFromText("not json");
    expect(result.ok).toBe(false);
  });

  it("parses startup plan response text from fenced json", () => {
    const result = parseStartupSessionPlanResponseFromText(
      [
        "Agent analysis follows.",
        "```json",
        JSON.stringify({
          responseType: "startup_plan_v1",
          requiredServiceIds: ["service-1"],
          primaryImplementations: [
            {
              title: "Core implementation",
              content: "Implementation details",
              rationale: "Primary plan outcome",
            },
          ],
          sessionTitle: "Implement startup workflow",
          executionPlan: [],
          discrepancies: [],
          clarificationQuestions: [],
        }),
        "```",
      ].join("\n")
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.responseType).toBe("startup_plan_v1");
    expect([...result.value.requiredServiceIds]).toEqual(["service-1"]);
  });

  it("parses final assessment response text from fenced json", () => {
    const result = parseFinalAssessmentResponseFromText(
      [
        "Final assessment output:",
        "```json",
        JSON.stringify({
          responseType: "final_assessment_v2",
          taskAssessment: {
            target: { entityType: "task", entityId: "task-1" },
            verdict: "completed",
            statusRecommendation: {
              status: "COMPLETED",
              reason: "All acceptance criteria are met.",
            },
            summary: "Prompt and parser updates are complete.",
          },
          implementationNotes:
            "Updated final assessment prompt instructions and runtime discrepancy context wiring.",
          artifactUpdateSuggestions: [],
          evidenceCorrections: [],
          validationRecommendationsSummary:
            "Run two high-confidence checks for parsing and prompt output.",
          validationRecommendations: [
            {
              stepId: "validation-step-1",
              title: "Validate prompt snapshot output",
              stepDescription:
                "Confirm final assessment prompt includes validation recommendation instructions.",
              target: {
                filePath:
                  "src/agents/coordination/prompts/finalAssessmentPrompt.ts",
              },
              preconditions: ["Prompt changes are merged locally."],
              expectedResult:
                "Snapshot includes validationRecommendations fields.",
              executionType: "automated",
              estimatedEffort: 10,
              confidence: 0.9,
              provenance: {
                sessionId: "session-1",
                agentResponseId: "response-1",
              },
              fileReferences: [
                {
                  filePath:
                    "src/agents/coordination/prompts/finalAssessmentPrompt.ts",
                  startLine: 52,
                  endLine: 168,
                },
              ],
            },
          ],
          openQuestions: [],
        }),
        "```",
      ].join("\n")
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.responseType).toBe("final_assessment_v2");
  });

  it("parses verification plan response text from fenced json", () => {
    const result = parseVerificationPlanResponseFromText(
      [
        "Verification plan output:",
        "```json",
        JSON.stringify({
          responseType: "verification_plan_v1",
          verificationChecks: [
            {
              checkId: "check-1",
              tier: "product_walkthrough",
              priority: 1,
              goal: "Verify prompt preview in UI",
              target: { entityType: "task", entityId: "task-1" },
              steps: ["Open CLI UI", "Run command", "Confirm preview"],
              expectedResult: "Preview shows structured sections.",
              fallback: null,
              evidenceRefs: [{ sourceType: "task", sourceId: "task-1" }],
            },
          ],
          coverageSummary: {
            verifiedBehaviors: ["Prompt preview"],
            remainingRisks: ["Persistence command not run yet"],
            recommendedNextAction: "Run the persist command in staging.",
          },
        }),
        "```",
      ].join("\n")
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.responseType).toBe("verification_plan_v1");
  });

  it("parses set_splitting response text from fenced json", () => {
    const result = parseSetSplittingResponseFromText(
      [
        "Splitting analysis follows.",
        "```json",
        JSON.stringify({
          responseType: "set_splitting_v1",
          splitMode: "feature",
          tasks: [
            {
              title: "Implement authentication flow",
              description: "Build login and registration endpoints.",
              acceptanceCriteria: "Users can register and authenticate.",
            },
            {
              title: "Implement profile management",
              description: "Build profile CRUD operations.",
              acceptanceCriteria: "Users can view and edit profiles.",
            },
          ],
          reasoning: "Split by functional area for independent deliverability.",
        }),
        "```",
      ].join("\n")
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.responseType).toBe("set_splitting_v1");
    expect(result.value.splitMode).toBe("feature");
    expect(result.value.tasks).toHaveLength(2);
  });

  it("returns error for set_splitting response with only one task", () => {
    const result = parseSetSplittingResponseFromText(
      JSON.stringify({
        responseType: "set_splitting_v1",
        splitMode: "service",
        tasks: [
          {
            title: "Only one",
            description: "Not enough tasks.",
            acceptanceCriteria: "Should fail.",
          },
        ],
        reasoning: "Insufficient.",
      })
    );

    expect(result.ok).toBe(false);
  });
});
