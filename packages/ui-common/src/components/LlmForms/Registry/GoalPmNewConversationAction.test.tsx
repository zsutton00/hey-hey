import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GoalPmNewConversationAction } from "./GoalPmNewConversationAction";

const mocks = vi.hoisted(() => ({
  selection: null as null | {
    provider: "claude" | "codex";
    model: string;
    reasoningEffort: "high" | null;
    fastMode?: boolean;
  },
  updateSelection: vi.fn(),
  selectedMachine: null as null | { machineId: string },
  supportsFast: true,
  selectorProps: vi.fn(),
}));

vi.mock("../../AgentSession/runtime/coding/useMachineResolution", () => ({
  useMachineResolution: () => ({
    machines: [],
    mode: "one",
    isReady: true,
    selectedMachine: mocks.selectedMachine,
    setSelectedMachineId: vi.fn(),
  }),
}));
vi.mock("../../AgentSession/useSurfaceSelection", () => ({
  useSurfaceSelection: () => ({
    selection: mocks.selection,
    updateSelection: mocks.updateSelection,
  }),
}));
vi.mock("../../AgentSession/capabilityCatalog", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../AgentSession/capabilityCatalog")
  >()),
  supportsFastMode: () => mocks.supportsFast,
}));
vi.mock("../../AgentSession/RuntimeModelSelector", () => ({
  RuntimeModelSelector: (props: { disabled?: boolean }) => {
    mocks.selectorProps(props);
    return <div data-testid="runtime-selector-stub" />;
  },
}));

const renderAction = (disabled = false) => {
  const onStart = vi.fn();
  render(
    <GoalPmNewConversationAction
      organizationId="org"
      projectId="project"
      optionId="new"
      label="Start Conversation"
      disabled={disabled}
      onStart={onStart}
    />,
  );
  return onStart;
};

describe("GoalPmNewConversationAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.selection = {
      provider: "claude",
      model: "model-1",
      reasoningEffort: "high",
      fastMode: true,
    };
    mocks.selectedMachine = { machineId: "machine-1" };
    mocks.supportsFast = true;
  });

  it("starts with exactly the displayed runtime", () => {
    const onStart = renderAction();
    fireEvent.click(screen.getByTestId("goal-pm-record-choice"));
    expect(onStart).toHaveBeenCalledExactlyOnceWith({
      config: {
        type: "ENTITY_CONVERSATION",
        version: "v1",
        model: "model-1",
        effort: "high",
      },
      provider: "claude",
      machineId: "machine-1",
      fastMode: true,
    });
  });

  it("omits Fast mode when the model does not support it", () => {
    mocks.supportsFast = false;
    const onStart = renderAction();
    fireEvent.click(screen.getByTestId("goal-pm-record-choice"));
    expect(onStart.mock.calls[0][0]).not.toHaveProperty("fastMode");
  });

  it("cannot start before a runtime and machine are chosen", () => {
    mocks.selection = null;
    renderAction();
    expect(screen.getByTestId("goal-pm-record-choice")).toBeDisabled();
  });

  it("disables the button and the selector together", () => {
    renderAction(true);
    expect(screen.getByTestId("goal-pm-record-choice")).toBeDisabled();
    expect(mocks.selectorProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ disabled: true }),
    );
  });
});
