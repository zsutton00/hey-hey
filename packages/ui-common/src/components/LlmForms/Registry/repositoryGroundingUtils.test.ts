import { describe, expect, it } from "vitest";
import { ConversationStartRunRequestDtoProviderEnum } from "../../../api";
import {
  buildRepositoryGroundingSubmission,
  createRepositoryGroundingValue,
  getRepositoryGroundingValidation,
  normalizeRepositoryGroundingValue,
  readRepositoryGroundingPayload,
  RepositoryGroundingNextAction,
} from "./repositoryGroundingUtils";

const provider = ConversationStartRunRequestDtoProviderEnum.Codex;
const model = "gpt-5.6-sol";

const bounds = {
  maxFiles: 100,
  maxTotalBytes: 1_000_000,
  maxFileBytes: 100_000,
  maxDepth: 8,
  maxGeneratedFiles: 20,
  maxIgnoredFiles: 20,
  maxUnsupportedFiles: 20,
  maxBinaryFiles: 20,
};

const readyValue = createRepositoryGroundingValue({
  entryMode: "existing",
  serviceId: "service-id",
  brief: "The API service",
  machineId: "machine-id",
  scope: "comprehensive",
  provider,
  model,
  reasoningEffort: "high",
  fastMode: true,
  bounds,
});

describe("repository grounding utilities", () => {
  it("normalizes persisted analysis state without API provider metadata", () => {
    const presentation = readRepositoryGroundingPayload({
      savedChoices: {
        entryMode: "existing",
        serviceId: "service-id",
        brief: "The API service",
        machineId: "machine-id",
        scope: "focused",
        focus: "The request boundary",
      },
      state: {
        status: "in_progress",
        progressPercent: 42,
        message: "Reading repository evidence",
      },
      bounds,
    });

    expect(presentation.phase).toBe("running");
    expect(presentation.progress).toBe(42);

    expect(
      normalizeRepositoryGroundingValue(undefined, presentation)
    ).toMatchObject({
      serviceId: "service-id",
      scope: "focused",
      focus: "The request boundary",
      phase: "running",
    });

    expect(
      normalizeRepositoryGroundingValue(
        {
          ...readyValue,
          phase: "ready",
          progress: 5,
          statusMessage: "Waiting to start",
        },
        presentation
      )
    ).toMatchObject({
      phase: "running",
      progress: 42,
      statusMessage: "Reading repository evidence",
    });

    expect(
      normalizeRepositoryGroundingValue(
        { ...readyValue, brief: "", focus: "" },
        presentation
      )
    ).toMatchObject({ brief: "", focus: "" });
  });

  it("restores choices when the persisted state owns the saved choices", () => {
    const presentation = readRepositoryGroundingPayload({
      state: {
        phase: "running",
        savedChoices: {
          serviceId: "service-id",
          brief: "The API service",
          machineId: "machine-id",
          scope: "comprehensive",
          provider: "codex",
          model,
          reasoningEffort: "high",
          fastMode: true,
        },
        bounds,
      },
    });

    expect(
      normalizeRepositoryGroundingValue(undefined, presentation)
    ).toMatchObject({
      serviceId: "service-id",
      brief: "The API service",
      machineId: "machine-id",
      scope: "comprehensive",
      provider: "codex",
      phase: "running",
    });
  });

  it("allows comprehensive analysis without focus but gates focused analysis", () => {
    const comprehensive = getRepositoryGroundingValidation({
      value: readyValue,
      hasReadyMachine: true,
      bindingReady: true,
    });

    expect(comprehensive.valid).toBe(true);

    const focused = getRepositoryGroundingValidation({
      value: { ...readyValue, scope: "focused", focus: "" },
      hasReadyMachine: true,
      bindingReady: true,
    });

    expect(focused.valid).toBe(false);
    expect(focused.errors).toContain("Add a focus for focused analysis.");
  });

  it("projects an admission action without local directory paths", () => {
    const submission = buildRepositoryGroundingSubmission({
      value: readyValue,
      action: RepositoryGroundingNextAction.StartAnalysis,
    });

    expect(submission).toEqual({
      entryMode: "existing",
      serviceId: "service-id",
      brief: "The API service",
      machineId: "machine-id",
      scope: "comprehensive",
      provider: "codex",
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
      fastMode: true,
      bounds,
      nextAction: "START_ANALYSIS",
    });
    expect(submission).not.toHaveProperty("repositoryPath");
  });

  it("rejects incomplete runtime selections", () => {
    expect(
      buildRepositoryGroundingSubmission({
        value: { ...readyValue, reasoningEffort: null },
        action: RepositoryGroundingNextAction.RetryAnalysis,
      })
    ).toBeNull();
  });
});
