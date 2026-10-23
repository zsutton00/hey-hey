import {
  AgentSessionCurrentState,
  AgentSessionListSort,
  AgentSessionStatus,
  AgentSessionType,
  MessageStatus,
  MessageType,
  type PaginatedAgentSessionItemDto,
} from "@hey-hey/ui-common/api";
import { usePaginatedAgentSessions } from "@hey-hey/ui-common/data";
import { useUserIdentity } from "@hey-hey/ui-common/hooks";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PaginatedSessionFeed } from "./PaginatedSessionFeed";

const agentSessionListItemMock = vi.fn();
const { motionDivMock, reducedMotionState } = vi.hoisted(() => ({
  motionDivMock: vi.fn(),
  reducedMotionState: { value: false },
}));

vi.mock("motion/react", async () => {
  const ReactModule = await import("react");
  type MockMotionProps = React.HTMLAttributes<HTMLDivElement> & {
    layout?: boolean | string;
    transition?: unknown;
  };

  return {
    motion: {
      div: ReactModule.forwardRef<HTMLDivElement, MockMotionProps>(
        ({ children, layout, transition, ...props }, ref) => {
          motionDivMock({ layout, transition });
          return ReactModule.createElement("div", { ...props, ref }, children);
        },
      ),
    },
    useReducedMotion: () => reducedMotionState.value,
  };
});

