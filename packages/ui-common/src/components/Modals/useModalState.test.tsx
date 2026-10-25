import { Button, DialogTitle, TextField } from "@mui/material";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FunctionalDialog } from "./FunctionalDialog";
import { ModalRestoreControls } from "./ModalRestoreControls";
import { ModalWorkOwner } from "./ModalWorkOwner";
import { useModalState } from "./useModalState";

function ModalContent({
  open,
  onClose,
  initialized,
}: {
  open: boolean;
  onClose: () => void;
  initialized: () => void;
}) {
  return (
    <FunctionalDialog open={open} onClose={onClose}>
      <DialogTitle>Existing form</DialogTitle>
      <TextField label="Values" defaultValue="" inputRef={initialized} />
    </FunctionalDialog>
  );
}

function Owner({ initialized }: { initialized: () => void }) {
  const [open, setOpen, ownerKey] = useModalState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Open form</Button>
      <ModalWorkOwner.Provider value={ownerKey}>
        <ModalContent
          open={open}
          onClose={() => setOpen(false)}
          initialized={initialized}
        />
      </ModalWorkOwner.Provider>
      <ModalRestoreControls />
    </>
  );
}

describe("reopening minimized work", () => {
  it("uses the original entry point to restore the same form without reinitializing it", async () => {
    const user = userEvent.setup();
    const initialized = vi.fn();
    render(<Owner initialized={initialized} />);
    await user.click(screen.getByRole("button", { name: "Open form" }));
    const input = screen.getByLabelText("Values");
    await user.type(input, "Original values");
    const initializations = initialized.mock.calls.length;
    await user.click(screen.getByTestId("modal-minimize"));
    await user.click(screen.getByRole("button", { name: "Open form" }));
    await waitFor(() => expect(input).toBeVisible());
    expect(screen.getByLabelText("Values")).toBe(input);
    expect(input).toHaveValue("Original values");
    expect(initialized).toHaveBeenCalledTimes(initializations);
    await user.click(screen.getByTestId("modal-close"));
    expect(screen.queryByTestId("modal-restore")).not.toBeInTheDocument();
  });
});
