import { render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  ActivityCorrelationActivityType,
  ActivityCorrelationSource,
  EntityType,
  RecentActivityCorrelationMode,
  RecentActivityCorrelationSort,
  type ActivityCorrelationRecordDto,
} from "../../../api";
import { mapCorrelatedActivityRecord } from "../../../data/collections/activityCorrelations";
import { type UseCorrelatedActivityReturn } from "../../../data/hooks/useCorrelatedActivity";
import { CorrelatedActivityFeed } from "../CorrelatedActivityFeed";

const useCorrelatedActivityMock = vi.fn();
const useOptionalWebSocketServiceMock = vi.fn();

vi.mock("../../../data/hooks/useCorrelatedActivity", () => ({
  useCorrelatedActivity: (...args: unknown[]) =>
    useCorrelatedActivityMock(...args),
}));

vi.mock("../../../contexts/WebSocketContext", () => ({
  useOptionalWebSocketService: () => useOptionalWebSocketServiceMock(),
}));

vi.mock("../../../contexts/OrganizationContext", () => ({
  useOrganization: () => ({
    currentOrganization: { id: "test-org-id" },
  }),
}));

const createRecord = () => {
  const dto: ActivityCorrelationRecordDto = {
    entityId: "task-1",
    entityType: EntityType.Task,
    title: "Task One",
    type: ActivityCorrelationActivityType.Viewed,
    timestamp: "2026-03-02T00:00:00.000Z",
    source: ActivityCorrelationSource.AttentionEvent,
    linkedEntities: [],
    reports: [],
  };

  const mapped = mapCorrelatedActivityRecord(dto);
  return {
    ...mapped,
    previewText: mapped.preview.full,
  };
};

const buildHookResult = (
  overrides: Partial<UseCorrelatedActivityReturn> = {}
): UseCorrelatedActivityReturn => {
  const record = createRecord();

  return {
    data: {
      items: [record],
      records: [record],
      pagination: {
        limit: 25,
        offset: 0,
        totalCount: 1,
        nextOffset: null,
      },
    },
    records: [record],
    rawRecords: [record],
    pagination: {
      limit: 25,
      offset: 0,
      totalCount: 1,
      nextOffset: null,
    },
    isLoading: false,
    isFetching: false,
    isFetched: true,
    isReady: true,
    error: null,
    isStale: false,
    refetch: vi.fn(),
    markStale: vi.fn(),
    ...overrides,
  };
};

const renderCorrelatedActivityFeed = (ui: ReactElement) => {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
};

