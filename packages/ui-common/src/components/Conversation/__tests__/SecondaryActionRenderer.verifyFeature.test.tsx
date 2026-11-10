import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VerifyFeatureElement } from "../../../api";
import type { ConversationResponseDto } from "../../../api";
// Provided only by the mock of the conversation context above.
// @ts-expect-error mock-only export
import { TestDecisionsContext } from "../Components/ConversationContext";
import { useSuggestionDecisions } from "../hooks/useSuggestionDecisions";
import { VerifyFeatureField } from "../../LlmForms/Registry/VerifyFeatureField";
import { SecondaryActionRenderer } from "../SecondaryActionRenderer";
import { VerificationRuntimeContext } from "../SecondaryActions/verificationRuntimeContext";

const mocks = vi.hoisted(() => ({
  launch: vi.fn(),
  mutate: vi.fn(),
}));

vi.mock(
  "../../InteractionComponent/useFeatureSyncConversationLauncher",
  () => ({
    useFeatureSyncConversationLauncher: () => ({
      launch: mocks.launch,
      isLoading: false,
      error: null,
      clearError: vi.fn(),
    }),
  }),
);
vi.mock("../../InteractionComponent", () => ({
  EntityConversationPromptDialog: ({
    onSubmit,
    runtimeSelection,
  }: {
    onSubmit: (prompt: string) => void;
    runtimeSelection: {
      onProviderChange: (provider: string) => void;
      onModelChange: (model: string) => void;
    };
  }) => (
    <button
      type="button"
      data-testid="submit-verification"
      onClick={() => {
        runtimeSelection.onProviderChange("claude");
        runtimeSelection.onModelChange("model");
        onSubmit("verify");
      }}
    >
      Submit
    </button>
  ),
}));
vi.mock("../../../data/hooks/useAgentSession", () => ({
  useAgentSession: () => ({ data: null }),
}));
vi.mock("../../AgentSession/runtime/coding/useMachineResolution", () => ({
  useMachineResolution: (preferred: string) => ({
    machines: [],
    selectedMachine: { machineId: preferred },
    setSelectedMachineId: vi.fn(),
  }),
}));
vi.mock("../../AgentSession/surfaceSelectionMemory", () => ({
  DISCUSS_SURFACE_ID: "discuss",
  readSurfaceSelection: () => null,
  writeSurfaceSelection: vi.fn(),
  buildDefaultSurfaceSelection: () => ({
    provider: "claude",
    model: "model",
    reasoningEffort: "medium",
  }),
}));
vi.mock("../Components/ConversationContext", async () => {
  const { createContext, useContext } = await import("react");
  const TestDecisionsContext = createContext<unknown>(null);
  return {
    TestDecisionsContext,
    useConversationContext: () => ({
      suggestionDecisions: useContext(TestDecisionsContext),
    }),
  };
});
vi.mock("../../../data/hooks/useSuggestionDecision", () => ({
  useSuggestionDecision: () => ({ mutate: mocks.mutate }),
}));
vi.mock("../../../contexts", () => ({
  usePathService: () => ({
    agentSession: ({
      projectId,
      agentSessionId,
    }: {
      projectId: string;
      agentSessionId: string;
    }) => `/projects/${projectId}/sessions/${agentSessionId}`,
  }),
}));
vi.mock("../utils/conversationFormHelpers", () => ({
  createSecondActionFromAPI: () => ({ onExecute: vi.fn() }),
}));
vi.mock("../../SmarterTextAreaCard/MentionBadge", () => ({
  MentionBadgeInner: ({
    mention,
  }: {
    mention: { entityType: string; entityId: string };
  }) => (
    <span data-testid="mention-node">{`${mention.entityType}:${mention.entityId}`}</span>
  ),
}));

