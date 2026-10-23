import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VerifyFeatureElement } from "../../../../api";
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
  useSuggestionDecision: () => ({ mutate: vi.fn() }),
}));
vi.mock("../../../Conversation/utils/conversationFormHelpers", () => ({
  createSecondActionFromAPI: () => ({ onExecute: mocks.next }),
}));
vi.mock("../index", () => ({ getSecondaryActionBehavior: () => undefined }));
vi.mock("../../../SmarterTextAreaCard/MentionBadge", () => ({
  MentionBadgeInner: ({
    mention,
    mode,
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
const entityNames = vi.hoisted(() => ({
  lookups: [] as unknown[],
  names: new Map<string, string>(),
}));
vi.mock("../../../../data/hooks/useEntityNames", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../../../data/hooks/useEntityNames")
  >()),
  useEntityNames: ({ entities }: { entities: unknown[] }) => {
    entityNames.lookups = entities;
    return { names: entityNames.names, isLoading: false, error: null };
  },
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

beforeEach(() => {
  vi.clearAllMocks();
  mocks.launch.mockResolvedValue(true);
});
describe("Verify Feature field and secondary action", () => {
  it("renders the explanation as markdown without changing form values", () => {
    const change = vi.fn();
    render(
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
    render(
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

  it("lists affected entities as full mention nodes after the concern, once each, in order", () => {
    render(
      <VerifyFeatureField
        config={{ field: field.id, type: field.type, description: field.label }}
        value={{
          ...field.payload,
          impactedEntities: [
            { entityType: "TASK", entityId: "b" },
            { entityType: "FEATURE", entityId: "a" },
            { entityType: "TASK", entityId: "b" },
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

  it("labels affected entities with their resolved names", () => {
    entityNames.names = new Map([["TASK:task-id", "Record eval runs"]]);
    render(
      <VerifyFeatureField
        config={{ field: field.id, type: field.type, description: field.label }}
        value={{
          ...field.payload,
          impactedEntities: [
            { entityType: "MOCKUP", entityId: "task-id" },
            { entityType: "FEATURE", entityId: "unnamed-id" },
          ],
        }}
        context={context}
        isSubmitted={false}
        onChange={vi.fn()}
      />,
    );
    expect(entityNames.lookups).toEqual([
      { entityId: "task-id", entityType: "TASK" },
      { entityId: "unnamed-id", entityType: "TASK" },
    ]);
    const nodes = screen.getAllByTestId("mention-node");
    expect(nodes.map((n) => n.getAttribute("data-entity-name"))).toEqual([
      "Record eval runs",
      "unnamed-id",
    ]);
    entityNames.names = new Map();
  });

  it.each([
    ["empty", []],
    ["missing", undefined],
  ])("renders no list area for a %s list", (_label, impactedEntities) => {
    render(
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
    render(
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
      </VerificationRuntimeContext.Provider>,
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
    mocks.launch.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    render(
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
      </VerificationRuntimeContext.Provider>,
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
