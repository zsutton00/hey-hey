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
import { ActivityDetailLayout } from "../ActivityDetailLayout";

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

const renderLayout = (ui: ReactElement) =>
  render(
    <Provider>
      <MemoryRouter>{ui}</MemoryRouter>
    </Provider>
  );

describe("ActivityDetailLayout", () => {
  it("renders activity card and reports section", () => {
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

    renderLayout(
      <ActivityDetailLayout
        activity={activity}
        organizationId="org-1"
        projectId="proj-1"
      />
    );

    expect(screen.getByTestId("activity-detail-layout")).toBeInTheDocument();
    expect(screen.getByTestId("activity-detail-reports")).toBeInTheDocument();
    expect(
      screen.getByTestId("activity-detail-report-report-1")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("activity-detail-report-report-1-title")
    ).toHaveTextContent("Snapshot Report");
  });

  it("renders multiple reports", () => {
    const activity = createActivityRecord({
      reports: [
        {
          id: "report-1",
          organizationId: "org-1",
          reportType: ReportType.Snapshot,
          title: "First Report",
          payload: {},
          version: 1,
          schemaVersion: 1,
          createdAt: "2026-03-02T10:00:00.000Z",
          expiresAt: "2026-03-20T10:00:00.000Z",
          entities: [],
        },
        {
          id: "report-2",
          organizationId: "org-1",
          reportType: ReportType.Snapshot,
          title: "Second Report",
          payload: {},
          version: 1,
          schemaVersion: 1,
          createdAt: "2026-03-02T11:00:00.000Z",
          expiresAt: "2026-03-20T11:00:00.000Z",
          entities: [],
        },
      ],
    });

    renderLayout(
      <ActivityDetailLayout
        activity={activity}
        organizationId="org-1"
        projectId="proj-1"
      />
    );

    expect(
      screen.getByTestId("activity-detail-report-report-1")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("activity-detail-report-report-2")
    ).toBeInTheDocument();
  });

  it("hides reports section when no reports exist", () => {
    const activity = createActivityRecord({ reports: [] });

    renderLayout(
      <ActivityDetailLayout
        activity={activity}
        organizationId="org-1"
        projectId="proj-1"
      />
    );

    expect(screen.getByTestId("activity-detail-layout")).toBeInTheDocument();
    expect(
      screen.queryByTestId("activity-detail-reports")
    ).not.toBeInTheDocument();
  });
});
