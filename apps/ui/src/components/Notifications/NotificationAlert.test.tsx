import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import type { NotificationAlertItem } from "../../hooks/useProjectNotificationActivity";
import { NotificationAlert } from "./NotificationAlert";

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
};

const itemFixture = {
  activity: {
    activityId: "activity-1",
    activityType: "NOTIFICATION",
    entityId: "task-1",
    entityType: "TASK",
    linkedEntities: [],
    metadata: {},
    preview: {
      dropdown: "Dropdown summary",
      full: "Full summary",
    },
    previewText: "Dropdown summary",
    priorityRank: 1,
    reports: [reportFixture],
    source: "SYSTEM",
    timestamp: "2026-03-01T00:00:00.000Z",
    type: "NOTIFICATION",
  },
  notification: null,
  notificationId: "notification-1",
  report: reportFixture,
  reportId: "report-1",
  taskId: "task-1",
} as NotificationAlertItem;

describe("NotificationAlert", () => {
  it("renders icon-first alert content with title and full activity callbacks", () => {
    const onDismiss = vi.fn();
    const onNavigateFullActivity = vi.fn();

    render(
      <NotificationAlert
        item={itemFixture}
        onDismiss={onDismiss}
        onNavigateFullActivity={onNavigateFullActivity}
      />,
    );

    expect(screen.getByText("Dropdown summary")).toBeInTheDocument();
    expect(screen.getByTestId("notification-alert-report-icon-activity-1")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("link", { name: "Open activity" }));
    expect(onNavigateFullActivity).toHaveBeenCalledWith("activity-1");

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onDismiss).toHaveBeenCalledWith("notification-1");
    expect(onNavigateFullActivity).toHaveBeenCalledTimes(1);
  });

  it("normalizes viewed-from-attention preview copy to recently viewed", () => {
    const viewedItemFixture = {
      ...itemFixture,
      activity: {
        ...itemFixture.activity,
        activityType: "VIEWED",
        linkedEntities: [{ entityId: "task-1", entityType: "TASK", linkType: "RELATED" }],
        previewText: "Viewed from Attention",
        source: "ATTENTION_EVENT",
      },
    } as NotificationAlertItem;

    render(<NotificationAlert item={viewedItemFixture} />);

    expect(screen.getByText("Recently viewed")).toBeInTheDocument();
    expect(
      screen.getByTestId("notification-alert-linked-entity-icon-activity-1-TASK"),
    ).toBeInTheDocument();
  });
});