const context = {
  organizationId: "org",
  projectId: "project",
  conversationId: "source-conversation",
  agentSessionId: "source-session",
};
const field: VerifyFeatureElement = {
  id: "verify-feature",
  type: "verify_feature",
  label: "Verify Feature",
  payload: {
    feature: {
      entityType: "FEATURE",
      entityId: "3782302e-54ad-4908-b168-0b2260a89b3c",
    },
    explanation: "A delivered capability changed.",
    impactedEntities: [
      { entityType: "TASK", entityId: "b", title: "B" },
      { entityType: "FEATURE", entityId: "a", title: "A" },
    ],
  },
};
const action = {
  id: "verify",
  type: "field_action" as const,
  label: "Verify Feature",
  fieldId: field.id,
  handler: "verify_feature" as const,
  presentation: "INLINE" as const,
};
const suggestionId = "message-1:verify-feature";

/**
 * Feeds the renderer from the real conversation-decision lookup, built from a
 * conversation shaped like the API returns it with includeSuggestionDecisions.
 */
function ConversationDecisions({
  conversation,
  children,
}: {
  conversation: ConversationResponseDto;
  children: React.ReactNode;
}) {
  const decisions = useSuggestionDecisions(conversation);
  return (
    <TestDecisionsContext.Provider value={decisions}>
      {children}
    </TestDecisionsContext.Provider>
  );
}

const renderSuggestion = (
  messageId = "message-1",
  conversation: ConversationResponseDto = loadedConversation([]),
) =>
  render(
    <MemoryRouter>
      <ConversationDecisions conversation={conversation}>
        <VerificationRuntimeContext.Provider
          value={{
            parentAgentSessionId: "source-session",
            machineId: "machine",
            serviceIds: [],
            launchServiceId: null,
          }}
        >
          <VerifyFeatureField
            config={{
              field: field.id,
              type: field.type,
              description: field.label,
            }}
            value={field.payload}
            context={context}
            isSubmitted={false}
            onChange={vi.fn()}
          />
          <SecondaryActionRenderer
            action={action}
            context={context}
            trackUI={vi.fn()}
            messageId={messageId}
            handleNext={vi.fn()}
            formValues={{}}
            isSubmissionLocked={false}
            uiElements={[field]}
          />
        </VerificationRuntimeContext.Provider>
      </ConversationDecisions>
    </MemoryRouter>,
  );

const startedDecision = {
  id: suggestionId,
  type: "verify_feature",
  accepted: true,
  decidedBy: "someone-else",
  createdAt: "2026-11-10T00:00:00.000Z",
  sourceConversationId: "source-conversation",
  sourceMessageId: "message-1",
  metadata: { kind: "VERIFY_FEATURE", agentSessionId: "stored-session" },
};

const olderDecision = {
  id: "older-message:task-1",
  type: "task_content_apply",
  accepted: true,
  decidedBy: "someone-else",
  createdAt: "2026-11-09T00:00:00.000Z",
  sourceConversationId: "source-conversation",
  sourceMessageId: "older-message",
  metadata: { kind: "CREATE_SUGGESTED_TASK", workflowId: "wf-1" },
};

const loadedConversation = (decisions: unknown[]): ConversationResponseDto =>
  ({
    id: "source-conversation",
    suggestionDecisions: decisions,
    goalPmRoutingDecisions: [],
  }) as unknown as ConversationResponseDto;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.mutate.mockResolvedValue(startedDecision);
});

const launchAndSubmit = () => {
  fireEvent.click(screen.getByTestId("project-topology-button"));
  fireEvent.click(screen.getByTestId("submit-verification"));
};

