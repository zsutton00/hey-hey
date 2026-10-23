import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PromptEditor } from "../PromptEditor";

vi.mock("../../SmarterTextAreaCard", () => ({
  SmarterTextAreaCard: () => <div data-testid="mock-smarter-textarea-card" />,
}));

describe("PromptEditor", () => {
  it("renders the shared editor without provider-specific command props", () => {
    render(
      <PromptEditor
        prompt="ship it"
        submittingPrompt={false}
        submitDisabled={false}
        submitDisabledReason={null}
        onPromptChange={vi.fn()}
        onSubmitPrompt={vi.fn()}
      />
    );

    expect(screen.getByTestId("mock-smarter-textarea-card")).toBeInTheDocument();
  });

  it("renders launch errors beside Submit Prompt", () => {
    render(
      <PromptEditor
        prompt="ship it"
        submittingPrompt={false}
        submitDisabled={false}
        submitDisabledReason={null}
        onPromptChange={vi.fn()}
        onSubmitPrompt={vi.fn()}
        errorMessages={["The selected machine is not reachable."]}
      />
    );

    const actionArea = screen.getByTestId("prompt-editor-actions");
    expect(
      within(actionArea).getByRole("button", { name: "Submit Prompt" })
    ).toBeInTheDocument();
    expect(within(actionArea).getByRole("alert")).toHaveTextContent(
      "The selected machine is not reachable."
    );
  });
});
