import type { MachineDto } from "@hey-hey/ui-common/api";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RevokeMachineDialog } from "./RevokeMachineDialog";

const machine: MachineDto = {
  machineId: "machine-1",
  name: "Zac's MacBook",
  pairedAt: "2026-05-10T00:00:00.000Z",
  lastSeen: "2026-05-17T12:00:00.000Z",
};

describe("RevokeMachineDialog", () => {
  it("does not render content when closed", () => {
    render(
      <RevokeMachineDialog
        open={false}
        machine={machine}
        isRevoking={false}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("revoke-machine-dialog")).not.toBeInTheDocument();
  });

  it("renders the machine name in the body when open", () => {
    render(
      <RevokeMachineDialog
        open={true}
        machine={machine}
        isRevoking={false}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByTestId("revoke-machine-dialog")).toBeInTheDocument();
    expect(screen.getByText(/Zac's MacBook/)).toBeInTheDocument();
    expect(screen.getByText(/connection, Passkeys, and permission/i)).toBeInTheDocument();
    expect(screen.getByText(/history will remain available/i)).toBeInTheDocument();
  });

  it("invokes onConfirm when the confirm button is clicked", () => {
    const handleConfirm = vi.fn();
    render(
      <RevokeMachineDialog
        open={true}
        machine={machine}
        isRevoking={false}
        onConfirm={handleConfirm}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("revoke-machine-confirm"));
    expect(handleConfirm).toHaveBeenCalledTimes(1);
  });

  it("invokes onCancel when the cancel button is clicked", () => {
    const handleCancel = vi.fn();
    render(
      <RevokeMachineDialog
        open={true}
        machine={machine}
        isRevoking={false}
        onConfirm={vi.fn()}
        onCancel={handleCancel}
      />,
    );
    fireEvent.click(screen.getByTestId("revoke-machine-cancel"));
    expect(handleCancel).toHaveBeenCalledTimes(1);
  });

  it("disables actions and shows progress while revoking", () => {
    render(
      <RevokeMachineDialog
        open={true}
        machine={machine}
        isRevoking={true}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByTestId("revoke-machine-confirm")).toBeDisabled();
    expect(screen.getByTestId("revoke-machine-cancel")).toBeDisabled();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
  });
});
