import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FinalAssessmentStructuredField } from "../FinalAssessmentStructuredField";
import type { FieldConfig, FieldComponentContext } from "../types";
import { useAgentSession } from "../../../../data/hooks/useAgentSession";
import { useWorkItem } from "../../../../data/hooks/useWorkItem";
import { useWorkItemUpdateMethods } from "../../../../data/hooks/useWorkItemUpdateMethods";
import { useUpdateDesignDoc } from "../../../../data/hooks/useUpdateDesignDoc";
import { useDesignDoc } from "../../../../data/hooks/useDesignDoc";
import { useSuggestionDecision } from "../../../../data/hooks/useSuggestionDecision";
import { unifiedApiClient } from "../../../../clients/serviceClients";
import { useConversationContext } from "../../../Conversation/Components/ConversationContext";

vi.mock("../../../../data/hooks/useWorkItem", () => ({
  useWorkItem: vi.fn(),
}));

vi.mock("../../../../data/hooks/useAgentSession", () => ({
  useAgentSession: vi.fn(),
}));

vi.mock("../../../../data/hooks/useWorkItemUpdateMethods", () => ({
  useWorkItemUpdateMethods: vi.fn(),
}));

vi.mock("../../../../data/hooks/useUpdateDesignDoc", () => ({
  useUpdateDesignDoc: vi.fn(),
}));

vi.mock("../../../../data/hooks/useDesignDoc", () => ({
  useDesignDoc: vi.fn(),
}));

vi.mock("../../../../data/hooks/useSuggestionDecision", () => ({
  useSuggestionDecision: vi.fn(),
}));

vi.mock("../../../../clients/serviceClients", () => ({
  unifiedApiClient: {
    getImplementationHint: vi.fn(),
    createImplementationHint: vi.fn(),
    updateImplementationHint: vi.fn(),
  },
}));

vi.mock("../../../Conversation/Components/ConversationContext", () => ({
  useConversationContext: vi.fn(),
}));

const mockUseConversationContext = vi.mocked(useConversationContext);

const mockUseWorkItem = vi.mocked(useWorkItem);
const mockUseAgentSession = vi.mocked(useAgentSession);
const mockUseWorkItemUpdateMethods = vi.mocked(useWorkItemUpdateMethods);
const mockUseUpdateDesignDoc = vi.mocked(useUpdateDesignDoc);
const mockUseDesignDoc = vi.mocked(useDesignDoc);
const mockUseSuggestionDecision = vi.mocked(useSuggestionDecision);
const mockUnifiedApiClient = vi.mocked(unifiedApiClient);

const mockUpdateTask = vi.fn();
const mockUpdateDesignDoc = vi.fn();
const mockDecisionMutate = vi.fn();

const baseConfig: FieldConfig = {
  field: "coding_prompt_final_assessment",
  description: "Final Assessment",
  type: "agent_response",
};

const baseContext: FieldComponentContext = {
  conversationId: "conversation-1",
  projectId: "project-1",
  organizationId: "org-1",
  agentSessionId: "agent-session-1",
  messageId: "message-1",
};

const buildTask = (overrides?: Record<string, unknown>) => ({
  id: "task-1",
  name: "Task 1",
  organizationId: "org-1",
  initiativeId: "initiative-1",
  status: "ACTIVE",
  sections: [
    {
      id: "section-description",
      key: "description",
      order: 0,
      materializedMarkdown: "Old task description",
    },
    {
      id: "section-details",
      key: "details",
      order: 1,
      materializedMarkdown: "Old task details",
    },
    {
      id: "section-ac",
      key: "acceptanceCriteria",
      order: 2,
      materializedMarkdown: "Old acceptance criteria",
    },
  ],
  serviceRelations: [
    {
      id: "relation-1",
      serviceId: "service-1",
      taskId: "task-1",
      createdAt: "2026-02-28T00:00:00.000Z",
    },
  ],
  ...(overrides ?? {}),
});

const buildV2Value = (artifactUpdateSuggestions: unknown[]) => ({
  responseType: "final_assessment_v2" as const,
  taskAssessment: {
    target: {
      entityType: "task" as const,
      entityId: "task-1",
    },
    verdict: "partiallyCompleted" as const,
    statusRecommendation: {
      status: "ACTIVE",
      reason: "Follow-up required.",
    },
    summary: "Some updates should be applied.",
  },
  artifactUpdateSuggestions,
  evidenceCorrections: [],
  validationRecommendationsSummary: "Run smoke checks.",
  validationRecommendations: [],
  openQuestions: [
    {
      question: "Should this remain active?",
      reason: "A follow-up path still exists.",
    },
  ],
});

