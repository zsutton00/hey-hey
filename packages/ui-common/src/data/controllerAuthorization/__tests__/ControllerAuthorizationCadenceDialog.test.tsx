import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ControllerAuthorizationCadence } from "../../../api";
import { ControllerAuthorizationCadenceDialog } from "../ControllerAuthorizationCadenceDialog";

describe("ControllerAuthorizationCadenceDialog", () => {
  it("renders the selected execution machine and five reusable cadence choices", () => {
    render(
      <ControllerAuthorizationCadenceDialog
        errorMessage={null}
        machineName="Studio Mac"
        onAuthorize={vi.fn()}
        onCadenceChange={vi.fn()}
        onCancel={vi.fn()}
        open
        selectedCadence={ControllerAuthorizationCadence.FiveMinutes}
      />
    );

    expect(screen.getByText("Authorize actions on Studio Mac")).toBeVisible();
    expect(
      screen.getAllByTestId("controller-authorization-cadence-option")
    ).toHaveLength(5);
    expect(screen.getByText("5 minutes")).toBeVisible();
    expect(screen.queryByText("Every action")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Current browser session")
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/controller device/iu)).not.toBeInTheDocument();
  });

  it("reports cadence changes and authorization intent without side effects", () => {
    const onAuthorize = vi.fn();
    const onCadenceChange = vi.fn();
    render(
      <ControllerAuthorizationCadenceDialog
        errorMessage="Passkey approval was cancelled."
        machineName="Studio Mac"
        onAuthorize={onAuthorize}
        onCadenceChange={onCadenceChange}
        onCancel={vi.fn()}
        open
        selectedCadence={ControllerAuthorizationCadence.FiveMinutes}
      />
    );

    fireEvent.click(screen.getByLabelText("1 week"));
    fireEvent.click(screen.getByTestId("controller-authorization-continue"));

    expect(onCadenceChange).toHaveBeenCalledWith(
      ControllerAuthorizationCadence.OneWeek
    );
    expect(onAuthorize).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Passkey approval was cancelled.")).toBeVisible();
  });

  it("keeps the cause separate from cadence and authorization controls", () => {
    render(
      <ControllerAuthorizationCadenceDialog
        cause={{
          operation: "read the current changed-file count",
          purpose: "Show the current changed files for this coding session.",
        }}
        errorMessage={null}
        machineName="Studio Mac"
        onAuthorize={vi.fn()}
        onCadenceChange={vi.fn()}
        onCancel={vi.fn()}
        open
        selectedCadence={ControllerAuthorizationCadence.FiveMinutes}
      />
    );

    expect(screen.getByTestId("controller-authorization-cause")).toHaveTextContent(
      "The system would like to read the current changed-file count."
    );
    expect(screen.getByTestId("controller-authorization-cause")).toHaveTextContent(
      "Purpose: Show the current changed files for this coding session."
    );
    expect(
      screen.getAllByTestId("controller-authorization-cadence-option")
    ).toHaveLength(5);
  });
});
