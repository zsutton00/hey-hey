import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { SaveReasonModal } from "../SaveReasonModal";

describe("SaveReasonModal", () => {
  it("renders with an optional reason field and the modal hidden when closed", () => {
    render(
      <SaveReasonModal open={false} onClose={vi.fn()} onSubmit={vi.fn()} />
    );

    expect(screen.queryByTestId("save-reason-modal")).not.toBeInTheDocument();
  });

  it("submits with an empty reason when the user submits without typing", async () => {
    const onSubmit = vi.fn();
    const onClose = vi.fn();

    render(<SaveReasonModal open onClose={onClose} onSubmit={onSubmit} />);

    const submit = screen.getByTestId("save-reason-submit");
    expect(submit).toBeEnabled();
    await userEvent.click(submit);

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith("");
    });
  });

  it("forwards a trimmed non-empty reason on submit", async () => {
    const onSubmit = vi.fn();

    render(<SaveReasonModal open onClose={vi.fn()} onSubmit={onSubmit} />);

    await userEvent.type(
      screen.getByTestId("save-reason-input"),
      "  Tightening acceptance criteria  "
    );
    await userEvent.click(screen.getByTestId("save-reason-submit"));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith("Tightening acceptance criteria");
    });
  });

  it("submits with the trimmed reason when Cmd+Enter is pressed", async () => {
    const onSubmit = vi.fn();

    render(<SaveReasonModal open onClose={vi.fn()} onSubmit={onSubmit} />);

    await userEvent.type(
      screen.getByTestId("save-reason-input"),
      "  Tightening acceptance criteria  "
    );
    await userEvent.keyboard("{Meta>}{Enter}{/Meta}");

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith("Tightening acceptance criteria");
    });
  });

  it("invokes onClose without calling onSubmit when the user cancels", async () => {
    const onSubmit = vi.fn();
    const onClose = vi.fn();

    render(<SaveReasonModal open onClose={onClose} onSubmit={onSubmit} />);

    await userEvent.type(
      screen.getByTestId("save-reason-input"),
      "won't be sent"
    );
    await userEvent.click(screen.getByTestId("save-reason-cancel"));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("renders no secondary button when no secondaryAction is provided", () => {
    render(<SaveReasonModal open onClose={vi.fn()} onSubmit={vi.fn()} />);

    expect(
      screen.queryByTestId("save-reason-secondary")
    ).not.toBeInTheDocument();
  });

  it("renders the secondary button with its label when secondaryAction is provided", () => {
    render(
      <SaveReasonModal
        open
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        secondaryAction={{
          label: "Submit and Create Task",
          onAction: vi.fn(),
        }}
      />
    );

    expect(screen.getByTestId("save-reason-secondary")).toHaveTextContent(
      "Submit and Create Task"
    );
  });

  it("fires the secondary action with the trimmed reason", async () => {
    const onAction = vi.fn();
    const onSubmit = vi.fn();

    render(
      <SaveReasonModal
        open
        onClose={vi.fn()}
        onSubmit={onSubmit}
        secondaryAction={{ label: "Submit and Create Task", onAction }}
      />
    );

    await userEvent.type(
      screen.getByTestId("save-reason-input"),
      "  Splitting out the API work  "
    );
    await userEvent.click(screen.getByTestId("save-reason-secondary"));

    await waitFor(() => {
      expect(onAction).toHaveBeenCalledWith("Splitting out the API work");
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("shares the submitting state so Submit disables while the secondary action runs", async () => {
    let resolveAction: (() => void) | undefined;
    const onAction = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveAction = resolve;
        })
    );

    render(
      <SaveReasonModal
        open
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        secondaryAction={{ label: "Submit and Create Task", onAction }}
      />
    );

    await userEvent.click(screen.getByTestId("save-reason-secondary"));

    await waitFor(() => {
      expect(screen.getByTestId("save-reason-submit")).toBeDisabled();
    });
    expect(screen.getByTestId("save-reason-secondary")).toBeDisabled();

    resolveAction?.();

    await waitFor(() => {
      expect(screen.getByTestId("save-reason-submit")).toBeEnabled();
    });
    expect(screen.getByTestId("save-reason-secondary")).toBeEnabled();
  });
});
