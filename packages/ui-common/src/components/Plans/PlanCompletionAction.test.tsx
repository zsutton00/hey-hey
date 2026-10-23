import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EntityType, WorkStatus } from "../../api";
import { useCanonicalPlanMutations } from "../../data";
import { buildEntityConversationPrompt } from "../InteractionComponent/entityConversationPrompt";
import { useEntityConversationLauncher } from "../InteractionComponent/useEntityConversationLauncher";
import { useMachineResolution } from "../AgentSession/runtime/coding/useMachineResolution";
import { PlanCompletionAction } from "./PlanCompletionAction";

const updatePlan = vi.fn();
const launch = vi.fn();
const mockUseCanonicalPlanMutations = vi.mocked(useCanonicalPlanMutations);
const mockUseEntityConversationLauncher = vi.mocked(
  useEntityConversationLauncher
);
const mockUseMachineResolution = vi.mocked(useMachineResolution);

vi.mock("../../data", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../data")>();
  return { ...original, useCanonicalPlanMutations: vi.fn() };
});

vi.mock("../InteractionComponent/useEntityConversationLauncher", () => ({
  useEntityConversationLauncher: vi.fn(),
}));

vi.mock("../AgentSession/runtime/coding/useMachineResolution", () => ({
  useMachineResolution: vi.fn(),
}));

vi.mock("../ActionsCapsule", () => ({
  CapsuleAction: ({
    id,
    label,
    onClick,
  }: {
    id: string;
    label: string;
    onClick: () => void;
  }) => (
    <button data-testid={`capsule-action-${id}`} onClick={onClick}>
      {label}
    </button>
  ),
}));

vi.mock("../InteractionComponent/EntityConversationPromptDialog", () => ({
  EntityConversationPromptDialog: (
    props: React.ComponentProps<
      typeof import("../InteractionComponent/EntityConversationPromptDialog").EntityConversationPromptDialog
    >
  ) => (
    <div data-testid="plan-completion-dialog">
      <textarea
        data-testid="plan-completion-guidance"
        value={props.userInput}
        onChange={(event) => props.onUserInputChange(event.target.value)}
      />
      <button data-testid="plan-completion-cancel" onClick={props.onClose}>
        Cancel
      </button>
      <button
        data-testid={props.secondaryAction?.testId}
        onClick={props.secondaryAction?.onClick}
      >
        {props.secondaryAction?.label}
      </button>
      <button
        data-testid={props.primaryAction.testId}
        onClick={() =>
          props.onSubmit(
            buildEntityConversationPrompt(
              props.preCannedPrompt,
              props.userInput
            )
          )
        }
      >
        {props.primaryAction.label}
      </button>
      {props.secondaryAction?.error ? (
        <div>{props.secondaryAction.error.message}</div>
      ) : null}
      {props.primaryAction.error ? (
        <div>{props.primaryAction.error.message}</div>
      ) : null}
    </div>
  ),
}));

const selectedMachine = {
  machineId: "machine-1",
  name: "Developer Mac",
} as never;

const renderAction = () =>
  render(
    <MemoryRouter>
      <PlanCompletionAction
        organizationId="org-1"
        projectId="project-1"
        planId="plan-1"
        planTitle="Release planning"
        planStatus={WorkStatus.Verifying}
      />
    </MemoryRouter>
  );

describe("PlanCompletionAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updatePlan.mockResolvedValue({ status: "applied", plan: {} });
    launch.mockResolvedValue(true);
    mockUseCanonicalPlanMutations.mockReturnValue({
      updatePlan,
      deletePlan: vi.fn(),
      isLoading: false,
      error: null,
    });
    mockUseEntityConversationLauncher.mockReturnValue({
      launch,
      isLoading: false,
      error: null,
      clearError: vi.fn(),
    });
    mockUseMachineResolution.mockReturnValue({
      machines: [selectedMachine],
      executionReadyMachines: [selectedMachine],
      isReady: true,
      mode: "one",
      selectedMachine,
      setSelectedMachineId: vi.fn(),
    });
  });

  it("completes without launching a conversation when Complete is chosen", async () => {
    renderAction();
    fireEvent.click(screen.getByTestId("capsule-action-complete-plan"));
    fireEvent.click(screen.getByTestId("plan-completion-complete"));

    await waitFor(() =>
      expect(updatePlan).toHaveBeenCalledWith("plan-1", {
        status: WorkStatus.Completed,
      })
    );
    expect(launch).not.toHaveBeenCalled();
  });

  it("cancels without mutating the Plan", () => {
    renderAction();
    fireEvent.click(screen.getByTestId("capsule-action-complete-plan"));
    fireEvent.click(screen.getByTestId("plan-completion-cancel"));

    expect(updatePlan).not.toHaveBeenCalled();
    expect(launch).not.toHaveBeenCalled();
  });

  it("completes before launching one PROJECT-scoped review with trimmed guidance", async () => {
    renderAction();
    fireEvent.click(screen.getByTestId("capsule-action-complete-plan"));
    fireEvent.change(screen.getByTestId("plan-completion-guidance"), {
      target: { value: "  Check billing first.  " },
    });
    fireEvent.click(screen.getByTestId("plan-completion-complete-and-review"));

    await waitFor(() => expect(launch).toHaveBeenCalledOnce());
    expect(updatePlan.mock.invocationCallOrder[0]).toBeLessThan(
      launch.mock.invocationCallOrder[0]
    );
    expect(launch).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining("Check billing first."),
        context: {
          entityId: "project-1",
          entityType: EntityType.Project,
        },
        machineId: "machine-1",
      })
    );
  });

  it("does not launch when completion fails", async () => {
    updatePlan.mockRejectedValueOnce(new Error("completion failed"));
    renderAction();
    fireEvent.click(screen.getByTestId("capsule-action-complete-plan"));
    fireEvent.click(screen.getByTestId("plan-completion-complete-and-review"));

    await waitFor(() =>
      expect(screen.getByText("completion failed")).toBeInTheDocument()
    );
    expect(launch).not.toHaveBeenCalled();
  });

  it("retries only the review launch after completion succeeds", async () => {
    launch.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    renderAction();
    fireEvent.click(screen.getByTestId("capsule-action-complete-plan"));
    fireEvent.click(screen.getByTestId("plan-completion-complete-and-review"));

    await waitFor(() =>
      expect(
        screen.getByText(/project review could not be started/i)
      ).toBeInTheDocument()
    );
    fireEvent.click(screen.getByTestId("plan-completion-complete-and-review"));

    await waitFor(() => expect(launch).toHaveBeenCalledTimes(2));
    expect(updatePlan).toHaveBeenCalledOnce();
  });
});
