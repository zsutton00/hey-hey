import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ActivityCorrelationActivityType,
  ActivityCorrelationSource,
  EntityType,
} from "../../../api";
import { mapCorrelatedActivityRecord } from "../../../data/collections/activityCorrelations";
import { ActivityHistoryRow } from "../ActivityHistoryRow";
import { CorrelatedActivityList } from "../CorrelatedActivityList";

const record = mapCorrelatedActivityRecord({
  entityId: "task",
  entityType: EntityType.Task,
  projectId: "project",
  title: "Completed work",
  status: "COMPLETED",
  timestamp: "2026-09-02T12:00:00Z",
  entityCreatedAt: "2026-08-01T12:00:00Z",
  projectName: "Product",
  responsibleUser: {
    id: "user",
    name: "Alex",
    email: "alex@example.test",
    isActive: true,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  },
  type: ActivityCorrelationActivityType.Notification,
  source: ActivityCorrelationSource.System,
  linkedEntities: [],
  reports: [],
  conversationId: "conversation",
});

describe("ActivityHistoryRow", () => {
  beforeEach(() => {
    window.matchMedia = vi.fn().mockImplementation((query) => ({
      matches: false,
      media: query,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
  });
  it("renders one plain creation date and opens the source task in its owning project", () => {
    const onExpandActivity = vi.fn();
    render(
      <MemoryRouter>
        <ActivityHistoryRow
          activity={record}
          projectId="wrong-project"
          onExpandActivity={onExpandActivity}
        />
      </MemoryRouter>
    );
    expect(screen.getByText("Alex")).toBeInTheDocument();
    expect(screen.getByText("Product")).toBeInTheDocument();
    expect(
      screen.getByLabelText("Current status: Completed")
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/^Created:/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Created:/)).toHaveTextContent(
      new Date("2026-08-01T12:00:00Z").toLocaleDateString()
    );
    expect(screen.queryByLabelText(/^Activity:/)).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("entity-list-item-status")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("entity-list-item-metadata")
    ).not.toBeInTheDocument();
    expect(
      screen
        .getByTestId("activity-history-row")
        .querySelectorAll(".MuiChip-root")
    ).toHaveLength(0);
    expect(screen.getByTestId("activity-history-identity")).toHaveTextContent(
      "Product"
    );
    expect(screen.getByTestId("activity-history-status")).toHaveTextContent(
      "Completed"
    );
    expect(
      screen.getByTestId("activity-history-responsible-user")
    ).toHaveTextContent("Alex");
    expect(screen.getByTestId("activity-history-created")).toHaveTextContent(
      new Date("2026-08-01T12:00:00Z").toLocaleDateString()
    );
    fireEvent.click(screen.getByText("Completed work"));
    expect(onExpandActivity).toHaveBeenCalledWith({
      activity: record,
      href: "/projects/project/tasks/task",
    });
  });

  it("omits unavailable identities and preview text while retaining navigation", () => {
    render(
      <MemoryRouter>
        <ActivityHistoryRow
          activity={{
            ...record,
            responsibleUser: null,
            projectName: null,
            entityCreatedAt: null,
            previewText: "Never show this message",
          }}
        />
      </MemoryRouter>
    );
    expect(screen.queryByText("Alex")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Never show this message")
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      "/projects/project/tasks/task"
    );
    expect(screen.queryByLabelText(/^Created:/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^Activity:/)).not.toBeInTheDocument();
  });
  it("keeps metadata visible as plain text on narrow screens", () => {
    const matchMedia = vi
      .spyOn(window, "matchMedia")
      .mockImplementation((query) => ({
        matches: true,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }));
    render(
      <MemoryRouter>
        <ActivityHistoryRow activity={record} />
      </MemoryRouter>
    );
    expect(
      screen.getByTestId("activity-history-responsible-user")
    ).toHaveTextContent("Alex");
    expect(screen.getByText("Product")).toBeInTheDocument();
    expect(
      screen.queryByTestId("entity-list-item-metadata-mobile-toggle")
    ).not.toBeInTheDocument();
    matchMedia.mockRestore();
  });
  it("aligns history rows beneath the mockup's four column headings", () => {
    render(
      <MemoryRouter>
        <CorrelatedActivityList
          records={[record]}
          organizationId="org"
          showHeader={false}
        />
      </MemoryRouter>
    );
    expect(
      screen.getByTestId("activity-history-column-headings")
    ).toHaveTextContent("SourceCurrent statusResponsible userCreated");
    expect(
      screen.getByTestId("activity-history-row-content").children
    ).toHaveLength(4);
    expect(screen.getByTestId("activity-history-results")).toHaveTextContent(
      "1 result"
    );
  });
  it.each([
    [
      EntityType.AgentSession,
      "session",
      "/projects/project/resolve-agent-session-by-id/session",
    ],
    [
      EntityType.Message,
      "message",
      "/projects/project/resolve-message/message",
    ],
    [
      EntityType.Conversation,
      "conversation",
      "/projects/project/resolve-agent-session/conversation",
    ],
  ])("opens %s using its own identity", (entityType, entityId, href) => {
    render(
      <MemoryRouter>
        <ActivityHistoryRow activity={{ ...record, entityType, entityId }} />
      </MemoryRouter>
    );
    expect(screen.getByRole("link")).toHaveAttribute("href", href);
  });
});
