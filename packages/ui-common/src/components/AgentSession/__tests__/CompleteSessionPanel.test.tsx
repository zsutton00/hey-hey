import { act, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { WorkStatus } from "../../../api";
import { ActionsCapsuleProvider } from "../../ActionsCapsule/ActionsCapsuleProvider";
import { CompleteSessionPanel } from "../CompleteSessionPanel";

vi.mock("../useValidationLauncher", () => ({
  useValidationLauncher: vi.fn(),
}));

import { useValidationLauncher } from "../useValidationLauncher";

const mockedUseValidationLauncher = useValidationLauncher as unknown as Mock;

const launchMock = vi.fn();

const renderWithProvider = (ui: React.ReactNode) =>
  render(<ActionsCapsuleProvider>{ui}</ActionsCapsuleProvider>);

beforeEach(() => {
  vi.clearAllMocks();
  launchMock.mockReset();
  launchMock.mockResolvedValue({ id: "session-1" });
  mockedUseValidationLauncher.mockReturnValue({
    launch: launchMock,
    isPending: false,
    error: null,
  });
});

describe("CompleteSessionPanel", () => {
  it("shows the chained validation offer after Set Task Verifying when org and project ids are present", async () => {
    const onUpdateStatus = vi.fn().mockResolvedValue(undefined);

    renderWithProvider(
      <CompleteSessionPanel
        taskId="task-1"
        currentStatus={WorkStatus.Active}
        onUpdateStatus={onUpdateStatus}
        organizationId="org-1"
        projectId="proj-1"
      />
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId("complete-session-set-verifying"));
    });

    expect(onUpdateStatus).toHaveBeenCalledWith("task-1", {
      status: WorkStatus.Verifying,
    });
    expect(
      screen.getByTestId("complete-session-start-validation")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("complete-session-validation-done")
    ).toBeInTheDocument();
  });

  it("launches validation when Start validation is clicked", async () => {
    const onUpdateStatus = vi.fn().mockResolvedValue(undefined);

    renderWithProvider(
      <CompleteSessionPanel
        taskId="task-1"
        currentStatus={WorkStatus.Active}
        onUpdateStatus={onUpdateStatus}
        organizationId="org-1"
        projectId="proj-1"
      />
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId("complete-session-set-verifying"));
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("complete-session-start-validation"));
    });

    expect(launchMock).toHaveBeenCalledTimes(1);
  });

  it("dismisses the panel on Done without launching validation", async () => {
    const onUpdateStatus = vi.fn().mockResolvedValue(undefined);

    renderWithProvider(
      <CompleteSessionPanel
        taskId="task-1"
        currentStatus={WorkStatus.Active}
        onUpdateStatus={onUpdateStatus}
        organizationId="org-1"
        projectId="proj-1"
      />
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId("complete-session-set-verifying"));
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("complete-session-validation-done"));
    });

    expect(launchMock).not.toHaveBeenCalled();
  });

  it("skips the chained offer when organizationId or projectId is missing", async () => {
    const onUpdateStatus = vi.fn().mockResolvedValue(undefined);

    renderWithProvider(
      <CompleteSessionPanel
        taskId="task-1"
        currentStatus={WorkStatus.Active}
        onUpdateStatus={onUpdateStatus}
      />
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId("complete-session-set-verifying"));
    });

    expect(
      screen.queryByTestId("complete-session-start-validation")
    ).not.toBeInTheDocument();
  });

  it("calls onPanelComplete after a status update with no validation offer", async () => {
    const onUpdateStatus = vi.fn().mockResolvedValue(undefined);
    const onPanelComplete = vi.fn().mockResolvedValue(undefined);

    renderWithProvider(
      <CompleteSessionPanel
        taskId="task-1"
        currentStatus={WorkStatus.Active}
        onUpdateStatus={onUpdateStatus}
        onPanelComplete={onPanelComplete}
      />
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId("complete-session-set-completed"));
    });

    expect(onPanelComplete).toHaveBeenCalledTimes(1);
  });

  it("defers onPanelComplete past the validation offer step", async () => {
    const onUpdateStatus = vi.fn().mockResolvedValue(undefined);
    const onPanelComplete = vi.fn().mockResolvedValue(undefined);

    renderWithProvider(
      <CompleteSessionPanel
        taskId="task-1"
        currentStatus={WorkStatus.Active}
        onUpdateStatus={onUpdateStatus}
        onPanelComplete={onPanelComplete}
        organizationId="org-1"
        projectId="proj-1"
      />
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId("complete-session-set-verifying"));
    });

    expect(onPanelComplete).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByTestId("complete-session-start-validation"));
    });

    expect(onPanelComplete).toHaveBeenCalledTimes(1);
  });

  it("calls onPanelComplete when Done is clicked in the validation offer view", async () => {
    const onUpdateStatus = vi.fn().mockResolvedValue(undefined);
    const onPanelComplete = vi.fn().mockResolvedValue(undefined);

    renderWithProvider(
      <CompleteSessionPanel
        taskId="task-1"
        currentStatus={WorkStatus.Active}
        onUpdateStatus={onUpdateStatus}
        onPanelComplete={onPanelComplete}
        organizationId="org-1"
        projectId="proj-1"
      />
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId("complete-session-set-verifying"));
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("complete-session-validation-done"));
    });

    expect(onPanelComplete).toHaveBeenCalledTimes(1);
  });

  it("does not call onPanelComplete from Coding Session Only or Cancel", async () => {
    const onUpdateStatus = vi.fn().mockResolvedValue(undefined);
    const onCompleteSessionOnly = vi.fn().mockResolvedValue(undefined);
    const onPanelComplete = vi.fn().mockResolvedValue(undefined);

    renderWithProvider(
      <CompleteSessionPanel
        taskId="task-1"
        currentStatus={WorkStatus.Active}
        onUpdateStatus={onUpdateStatus}
        onCompleteSessionOnly={onCompleteSessionOnly}
        onPanelComplete={onPanelComplete}
      />
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId("complete-session-only"));
    });

    expect(onCompleteSessionOnly).toHaveBeenCalledTimes(1);
    expect(onPanelComplete).not.toHaveBeenCalled();
  });
});
