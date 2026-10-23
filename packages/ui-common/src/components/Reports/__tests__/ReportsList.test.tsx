import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ReportEntityRelation,
  ReportRelatedEntityType,
  ReportType,
  type ReportDto,
} from "../../../api";
import { ReportsList } from "../ReportsList";

const mockUseReports = vi.fn();

vi.mock("../../../data/hooks/useReports", () => ({
  useReports: (...args: unknown[]) => mockUseReports(...args),
}));

const reportsFixture: ReportDto[] = [
  {
    id: "report-a",
    organizationId: "org-1",
    reportType: ReportType.CodingResearch,
    payload: {},
    schemaVersion: 2,
    sourceExecutionId: "exec-1",
    createdAt: "2026-01-10T00:00:00.000Z",
    expiresAt: "2026-02-01T00:00:00.000Z",
    entities: [
      {
        entityType: ReportRelatedEntityType.Task,
        entityId: "task-1",
        relation: ReportEntityRelation.Primary,
        createdAt: "2026-01-10T00:00:00.000Z",
      },
    ],
  },
  {
    id: "report-b",
    organizationId: "org-1",
    reportType: ReportType.Snapshot,
    payload: {},
    schemaVersion: 1,
    sourceExecutionId: "exec-2",
    createdAt: "2026-01-05T00:00:00.000Z",
    expiresAt: "2026-02-02T00:00:00.000Z",
    entities: [
      {
        entityType: ReportRelatedEntityType.Task,
        entityId: "task-2",
        relation: ReportEntityRelation.Context,
        createdAt: "2026-01-05T00:00:00.000Z",
      },
    ],
  },
];

const sortFixtureBySchemaVersionAsc = (reports: ReportDto[]) => {
  return [...reports].sort(
    (left, right) => left.schemaVersion - right.schemaVersion
  );
};

describe("ReportsList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseReports.mockImplementation(
      (
        _organizationId: string,
        options?: { sortBy?: string; sortDirection?: string }
      ) => {
        const shouldSortBySchemaVersionAsc =
          options?.sortBy === "schemaVersion" &&
          options.sortDirection === "asc";

        return {
          reports: shouldSortBySchemaVersionAsc
            ? sortFixtureBySchemaVersionAsc(reportsFixture)
            : reportsFixture,
          isLoading: false,
          isFetching: false,
          isFetched: true,
          isReady: true,
          error: null,
          isStale: false,
          refetch: vi.fn(),
          markStale: vi.fn(),
          data: reportsFixture,
        };
      }
    );
  });

  it("renders reports and applies search filtering", () => {
    render(<ReportsList organizationId="org-1" />);

    expect(
      screen.getByTestId("reports-list-item-report-a")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("reports-list-item-report-b")
    ).toBeInTheDocument();

    fireEvent.change(screen.getByTestId("reports-list-search-input"), {
      target: { value: "report-b" },
    });

    expect(
      screen.queryByTestId("reports-list-item-report-a")
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("reports-list-item-report-b")
    ).toBeInTheDocument();
  });

  it("filters by selected report type", () => {
    render(<ReportsList organizationId="org-1" />);

    fireEvent.change(screen.getByTestId("reports-list-report-type-filter"), {
      target: { value: ReportType.Snapshot },
    });

    const lastCall = mockUseReports.mock.calls.at(-1);
    expect(lastCall?.[1]).toMatchObject({
      reportType: ReportType.Snapshot,
    });
  });

  it("renders anchor links that resolve through path service", () => {
    render(<ReportsList organizationId="org-1" projectId="project-1" />);

    const reportLink = screen.getByTestId("reports-list-link-report-a");
    expect(reportLink).toHaveAttribute(
      "href",
      "/projects/project-1/reports/report-a"
    );
  });

  it("wires sort controls into useReports options", () => {
    render(<ReportsList organizationId="org-1" />);

    fireEvent.change(screen.getByTestId("reports-list-sort-by"), {
      target: { value: "schemaVersion" },
    });
    fireEvent.change(screen.getByTestId("reports-list-sort-direction"), {
      target: { value: "asc" },
    });

    const lastCall = mockUseReports.mock.calls.at(-1);
    expect(lastCall?.[1]).toMatchObject({
      sortBy: "schemaVersion",
      sortDirection: "asc",
    });

    const reportItems = screen
      .getByTestId("reports-list-items")
      .querySelectorAll('[data-testid^="reports-list-item-"]');
    expect(reportItems[0]).toHaveAttribute(
      "data-testid",
      "reports-list-item-report-b"
    );
  });
});
