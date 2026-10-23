import {
  AgentSessionCurrentState,
  AgentSessionListSort,
  AgentSessionStatus,
  AgentSessionType,
  EntityType,
  MessageStatus,
  MessageType,
  type PaginatedAgentSessionItemDto,
} from "@hey-hey/ui-common/api";
import { usePaginatedAgentSessions } from "@hey-hey/ui-common/data";
import { useUserIdentity } from "@hey-hey/ui-common/hooks";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PaginatedCodingSessionsFeed } from "./PaginatedCodingSessionsFeed";

const agentSessionListItemMock = vi.fn();
const correlatedActivityListMock = vi.fn();

vi.mock("@hey-hey/ui-common/components", () => ({
  AgentSessionListItem: (props: {
    buildSessionPath?: (agentSessionId: string) => string;
    item: PaginatedAgentSessionItemDto;
    onSessionNavigate?: () => void;
    variant: "coding" | "conversations";
  }) => {
    agentSessionListItemMock(props);
    const href = props.buildSessionPath
      ? props.buildSessionPath(props.item.agentSession.id)
      : `/projects/project-1/agent-sessions/${props.item.agentSession.id}`;
    return (
      <a
        data-testid={`coding-session-container-${props.item.agentSession.id}`}
        href={href}
        onClick={props.onSessionNavigate}
      >
        {props.item.agentSession.title}
      </a>
    );
  },
  AgentSessionUserFilter: (props: {
    onChange: (value: "all" | "mine") => void;
    value: "all" | "mine";
  }) => (
    <select
      aria-label="User"
      data-testid="agent-session-user-filter"
      onChange={(event: React.ChangeEvent<HTMLSelectElement>) => {
        const nextValue = event.target.value;
        if (nextValue === "all" || nextValue === "mine") {
          props.onChange(nextValue);
        }
      }}
      value={props.value}
    >
      <option value="all">All</option>
      <option value="mine">Me</option>
    </select>
  ),
  CorrelatedActivityList: (...args: unknown[]) => {
    correlatedActivityListMock(...args);
    return <div>Legacy graph</div>;
  },
}));

vi.mock("@hey-hey/ui-common/data", () => ({
  usePaginatedAgentSessions: vi.fn(),
}));

vi.mock("@hey-hey/ui-common/hooks", () => ({
  useUserIdentity: vi.fn(),
}));

const usePaginatedAgentSessionsMock = vi.mocked(usePaginatedAgentSessions);
const useUserIdentityMock = vi.mocked(useUserIdentity);
let intersectionCallback: IntersectionObserverCallback;
const observeMock = vi.fn();
const disconnectMock = vi.fn();

const makeItem = (
  overrides: Partial<PaginatedAgentSessionItemDto> = {},
): PaginatedAgentSessionItemDto => ({
  agentSession: {
    id: "session-1",
    organizationId: "org-1",
    projectId: "project-1",
    userId: "user-1",
    status: AgentSessionStatus.InProgress,
    currentState: AgentSessionCurrentState.Idle,
    conversationId: "conversation-1",
    serviceIds: ["service-1", "service-2"],
    launchServiceId: "service-2",
    sessionDate: "2026-07-17T10:00:00.000Z",
    title: "Implement pagination",
    hasUnsyncedChanges: false,
    monitoringEnabled: false,
    autoDecide: false,
    type: AgentSessionType.Coding,
  },
  lastMessage: {
    id: "message-1",
    conversationId: "conversation-1",
    type: MessageType.System,
    status: MessageStatus.Completed,
    data: {
      response: "Done",
      title: "Implementation complete",
      type: "IMPLEMENT",
    },
    createdAt: "2026-07-17T11:00:00.000Z",
  },
  parentEntity: {
    id: "task-1",
    type: EntityType.Task,
    name: "Parent task",
  },
  services: [
    { id: "service-1", name: "API" },
    { id: "service-2", name: "UI" },
  ],
  reports: [
    {
      id: "report-1",
      organizationId: "org-1",
      reportType: "IMPLEMENT",
      audience: "PROJECT_VISIBLE",
      title: "Implement",
      payload: {},
      version: 1,
      schemaVersion: 1,
      createdAt: "2026-07-17T11:00:01.000Z",
      expiresAt: "2026-08-17T11:00:01.000Z",
      entities: [],
    },
  ],
  ...overrides,
});

