import React from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { GoalProgressChip } from "../GoalProgressChip";
import { WorkStatus } from "../../../api";

const NOW = new Date("2026-10-08T12:00:00.000Z");

describe("GoalProgressChip", () => {
  it("derives progress from the compact summary", () => {
    render(
      <GoalProgressChip
        now={NOW}
        goal={{
          dueDate: "2026-10-01T00:00:00.000Z",
          trackedWorkSummary: {
            totalCount: 2,
            completedCount: 1,
            cancelledCount: 0,
            pastDueCount: 0,
            openUndatedCount: 1,
          },
        }}
      />
    );
    const chip = screen.getByTestId("goal-progress-chip");
    expect(chip).toHaveAttribute("data-goal-progress", "at-risk");
    expect(chip).toHaveTextContent("At risk");
  });

  it("falls back to tracked snapshots when no summary is present", () => {
    render(
      <GoalProgressChip
        now={NOW}
        goal={{
          dueDate: "2026-12-01T00:00:00.000Z",
          trackedEntities: [
            {
              targetEntityId: "t-1",
              targetEntityType: "TASK",
              title: "Done",
              status: WorkStatus.Completed,
            },
          ],
        }}
      />
    );
    expect(screen.getByTestId("goal-progress-chip")).toHaveAttribute(
      "data-goal-progress",
      "done"
    );
  });

  it("renders nothing without tracked-work data", () => {
    const { container } = render(
      <GoalProgressChip now={NOW} goal={{ dueDate: null }} />
    );
    expect(container).toBeEmptyDOMElement();
  });
});
