import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface CapsuleActionMockProps {
  id: string;
  label: string;
  disabled?: boolean;
  onClick: () => void;
}

interface DiscussModalMockProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (
    prompt: string,
    provider: string,
    model: string | null,
    reasoningEffort: string | null,
    machineId: string,
    fastMode?: boolean,
  ) => void;
}

const mockLaunch = vi.fn();

vi.mock("@hey-hey/ui-common/components", () => ({
  discussColor: "#2563EB",
  CapsuleAction: ({ id, label, disabled, onClick }: CapsuleActionMockProps) => (
    <button
      type="button"
      data-testid={`capsule-action-${id}`}
      disabled={disabled}
      onClick={onClick}
    >
      {label}
    </button>
  ),
  // The modal only renders when `open`; expose submit/close so the test can
  // drive each branch and assert the launcher fires only on submit.
  DiscussModal: ({ open, onClose, onSubmit }: DiscussModalMockProps) =>
    open ? (
      <div data-testid="discuss-modal">
        <button
          type="button"
          data-testid="discuss-modal-submit"
          onClick={() => onSubmit("draft some tasks", "CLAUDE", null, null, "svc-1")}
        >
          submit
        </button>
        <button
          type="button"
          data-testid="discuss-modal-close"
          onClick={onClose}
        >
          close
        </button>
      </div>
    ) : null,
  useFeatureTreeConversationLauncher: () => ({
    launch: mockLaunch,
    isLoading: false,
    error: null,
  }),
}));

import { DiscussFeatureTreeActionCapsule } from "./DiscussFeatureTreeActionCapsule";

const renderComponent = (
  props: Partial<
    React.ComponentProps<typeof DiscussFeatureTreeActionCapsule>
  > = {},
) =>
  render(
    <MemoryRouter>
      <DiscussFeatureTreeActionCapsule
        organizationId="org-1"
        projectId="project-1"
        {...props}
      />
    </MemoryRouter>,
  );

describe("DiscussFeatureTreeActionCapsule", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLaunch.mockResolvedValue(true);
  });

  it("opens the DiscussModal on click without launching a conversation", () => {
    renderComponent();

    expect(screen.queryByTestId("discuss-modal")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("capsule-action-discuss-feature-tree"));

    expect(screen.getByTestId("discuss-modal")).toBeInTheDocument();
    expect(mockLaunch).not.toHaveBeenCalled();
  });

  it("launches the feature-tree conversation only when the modal is submitted", async () => {
    renderComponent();

    fireEvent.click(screen.getByTestId("capsule-action-discuss-feature-tree"));
    fireEvent.click(screen.getByTestId("discuss-modal-submit"));

    await waitFor(() => {
      expect(mockLaunch).toHaveBeenCalledTimes(1);
    });
    expect(mockLaunch).toHaveBeenCalledWith("draft some tasks");

    // Modal closes after a successful launch.
    await waitFor(() => {
      expect(screen.queryByTestId("discuss-modal")).not.toBeInTheDocument();
    });
  });

  it("creates nothing when the modal is dismissed", () => {
    renderComponent();

    fireEvent.click(screen.getByTestId("capsule-action-discuss-feature-tree"));
    expect(screen.getByTestId("discuss-modal")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("discuss-modal-close"));

    expect(screen.queryByTestId("discuss-modal")).not.toBeInTheDocument();
    expect(mockLaunch).not.toHaveBeenCalled();
  });

  it("is disabled and does not open the modal when projectId is missing", () => {
    renderComponent({ projectId: undefined });

    const button = screen.getByTestId("capsule-action-discuss-feature-tree");
    expect(button).toBeDisabled();

    fireEvent.click(button);

    expect(screen.queryByTestId("discuss-modal")).not.toBeInTheDocument();
    expect(mockLaunch).not.toHaveBeenCalled();
  });
});
