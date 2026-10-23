import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ReportAudience,
  ReportEntityRelation,
  ReportRelatedEntityType,
  ReportType,
  type ReportDto,
} from "../../../api";
import { Report } from "../Report";

const mockUseReport = vi.fn();

vi.mock("../../../data/hooks/useReport", () => ({
  useReport: (...args: unknown[]) => mockUseReport(...args),
}));

const reportFixture: ReportDto = {
  id: "report-1",
  organizationId: "org-1",
  audience: ReportAudience.WorkflowOnly,
  reportType: ReportType.Snapshot,
  title: "Snapshot Report",
  payload: {},
  version: 1,
  schemaVersion: 2,
  sourceExecutionId: "exec-11",
  createdAt: "2026-01-01T00:00:00.000Z",
  expiresAt: "2026-03-01T00:00:00.000Z",
  entities: [
    {
      entityType: ReportRelatedEntityType.Task,
      entityId: "task-primary",
      relation: ReportEntityRelation.Primary,
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    {
      entityType: ReportRelatedEntityType.Task,
      entityId: "task-context",
      relation: ReportEntityRelation.Context,
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  ],
};

describe("Report", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseReport.mockReturnValue({
      data: reportFixture,
      isLoading: false,
      isFetching: false,
      isFetched: true,
      isReady: true,
      error: null,
      isStale: false,
      refetch: vi.fn(),
      markStale: vi.fn(),
    });
  });

  it("renders provided report data", () => {
    render(<Report report={reportFixture} />);

    expect(screen.getByTestId("report-view")).toBeInTheDocument();
    expect(
      screen.getByTestId("report-viewer-report-1-title"),
    ).toHaveTextContent("Snapshot Report");
    expect(screen.getByTestId("report-viewer-report-1-type")).toHaveTextContent(
      "SNAPSHOT",
    );
  });

  it("marks saved eval output with the evaluation badge", () => {
    render(<Report report={reportFixture} evaluationOutput />);

    expect(screen.getByTestId("evaluation-output-badge")).toBeInTheDocument();
    expect(
      screen.getByTestId("report-viewer-report-1-title"),
    ).toHaveTextContent("Snapshot Report");
  });

  it("leaves ordinary reports unmarked", () => {
    render(<Report report={reportFixture} />);

    expect(
      screen.queryByTestId("evaluation-output-badge"),
    ).not.toBeInTheDocument();
  });

  it("renders fetched report data when organizationId/reportId are provided", () => {
    render(<Report organizationId="org-1" reportId="report-1" />);

    expect(mockUseReport).toHaveBeenCalledWith("org-1", "report-1", {
      enabled: true,
    });
    expect(screen.getByTestId("report-view")).toBeInTheDocument();
    expect(
      screen.getByTestId("report-viewer-report-1-title"),
    ).toHaveTextContent("Snapshot Report");
  });

  it("renders empty state when no report is available", () => {
    mockUseReport.mockReturnValueOnce({
      data: null,
      isLoading: false,
      isFetching: false,
      isFetched: true,
      isReady: true,
      error: null,
      isStale: false,
      refetch: vi.fn(),
      markStale: vi.fn(),
    });

    render(<Report organizationId="org-1" reportId="missing-report" />);
    expect(screen.getByTestId("report-view-empty")).toBeInTheDocument();
  });
});
