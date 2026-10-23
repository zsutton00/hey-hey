import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ControllerAuthorizationCadence, type MachineDto } from "../../../api";
import {
  ControllerAuthorizationPromptHost,
  requestControllerAuthorizationCadence,
} from "../controllerAuthorizationPrompt";

const machine = {
  machineId: "machine-1",
  name: "Test machine",
} as MachineDto;

describe("ControllerAuthorizationPromptHost", () => {
  it("registers the prompt surface used by authorization requests", async () => {
    const user = userEvent.setup();
    const view = render(<ControllerAuthorizationPromptHost />);

    let cadence: ReturnType<typeof requestControllerAuthorizationCadence> | null =
      null;
    await act(async () => {
      cadence = requestControllerAuthorizationCadence({
        errorMessage: null,
        machine,
        preferredCadence: ControllerAuthorizationCadence.OneDay,
      });
    });

    expect(
      await screen.findByTestId("controller-authorization-cadence-dialog")
    ).toBeVisible();

    if (!cadence) {
      throw new Error("Expected the authorization request to be created.");
    }

    await user.click(
      screen.getByTestId("controller-authorization-continue")
    );

    await expect(cadence).resolves.toBe(ControllerAuthorizationCadence.OneDay);
    view.unmount();
  });

  it("passes background request cause context through to the modal", async () => {
    const user = userEvent.setup();
    const view = render(<ControllerAuthorizationPromptHost />);

    let cadence: ReturnType<typeof requestControllerAuthorizationCadence> | null =
      null;
    await act(async () => {
      cadence = requestControllerAuthorizationCadence({
        cause: {
          operation:
            "read the current changed-file count from the connected computer",
          purpose: "Show the current changed files for this coding session.",
        },
        errorMessage: null,
        machine,
        preferredCadence: ControllerAuthorizationCadence.OneDay,
      });
    });

    expect(
      await screen.findByTestId("controller-authorization-cause")
    ).toHaveTextContent(
      "The system would like to read the current changed-file count from the connected computer."
    );
    expect(screen.getByTestId("controller-authorization-cause")).toHaveTextContent(
      "Purpose: Show the current changed files for this coding session."
    );
    expect(screen.getByTestId("controller-authorization-cause")).not.toHaveTextContent(
      "Addressed Agent Session context is available."
    );
    expect(screen.getByTestId("controller-authorization-cause")).not.toHaveTextContent(
      "Addressed Run context is available."
    );

    if (!cadence) {
      throw new Error("Expected the authorization request to be created.");
    }
    await user.click(
      screen.getByTestId("controller-authorization-continue")
    );
    await expect(cadence).resolves.toBe(ControllerAuthorizationCadence.OneDay);

    view.unmount();
  });
});