const mockFeed = (
  overrides: Partial<ReturnType<typeof usePaginatedAgentSessions>> = {},
) => {
  usePaginatedAgentSessionsMock.mockReturnValue({
    items: [],
    nextCursor: null,
    hasNextPage: false,
    isLoading: false,
    isFetching: false,
    isFetchingNextPage: false,
    hasPendingUpdates: false,
    isApplyingUpdates: false,
    error: null,
    loadNextPage: vi.fn(),
    refetch: vi.fn(),
    ...overrides,
  });
};

const renderFeed = (element: React.ReactElement) =>
  render(<MemoryRouter>{element}</MemoryRouter>);

describe("PaginatedCodingSessionsFeed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useUserIdentityMock.mockReturnValue({
      userId: "user-1",
      email: "user@example.com",
      name: "User",
      currentOrgId: "org-1",
      orgMemberships: [],
      isDevAdmin: false,
      devAdminMode: false,
      isTokenExpired: false,
      currentOrgRole: null,
    });
    localStorage.clear();
    vi.stubGlobal(
      "IntersectionObserver",
      vi.fn((callback: IntersectionObserverCallback) => {
        intersectionCallback = callback;
        return {
          disconnect: disconnectMock,
          observe: observeMock,
          root: null,
          rootMargin: "",
          takeRecords: vi.fn(),
          thresholds: [],
          unobserve: vi.fn(),
        };
      }),
    );
    mockFeed();
  });

  it("requests coding sessions in last-message order and toggles the active filter", async () => {
    const user = userEvent.setup();
    renderFeed(
      <PaginatedCodingSessionsFeed
        organizationId="org-1"
        projectId="project-1"
      />,
    );

    expect(usePaginatedAgentSessionsMock).toHaveBeenLastCalledWith(
      "org-1",
      "project-1",
      expect.objectContaining({
        type: AgentSessionType.Coding,
        userId: undefined,
        statuses: Object.values(AgentSessionStatus),
        sort: AgentSessionListSort.LastMessage,
        staleTimeMs: 30000,
      }),
    );

    expect(screen.getByTestId("agent-session-user-filter")).toHaveValue("all");

    await user.selectOptions(
      screen.getByTestId("agent-session-user-filter"),
      "mine",
    );

    expect(usePaginatedAgentSessionsMock).toHaveBeenLastCalledWith(
      "org-1",
      "project-1",
      expect.objectContaining({ userId: "user-1" }),
    );

    await user.click(screen.getByRole("switch", { name: "Active only" }));

    expect(localStorage.getItem("coding-sessions-active-only")).toBe("true");

    expect(usePaginatedAgentSessionsMock).toHaveBeenLastCalledWith(
      "org-1",
      "project-1",
      expect.objectContaining({ statuses: [AgentSessionStatus.InProgress] }),
    );
  });

  it("waits for identity before requesting Me sessions", async () => {
    const user = userEvent.setup();
    useUserIdentityMock.mockReturnValue(null);

    renderFeed(
      <PaginatedCodingSessionsFeed
        organizationId="org-1"
        projectId="project-1"
      />,
    );
    await user.selectOptions(
      screen.getByTestId("agent-session-user-filter"),
      "mine",
    );

    expect(usePaginatedAgentSessionsMock).toHaveBeenLastCalledWith(
      "org-1",
      "project-1",
      expect.objectContaining({ enabled: false, userId: undefined }),
    );
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
  });

  it("passes the selected service into the paginated request", () => {
    renderFeed(
      <PaginatedCodingSessionsFeed
        organizationId="org-1"
        projectId="project-1"
        serviceId="service-1"
      />,
    );

    expect(usePaginatedAgentSessionsMock).toHaveBeenLastCalledWith(
      "org-1",
      "project-1",
      expect.objectContaining({ serviceId: "service-1" }),
    );
  });

  it("passes task scope into the paginated request and uses the task route", () => {
    mockFeed({ items: [makeItem()] });

    renderFeed(
      <PaginatedCodingSessionsFeed
        buildSessionPath={(sessionId) =>
          `/projects/project-1/tasks/task-1/agent-sessions/${sessionId}`
        }
        organizationId="org-1"
        projectId="project-1"
        taskId="task-1"
      />,
    );

    expect(usePaginatedAgentSessionsMock).toHaveBeenLastCalledWith(
      "org-1",
      "project-1",
      expect.objectContaining({ taskId: "task-1" }),
    );
    expect(
      screen.getByText("Implement pagination").closest("a"),
    ).toHaveAttribute(
      "href",
      "/projects/project-1/tasks/task-1/agent-sessions/session-1",
    );
  });

  it("applies the existing search and sort controls to accumulated rows", () => {
    mockFeed({
      items: [
        makeItem({
          agentSession: {
            ...makeItem().agentSession,
            id: "older",
            title: "Older API work",
            sessionDate: "2026-07-16T10:00:00.000Z",
          },
          parentEntity: null,
          services: [],
        }),
        makeItem({
          agentSession: {
            ...makeItem().agentSession,
            id: "newer",
            title: "Newer UI work",
            sessionDate: "2026-07-18T10:00:00.000Z",
          },
        }),
      ],
    });

    renderFeed(
      <PaginatedCodingSessionsFeed
        organizationId="org-1"
        projectId="project-1"
        search="UI"
        sortBy="created-asc"
      />,
    );

    expect(screen.getByText("Newer UI work")).toBeInTheDocument();
    expect(screen.queryByText("Older API work")).not.toBeInTheDocument();
  });

  it("keeps the configured empty and error states", () => {
    mockFeed({ error: new Error("Unable to load sessions") });

    renderFeed(
      <PaginatedCodingSessionsFeed
        emptyMessage="No sessions for this service"
        organizationId="org-1"
        projectId="project-1"
      />,
    );

    expect(screen.getByText("Unable to load sessions")).toBeInTheDocument();
    expect(
      screen.getByText("No sessions for this service"),
    ).toBeInTheDocument();
  });

  it("restores the saved active-only filter preference", () => {
    localStorage.setItem("coding-sessions-active-only", "true");

    renderFeed(
      <PaginatedCodingSessionsFeed
        organizationId="org-1"
        projectId="project-1"
      />,
    );

    expect(screen.getByRole("switch", { name: "Active only" })).toBeChecked();
    expect(usePaginatedAgentSessionsMock).toHaveBeenLastCalledWith(
      "org-1",
      "project-1",
      expect.objectContaining({ statuses: [AgentSessionStatus.InProgress] }),
    );
  });

  it("delegates coding-session row presentation to the shared session row", () => {
    const item = makeItem();
    mockFeed({ items: [item] });

    renderFeed(
      <PaginatedCodingSessionsFeed
        organizationId="org-1"
        projectId="project-1"
      />,
    );

    expect(agentSessionListItemMock).toHaveBeenCalledWith(
      expect.objectContaining({
        item,
        projectId: "project-1",
        variant: "coding",
      }),
    );
    expect(correlatedActivityListMock).not.toHaveBeenCalled();
  });

  it("uses the direct session link and notifies the parent before navigation", async () => {
    const user = userEvent.setup();
    const onSessionNavigate = vi.fn();
    mockFeed({ items: [makeItem()] });

    renderFeed(
      <PaginatedCodingSessionsFeed
        onSessionNavigate={onSessionNavigate}
        organizationId="org-1"
        projectId="project-1"
      />,
    );

    const link = screen.getByTestId("coding-session-container-session-1");
    expect(link).toHaveAttribute(
      "href",
      "/projects/project-1/agent-sessions/session-1",
    );
    expect(screen.getAllByRole("link")).toHaveLength(1);

    await user.click(link);

    expect(onSessionNavigate).toHaveBeenCalledOnce();
  });

  it("loads the next page when the scroll sentinel enters view", () => {
    const loadNextPage = vi.fn();
    mockFeed({
      nextCursor: "next-page",
      hasNextPage: true,
      loadNextPage,
    });

    renderFeed(
      <PaginatedCodingSessionsFeed
        organizationId="org-1"
        projectId="project-1"
      />,
    );

    expect(screen.queryByRole("button", { name: /load more/i })).toBeNull();
    expect(observeMock).toHaveBeenCalledOnce();

    intersectionCallback(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );

    expect(loadNextPage).toHaveBeenCalledOnce();
  });

  it("keeps sessions readable and announces background refresh without applying it", () => {
    const refetch = vi.fn();
    mockFeed({
      items: [makeItem()],
      isFetching: true,
      refetch,
    });

    renderFeed(
      <PaginatedCodingSessionsFeed
        organizationId="org-1"
        projectId="project-1"
      />,
    );

    const sessionResults = screen.getByTestId("coding-session-results");
    expect(sessionResults).toHaveAttribute("aria-busy", "true");
    expect(sessionResults).toHaveStyle({
      opacity: "1",
    });
    expect(screen.queryByText("Checking for updates…")).toBeNull();
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
    expect(screen.queryByTestId("session-feed-apply-updates")).toBeNull();
    expect(refetch).not.toHaveBeenCalled();
    expect(screen.getByText("Implement pagination")).toBeInTheDocument();
  });
});
