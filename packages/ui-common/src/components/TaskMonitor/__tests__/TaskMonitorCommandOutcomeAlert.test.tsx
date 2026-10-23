import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TaskMonitorCommandOutcomeAlert } from "../TaskMonitorCommandOutcomeAlert";

describe("TaskMonitorCommandOutcomeAlert", () => {
  it.each(["QUEUED", "ADMITTED"] as const)(
    "hides the successful internal %s acknowledgement",
    (status) => {
      render(
        <TaskMonitorCommandOutcomeAlert
          outcome={{ commandId: "command-1", status }}
        />
      );
      expect(
        screen.queryByTestId("task-monitor-command-outcome")
      ).not.toBeInTheDocument();
    }
  );

  it("renders concrete rejection details without internal status vocabulary", () => {
    render(
      <TaskMonitorCommandOutcomeAlert
        outcome={{
          commandId: "command-1",
          status: "REJECTED",
          stage: "ADMISSION",
          reason: "INVALID_STATE",
          message: "The monitor cannot start yet.",
        }}
      />
    );

    const alert = screen.getByTestId("task-monitor-command-outcome");
    expect(alert).toHaveTextContent("The monitor cannot start yet.");
    expect(alert).not.toHaveTextContent("Status: REJECTED");
  });
});
