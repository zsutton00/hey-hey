import { useEffect, useState } from "react";
import {
  Button,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
} from "@mui/material";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FunctionalDialog } from "./FunctionalDialog";
import { ModalRestoreControls } from "./ModalRestoreControls";
import { HostedModalFixture } from "../../test/HostedModalFixture";
import { ModalWorkOwner } from "./ModalWorkOwner";
function Draft({ mount }: { mount: () => void }) {
  const [value, setValue] = useState("");
  useEffect(mount, [mount]);
  return (
    <TextField
      label="Draft"
      value={value}
      onChange={(event) => setValue(event.target.value)}
    />
  );
}
afterEach(cleanup);
describe("shared modal shell eligibility", () => {
  it("does not grant Minimize to a page dialog, owner key or owner context", () => {
    render(
      <ModalWorkOwner.Provider value="page">
        <FunctionalDialog open ownerKey="page" onClose={vi.fn()}>
          <DialogTitle>Review</DialogTitle>
        </FunctionalDialog>
      </ModalWorkOwner.Provider>,
    );
    expect(screen.queryByTestId("modal-minimize")).not.toBeInTheDocument();
    expect(screen.getByTestId("modal-close")).toBeEnabled();
  });
  it("keeps hosted drafts mounted, releases the page and restores focus without acting", async () => {
    const user = userEvent.setup();
    const close = vi.fn();
    const mount = vi.fn();
    const pageClick = vi.fn();
    const view = render(
      <HostedModalFixture>
        <button onClick={pageClick}>Page action</button>
        <FunctionalDialog open onClose={close}>
          <DialogTitle>Compose</DialogTitle>
          <DialogContent>
            <Draft mount={mount} />
          </DialogContent>
        </FunctionalDialog>
        <ModalRestoreControls />
      </HostedModalFixture>,
    );
    await user.type(screen.getByLabelText("Draft"), "Keep my draft");
    await user.click(screen.getByTestId("modal-minimize"));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(document.body.style.overflow).not.toBe("hidden");
    await user.click(screen.getByText("Page action"));
    expect(pageClick).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "Restore Compose" }));
    await waitFor(() => expect(screen.getByLabelText("Draft")).toHaveFocus());
    expect(screen.getByLabelText("Draft")).toHaveValue("Keep my draft");
    expect(mount).toHaveBeenCalledOnce();
    expect(close).not.toHaveBeenCalled();
    view.unmount();
    render(<ModalRestoreControls />);
    expect(screen.queryByTestId("modal-restore")).not.toBeInTheDocument();
  });
  it("hides pending nested confirmations with the eligible parent and restores parent first", async () => {
    const user = userEvent.setup();
    const close = vi.fn();
    const apply = vi.fn();
    render(
      <HostedModalFixture>
        <FunctionalDialog open>
          <DialogTitle>Review</DialogTitle>
          <FunctionalDialog open onClose={close}>
            <DialogTitle>Confirm selection</DialogTitle>
            <DialogActions>
              <Button onClick={apply}>Apply</Button>
            </DialogActions>
          </FunctionalDialog>
        </FunctionalDialog>
        <ModalRestoreControls />
      </HostedModalFixture>,
    );
    await user.click(
      await screen.findByRole("button", { name: "Minimize Confirm selection" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(screen.getAllByTestId("modal-restore")).toHaveLength(1);
    expect(document.body.style.overflow).not.toBe("hidden");
    await user.click(screen.getByRole("button", { name: "Restore Review" }));
    expect(
      await screen.findByRole("dialog", { name: "Confirm selection" }),
    ).toBeVisible();
    expect(close).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
  });
  it("preserves busy close and Escape semantics", () => {
    const close = vi.fn();
    render(
      <FunctionalDialog
        open
        onClose={close}
        closeControl={<Button disabled>Close busy review</Button>}
      >
        <DialogTitle>Busy</DialogTitle>
      </FunctionalDialog>,
    );
    expect(screen.getByText("Close busy review")).toBeDisabled();
    fireEvent.keyDown(screen.getByRole("dialog"), {
      key: "Escape",
      keyCode: 27,
    });
    expect(close).toHaveBeenCalledWith(expect.anything(), "escapeKeyDown");
  });
});
