import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PlanAutomationChoiceDialog } from "./PlanAutomationChoiceDialog";

describe("PlanAutomationChoiceDialog", () => {
  it("offers navigation to existing automation and fresh monitor creation", () => {
    const onViewExisting = vi.fn();
    const onCreateAnother = vi.fn();

    render(
      <PlanAutomationChoiceDialog
        open
        relatedMonitorCount={2}
        onViewExisting={onViewExisting}
        onCreateAnother={onCreateAnother}
      />
    );

    expect(
      screen.getByTestId("plan-automation-choice-dialog")
    ).toHaveTextContent(
      "2 non-terminal Task Monitors are related to this plan."
    );
    fireEvent.click(screen.getByTestId("plan-automation-view-existing"));
    fireEvent.click(screen.getByTestId("plan-automation-create-another"));

    expect(onViewExisting).toHaveBeenCalledTimes(1);
    expect(onCreateAnother).toHaveBeenCalledTimes(1);
  });
});