describe("FinalAssessmentStructuredField", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    const decisionsById: Record<string, { accepted: boolean }> = {};
    mockUseConversationContext.mockImplementation(() => {
      const [, setVersion] = React.useState(0);
      const suggestionDecisions = {
        decisionsById,
        getDecision: (suggestionId: string | null | undefined) =>
          suggestionId ? decisionsById[suggestionId] : undefined,
        upsertDecision: (decision: { id: string; accepted: boolean }) => {
          decisionsById[decision.id] = decision;
          setVersion((current) => current + 1);
        },
      };

      return {
        handleNext: vi.fn(),
        isSubmitting: false,
        suggestionDecisions,
      } as unknown as ReturnType<typeof useConversationContext>;
    });

    mockDecisionMutate.mockImplementation(
      (_variables: {
        suggestionId: string;
        accepted: boolean;
        type: string;
        sourceConversationId: string;
        sourceMessageId: string;
      }) => new Promise(() => undefined)
    );
    mockUseSuggestionDecision.mockReturnValue({
      mutate: mockDecisionMutate,
    } as unknown as ReturnType<typeof useSuggestionDecision>);

    mockUseWorkItem.mockReturnValue({
      workItem: buildTask(),
      isLoading: false,
      isFetching: false,
      isFetched: true,
      isReady: true,
      error: null,
      isStale: false,
      refetch: vi.fn(),
      markStale: vi.fn(),
    });

    const agentSession = {
      id: "agent-session-1",
      organizationId: "org-1",
      userId: "user-1",
      status: "ACTIVE",
      conversationId: "conversation-1",
      serviceIds: ["service-1"],
      launchServiceId: "service-1",
      sessionDate: "2026-02-28T00:00:00.000Z",
      title: "Session 1",
    };

    mockUseAgentSession.mockReturnValue({
      agentSession,
      data: agentSession,
      isLoading: false,
      isFetching: false,
      isFetched: true,
      isReady: true,
      error: null,
      isStale: false,
      refetch: vi.fn().mockResolvedValue(agentSession),
      markStale: vi.fn(),
    });

    mockUseWorkItemUpdateMethods.mockReturnValue({
      updateTask: mockUpdateTask,
    } as unknown as ReturnType<typeof useWorkItemUpdateMethods>);

    mockUseUpdateDesignDoc.mockReturnValue({
      mutate: mockUpdateDesignDoc,
      isPending: false,
      isSuccess: false,
      isError: false,
      error: null,
    });

    mockUseDesignDoc.mockReturnValue({
      data: null,
      isLoading: false,
      isFetching: false,
      isFetched: true,
      isReady: true,
      error: null,
      isStale: false,
      refetch: vi.fn(),
      markStale: vi.fn(),
    });

    mockUpdateTask.mockResolvedValue(undefined);
    mockUpdateDesignDoc.mockResolvedValue(undefined);
    mockUnifiedApiClient.getImplementationHint.mockResolvedValue({
      data: {
        data: {
          id: "hint-1",
          serviceId: "service-1",
          featureName: "Existing",
          description: "Existing description",
          sourceType: "SYSTEM",
          createdAt: "2026-02-28T00:00:00.000Z",
          updatedAt: "2026-02-28T00:00:00.000Z",
        },
      },
    } as never);
    mockUnifiedApiClient.createImplementationHint.mockResolvedValue({
      data: { data: { id: "hint-2" } },
    } as never);
    mockUnifiedApiClient.updateImplementationHint.mockResolvedValue({
      data: { data: { id: "hint-1" } },
    } as never);
  });

  it("renders split-capable diff review for text suggestions", () => {
    render(
      <FinalAssessmentStructuredField
        config={baseConfig}
        context={baseContext}
        value={buildV2Value([
          {
            target: {
              entityType: "task",
              entityId: "task-1",
            },
            updateType: "task_details",
            updatePayload: {
              description: "New task description",
            },
            reasoning:
              "Description should include latest implementation notes.",
            sourceRefs: [],
          },
        ])}
      />
    );

    expect(screen.getByText("Artifact Updates")).toBeInTheDocument();
    expect(
      screen.getByTestId("final-assessment-artifact-update-select-0")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("diff-renderer-view-mode-toggle")
    ).toBeInTheDocument();
    expect(screen.getByTestId("diff-renderer-split-view")).toBeInTheDocument();
  });

  it("renders implementation hint diffs inline by default", () => {
    render(
      <FinalAssessmentStructuredField
        config={baseConfig}
        context={baseContext}
        value={buildV2Value([
          {
            target: {
              entityType: "implementationHint",
              entityId: "",
            },
            updateType: "implementation_hint_create",
            updatePayload: {
              featureName: "new-hint",
              description: "Add new implementation hint",
              sourceType: "SYSTEM",
            },
            reasoning: "Need to capture implementation guidance.",
            sourceRefs: [],
          },
        ])}
      />
    );

    expect(screen.getAllByTestId("diff-renderer-inline-view")).toHaveLength(2);
  });

  it("enables apply button only when at least one update is selected", () => {
    render(
      <FinalAssessmentStructuredField
        config={baseConfig}
        context={baseContext}
        value={buildV2Value([
          {
            target: {
              entityType: "task",
              entityId: "task-1",
            },
            updateType: "task_details",
            updatePayload: {
              details: "New task details",
            },
            reasoning: "Details should include test strategy.",
            sourceRefs: [],
          },
        ])}
      />
    );

    const applyButton = screen.getByTestId(
      "final-assessment-apply-updates-button"
    );
    expect(applyButton).toBeDisabled();

    fireEvent.click(
      screen.getByTestId("final-assessment-artifact-update-select-0")
    );

    expect(applyButton).toBeEnabled();
  });

  it("supports rejecting a suggestion and disables apply when only rejected", () => {
    render(
      <FinalAssessmentStructuredField
        config={baseConfig}
        context={baseContext}
        value={buildV2Value([
          {
            target: {
              entityType: "task",
              entityId: "task-1",
            },
            updateType: "task_details",
            updatePayload: {
              details: "New task details",
            },
            reasoning: "Details should include test strategy.",
            sourceRefs: [],
          },
        ])}
      />
    );

    const applyButton = screen.getByTestId(
      "final-assessment-apply-updates-button"
    );
    expect(applyButton).toBeDisabled();

    fireEvent.click(
      screen.getByTestId("final-assessment-artifact-update-select-0")
    );
    expect(applyButton).toBeEnabled();

    fireEvent.click(
      screen.getByTestId("final-assessment-artifact-update-reject-0")
    );
    expect(applyButton).toBeDisabled();
  });

  it("persists artifact decisions for the same message without leaking to another message", () => {
    const value = buildV2Value([
      {
        target: {
          entityType: "task",
          entityId: "task-1",
        },
        updateType: "task_details",
        updatePayload: {
          details: "New task details",
        },
        reasoning: "Details should include test strategy.",
        sourceRefs: [],
      },
    ]);

    const firstRender = render(
      <FinalAssessmentStructuredField
        config={baseConfig}
        context={baseContext}
        value={value}
      />
    );

    fireEvent.click(
      screen.getByTestId("final-assessment-artifact-update-select-0")
    );
    expect(
      screen.getByTestId("final-assessment-artifact-update-select-0")
    ).toHaveTextContent("Accepted");
    expect(mockDecisionMutate).toHaveBeenCalledTimes(1);

    firstRender.unmount();

    const secondRender = render(
      <FinalAssessmentStructuredField
        config={baseConfig}
        context={baseContext}
        value={value}
      />
    );

    expect(
      screen.getByTestId("final-assessment-artifact-update-select-0")
    ).toHaveTextContent("Accepted");

    secondRender.unmount();

    render(
      <FinalAssessmentStructuredField
        config={baseConfig}
        context={{ ...baseContext, messageId: "message-2" }}
        value={value}
      />
    );

    expect(
      screen.getByTestId("final-assessment-artifact-update-select-0")
    ).toHaveTextContent("Accept update");
  });

  it("applies selected task updates and marks them applied", async () => {
    render(
      <FinalAssessmentStructuredField
        config={baseConfig}
        context={baseContext}
        value={buildV2Value([
          {
            target: {
              entityType: "task",
              entityId: "task-1",
            },
            updateType: "task_acceptance_criteria",
            updatePayload: {
              acceptanceCriteria: "Updated acceptance criteria",
            },
            reasoning: "Criteria should include automation checks.",
            sourceRefs: [],
          },
        ])}
      />
    );

    fireEvent.click(
      screen.getByTestId("final-assessment-artifact-update-select-0")
    );
    fireEvent.click(
      screen.getByTestId("final-assessment-apply-updates-button")
    );

    await waitFor(() => {
      expect(mockUpdateTask).toHaveBeenCalledTimes(1);
    });

    expect(mockUpdateTask).toHaveBeenCalledWith(
      "task-1",
      expect.objectContaining({
        sectionUpdateSource: "AGENT_SUGGESTED",
      })
    );

    expect(
      screen.getByText("Applied 1 of 1 selected updates.")
    ).toBeInTheDocument();
  });

  it("strips diff markup tags from task update payload text before applying", async () => {
    render(
      <FinalAssessmentStructuredField
        config={baseConfig}
        context={baseContext}
        value={buildV2Value([
          {
            target: {
              entityType: "task",
              entityId: "task-1",
            },
            updateType: "task_details",
            updatePayload: {
              description:
                "<insert>Keep this</insert> and remove <delete>this</delete> plus <ins>this too</ins>.",
            },
            reasoning: "Persist plain text only.",
            sourceRefs: [],
          },
        ])}
      />
    );

    fireEvent.click(
      screen.getByTestId("final-assessment-artifact-update-select-0")
    );
    fireEvent.click(
      screen.getByTestId("final-assessment-apply-updates-button")
    );

    await waitFor(() => {
      expect(mockUpdateTask).toHaveBeenCalledTimes(1);
    });

    expect(mockUpdateTask).toHaveBeenCalledWith(
      "task-1",
      expect.objectContaining({
        sections: [
          {
            key: "description",
            content: "Keep this and remove  plus this too.",
            order: 0,
          },
        ],
      })
    );
  });

  it("strips diff markup tags from task_acceptance_criteria payload before applying", async () => {
    render(
      <FinalAssessmentStructuredField
        config={baseConfig}
        context={baseContext}
        value={buildV2Value([
          {
            target: {
              entityType: "task",
              entityId: "task-1",
            },
            updateType: "task_acceptance_criteria",
            updatePayload: {
              acceptanceCriteria:
                "Must <insert>pass</insert><delete>fail</delete><ins> reliably</ins>.",
            },
            reasoning: "Persist plain acceptance criteria text.",
            sourceRefs: [],
          },
        ])}
      />
    );

    fireEvent.click(
      screen.getByTestId("final-assessment-artifact-update-select-0")
    );
    fireEvent.click(
      screen.getByTestId("final-assessment-apply-updates-button")
    );

    await waitFor(() => {
      expect(mockUpdateTask).toHaveBeenCalledTimes(1);
    });

    expect(mockUpdateTask).toHaveBeenCalledWith(
      "task-1",
      expect.objectContaining({
        sections: [
          {
            key: "acceptanceCriteria",
            content: "Must pass reliably.",
            order: 1,
          },
        ],
      })
    );
  });

  it("strips diff markup tags from design_doc_revision payload before applying", async () => {
    render(
      <FinalAssessmentStructuredField
        config={baseConfig}
        context={baseContext}
        value={buildV2Value([
          {
            target: {
              entityType: "designDoc",
              entityId: "design-doc-1",
            },
            updateType: "design_doc_revision",
            updatePayload: {
              summary:
                "Summary <insert>kept</insert><delete>drop</delete><ins> now</ins>",
              sections: [
                {
                  key: "overview",
                  order: 0,
                  content:
                    "Line <insert>A</insert><delete>B</delete><ins> C</ins>",
                },
              ],
            },
            reasoning: "Persist plain summary and section text.",
            sourceRefs: [],
          },
        ])}
      />
    );

    fireEvent.click(
      screen.getByTestId("final-assessment-artifact-update-select-0")
    );
    fireEvent.click(
      screen.getByTestId("final-assessment-apply-updates-button")
    );

    await waitFor(() => {
      expect(mockUpdateDesignDoc).toHaveBeenCalledTimes(1);
    });

    expect(mockUpdateDesignDoc).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        designDocId: "design-doc-1",
        updates: expect.objectContaining({
          summary: "Summary kept now",
          sections: [
            {
              key: "overview",
              order: 0,
              content: "Line A C",
            },
          ],
        }),
      })
    );
  });

  it("strips diff markup tags from implementation_hint_create payload before applying", async () => {
    render(
      <FinalAssessmentStructuredField
        config={baseConfig}
        context={baseContext}
        value={buildV2Value([
          {
            target: {
              entityType: "implementationHint",
              entityId: "",
            },
            updateType: "implementation_hint_create",
            updatePayload: {
              featureName:
                "<insert>Feature</insert><delete>Legacy</delete><ins> Name</ins>",
              description:
                "Desc <insert>new</insert><delete>old</delete><ins> guidance</ins>",
              sourceType: "SYSTEM",
            },
            reasoning: "Persist plain implementation hint text.",
            sourceRefs: [],
          },
        ])}
      />
    );

    fireEvent.click(
      screen.getByTestId("final-assessment-artifact-update-select-0")
    );
    fireEvent.click(
      screen.getByTestId("final-assessment-apply-updates-button")
    );

    await waitFor(() => {
      expect(
        mockUnifiedApiClient.createImplementationHint
      ).toHaveBeenCalledTimes(1);
    });

    expect(mockUnifiedApiClient.createImplementationHint).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        createImplementationHintDto: expect.objectContaining({
          serviceId: "service-1",
          featureName: "Feature Name",
          description: "Desc new guidance",
          sourceType: "SYSTEM",
        }),
      })
    );
  });

  it("strips diff markup tags from implementation_hint_update payload before applying", async () => {
    render(
      <FinalAssessmentStructuredField
        config={baseConfig}
        context={baseContext}
        value={buildV2Value([
          {
            target: {
              entityType: "implementationHint",
              entityId: "hint-1",
            },
            updateType: "implementation_hint_update",
            updatePayload: {
              featureName: "New<delete>Legacy</delete><ins> Name</ins>",
              description:
                "Do <insert>this</insert><delete>that</delete><ins> safely</ins>",
            },
            reasoning: "Persist plain implementation hint update text.",
            sourceRefs: [],
          },
        ])}
      />
    );

    fireEvent.click(
      screen.getByTestId("final-assessment-artifact-update-select-0")
    );
    fireEvent.click(
      screen.getByTestId("final-assessment-apply-updates-button")
    );

    await waitFor(() => {
      expect(
        mockUnifiedApiClient.updateImplementationHint
      ).toHaveBeenCalledTimes(1);
    });

    expect(mockUnifiedApiClient.updateImplementationHint).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        hintId: "hint-1",
        updateImplementationHintDto: expect.objectContaining({
          serviceId: "service-1",
          featureName: "New Name",
          description: "Do this safely",
        }),
      })
    );
  });

  it("continues applying remaining updates after an earlier failure", async () => {
    mockUpdateTask
      .mockRejectedValueOnce(new Error("Task update failed"))
      .mockResolvedValueOnce(undefined);

    render(
      <FinalAssessmentStructuredField
        config={baseConfig}
        context={baseContext}
        value={buildV2Value([
          {
            target: {
              entityType: "task",
              entityId: "task-1",
            },
            updateType: "task_details",
            updatePayload: {
              details: "First update",
            },
            reasoning: "First suggestion",
            sourceRefs: [],
          },
          {
            target: {
              entityType: "task",
              entityId: "task-1",
            },
            updateType: "task_acceptance_criteria",
            updatePayload: {
              acceptanceCriteria: "Second update",
            },
            reasoning: "Second suggestion",
            sourceRefs: [],
          },
        ])}
      />
    );

    fireEvent.click(
      screen.getByTestId("final-assessment-artifact-update-select-0")
    );
    fireEvent.click(
      screen.getByTestId("final-assessment-artifact-update-select-1")
    );
    fireEvent.click(
      screen.getByTestId("final-assessment-apply-updates-button")
    );

    await waitFor(() => {
      expect(mockUpdateTask).toHaveBeenCalledTimes(2);
    });

    expect(
      screen.getByText("Applied 1 of 2 selected updates.")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("final-assessment-artifact-update-error-0")
    ).toHaveTextContent("Task update failed");
  });

  it("creates implementation hints using the active coding session service", async () => {
    render(
      <FinalAssessmentStructuredField
        config={baseConfig}
        context={baseContext}
        value={buildV2Value([
          {
            target: {
              entityType: "implementationHint",
              entityId: "",
            },
            updateType: "implementation_hint_create",
            updatePayload: {
              featureName: "new-hint",
              description: "Add new implementation hint",
              sourceType: "SYSTEM",
            },
            reasoning: "Need to capture implementation guidance.",
            sourceRefs: [],
          },
        ])}
      />
    );

    fireEvent.click(
      screen.getByTestId("final-assessment-artifact-update-select-0")
    );
    fireEvent.click(
      screen.getByTestId("final-assessment-apply-updates-button")
    );

    await waitFor(() => {
      expect(
        mockUnifiedApiClient.createImplementationHint
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: "org-1",
          createImplementationHintDto: {
            serviceId: "service-1",
            featureName: "new-hint",
            description: "Add new implementation hint",
            sourceType: "SYSTEM",
            agentSessionId: "agent-session-1",
          },
        })
      );
    });
  });

  it("fails implementation_hint_create when coding session context is unavailable", async () => {
    render(
      <FinalAssessmentStructuredField
        config={baseConfig}
        context={{
          ...baseContext,
          agentSessionId: undefined,
        }}
        value={buildV2Value([
          {
            target: {
              entityType: "implementationHint",
              entityId: "",
            },
            updateType: "implementation_hint_create",
            updatePayload: {
              featureName: "new-hint",
              description: "Add new implementation hint",
              sourceType: "SYSTEM",
            },
            reasoning: "Need to capture implementation guidance.",
            sourceRefs: [],
          },
        ])}
      />
    );

    fireEvent.click(
      screen.getByTestId("final-assessment-artifact-update-select-0")
    );
    fireEvent.click(
      screen.getByTestId("final-assessment-apply-updates-button")
    );

    await waitFor(() => {
      expect(
        screen.getByTestId("final-assessment-artifact-update-error-0")
      ).toBeInTheDocument();
    });

    expect(mockUnifiedApiClient.createImplementationHint).toHaveBeenCalledTimes(
      0
    );
    expect(
      screen.getByTestId("final-assessment-artifact-update-error-0")
    ).toHaveTextContent("Agent session context required.");
  });

  it("allows selection and applying even when disabled is true", () => {
    render(
      <FinalAssessmentStructuredField
        config={baseConfig}
        context={baseContext}
        disabled
        value={buildV2Value([
          {
            target: {
              entityType: "task",
              entityId: "task-1",
            },
            updateType: "task_details",
            updatePayload: {
              details: "New task details",
            },
            reasoning: "Details should include test strategy.",
            sourceRefs: [],
          },
        ])}
      />
    );

    const selectButton = screen.getByTestId(
      "final-assessment-artifact-update-select-0"
    );
    fireEvent.click(selectButton);

    expect(selectButton).toBeEnabled();
    expect(
      screen.getByTestId("final-assessment-artifact-update-reject-0")
    ).toBeEnabled();
    expect(
      screen.getByTestId("final-assessment-apply-updates-button")
    ).toBeEnabled();
  });

  it("renders final_assessment_v1 payloads as read-only", () => {
    render(
      <FinalAssessmentStructuredField
        config={baseConfig}
        context={baseContext}
        value={{
          structuredResponse: {
            responseType: "final_assessment_v1",
            parsed: {
              responseType: "final_assessment_v1",
              taskAssessment: {
                target: {
                  entityType: "task",
                  entityId: "task-1",
                },
                verdict: "partiallyCompleted",
                statusRecommendation: {
                  status: "ACTIVE",
                  reason: "Follow-up needed.",
                },
                summary: "Most changes landed.",
              },
              artifactUpdateSuggestions: [
                {
                  target: {
                    entityType: "task",
                    entityId: "task-1",
                  },
                  updateType: "task_details",
                  updatePayload: {
                    details: "Legacy summary content.",
                  },
                  reasoning: "Legacy recommendation",
                  sourceRefs: [],
                },
              ],
              evidenceCorrections: [],
              openQuestions: [],
            },
          },
        }}
      />
    );

    expect(screen.getByText("Recommended status: ACTIVE")).toBeInTheDocument();
    expect(screen.getByText("1. Task Details")).toBeInTheDocument();
    expect(
      screen.getByText("Details: Legacy summary content.")
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("final-assessment-apply-updates-button")
    ).not.toBeInTheDocument();
  });

  it("keeps open questions visible", () => {
    render(
      <FinalAssessmentStructuredField
        config={baseConfig}
        context={baseContext}
        value={buildV2Value([])}
      />
    );

    expect(screen.getByText("Open Questions")).toBeInTheDocument();
    expect(screen.getByText("Should this remain active?")).toBeInTheDocument();
  });

  it("renders hierarchyWalk entries when present in V2 payload", () => {
    const value = {
      ...buildV2Value([]),
      hierarchyWalk: [
        {
          entityType: "feature",
          entityId: "feat-1",
          name: "Auth Module",
          distance: 1,
          action: "proposed_update",
          rationale: "Task completion changes feature progress from 60% to 80%",
        },
        {
          entityType: "feature",
          entityId: "feat-2",
          name: "Platform Security",
          distance: 2,
          action: "no_update",
          rationale: "No material change at this level",
        },
      ],
    };

    render(
      <MemoryRouter>
        <FinalAssessmentStructuredField
          config={baseConfig}
          context={baseContext}
          value={value}
        />
      </MemoryRouter>
    );

    expect(screen.getByText("Hierarchy Walk")).toBeInTheDocument();
    const hierarchySection = screen.getByTestId(
      "final-assessment-hierarchy-walk"
    );
    expect(hierarchySection).toHaveTextContent(
      "Auth Module [proposed_update] - Task completion changes feature progress from 60% to 80%"
    );
    expect(hierarchySection).toHaveTextContent(
      "Platform Security [no_update] - No material change at this level"
    );
  });

  it("does not render hierarchy walk section when hierarchyWalk is empty", () => {
    render(
      <FinalAssessmentStructuredField
        config={baseConfig}
        context={baseContext}
        value={{ ...buildV2Value([]), hierarchyWalk: [] }}
      />
    );

    expect(screen.queryByText("Hierarchy Walk")).not.toBeInTheDocument();
  });

  it("renders dependentTaskWalk entries when present in V2 payload", () => {
    render(
      <MemoryRouter>
        <FinalAssessmentStructuredField
          config={baseConfig}
          context={baseContext}
          value={{
            ...buildV2Value([]),
            dependentTaskWalk: [
              {
                entityType: "task",
                entityId: "task-dep-1",
                name: "Setup Auth Tokens",
                relationshipType: "DEPENDS_ON",
                action: "proposed_update",
                rationale: "Parent task completion affects dependent status",
              },
              {
                entityType: "task",
                entityId: "task-dep-2",
                name: "Rotate Credentials",
                relationshipType: "DERIVES_FROM",
                action: "no_update",
                rationale: "No material change required",
              },
            ],
          }}
        />
      </MemoryRouter>
    );

    expect(screen.getByText("Dependent Task Walk")).toBeInTheDocument();
    expect(screen.getByText("Setup Auth Tokens")).toBeInTheDocument();
    expect(screen.getByText("DEPENDS_ON")).toBeInTheDocument();
    expect(screen.getByText("Rotate Credentials")).toBeInTheDocument();
    expect(screen.getByText("DERIVES_FROM")).toBeInTheDocument();
    expect(
      screen.getByText("Parent task completion affects dependent status")
    ).toBeInTheDocument();
    expect(screen.getByText("No material change required")).toBeInTheDocument();
  });

  it("does not render dependent task walk section when dependentTaskWalk is empty", () => {
    render(
      <FinalAssessmentStructuredField
        config={baseConfig}
        context={baseContext}
        value={{ ...buildV2Value([]), dependentTaskWalk: [] }}
      />
    );

    expect(screen.queryByText("Dependent Task Walk")).not.toBeInTheDocument();
  });

  it("does not render dependent task walk section when dependentTaskWalk is absent", () => {
    render(
      <FinalAssessmentStructuredField
        config={baseConfig}
        context={baseContext}
        value={buildV2Value([])}
      />
    );

    expect(screen.queryByText("Dependent Task Walk")).not.toBeInTheDocument();
  });
});