vi.mock("@hey-hey/ui-common/components", () => ({
  AgentSessionListItem: (props: {
    item: PaginatedAgentSessionItemDto;
    onDeleteSession?: () => void | Promise<void>;
    variant: "coding" | "conversations";
  }) => {
    agentSessionListItemMock(props);
    const itemName =
      props.variant === "coding" ? "coding-session" : "conversation";
    const response = props.item.lastMessage?.data as {
      response?: string;
    };
    return (
      <div data-testid={`${itemName}-container-${props.item.agentSession.id}`}>
        {props.item.agentSession.title}
        {response.response ? (
          <div
            data-testid={`${itemName}-message-${props.item.agentSession.id}`}
          >
            {response.response}
          </div>
        ) : null}
        {props.onDeleteSession ? (
          <button
            data-testid={`${itemName}-delete-${props.item.agentSession.id}`}
            onClick={() => {
              void props.onDeleteSession?.();
            }}
            type="button"
          />
        ) : null}
      </div>
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
}));

vi.mock("@hey-hey/ui-common/data", () => ({
  usePaginatedAgentSessions: vi.fn(),
}));

vi.mock("@hey-hey/ui-common/hooks", () => ({
  useUserIdentity: vi.fn(),
}));

const usePaginatedAgentSessionsMock = vi.mocked(usePaginatedAgentSessions);
const useUserIdentityMock = vi.mocked(useUserIdentity);
const loadNextPageMock = vi.fn();
let intersectionCallback: IntersectionObserverCallback;

const makeItem = (id: string): PaginatedAgentSessionItemDto => ({
  agentSession: {
    id,
    organizationId: "org-1",
    projectId: "project-1",
    userId: "user-1",
    status: AgentSessionStatus.Completed,
    currentState: AgentSessionCurrentState.Idle,
    conversationId: `conversation-${id}`,
    serviceIds: [],
    sessionDate: "2026-07-24T10:00:00.000Z",
    title: `Conversation ${id}`,
    hasUnsyncedChanges: false,
    monitoringEnabled: false,
    autoDecide: false,
    type: AgentSessionType.EntityConversation,
  },
  lastMessage: {
    id: `message-${id}`,
    conversationId: `conversation-${id}`,
    type: MessageType.System,
    status: MessageStatus.Completed,
    data: { type: "CARRIER" },
    createdAt: "2026-07-24T11:00:00.000Z",
  },
  parentEntity: null,
  services: [],
  reports: [
    {
      id: `report-${id}`,
      organizationId: "org-1",
      reportType: "IMPLEMENT",
      audience: "PROJECT_VISIBLE",
      title: "Implementation report",
      payload: {},
      version: 1,
      schemaVersion: 1,
      createdAt: "2026-07-24T11:00:01.000Z",
      expiresAt: "2026-08-24T11:00:01.000Z",
      entities: [],
    },
  ],
});

const makeItemWithCurrentState = (id: string): PaginatedAgentSessionItemDto => {
  const item = makeItem(id);
  return {
    ...item,
    agentSession: {
      ...item.agentSession,
      currentState: AgentSessionCurrentState.Thinking,
    },
  };
};

const renderConversations = () =>
  render(
    <MemoryRouter>
      <PaginatedSessionFeed
        organizationId="org-1"
        projectId="project-1"
        variant="conversations"
      />
    </MemoryRouter>,
  );

const renderCoding = () =>
  render(
    <MemoryRouter>
      <PaginatedSessionFeed
        organizationId="org-1"
        projectId="project-1"
        variant="coding"
      />
    </MemoryRouter>,
  );

const makeRect = (top: number, bottom: number): DOMRect =>
  ({
    bottom,
    height: bottom - top,
    left: 0,
    right: 100,
    top,
    width: 100,
    x: 0,
    y: top,
    toJSON: () => ({}),
  } as DOMRect);

describe("PaginatedSessionFeed conversations variant", () => {
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
      loadNextPage: loadNextPageMock,
      refetch: vi.fn(),
    });
    vi.stubGlobal(
      "IntersectionObserver",
      vi.fn((callback: IntersectionObserverCallback) => {
        intersectionCallback = callback;
        return {
          disconnect: vi.fn(),
          observe: vi.fn(),
          root: null,
          rootMargin: "",
          takeRecords: vi.fn(),
          thresholds: [],
          unobserve: vi.fn(),
        };
      }),
    );
  });

  it("requests only Entity Conversation sessions in last-message order", () => {
    renderConversations();

    expect(usePaginatedAgentSessionsMock).toHaveBeenCalledWith(
      "org-1",
      "project-1",
      {
        type: AgentSessionType.EntityConversation,
        hasUserMessage: true,
        staleTimeMs: 30000,
        limit: 10,
        sort: AgentSessionListSort.LastMessage,
      },
    );
    expect(screen.queryByRole("switch", { name: "Active only" })).toBeNull();
  });

  it("preserves conversation refresh presentation", () => {
    usePaginatedAgentSessionsMock.mockReturnValue({
      ...usePaginatedAgentSessionsMock(),
      items: [makeItem("one")],
      isFetching: true,
      hasPendingUpdates: true,
    });
    renderConversations();
    expect(screen.getByTestId("conversation-results")).toHaveStyle({ opacity: "0.5" });
    expect(screen.getByRole("button", { name: "Updates available" })).toBeEnabled();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("preserves conversation state presentation and report-backed messages", () => {
    const item = makeItem("session-1");
    usePaginatedAgentSessionsMock.mockReturnValue({
      ...usePaginatedAgentSessionsMock(),
      items: [item],
    });

    renderConversations();

    expect(agentSessionListItemMock).toHaveBeenCalledWith(
      expect.objectContaining({ item, variant: "conversations" }),
    );
  });

  it("renders the shared current-state label for conversations", () => {
    const item = makeItemWithCurrentState("session-1");
    usePaginatedAgentSessionsMock.mockReturnValue({
      ...usePaginatedAgentSessionsMock(),
      items: [item],
    });

    renderConversations();

    expect(agentSessionListItemMock).toHaveBeenCalledWith(
      expect.objectContaining({ item, variant: "conversations" }),
    );
  });

  it("delegates conversation row presentation to the shared session row", () => {
    const item = makeItem("session-1");
    usePaginatedAgentSessionsMock.mockReturnValue({
      ...usePaginatedAgentSessionsMock(),
      items: [item],
    });

    renderConversations();

    expect(agentSessionListItemMock).toHaveBeenCalledWith(
      expect.objectContaining({ item, variant: "conversations" }),
    );
  });

  it("delegates coding row presentation to the shared session row", () => {
    const item = makeItem("session-1");
    usePaginatedAgentSessionsMock.mockReturnValue({
      ...usePaginatedAgentSessionsMock(),
      items: [item],
    });

    renderCoding();

    expect(agentSessionListItemMock).toHaveBeenCalledWith(
      expect.objectContaining({ item, variant: "coding" }),
    );
  });

  it("passes the latest message to the shared session row", () => {
    const baseItem = makeItem("session-1");
    const item: PaginatedAgentSessionItemDto = {
      ...baseItem,
      lastMessage: {
        ...baseItem.lastMessage!,
        data: {
          response:
            "Reviewing the conversation...\n\n──────────\n\nPreparing the response...",
          type: "AGENT",
          uiElements: [{ id: "interstitial", type: "interstitial", label: "" }],
        },
      },
    };
    usePaginatedAgentSessionsMock.mockReturnValue({
      ...usePaginatedAgentSessionsMock(),
      items: [item],
    });

    renderConversations();

    expect(agentSessionListItemMock).toHaveBeenCalledWith(
      expect.objectContaining({ item, variant: "conversations" }),
    );
  });

  it("renders accumulated unique pages and continues from the next cursor", () => {
    usePaginatedAgentSessionsMock.mockReturnValue({
      ...usePaginatedAgentSessionsMock(),
      items: [makeItem("session-1"), makeItem("session-2")],
      nextCursor: "next-page",
      hasNextPage: true,
    });

    renderConversations();

    expect(screen.getAllByText(/Conversation session-/)).toHaveLength(2);
    intersectionCallback(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );
    expect(loadNextPageMock).toHaveBeenCalledOnce();
  });

  it("preserves the results viewport while loading and appending the next page", () => {
    const firstPage = [makeItem("session-1"), makeItem("session-2")];
    usePaginatedAgentSessionsMock.mockReturnValue({
      ...usePaginatedAgentSessionsMock(),
      items: firstPage,
      nextCursor: "next-page",
      hasNextPage: true,
    });

    const { rerender } = renderConversations();
    const results = screen.getByTestId("conversation-results");
    results.scrollTop = 240;

    usePaginatedAgentSessionsMock.mockReturnValue({
      ...usePaginatedAgentSessionsMock(),
      items: firstPage,
      nextCursor: "next-page",
      hasNextPage: true,
      isLoading: true,
      isFetching: true,
      isFetchingNextPage: true,
    });
    rerender(
      <MemoryRouter>
        <PaginatedSessionFeed
          organizationId="org-1"
          projectId="project-1"
          variant="conversations"
        />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("conversation-results")).toBe(results);
    expect(results.scrollTop).toBe(240);
    expect(screen.getAllByText(/Conversation session-/)).toHaveLength(2);

    usePaginatedAgentSessionsMock.mockReturnValue({
      ...usePaginatedAgentSessionsMock(),
      items: [...firstPage, makeItem("session-3")],
      nextCursor: null,
      hasNextPage: false,
    });
    rerender(
      <MemoryRouter>
        <PaginatedSessionFeed
          organizationId="org-1"
          projectId="project-1"
          variant="conversations"
        />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("conversation-results")).toBe(results);
    expect(results.scrollTop).toBe(240);
    expect(screen.getAllByText(/Conversation session-/)).toHaveLength(3);
  });
});

