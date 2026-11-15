import { ThemeProvider } from "@mui/material";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VerifyFeatureElement } from "../../../../api";
import { createHeyTheme } from "../../../../contexts/ThemeContext";
import { VerifyFeatureField } from "../VerifyFeatureField";
import { SecondaryActionRenderer } from "../../../Conversation/SecondaryActionRenderer";
import { VerificationRuntimeContext } from "../../../Conversation/SecondaryActions/verificationRuntimeContext";
import type { EntityConversationPromptRuntimeSelection } from "../../../InteractionComponent/EntityConversationPromptDialog";

const mocks = vi.hoisted(() => ({ launch: vi.fn(), next: vi.fn() }));
vi.mock(
  "../../../InteractionComponent/useFeatureSyncConversationLauncher",
  () => ({
    useFeatureSyncConversationLauncher: () => ({
      launch: mocks.launch,
      isLoading: false,
      error: null,
      clearError: vi.fn(),
    }),
  }),
);
vi.mock("../../../InteractionComponent", () => ({
  EntityConversationPromptDialog: ({
    open,
    onClose,
    onSubmit,
    preCannedPrompt,
    userInput,
    onUserInputChange,
    runtimeSelection,
  }: {
    open: boolean;
    onClose: () => void;
    onSubmit: (prompt: string) => void;
    preCannedPrompt: string;
    userInput: string;
    onUserInputChange: (value: string) => void;
    runtimeSelection: EntityConversationPromptRuntimeSelection;
  }) =>
    open ? (
      <div
        data-testid="mock-entity-conversation-prompt-dialog"
        data-pre-canned-prompt={preCannedPrompt}
        data-selected-machine-id={runtimeSelection.selectedMachineId ?? ""}
      >
        <input
          data-testid="mock-entity-conversation-prompt-guidance"
          value={userInput}
          onChange={(event) => onUserInputChange(event.target.value)}
        />
        <button
          type="button"
          data-testid="mock-entity-conversation-prompt-submit"
          onClick={() => {
            runtimeSelection.onProviderChange("codex");
            runtimeSelection.onModelChange("gpt-5.6-sol");
            runtimeSelection.onReasoningEffortChange("high");
            runtimeSelection.onFastModeChange(true);
            onSubmit(
              `${preCannedPrompt}\n\n${
                userInput.trim() || "Edited verification guidance"
              }`,
            );
          }}
        >
          Submit verification
        </button>
        <button type="button" onClick={onClose}>
          Close verification
        </button>
      </div>
    ) : null,
}));
vi.mock("../../../../contexts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../contexts")>()),
  usePathService: () => ({
    agentSession: ({ agentSessionId }: { agentSessionId: string }) =>
      `/sessions/${agentSessionId}`,
  }),
}));
vi.mock("../../../../data/hooks/useAgentSession", () => ({
  useAgentSession: () => ({ data: null }),
}));
vi.mock("../../../AgentSession/runtime/coding/useMachineResolution", () => ({
  useMachineResolution: (preferred: string) => ({
    isReady: true,
    mode: "one",
    machines: [],
    selectedMachine: { machineId: preferred },
    setSelectedMachineId: vi.fn(),
  }),
}));
vi.mock("../../../AgentSession/surfaceSelectionMemory", () => ({
  DISCUSS_SURFACE_ID: "discuss",
  readSurfaceSelection: () => null,
  writeSurfaceSelection: vi.fn(),
  buildDefaultSurfaceSelection: () => ({
    provider: "claude",
    model: "model",
    reasoningEffort: "medium",
  }),
}));
vi.mock("../../../Conversation/Components/ConversationContext", () => ({
  useConversationContext: () => ({
    suggestionDecisions: { getDecision: () => undefined },
  }),
}));
vi.mock("../../../../data/hooks/useSuggestionDecision", () => ({
  useSuggestionDecision: () => ({ mutate: vi.fn().mockResolvedValue({}) }),
}));
vi.mock("../../../Conversation/utils/conversationFormHelpers", () => ({
  createSecondActionFromAPI: () => ({ onExecute: mocks.next }),
}));
vi.mock("../index", () => ({ getSecondaryActionBehavior: () => undefined }));
vi.mock("../../../SmarterTextAreaCard/MentionBadge", () => ({
  MentionBadgeInner: ({
    mention,
    mode = "full",
  }: {
    mention: { entityType: string; entityId: string; entityName: string };
    mode: string;
  }) => (
    <span
      data-testid="mention-node"
      data-mode={mode}
      data-entity-name={mention.entityName}
    >
      {`${mention.entityType}:${mention.entityId}`}
    </span>
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
    explanation: "[A delivered capability](#capability) changed.",
    impactedEntities: [],
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

const renderField = (ui: React.ReactElement) =>
  render(<ThemeProvider theme={createHeyTheme("light")}>{ui}</ThemeProvider>);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.launch.mockResolvedValue({ agentSessionId: "created-session" });
});

describe("Verify Feature field and secondary action", () => {
  it("renders the explanation as markdown without changing form values", () => {
    const change = vi.fn();
    renderField(
      <VerifyFeatureField
        config={{ field: field.id, type: field.type, description: field.label }}
        value={field.payload}
        context={context}
        isSubmitted={false}
        onChange={change}
      />,
    );
    expect(screen.getByTestId("verify-feature-field")).toHaveTextContent(
      "A delivered capability changed.",
    );
    expect(
      screen.getByRole("link", { name: "A delivered capability" }),
    ).toHaveAttribute("href", "#capability");
    expect(change).not.toHaveBeenCalled();
  });
  it("renders mention tokens in the explanation as mention nodes", () => {
    renderField(
      <VerifyFeatureField
        config={{ field: field.id, type: field.type, description: field.label }}
        value={{
          ...field.payload,
          explanation:
            "Check @[feature:3782302e-54ad-4908-b168-0b2260a89b3c|Sync] now.",
        }}
        context={context}
        isSubmitted={false}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId("mention-node")).toHaveTextContent(
      "feature:3782302e-54ad-4908-b168-0b2260a89b3c",
    );
  });

  it("renders the card header with the after-implementation chip", () => {
    renderField(
      <VerifyFeatureField
        config={{ field: field.id, type: field.type, description: field.label }}
        value={field.payload}
        context={context}
        isSubmitted={false}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId("conversation-card-header")).toHaveTextContent(
      "Project sync · Possible issue",
    );
    expect(screen.getByText("After implementation")).toBeInTheDocument();
  });

  it("splits a multi-sentence explanation into a lead and details", () => {
    renderField(
      <VerifyFeatureField
        config={{ field: field.id, type: field.type, description: field.label }}
        value={{
          ...field.payload,
          explanation: "The sync drifted. Tasks no longer match the feature.",
        }}
        context={context}
        isSubmitted={false}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId("conversation-card-lead")).toHaveTextContent(
      "The sync drifted.",
    );
    expect(
      screen.getByTestId("conversation-card-section-label"),
    ).toHaveTextContent("Details");
    expect(screen.getByTestId("conversation-card-section")).toHaveTextContent(
      "Tasks no longer match the feature.",
    );
  });

  it.each([
    [
      "a paragraph break",
      "The sync drifted.\n\nTasks no longer match the feature.",
    ],
    [
      "a bolded sentence ending",
      "**The sync drifted.** Tasks no longer match the feature.",
    ],
  ])("splits lead and details across %s", (_label, explanation) => {
    renderField(
      <VerifyFeatureField
        config={{ field: field.id, type: field.type, description: field.label }}
        value={{ ...field.payload, explanation }}
        context={context}
        isSubmitted={false}
        onChange={vi.fn()}
      />,
    );
    const lead = screen.getByTestId("conversation-card-lead");
    expect(lead).toHaveTextContent("The sync drifted.");
    expect(lead).not.toHaveTextContent("Tasks no longer");
    expect(
      screen.getByTestId("conversation-card-section-label"),
    ).toHaveTextContent("Details");
    expect(screen.getByTestId("conversation-card-section")).toHaveTextContent(
      "Tasks no longer match the feature.",
    );
  });

  it("renders only a lead for a single-sentence explanation", () => {
    renderField(
      <VerifyFeatureField
        config={{ field: field.id, type: field.type, description: field.label }}
        value={field.payload}
        context={context}
        isSubmitted={false}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId("conversation-card-lead")).toHaveTextContent(
      "A delivered capability changed.",
    );
    expect(screen.queryByText("Details")).not.toBeInTheDocument();
  });

  it("does not split inside a mention whose title contains a period", () => {
    renderField(
      <VerifyFeatureField
        config={{ field: field.id, type: field.type, description: field.label }}
        value={{
          ...field.payload,
          explanation:
            "Check @[feature:3782302e-54ad-4908-b168-0b2260a89b3c|Sync v2. Beta] now. Then review.",
        }}
        context={context}
        isSubmitted={false}
        onChange={vi.fn()}
      />,
    );
    const lead = screen.getByTestId("conversation-card-lead");
    expect(lead).toHaveTextContent("now.");
    expect(lead).not.toHaveTextContent("Then review.");
    expect(screen.getByTestId("conversation-card-section")).toHaveTextContent(
      "Then review.",
    );
  });

  it("renders footer actions inside the card footer", () => {
    renderField(
      <VerifyFeatureField
        config={{ field: field.id, type: field.type, description: field.label }}
        value={field.payload}
        context={context}
        isSubmitted={false}
        onChange={vi.fn()}
        footerActions={<button type="button">Act</button>}
      />,
    );
    expect(screen.getByTestId("conversation-card-footer")).toContainElement(
      screen.getByRole("button", { name: "Act" }),
    );
  });

  it("lists affected entities as full mention nodes after the concern, once each, in order", () => {
    renderField(
      <VerifyFeatureField
        config={{ field: field.id, type: field.type, description: field.label }}
        value={{
          ...field.payload,
          impactedEntities: [
            { entityType: "TASK", entityId: "b", title: "B" },
            { entityType: "FEATURE", entityId: "a", title: "A" },
            { entityType: "TASK", entityId: "b", title: "B" },
          ],
        }}
        context={context}
        isSubmitted={false}
        onChange={vi.fn()}
      />,
    );
    const list = screen.getByTestId("verify-feature-impacted-entities");
    const nodes = Array.from(
      list.querySelectorAll("[data-testid=mention-node]"),
    );
    expect(nodes.map((n) => n.textContent)).toEqual(["TASK:b", "FEATURE:a"]);
    expect(nodes.every((n) => n.getAttribute("data-mode") === "full")).toBe(
      true,
    );
    expect(
      screen.getByText("A delivered capability").compareDocumentPosition(list) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("labels affected entities with their supplied titles and falls back to the id for older references", () => {
    renderField(
      <VerifyFeatureField
        config={{ field: field.id, type: field.type, description: field.label }}
        value={{
          ...field.payload,
          impactedEntities: [
            { entityType: "plan", entityId: "plan-id", title: "Ship it" },
            { entityType: "task", entityId: "older-id" },
          ],
        }}
        context={context}
        isSubmitted={false}
        onChange={vi.fn()}
      />,
    );
    const nodes = screen.getAllByTestId("mention-node");
    expect(nodes.map((n) => n.getAttribute("data-entity-name"))).toEqual([
      "Ship it",
      "older-id",
    ]);
  });

  it.each([
    ["empty", []],
    ["missing", undefined],
  ])("renders no list area for a %s list", (_label, impactedEntities) => {
    renderField(
      <VerifyFeatureField
        config={{ field: field.id, type: field.type, description: field.label }}
        value={{ ...field.payload, impactedEntities }}
        context={context}
        isSubmitted={false}
        onChange={vi.fn()}
      />,
    );
    expect(
      screen.queryByTestId("verify-feature-impacted-entities"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Possibly affected")).not.toBeInTheDocument();
  });

  it("opens shared staging without launching until the edited modal is submitted", async () => {
    renderField(
      <MemoryRouter>
        <VerificationRuntimeContext.Provider
          value={{
            parentAgentSessionId: "source-session",
            machineId: "selected-machine",
            serviceIds: ["one", "two"],
            launchServiceId: "two",
          }}
        >
          <SecondaryActionRenderer
            action={action}
            context={context}
            trackUI={vi.fn()}
            messageId="source-message"
            handleNext={mocks.next}
            formValues={{}}
            uiElements={[field]}
          />
        </VerificationRuntimeContext.Provider>
      </MemoryRouter>,
    );
    expect(mocks.launch).not.toHaveBeenCalled();
    const verifyButton = screen.getByTestId("project-topology-button");
    expect(verifyButton).toHaveAccessibleName("Potential project sync issue");
    fireEvent.click(verifyButton);
    expect(mocks.launch).not.toHaveBeenCalled();
    expect(
      screen.getByTestId("mock-entity-conversation-prompt-dialog"),
    ).toHaveAttribute("data-pre-canned-prompt", field.payload.explanation);
    expect(
      screen.getByTestId("mock-entity-conversation-prompt-dialog"),
    ).toHaveAttribute("data-selected-machine-id", "selected-machine");

    fireEvent.change(
      screen.getByTestId("mock-entity-conversation-prompt-guidance"),
      { target: { value: "Prioritize the affected task." } },
    );
    fireEvent.click(
      screen.getByTestId("mock-entity-conversation-prompt-submit"),
    );
    await waitFor(() =>
      expect(mocks.launch).toHaveBeenCalledWith(
        expect.objectContaining({
          check: field.payload,
          parentAgentSessionId: "source-session",
          prompt: expect.stringContaining("Prioritize the affected task."),
          provider: "codex",
          model: "gpt-5.6-sol",
          reasoningEffort: "high",
          fastMode: true,
          machineId: "selected-machine",
          serviceIds: ["one", "two"],
          launchServiceId: "two",
        }),
      ),
    );
    await waitFor(() =>
      expect(
        screen.queryByTestId("mock-entity-conversation-prompt-dialog"),
      ).not.toBeInTheDocument(),
    );
    expect(mocks.next).not.toHaveBeenCalled();
  });

  it("keeps staging open for a failed start so the prompt can be retried", async () => {
    mocks.launch
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ agentSessionId: "created-session" });
    renderField(
      <MemoryRouter>
        <VerificationRuntimeContext.Provider
          value={{
            parentAgentSessionId: "source-session",
            machineId: "selected-machine",
            serviceIds: [],
            launchServiceId: null,
          }}
        >
          <SecondaryActionRenderer
            action={action}
            context={context}
            trackUI={vi.fn()}
            messageId="source-message"
            handleNext={mocks.next}
            formValues={{}}
            uiElements={[field]}
          />
        </VerificationRuntimeContext.Provider>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByTestId("project-topology-button"));
    fireEvent.click(
      screen.getByTestId("mock-entity-conversation-prompt-submit"),
    );

    await waitFor(() => expect(mocks.launch).toHaveBeenCalledTimes(1));
    expect(
      screen.getByTestId("mock-entity-conversation-prompt-dialog"),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByTestId("mock-entity-conversation-prompt-submit"),
    );
    await waitFor(() => expect(mocks.launch).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(
        screen.queryByTestId("mock-entity-conversation-prompt-dialog"),
      ).not.toBeInTheDocument(),
    );
  });
});
