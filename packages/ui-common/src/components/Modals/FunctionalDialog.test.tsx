import { useEffect, useState } from "react";
import {
  Button,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
} from "@mui/material";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FunctionalDialog } from "./FunctionalDialog";
import { ModalRestoreControls } from "./ModalRestoreControls";
import { restoreModalWork } from "./modalWorkRegistry";

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
describe("functional modal work", () => {
  it("keeps the same draft mounted, releases page interaction and scroll lock, then restores without closing", async () => {
    const user = userEvent.setup();
    const close = vi.fn();
    const mount = vi.fn();
    const pageClick = vi.fn();
    render(
      <>
        <button onClick={pageClick}>Page action</button>
        <FunctionalDialog open onClose={close} ownerKey="draft">
          <DialogTitle>Compose</DialogTitle>
          <DialogContent>
            <Draft mount={mount} />
          </DialogContent>
        </FunctionalDialog>
        <ModalRestoreControls />
      </>,
    );
    await user.type(screen.getByLabelText("Draft"), "Keep my draft");
    expect(document.body.style.overflow).toBe("hidden");
    await user.click(screen.getByRole("button", { name: "Minimize Compose" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(screen.getByLabelText("Draft")).toHaveValue("Keep my draft");
    expect(document.body.style.overflow).not.toBe("hidden");
    await user.click(screen.getByRole("button", { name: "Page action" }));
    expect(pageClick).toHaveBeenCalledOnce();
    expect(close).not.toHaveBeenCalled();
    expect(mount).toHaveBeenCalledOnce();
    act(() => {
      expect(restoreModalWork("draft")).toBe(true);
    });
    await waitFor(() => expect(screen.getByRole("dialog")).toBeVisible());
    expect(screen.getByLabelText("Draft")).toHaveValue("Keep my draft");
    expect(mount).toHaveBeenCalledOnce();
    expect(
      screen.queryByRole("button", { name: "Restore Compose" }),
    ).not.toBeInTheDocument();
  });

  it("keeps instances separate and unregisters on owner disposal", async () => {
    const user = userEvent.setup();
    const view = render(
      <>
        <FunctionalDialog open>
          <DialogTitle>First</DialogTitle>
        </FunctionalDialog>
        <ModalRestoreControls />
      </>,
    );
    await user.click(screen.getByRole("button", { name: "Minimize First" }));
    view.rerender(
      <>
        <FunctionalDialog open>
          <DialogTitle>First</DialogTitle>
        </FunctionalDialog>
        <FunctionalDialog open>
          <DialogTitle>Second</DialogTitle>
        </FunctionalDialog>
        <ModalRestoreControls />
      </>,
    );
    await user.click(screen.getByRole("button", { name: "Minimize Second" }));
    expect(screen.getAllByTestId("modal-restore")).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "Restore First" }));
    await waitFor(() =>
      expect(screen.getByRole("dialog", { name: "First" })).toBeVisible(),
    );
    // Another modal owns aria-modal while the first is open; its restore button remains mounted.
    expect(screen.getByLabelText("Restore Second")).toBeInTheDocument();
    view.unmount();
    render(<ModalRestoreControls />);
    expect(screen.queryByTestId("modal-restore")).not.toBeInTheDocument();
  });

  it("hides nested confirmations with their parent and retains pending context", async () => {
    const user = userEvent.setup();
    const close = vi.fn();
    const apply = vi.fn();
    render(
      <>
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
      </>,
    );
    fireEvent.click(screen.getAllByTestId("modal-minimize")[0]);
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(document.body.style.overflow).not.toBe("hidden");
    await user.click(screen.getByRole("button", { name: "Restore Review" }));
    const confirmation = await screen.findByRole("dialog", {
      name: "Confirm selection",
    });
    expect(
      within(confirmation).getByRole("button", { name: "Apply" }),
    ).toBeVisible();
    expect(close).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
  });

  it("minimizes a nested confirmation together with its owning review from the child's reachable control", async () => {
    const user = userEvent.setup();
    const close = vi.fn();
    render(
      <>
        <FunctionalDialog open>
          <DialogTitle>Owning review</DialogTitle>
          <FunctionalDialog open onClose={close}>
            <DialogTitle>Pending confirmation</DialogTitle>
            <TextField label="Confirmation draft" />
          </FunctionalDialog>
        </FunctionalDialog>
        <ModalRestoreControls />
      </>,
    );
    await user.type(
      screen.getByLabelText("Confirmation draft"),
      "Keep this pending",
    );
    await user.click(
      screen.getByRole("button", { name: "Minimize Pending confirmation" }),
    );
    await waitFor(() =>
      expect(document.body.style.overflow).not.toBe("hidden"),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getAllByTestId("modal-restore")).toHaveLength(1);
    await user.click(
      screen.getByRole("button", { name: "Restore Owning review" }),
    );
    await waitFor(() =>
      expect(screen.getByLabelText("Confirmation draft")).toHaveFocus(),
    );
    expect(screen.getByLabelText("Confirmation draft")).toHaveValue(
      "Keep this pending",
    );
    expect(close).not.toHaveBeenCalled();
  });

  it("cleans up on accepted close and restores focus to a usable control if the previous input disappeared", async () => {
    const user = userEvent.setup();
    const content = (open: boolean, input: boolean) => (
      <>
        <FunctionalDialog open={open} onClose={vi.fn()}>
          <DialogTitle>Changing review</DialogTitle>
          {input && <TextField label="Temporary input" />}
        </FunctionalDialog>
        <ModalRestoreControls />
      </>
    );
    const view = render(content(true, true));
    await user.click(screen.getByLabelText("Temporary input"));
    await user.click(screen.getByTestId("modal-minimize"));
    view.rerender(content(true, false));
    await user.click(
      screen.getByRole("button", { name: "Restore Changing review" }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("modal-minimize")).toHaveFocus(),
    );
    await user.click(screen.getByTestId("modal-minimize"));
    view.rerender(content(false, false));
    expect(screen.queryByTestId("modal-restore")).not.toBeInTheDocument();
  });

  it("preserves consumer Escape handling and blocked close independently from minimize", async () => {
    const user = userEvent.setup();
    const close = vi.fn();
    render(
      <>
        <FunctionalDialog
          open
          onClose={close}
          closeControl={<Button disabled>Close busy review</Button>}
        >
          <DialogTitle>Busy</DialogTitle>
        </FunctionalDialog>
        <ModalRestoreControls />
      </>,
    );
    await user.click(screen.getByRole("button", { name: "Minimize Busy" }));
    expect(close).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Restore Busy" }));
    fireEvent.keyDown(screen.getByRole("dialog"), {
      key: "Escape",
      code: "Escape",
      keyCode: 27,
    });
    expect(close).toHaveBeenCalledWith(expect.anything(), "escapeKeyDown");
  });
});
