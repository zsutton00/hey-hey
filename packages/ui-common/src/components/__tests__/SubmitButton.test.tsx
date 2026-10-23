import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SubmitButton } from "../SubmitButton";

describe("SubmitButton", () => {
  it("renders the shared send control contract by default", () => {
    render(<SubmitButton />);

    const button = screen.getByTestId("run-stream-external-reply-submit");
    expect(button).toHaveAttribute("aria-label", "Send");
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveStyle({
      width: "40px",
      height: "40px",
      minWidth: "40px",
      minHeight: "40px",
      borderRadius: "50%",
    });
    expect(button.querySelector("svg")).toBeInTheDocument();
  });

  it("forwards submit behavior and supports custom content", () => {
    const onClick = vi.fn();

    render(
      <form onSubmit={(event) => event.preventDefault()}>
        <SubmitButton
          type="submit"
          onClick={onClick}
          aria-label="Create"
        >
          Create
        </SubmitButton>
      </form>
    );

    const button = screen.getByTestId("run-stream-external-reply-submit");
    expect(button).toHaveAttribute("type", "submit");
    expect(button).toHaveAttribute("aria-label", "Create");
    expect(button).toHaveTextContent("Create");
    expect(button).toHaveClass("MuiButton-root");
    expect(button).not.toHaveClass("MuiIconButton-root");
    expect(button).not.toHaveStyle({ borderRadius: "50%" });

    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("disables the control while loading", () => {
    render(<SubmitButton loading>Send</SubmitButton>);

    const button = screen.getByTestId("run-stream-external-reply-submit");
    expect(button).toBeDisabled();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(button).not.toHaveTextContent("Send");
    expect(button).toHaveClass("MuiButton-root");
    expect(button).not.toHaveClass("MuiIconButton-root");
  });

  it("preserves the circular icon-only geometry while disabled", () => {
    render(<SubmitButton disabled />);

    expect(screen.getByTestId("run-stream-external-reply-submit")).toHaveStyle({
      width: "40px",
      height: "40px",
      borderRadius: "50%",
    });
  });
});
