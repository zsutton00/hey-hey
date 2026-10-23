import { Provider } from "jotai";
import { render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import {
  ActivityCorrelationActivityType,
  ActivityCorrelationSource,
  EntityType,
  ReportType,
  type ActivityCorrelationRecordDto,
} from "../../../api";
import { mapCorrelatedActivityRecord } from "../../../data/collections/activityCorrelations";
import type { UseCorrelatedActivityReturn } from "../../../data/hooks/useCorrelatedActivity";
import { ActivityDetailPage } from "../ActivityDetailPage";

const { useCorrelatedActivityMock } = vi.hoisted(() => ({
  useCorrelatedActivityMock: vi.fn(),
}));

vi.mock("../../../data/hooks/useCorrelatedActivity", () => ({
  useCorrelatedActivity: useCorrelatedActivityMock,
}));

vi.mock("../../../contexts/OrganizationContext", () => ({
  useOrganization: () => ({
    currentOrganization: { id: "test-org-id" },
  }),
}));

vi.mock("../../../clients/serviceClients", () => ({
  activityCorrelationClient: {},
  platformClient: {
    getLatestMessage: vi.fn().mockResolvedValue({ data: { data: null } }),
  },
}));

const buildMockReturn = (
  overrides: Partial<UseCorrelatedActivityReturn> = {}
): UseCorrelatedActivityReturn => ({
  data: null,
  records: [],
  rawRecords: [],
  pagination: { limit: 1, offset: 0, totalCount: null, nextOffset: null },
  isLoading: false,
  isFetching: false,
  isFetched: true,
  isReady: true,
  error: null,
  isStale: false,
  refetch: vi.fn().mockResolvedValue(null),
  markStale: vi.fn(),
  ...overrides,
});

const createActivityRecord = (
  overrides: Partial<ActivityCorrelationRecordDto> = {}
) => {
  const baseRecord: ActivityCorrelationRecordDto = {
    entityId: "task-1",
    entityType: EntityType.Task,
    title: "Test Task",
    type: ActivityCorrelationActivityType.Notification,
    timestamp: "2026-03-02T10:00:00.000Z",
    source: ActivityCorrelationSource.System,
    linkedEntities: [],
    reports: [],
  };

  const dto: ActivityCorrelationRecordDto = {
    ...baseRecord,
    ...overrides,
    linkedEntities: overrides.linkedEntities ?? baseRecord.linkedEntities,
    reports: overrides.reports ?? baseRecord.reports,
  };

  const mappedRecord = mapCorrelatedActivityRecord(dto);
  return {
    ...mappedRecord,
    previewText: mappedRecord.preview.full,
  };
};

const renderPage = (ui: ReactElement) =>
  render(
    <Provider>
      <MemoryRouter>{ui}</MemoryRouter>
    </Provider>
  );

describe("ActivityDetailPage", () => {
  it("renders loading state", () => {
    useCorrelatedActivityMock.mockReturnValue(
      buildMockReturn({ isLoading: true })
    );

    renderPage(
      <ActivityDetailPage
        entityId="task-1"
        entityType={EntityType.Task}
        organizationId="org-1"
        projectId="proj-1"
      />
    );

    expect(
      screen.getByTestId("activity-detail-page-loading")
    ).toBeInTheDocument();
  });

  it("renders error state", () => {
    useCorrelatedActivityMock.mockReturnValue(
      buildMockReturn({ error: new Error("Network failure") })
    );

    renderPage(
      <ActivityDetailPage
        entityId="task-1"
        entityType={EntityType.Task}
        organizationId="org-1"
        projectId="proj-1"
      />
    );

    expect(
      screen.getByTestId("activity-detail-page-error")
    ).toBeInTheDocument();
    expect(screen.getByText("Network failure")).toBeInTheDocument();
  });

  it("renders empty state when no records found", () => {
    useCorrelatedActivityMock.mockReturnValue(buildMockReturn());

    renderPage(
      <ActivityDetailPage
        entityId="task-1"
        entityType={EntityType.Task}
        organizationId="org-1"
        projectId="proj-1"
      />
    );

    expect(
      screen.getByTestId("activity-detail-page-empty")
    ).toBeInTheDocument();
  });

  it("renders activity detail layout with reports", () => {
    const activity = createActivityRecord({
      reports: [
        {
          id: "report-1",
          organizationId: "org-1",
          reportType: ReportType.Snapshot,
          title: "Snapshot Report",
          payload: {},
          version: 1,
          schemaVersion: 2,
          createdAt: "2026-03-02T10:00:00.000Z",
          expiresAt: "2026-03-20T10:00:00.000Z",
          entities: [],
        },
      ],
    });

    useCorrelatedActivityMock.mockReturnValue(
      buildMockReturn({ records: [activity] })
    );

    renderPage(
      <ActivityDetailPage
        entityId="task-1"
        entityType={EntityType.Task}
        organizationId="org-1"
        projectId="proj-1"
      />
    );

    expect(screen.getByTestId("activity-detail-page")).toBeInTheDocument();
    expect(screen.getByTestId("activity-detail-layout")).toBeInTheDocument();
    expect(
      screen.getByTestId("activity-detail-report-report-1")
    ).toBeInTheDocument();
  });
});
