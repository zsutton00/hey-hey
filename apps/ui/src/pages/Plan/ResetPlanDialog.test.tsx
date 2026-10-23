import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ResetPlanDialog } from "./ResetPlanDialog";

describe("ResetPlanDialog", () => {
  it("explains what is replaced and what is retained", () => {
    render(
      <ResetPlanDialog
        open
        planName="Launch plan"
        resetting={false}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.getByText(/generated stages and steps/i)).toBeInTheDocument();
    expect(
      screen.getByText(/latest linked design document/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/identity.*retained/i)).toBeInTheDocument();
  });

  it("leaves reset untouched when cancelled", () => {
    const onClose = vi.fn();
    const onConfirm = vi.fn();
    render(
      <ResetPlanDialog
        open
        planName="Launch plan"
        resetting={false}
        onClose={onClose}
        onConfirm={onConfirm}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("prevents duplicate actions while reset is pending", () => {
    render(
      <ResetPlanDialog
        open
        planName="Launch plan"
        resetting
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Resetting…" })).toBeDisabled();
  });
});