describe("CorrelatedActivityFeed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useOptionalWebSocketServiceMock.mockReturnValue(null);
    useCorrelatedActivityMock.mockReturnValue(buildHookResult());
  });

  it("passes filter and update options to useCorrelatedActivity", () => {
    const subscribeToUpdates = vi.fn();

    renderCorrelatedActivityFeed(
      <CorrelatedActivityFeed
        limit={25}
        offset={0}
        organizationId="org-1"
        projectId="project-1"
        subscribeToUpdates={subscribeToUpdates}
        view="dropdown"
      />
    );

    expect(useCorrelatedActivityMock).toHaveBeenCalledWith("org-1", {
      projectId: "project-1",
      mode: RecentActivityCorrelationMode.Task,
      sort: RecentActivityCorrelationSort.LastUpdated,
      limit: 25,
      offset: 0,
      view: "dropdown",
      enabled: undefined,
      subscribeToUpdates,
    });
  });

  it("renders loading state", () => {
    useCorrelatedActivityMock.mockReturnValueOnce(
      buildHookResult({
        isLoading: true,
      })
    );

    renderCorrelatedActivityFeed(
      <CorrelatedActivityFeed organizationId="org-1" projectId="project-1" />
    );

    expect(
      screen.getByTestId("correlated-activity-feed-loading")
    ).toBeInTheDocument();
  });

  it("presents an unstarted read as loading instead of empty", () => {
    useCorrelatedActivityMock.mockReturnValueOnce(
      buildHookResult({
        data: null,
        records: [],
        rawRecords: [],
        isLoading: false,
        isFetched: false,
        isReady: false,
      })
    );
    renderCorrelatedActivityFeed(
      <CorrelatedActivityFeed organizationId="org-1" projectId="project-1" />
    );
    expect(
      screen.getByTestId("correlated-activity-feed-loading")
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("correlated-activity-list")
    ).not.toBeInTheDocument();
  });

  it("retains cached rows while showing refresh progress", () => {
    useCorrelatedActivityMock.mockReturnValueOnce(
      buildHookResult({ isFetching: true })
    );
    renderCorrelatedActivityFeed(
      <CorrelatedActivityFeed organizationId="org-1" projectId="project-1" />
    );
    expect(screen.getByTestId("activity-history-row")).toBeInTheDocument();
    expect(
      screen.getByRole("progressbar", { name: "Refreshing activity" })
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("correlated-activity-feed-loading")
    ).not.toBeInTheDocument();
  });

  it("renders error state", () => {
    useCorrelatedActivityMock.mockReturnValueOnce(
      buildHookResult({
        error: new Error("Failed to fetch"),
      })
    );

    renderCorrelatedActivityFeed(
      <CorrelatedActivityFeed organizationId="org-1" projectId="project-1" />
    );

    expect(
      screen.getByTestId("correlated-activity-feed-error")
    ).toHaveTextContent("Failed to fetch");
  });

  it("renders activity records", () => {
    renderCorrelatedActivityFeed(
      <CorrelatedActivityFeed organizationId="org-1" projectId="project-1" />
    );

    expect(screen.getByTestId("correlated-activity-feed")).toBeInTheDocument();
    expect(screen.getByTestId("correlated-activity-list")).toBeInTheDocument();
    expect(screen.getByTestId("activity-history-row")).toHaveAttribute(
      "data-activity-id",
      "TASK:task-1:VIEWED:2026-03-02T00:00:00.000Z:ATTENTION_EVENT"
    );
    expect(
      screen.getByTestId("activity-history-row-content")
    ).toBeInTheDocument();
  });

  it("renders dropdown view without pagination summary", () => {
    renderCorrelatedActivityFeed(
      <CorrelatedActivityFeed
        organizationId="org-1"
        projectId="project-1"
        view="dropdown"
      />
    );

    expect(
      screen.queryByTestId("activity-pagination-summary")
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("activity-history-row-content")
    ).toBeInTheDocument();
  });

  it("provides a system notification subscription callback by default", () => {
    const subscribe = vi.fn(() => "sub-1");
    const unsubscribe = vi.fn();

    useOptionalWebSocketServiceMock.mockReturnValue({
      subscribe,
      unsubscribe,
    });

    renderCorrelatedActivityFeed(
      <CorrelatedActivityFeed
        organizationId="org-1"
        projectId="project-1"
        userId="user-1"
      />
    );

    const call = useCorrelatedActivityMock.mock.calls.at(-1);
    const hookOptions = call?.[1] as {
      subscribeToUpdates?:
        | ((onUpdate: () => void) => (() => void) | void)
        | undefined;
    };

    expect(hookOptions.subscribeToUpdates).toBeTypeOf("function");

    const onUpdate = vi.fn();
    const cleanup = hookOptions.subscribeToUpdates?.(onUpdate);

    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(typeof cleanup).toBe("function");

    cleanup?.();
    expect(unsubscribe).toHaveBeenCalledWith("sub-1");
  });

  it("uses compact shared rows in dropdown view", () => {
    renderCorrelatedActivityFeed(
      <CorrelatedActivityFeed
        organizationId="org-1"
        projectId="project-1"
        view="dropdown"
      />
    );

    expect(screen.getByTestId("activity-history-row")).toBeInTheDocument();
  });
});
