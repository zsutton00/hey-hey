import { useCorrelatedActivity } from "@hey-hey/ui-common/data";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { ActivityDropdownItem } from "./ActivityDropdownItem";

const itemFixture = {
  kind: "entity",
  activityId: "activity-1",
  activityType: "NOTIFICATION",
  entityId: "task-1",
  entityType: "TASK",
  linkedEntities: [
    {
      entityId: "task-2",
      entityType: "TASK",
      linkType: "CHILD",
      title: "Child task",
    },
    {
      entityId: "task-3",
      entityType: "TASK",
      linkType: "RELATED",
      title: "Sibling task",
    },
  ],
  metadata: {
    durationMs: 90000,
  },
  preview: {
    dropdown: "Dropdown preview",
    full: "Full preview",
  },
  previewText: "Dropdown preview",
  priorityRank: 40,
  reports: [
    {
      createdAt: "2026-03-01T00:00:00.000Z",
      entities: [],
      expiresAt: "2026-04-01T00:00:00.000Z",
      id: "report-1",
      organizationId: "org-1",
      payload: {
        nextSteps: [{ title: "Ship update" }],
        recommendedUpdates: [],
        verificationTasks: [{ title: "Run checks" }],
      },
      projectId: "project-1",
      reportType: "SNAPSHOT",
      schemaVersion: 1,
      sourceExecutionId: null,
      title: "Daily report",
      version: 1,
    },
  ],
  source: "SYSTEM",
  timestamp: "2026-03-01T00:00:00.000Z",
  title: "Agent sync completed",
  type: "NOTIFICATION",
} as ReturnType<typeof useCorrelatedActivity>["records"][number];

const recentItemFixture = {
  kind: "recent",
  activityId: "activity-2",
  conversationId: null,
  entityId: "task-4",
  entityType: "TASK",
  linkedEntities: [],
  mode: "TASK",
  plan: undefined,
  preview: {
    dropdown: "Recent task activity",
    full: "Recent task activity",
  },
  previewText: "Recent task activity",
  priorityRank: 0,
  reports: [],
  sort: "LAST_UPDATED",
  status: "ACTIVE",
  timestamp: "2026-03-02T00:00:00.000Z",
  title: "Implement activity fetch",
  updatedAt: "2026-03-02T00:00:00.000Z",
} as ReturnType<typeof useCorrelatedActivity>["records"][number];

describe("ActivityDropdownItem", () => {
  it("renders compact metadata and report summary details", () => {
    render(<ActivityDropdownItem activity={itemFixture} onClick={vi.fn()} />);

    expect(screen.getByText("Agent sync completed")).toBeInTheDocument();
    expect(screen.getByText("Linked entities: Child task, Sibling task")).toBeInTheDocument();
    expect(screen.getByText("Report: Daily report")).toBeInTheDocument();
    expect(screen.getByText("Duration 2m")).toBeInTheDocument();
  });

  it("supports pointer and keyboard navigation interactions", () => {
    const onClick = vi.fn();
    render(<ActivityDropdownItem activity={itemFixture} onClick={onClick} />);

    const itemLink = screen.getByRole("link", { name: "Open activity" });
    fireEvent.click(itemLink);
    fireEvent.keyDown(itemLink, { key: "Enter" });

    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it("renders recent task records without entity-only metadata fields", () => {
    render(
      <ActivityDropdownItem activity={recentItemFixture} onClick={vi.fn()} />,
    );

    expect(screen.getByText("Implement activity fetch")).toBeInTheDocument();
    expect(screen.getByText("Task")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("Linked entities: none")).toBeInTheDocument();
  });
});
