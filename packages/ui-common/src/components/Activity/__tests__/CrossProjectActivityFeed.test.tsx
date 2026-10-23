import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UseCorrelatedActivityReturn } from "../../../data/hooks/useCorrelatedActivity";
import { useCrossProjectActivity } from "../../../data/hooks/useCorrelatedActivity";
import { CrossProjectActivityFeed } from "../CrossProjectActivityFeed";

vi.mock("../../../data/hooks/useCorrelatedActivity", () => ({
  useCrossProjectActivity: vi.fn(),
}));

vi.mock("../CorrelatedActivityList", () => ({
  CorrelatedActivityList: ({
    records,
  }: {
    records: UseCorrelatedActivityReturn["records"];
  }) => <div data-testid="cross-project-list-mock">{records.length}</div>,
}));

const useCrossProjectActivityMock = vi.mocked(useCrossProjectActivity);

const createQueryResult = (
  overrides: Partial<UseCorrelatedActivityReturn> = {}
): UseCorrelatedActivityReturn => ({
  data: null,
  error: null,
  isFetching: false,
  isFetched: true,
  isLoading: false,
  isReady: true,
  isStale: false,
  markStale: vi.fn(),
  pagination: {
    limit: 25,
    offset: 0,
    totalCount: 0,
    nextOffset: null,
  },
  rawRecords: [],
  records: [],
  refetch: vi.fn().mockResolvedValue(null),
  ...overrides,
});

describe("CrossProjectActivityFeed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useCrossProjectActivityMock.mockReturnValue(createQueryResult());
  });

  it("keeps an unstarted read pending and forwards edited history unchanged", () => {
    useCrossProjectActivityMock.mockReturnValue(
      createQueryResult({ isFetched: false })
    );
    const historyFilter = {
      metric: "TASK_CREATED" as const,
      projectIds: [],
      windowStart: "2026-09-01T00:00:00Z",
      windowEnd: "2026-09-02T00:00:00Z",
      userId: "selected-user",
    };
    render(
      <CrossProjectActivityFeed
        organizationId="org"
        query={{ historyFilter, offset: 0 }}
      />
    );
    expect(
      screen.getByTestId("cross-project-activity-loading")
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("cross-project-list-mock")
    ).not.toBeInTheDocument();
    expect(useCrossProjectActivityMock).toHaveBeenCalledWith(
      "org",
      expect.objectContaining({ historyFilter, offset: 0 })
    );
  });

  it("passes ordinary cross-project query state to the shared hook", () => {
    render(
      <CrossProjectActivityFeed
        organizationId="org-1"
        query={{
          projectId: "project-1",
          activityMode: "ALL",
          limit: 25,
          offset: 10,
        }}
      />
    );

    expect(useCrossProjectActivityMock).toHaveBeenCalledWith("org-1", {
      activityScope: "organization",
      projectId: "project-1",
      userId: undefined,
      entityType: undefined,
      activityMode: "ALL",
      activityType: undefined,
      source: undefined,
      serviceId: undefined,
      since: undefined,
      until: undefined,
      affectsMe: undefined,
      sinceLastVisit: undefined,
      limit: 25,
      offset: 10,
      enabled: true,
      view: "full",
    });
  });

  it("renders an empty result state", () => {
    render(
      <CrossProjectActivityFeed
        emptyMessage="Nothing matched"
        organizationId="org-1"
      />
    );

    expect(screen.getByTestId("cross-project-list-mock")).toHaveTextContent(
      "0"
    );
  });

  it("offers retry for a failed result", () => {
    const refetch = vi.fn().mockResolvedValue(null);
    useCrossProjectActivityMock.mockReturnValue(
      createQueryResult({ error: new Error("Activity unavailable"), refetch })
    );

    render(<CrossProjectActivityFeed organizationId="org-1" />);

    expect(screen.getByText("Activity unavailable")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("cross-project-activity-retry"));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("reports the server next offset through pagination controls", () => {
    const onPageChange = vi.fn();
    useCrossProjectActivityMock.mockReturnValue(
      createQueryResult({
        pagination: {
          limit: 25,
          offset: 25,
          totalCount: 50,
          nextOffset: 50,
        },
      })
    );

    render(
      <CrossProjectActivityFeed
        onPageChange={onPageChange}
        organizationId="org-1"
        query={{ limit: 25, offset: 25 }}
      />
    );

    fireEvent.click(screen.getByTestId("cross-project-activity-next"));
    expect(onPageChange).toHaveBeenCalledWith(50);
    fireEvent.click(screen.getByTestId("cross-project-activity-previous"));
    expect(onPageChange).toHaveBeenCalledWith(0);
  });
});
