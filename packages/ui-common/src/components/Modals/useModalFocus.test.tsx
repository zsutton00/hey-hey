import { useState } from "react";
import { DialogTitle } from "@mui/material";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect } from "vitest";
import { HostedModalFixture } from "../../test/HostedModalFixture";
import { FunctionalDialog } from "./FunctionalDialog";
import { ModalRestoreControls } from "./ModalRestoreControls";
function Content() {
  const [input, setInput] = useState(true);
  return (
    <>
      <FunctionalDialog open workTitle="Changing work">
        <DialogTitle>Changing work</DialogTitle>
        {input && <input aria-label="Temporary input" />}
      </FunctionalDialog>
      <button onClick={() => setInput(false)}>Remove input</button>
      <ModalRestoreControls />
    </>
  );
}
describe("focus after origin changes", () => {
  it("uses a connected control when the old focused input disappears", async () => {
    const user = userEvent.setup();
    render(
      <HostedModalFixture>
        <Content />
      </HostedModalFixture>,
    );
    await user.click(screen.getByLabelText("Temporary input"));
    await user.click(screen.getByTestId("modal-minimize"));
    await user.click(screen.getByText("Remove input"));
    await user.click(
      screen.getByRole("button", { name: "Restore Changing work" }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("modal-minimize")).toHaveFocus(),
    );
  });
});