describe("Verify Feature remembers that it was started", () => {
  it("shows a link to the stored session after a reload, keeping the concern and mentions in order", () => {
    renderSuggestion(
      "message-1",
      loadedConversation([olderDecision, startedDecision]),
    );

    const link = screen.getByTestId("verify-feature-started-link");
    expect(link).toHaveTextContent("Verification started");
    expect(link).toHaveAttribute(
      "href",
      "/projects/project/sessions/stored-session",
    );
    expect(
      screen.queryByTestId("project-topology-button"),
    ).not.toBeInTheDocument();
    expect(
      screen.getAllByTestId("mention-node").map((node) => node.textContent),
    ).toEqual(["TASK:b", "FEATURE:a"]);
    expect(
      screen
        .getByText("A delivered capability changed.")
        .compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(mocks.launch).not.toHaveBeenCalled();
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it("offers the action for an older suggestion with no decision, even when the conversation has others", () => {
    renderSuggestion(
      "older-message",
      loadedConversation([olderDecision, startedDecision]),
    );

    expect(screen.getByTestId("project-topology-button")).toBeInTheDocument();
    expect(
      screen.queryByTestId("verify-feature-started-link"),
    ).not.toBeInTheDocument();
  });

  it("offers the action as before for a conversation with no decisions", () => {
    renderSuggestion();

    expect(screen.getByTestId("project-topology-button")).toBeInTheDocument();
    expect(
      screen.queryByTestId("verify-feature-started-link"),
    ).not.toBeInTheDocument();
  });

  it("records one decision with the created session after a successful launch, then shows the link", async () => {
    mocks.launch.mockResolvedValue({ agentSessionId: "created-session" });
    mocks.mutate.mockResolvedValue({
      ...startedDecision,
      metadata: { kind: "VERIFY_FEATURE", agentSessionId: "created-session" },
    });
    renderSuggestion();

    launchAndSubmit();

    await waitFor(() =>
      expect(screen.getByTestId("verify-feature-started-link")).toHaveAttribute(
        "href",
        "/projects/project/sessions/created-session",
      ),
    );
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
    expect(mocks.mutate).toHaveBeenCalledWith({
      organizationId: "org",
      type: "verify_feature",
      suggestionId,
      accepted: true,
      sourceConversationId: "source-conversation",
      sourceMessageId: "message-1",
      metadata: { kind: "VERIFY_FEATURE", agentSessionId: "created-session" },
    });
    expect(mocks.launch).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByTestId("verify-feature-save-failed"),
    ).not.toBeInTheDocument();
  });

  it("records nothing and keeps the action when the launch fails or is cancelled", async () => {
    mocks.launch.mockResolvedValue(null);
    renderSuggestion();

    launchAndSubmit();

    await waitFor(() => expect(mocks.launch).toHaveBeenCalledTimes(1));
    expect(mocks.mutate).not.toHaveBeenCalled();
    expect(screen.getByTestId("project-topology-button")).toBeInTheDocument();
  });

  it("keeps the created session linked when saving fails, and retries only the save", async () => {
    mocks.launch.mockResolvedValue({ agentSessionId: "created-session" });
    mocks.mutate.mockRejectedValueOnce(new Error("network down"));
    renderSuggestion();

    launchAndSubmit();

    await screen.findByTestId("verify-feature-save-failed");
    expect(screen.getByTestId("verify-feature-started-link")).toHaveAttribute(
      "href",
      "/projects/project/sessions/created-session",
    );

    mocks.mutate.mockResolvedValueOnce({
      ...startedDecision,
      metadata: { kind: "VERIFY_FEATURE", agentSessionId: "created-session" },
    });
    fireEvent.click(screen.getByTestId("verify-feature-retry-save"));

    await waitFor(() =>
      expect(
        screen.queryByTestId("verify-feature-save-failed"),
      ).not.toBeInTheDocument(),
    );
    expect(mocks.mutate).toHaveBeenCalledTimes(2);
    expect(mocks.mutate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        suggestionId,
        metadata: { kind: "VERIFY_FEATURE", agentSessionId: "created-session" },
      }),
    );
    expect(mocks.launch).toHaveBeenCalledTimes(1);
    expect(
      screen.getByTestId("verify-feature-started-link"),
    ).toBeInTheDocument();
  });
});
