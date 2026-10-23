import type { ReportDto } from "@hey-hey/ui-common/api";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { NotificationToast } from "./NotificationToast";

vi.mock("@hey-hey/ui-common/components", () => ({
  ReportSummaryCard: ({ report }: { report: ReportDto }) => (
    <div data-testid="report-summary-card">{report.id}</div>
  ),
}));

const reportFixture = {
  createdAt: "2026-03-01T00:00:00.000Z",
  entities: [],
  expiresAt: "2026-04-01T00:00:00.000Z",
  id: "report-1",
  organizationId: "org-1",
  payload: {
    nextSteps: [],
    recommendedUpdates: [],
    verificationTasks: [],
  },
  projectId: "project-1",
  reportType: "SNAPSHOT",
  schemaVersion: 1,
  sourceExecutionId: null,
  version: 1,
} as ReportDto;

describe("NotificationToast", () => {
  it("renders compact summary, supports expansion, and triggers dismissal callback", () => {
    const onDismiss = vi.fn();

    render(
      <NotificationToast
        notificationId="notification-1"
        onClose={() => undefined}
        onDismiss={onDismiss}
        report={reportFixture}
        reportId="report-1"
        taskId="task-1"
        title="Report created"
        topNextStep="Run regression tests"
        verificationHint="Check failing E2E"
      />,
    );

    expect(screen.getByText("Report created")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Next: Run regression tests | Verify: Check failing E2E",
      ),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Expand" }));
    expect(screen.getByTestId("report-summary-card")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onDismiss).toHaveBeenCalledWith("notification-1");
  });
});