describe("PaginatedSessionFeed coding variant refreshes", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
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
    reducedMotionState.value = false;
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
      loadNextPage: loadNextPageMock,
      refetch: vi.fn(),
    });
    vi.stubGlobal(
      "IntersectionObserver",
      vi.fn((callback: IntersectionObserverCallback) => {
        intersectionCallback = callback;
        return {
          disconnect: vi.fn(),
          observe: vi.fn(),
          root: null,
          rootMargin: "",
          takeRecords: vi.fn(),
          thresholds: [],
          unobserve: vi.fn(),
        };
      }),
    );
  });

  it("retains stable session subtrees during background field patches", () => {
    const first = makeItem("session-1");
    const second = makeItem("session-2");
    usePaginatedAgentSessionsMock.mockReturnValue({
      ...usePaginatedAgentSessionsMock(),
      items: [first, second],
    });

    const { rerender } = renderCoding();
    const firstContainer = screen.getByTestId(
      "coding-session-container-session-1",
    );
    const secondContainer = screen.getByTestId(
      "coding-session-container-session-2",
    );

    usePaginatedAgentSessionsMock.mockReturnValue({
      ...usePaginatedAgentSessionsMock(),
      items: [first, second],
      isFetching: true,
    });
    rerender(
      <MemoryRouter>
        <PaginatedSessionFeed
          organizationId="org-1"
          projectId="project-1"
          variant="coding"
        />
      </MemoryRouter>,
    );

    const promotedSecond: PaginatedAgentSessionItemDto = {
      ...second,
      lastMessage: {
        ...second.lastMessage!,
        data: { response: "Newest message", type: "AGENT" },
      },
    };
    usePaginatedAgentSessionsMock.mockReturnValue({
      ...usePaginatedAgentSessionsMock(),
      items: [first, promotedSecond],
      hasPendingUpdates: true,
      isFetching: false,
    });
    rerender(
      <MemoryRouter>
        <PaginatedSessionFeed
          organizationId="org-1"
          projectId="project-1"
          variant="coding"
        />
      </MemoryRouter>,
    );

    const results = screen.getByTestId("coding-session-results");
    expect(
      Array.from(results.querySelectorAll("[data-session-result-id]")).map(
        (element) => element.getAttribute("data-session-result-id"),
      ),
    ).toEqual(["session-1", "session-2"]);
    expect(screen.getByTestId("coding-session-container-session-1")).toBe(
      firstContainer,
    );
    expect(screen.getByTestId("coding-session-container-session-2")).toBe(
      secondContainer,
    );
    expect(screen.getByText("Newest message")).toBeInTheDocument();
    expect(motionDivMock).toHaveBeenCalledWith(
      expect.objectContaining({ layout: "position" }),
    );
  });

  it("renders the shared current-state icon and preserves lifecycle status", () => {
    const item = makeItemWithCurrentState("session-1");
    usePaginatedAgentSessionsMock.mockReturnValue({
      ...usePaginatedAgentSessionsMock(),
      items: [item],
    });

    renderCoding();

    expect(agentSessionListItemMock).toHaveBeenCalledWith(
      expect.objectContaining({ item, variant: "coding" }),
    );
  });

  it("exposes deletion only when requested and refreshes the paginated window", async () => {
    const item = makeItem("session-1");
    const onSessionDelete = vi.fn().mockResolvedValue(undefined);
    const refetch = vi.fn().mockResolvedValue(undefined);
    usePaginatedAgentSessionsMock.mockReturnValue({
      ...usePaginatedAgentSessionsMock(),
      items: [item],
      refetch,
    });

    render(
      <MemoryRouter>
        <PaginatedSessionFeed
          onSessionDelete={onSessionDelete}
          organizationId="org-1"
          projectId="project-1"
          variant="coding"
        />
      </MemoryRouter>,
    );

    const agentSessionListItemProps = agentSessionListItemMock.mock
      .calls[0]?.[0] as {
      onDeleteSession?: () => void | Promise<void>;
    };
    expect(agentSessionListItemProps.onDeleteSession).toEqual(
      expect.any(Function),
    );

    await act(async () => {
      await agentSessionListItemProps.onDeleteSession?.();
    });

    expect(onSessionDelete).toHaveBeenCalledWith("session-1");
    expect(refetch).toHaveBeenCalledOnce();
  });

  it("preserves both coding-session signals outside Activity", () => {
    const item = makeItemWithCurrentState("session-1");
    usePaginatedAgentSessionsMock.mockReturnValue({
      ...usePaginatedAgentSessionsMock(),
      items: [item],
    });

    render(
      <MemoryRouter>
        <PaginatedSessionFeed
          organizationId="org-1"
          projectId="project-1"
          variant="coding"
        />
      </MemoryRouter>,
    );

    expect(agentSessionListItemMock).toHaveBeenCalledWith(
      expect.objectContaining({ item, variant: "coding" }),
    );
  });

  it("keeps hook-retained rows mounted without scroll compensation", () => {
    const positions = new Map([
      ["session-1", makeRect(-120, -20)],
      ["session-2", makeRect(40, 140)],
      ["session-3", makeRect(150, 250)],
    ]);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function () {
        const sessionId = this.dataset.sessionResultId;
        return (sessionId && positions.get(sessionId)) ?? makeRect(0, 600);
      },
    );
    const items = [
      makeItem("session-1"),
      makeItem("session-2"),
      makeItem("session-3"),
    ];
    usePaginatedAgentSessionsMock.mockReturnValue({
      ...usePaginatedAgentSessionsMock(),
      items,
    });

    const { rerender } = renderCoding();
    const results = screen.getByTestId("coding-session-results");
    const secondContainer = screen.getByTestId(
      "coding-session-container-session-2",
    );
    results.scrollTop = 200;
    fireEvent.scroll(results);

    usePaginatedAgentSessionsMock.mockReturnValue({
      ...usePaginatedAgentSessionsMock(),
      items,
      isFetching: true,
      isLoading: true,
    });
    rerender(
      <MemoryRouter>
        <PaginatedSessionFeed
          organizationId="org-1"
          projectId="project-1"
          variant="coding"
        />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("coding-session-results")).toBe(results);
    expect(results).toHaveStyle({ opacity: "1" });
    expect(screen.queryByText("Checking for updates…")).toBeNull();
    expect(screen.getByTestId("coding-session-container-session-2")).toBe(
      secondContainer,
    );

    positions.set("session-2", makeRect(180, 280));
    usePaginatedAgentSessionsMock.mockReturnValue({
      ...usePaginatedAgentSessionsMock(),
      items,
      hasPendingUpdates: true,
      isFetching: false,
      isLoading: false,
    });
    rerender(
      <MemoryRouter>
        <PaginatedSessionFeed
          organizationId="org-1"
          projectId="project-1"
          variant="coding"
        />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("coding-session-results")).toBe(results);
    expect(screen.getByTestId("coding-session-container-session-2")).toBe(
      secondContainer,
    );
    expect(results).toHaveStyle({ opacity: "1" });
    expect(results.scrollTop).toBe(200);
    expect(screen.getByRole("status")).toHaveTextContent("There is new content. Load it?");
    expect(screen.getByRole("button", { name: "Load updates" })).toBeEnabled();
    expect(usePaginatedAgentSessionsMock().refetch).not.toHaveBeenCalled();
  });

  it("does not resurrect retained rows after a fresh empty response", () => {
    usePaginatedAgentSessionsMock.mockReturnValue({
      ...usePaginatedAgentSessionsMock(),
      items: [makeItem("session-1")],
    });

    const { rerender } = renderCoding();

    usePaginatedAgentSessionsMock.mockReturnValue({
      ...usePaginatedAgentSessionsMock(),
      items: [],
    });
    rerender(
      <MemoryRouter>
        <PaginatedSessionFeed
          organizationId="org-1"
          projectId="project-1"
          variant="coding"
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("No coding sessions found")).toBeInTheDocument();

    usePaginatedAgentSessionsMock.mockReturnValue({
      ...usePaginatedAgentSessionsMock(),
      items: [],
      isFetching: true,
      isLoading: true,
    });
    rerender(
      <MemoryRouter>
        <PaginatedSessionFeed
          organizationId="org-1"
          projectId="project-1"
          variant="coding"
        />
      </MemoryRouter>,
    );

    expect(screen.queryByText("Conversation session-1")).toBeNull();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
  });

  it("does not retain coding rows when task scope changes", () => {
    usePaginatedAgentSessionsMock.mockReturnValue({
      ...usePaginatedAgentSessionsMock(),
      items: [makeItem("session-1")],
    });

    const { rerender } = render(
      <MemoryRouter>
        <PaginatedSessionFeed
          organizationId="org-1"
          projectId="project-1"
          taskId="task-1"
          variant="coding"
        />
      </MemoryRouter>,
    );
    expect(screen.getByText("Conversation session-1")).toBeInTheDocument();

    usePaginatedAgentSessionsMock.mockReturnValue({
      ...usePaginatedAgentSessionsMock(),
      items: [],
      isFetching: true,
      isLoading: true,
    });
    rerender(
      <MemoryRouter>
        <PaginatedSessionFeed
          organizationId="org-1"
          projectId="project-1"
          taskId="task-2"
          variant="coding"
        />
      </MemoryRouter>,
    );

    expect(screen.queryByText("Conversation session-1")).toBeNull();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
  });

  it("disables layout movement when reduced motion is preferred", () => {
    reducedMotionState.value = true;
    usePaginatedAgentSessionsMock.mockReturnValue({
      ...usePaginatedAgentSessionsMock(),
      items: [makeItem("session-1")],
    });

    renderCoding();

    expect(motionDivMock).toHaveBeenCalledWith(
      expect.objectContaining({ layout: false }),
    );
  });
  it("applies updates only on request and resets the containing viewport after success", async () => {
    const user = userEvent.setup();
    let finish!: (result: "applied" | "superseded") => void;
    const refetch = vi.fn(
      () =>
        new Promise<"applied" | "superseded">((resolve) => {
          finish = resolve;
        }),
    );
    usePaginatedAgentSessionsMock.mockReturnValue({
      ...usePaginatedAgentSessionsMock(),
      items: [makeItem("one")],
      hasPendingUpdates: true,
      refetch,
    });
    const view = () => (
      <div data-testid="viewport" style={{ overflowY: "auto" }}>
        <PaginatedSessionFeed
          organizationId="org-1"
          projectId="project-1"
          variant="coding"
        />
      </div>
    );
    const { rerender } = render(view());
    const viewport = screen.getByTestId("viewport");
    viewport.scrollTop = 250;
    Object.defineProperty(viewport, "scrollHeight", { value: 1000 });
    Object.defineProperty(viewport, "clientHeight", { value: 600 });
    vi.spyOn(viewport, "getBoundingClientRect").mockReturnValue(
      makeRect(0, 600),
    );
    vi.spyOn(
      screen.getByTestId("paginated-coding-sessions-feed"),
      "getBoundingClientRect",
    ).mockReturnValue(makeRect(-250, 500));
    const originalRow = screen.getByTestId("coding-session-container-one");
    expect(refetch).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("There is new content. Load it?");
    await user.click(screen.getByRole("button", { name: "Load updates" }));
    expect(refetch).toHaveBeenCalledOnce();
    expect(viewport.scrollTop).toBe(250);
    usePaginatedAgentSessionsMock.mockReturnValue({
      ...usePaginatedAgentSessionsMock(),
      isApplyingUpdates: true,
    });
    rerender(view());
    expect(screen.getByTestId("session-feed-apply-updates")).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Loading updates…");
    expect(screen.getByTestId("coding-session-results")).toHaveStyle({ opacity: "1" });
    fireEvent.click(screen.getByTestId("session-feed-apply-updates"));
    expect(refetch).toHaveBeenCalledOnce();
    expect(screen.getByTestId("coding-session-container-one")).toBe(
      originalRow,
    );
    usePaginatedAgentSessionsMock.mockReturnValue({
      ...usePaginatedAgentSessionsMock(),
      items: [],
      isApplyingUpdates: false,
      hasPendingUpdates: false,
    });
    await act(async () => {
      finish("applied");
    });
    expect(viewport.scrollTop).toBe(0);
    expect(screen.getByText("No coding sessions found")).toBeInTheDocument();
    expect(screen.queryByTestId("session-feed-apply-updates")).toBeNull();
  });

  it("preserves scroll on failed or superseded application and exposes retry", async () => {
    const refetch = vi
      .fn()
      .mockRejectedValueOnce(new Error("Failed"))
      .mockResolvedValueOnce("superseded");
    usePaginatedAgentSessionsMock.mockReturnValue({
      ...usePaginatedAgentSessionsMock(),
      items: [makeItem("one")],
      hasPendingUpdates: true,
      refetch,
    });
    const { rerender } = renderCoding();
    const results = screen.getByTestId("coding-session-results");
    results.scrollTop = 180;
    await act(async () =>
      fireEvent.click(screen.getByTestId("session-feed-apply-updates")),
    );
    usePaginatedAgentSessionsMock.mockReturnValue({
      ...usePaginatedAgentSessionsMock(),
      error: new Error("Failed"),
    });
    rerender(
      <MemoryRouter>
        <PaginatedSessionFeed
          organizationId="org-1"
          projectId="project-1"
          variant="coding"
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Failed");
    expect(screen.getByRole("button", { name: "Retry updates" })).toBeEnabled();
    expect(screen.getByRole("status")).toHaveTextContent("Updates could not be loaded. Try again.");
    expect(results).toHaveStyle({ opacity: "1" });
    expect(screen.getByTestId("coding-session-container-one")).toBeInTheDocument();
    await act(async () =>
      fireEvent.click(screen.getByTestId("session-feed-apply-updates")),
    );
    expect(refetch).toHaveBeenCalledTimes(2);
    expect(results.scrollTop).toBe(180);
  });

  it("keeps name sorting stable during field changes and reapplies explicit sort changes", () => {
    const first = makeItem("a");
    const second = makeItem("b");
    usePaginatedAgentSessionsMock.mockReturnValue({
      ...usePaginatedAgentSessionsMock(),
      items: [first, second],
    });
    const view = (sortBy: string, search = "") => (
      <PaginatedSessionFeed
        organizationId="org-1"
        projectId="project-1"
        variant="coding"
        sortBy={sortBy}
        search={search}
      />
    );
    const { rerender } = render(view("name-asc"));
    const row = screen.getByTestId("coding-session-container-a");
    const updated = {
      ...first,
      agentSession: { ...first.agentSession, title: "Zebra" },
    };
    usePaginatedAgentSessionsMock.mockReturnValue({
      ...usePaginatedAgentSessionsMock(),
      items: [updated, second],
    });
    rerender(view("name-asc"));
    const order = () =>
      Array.from(
        screen
          .getByTestId("coding-session-results")
          .querySelectorAll("[data-session-result-id]"),
      ).map((element) => element.getAttribute("data-session-result-id"));
    expect(order()).toEqual(["a", "b"]);
    expect(screen.getByTestId("coding-session-container-a")).toBe(row);
    expect(row).toHaveTextContent("Zebra");
    rerender(view("name-desc"));
    rerender(view("name-asc"));
    expect(order()).toEqual(["b", "a"]);
    rerender(view("name-asc", "Zebra"));
    expect(order()).toEqual(["a"]);
  });
  it("replaces the displayed order on successful application while retaining shared row identity", async () => {
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    const first = makeItem("a");
    const second = makeItem("b");
    const refetch = vi.fn(async () => {
      usePaginatedAgentSessionsMock.mockReturnValue({
        ...usePaginatedAgentSessionsMock(),
        items: [second, first],
        hasPendingUpdates: false,
      });
      return "applied" as const;
    });
    usePaginatedAgentSessionsMock.mockReturnValue({
      ...usePaginatedAgentSessionsMock(),
      items: [first, second, makeItem("old-page")],
      hasPendingUpdates: true,
      refetch,
    });
    renderCoding();
    const row = screen.getByTestId("coding-session-container-a");
    await act(async () =>
      fireEvent.click(screen.getByTestId("session-feed-apply-updates")),
    );
    expect(
      Array.from(
        screen
          .getByTestId("coding-session-results")
          .querySelectorAll("[data-session-result-id]"),
      ).map((element) => element.getAttribute("data-session-result-id")),
    ).toEqual(["b", "a"]);
    expect(screen.getByTestId("coding-session-container-a")).toBe(row);
    expect(screen.queryByTestId("session-feed-apply-updates")).toBeNull();
    expect(window.scrollTo).toHaveBeenCalledOnce();
  });
});
