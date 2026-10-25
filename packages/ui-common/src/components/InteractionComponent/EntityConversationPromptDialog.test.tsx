import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EntityConversationPromptDialog } from "./EntityConversationPromptDialog";

const renderDialog = (
  overrides: Partial<
    React.ComponentProps<typeof EntityConversationPromptDialog>
  > = {},
) => {
  const props: React.ComponentProps<typeof EntityConversationPromptDialog> = {
    open: true,
    title: "Start project review",
    question: "Would you like to review the project?",
    preCannedPrompt: "Review the project for updates.",
    userInput: "",
    onUserInputChange: vi.fn(),
    onClose: vi.fn(),
    onSubmit: vi.fn(),
    primaryAction: {
      label: "Start review",
      pendingLabel: "Starting review…",
      pending: false,
      testId: "prompt-dialog-submit",
    },
    testIdPrefix: "prompt-dialog",
    ...overrides,
  };
  return { ...render(<EntityConversationPromptDialog {...props} />), props };
};

describe("EntityConversationPromptDialog", () => {
  it("renders the optional input and actions in order, then sends the composed prompt", () => {
    const { props, rerender } = renderDialog({
      secondaryAction: {
        label: "Save without review",
        pendingLabel: "Saving…",
        pending: false,
        testId: "prompt-dialog-secondary",
        onClick: vi.fn(),
      },
    });

    expect(screen.getByTestId("prompt-dialog-question")).toHaveTextContent(
      "review the project",
    );
    expect(screen.getByTestId("prompt-dialog-user-input")).toBeInTheDocument();
    expect(
      within(screen.getByTestId("entity-conversation-prompt-actions"))
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["Cancel", "Save without review", "Start review"]);

    fireEvent.change(screen.getByTestId("prompt-dialog-user-input"), {
      target: { value: "  Check billing first.  " },
    });
    rerender(
      <EntityConversationPromptDialog
        {...props}
        userInput="  Check billing first.  "
      />,
    );
    fireEvent.click(screen.getByTestId("prompt-dialog-cancel"));
    fireEvent.click(screen.getByTestId("prompt-dialog-secondary"));
    fireEvent.click(screen.getByTestId("prompt-dialog-submit"));

    expect(props.onUserInputChange).toHaveBeenCalledWith(
      "  Check billing first.  ",
    );
    expect(props.onClose).toHaveBeenCalledOnce();
    expect(props.secondaryAction?.onClick).toHaveBeenCalledOnce();
    expect(props.onSubmit).toHaveBeenCalledWith(
      "Review the project for updates.\n\nCheck billing first.",
    );
  });

  it("keeps every action disabled while a transition is pending and shows errors", () => {
    renderDialog({
      primaryAction: {
        label: "Start review",
        pendingLabel: "Starting review…",
        pending: true,
        testId: "prompt-dialog-submit",
        error: {
          message: "The review could not be started.",
          testId: "prompt-dialog-primary-error",
        },
      },
      secondaryAction: {
        label: "Save without review",
        pendingLabel: "Saving…",
        pending: false,
        testId: "prompt-dialog-secondary",
        error: {
          message: "The project could not be saved.",
          testId: "prompt-dialog-secondary-error",
        },
      },
    });

    expect(screen.getByTestId("modal-minimize")).toBeEnabled();
    expect(screen.getByTestId("modal-close")).toBeDisabled();
    expect(screen.getByTestId("prompt-dialog-cancel")).toBeDisabled();
    expect(screen.getByTestId("prompt-dialog-secondary")).toBeDisabled();
    expect(screen.getByTestId("prompt-dialog-submit")).toBeDisabled();
    expect(screen.getByTestId("prompt-dialog-primary-error")).toHaveTextContent(
      "The review could not be started.",
    );
    expect(
      screen.getByTestId("prompt-dialog-secondary-error"),
    ).toHaveTextContent("The project could not be saved.");
  });
});
