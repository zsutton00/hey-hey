import { render, screen } from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReportType, type ReportDto } from "@hey-hey/ui-common/api";

const mockUseProjectReports = vi.fn();

vi.mock("@hey-hey/ui-common/data", () => ({
  useProjectReports: (...args: unknown[]) => mockUseProjectReports(...args),
}));

interface ReportCardMockProps {
  report: ReportDto;
}

vi.mock("@hey-hey/ui-common/components", () => ({
  ReportCard: ({ report }: ReportCardMockProps) => (
    <div data-testid={`report-card-${report.id}`} data-report-type={report.reportType}>
      <span data-testid={`report-title-${report.id}`}>{report.title}</span>
      <span data-testid={`report-text-${report.id}`}>
        {(report.payload as { text?: string }).text ?? ""}
      </span>
    </div>
  ),
}));

import { FeatureReportsTab } from "./FeatureReportsTab";

const buildReport = (overrides: Partial<ReportDto>): ReportDto => ({
  id: "report-1",
  organizationId: "org-1",
  projectId: "project-1",
  reportType: ReportType.FeatureTreeAnalysis,
  title: "Feature tree analysis",
  payload: {
    reportType: "FEATURE_TREE_ANALYSIS",
    summary: "summary",
    text: "tree body",
  },
  version: 1,
  schemaVersion: 1,
  sourceExecutionId: "exec-1",
  createdAt: "2026-05-10T09:00:00.000Z",
  expiresAt: "2027-05-10T09:00:00.000Z",
  entities: [],
  ...overrides,
});

const setReports = (reports: ReportDto[]): void => {
  mockUseProjectReports.mockReturnValue({
    reports,
    data: reports,
    isLoading: false,
    isFetching: false,
    isFetched: true,
    isReady: true,
    error: null,
    isStale: false,
    refetch: vi.fn(),
    markStale: vi.fn(),
  });
};

const renderComponent = (): ReturnType<typeof render> =>
  render(
    <MemoryRouter>
      <FeatureReportsTab organizationId="org-1" projectId="project-1" />
    </MemoryRouter>,
  );

describe("FeatureReportsTab", () => {
  beforeEach(() => {
    mockUseProjectReports.mockReset();
  });

  it("renders both feature tree analysis and competitive analysis rows", () => {
    setReports([
      buildReport({
        id: "report-tree-1",
        reportType: ReportType.FeatureTreeAnalysis,
        title: "Tree analysis",
        payload: {
          reportType: "FEATURE_TREE_ANALYSIS",
          summary: "s",
          text: "We see drift in @[feature:abc|Plans] subtree.",
        },
      }),
      buildReport({
        id: "report-comp-1",
        reportType: ReportType.CompetitiveAnalysis,
        title: "Competitive analysis",
        payload: {
          reportType: "COMPETITIVE_ANALYSIS",
          summary: "s",
          text: "Compared to competitor, @[feature:xyz|Onboarding] lags.",
        },
      }),
    ]);

    renderComponent();

    const treeCard = screen.getByTestId("report-card-report-tree-1");
    expect(treeCard).toHaveAttribute("data-report-type", "FEATURE_TREE_ANALYSIS");
    expect(
      screen.getByTestId("report-text-report-tree-1"),
    ).toHaveTextContent("@[feature:abc|Plans]");

    const compCard = screen.getByTestId("report-card-report-comp-1");
    expect(compCard).toHaveAttribute("data-report-type", "COMPETITIVE_ANALYSIS");
    expect(
      screen.getByTestId("report-text-report-comp-1"),
    ).toHaveTextContent("@[feature:xyz|Onboarding]");
  });

  it("renders the empty state when no reports are returned", () => {
    setReports([]);

    renderComponent();

    expect(screen.getByTestId("feature-reports-empty")).toBeInTheDocument();
  });

  it("requests both FEATURE_TREE_ANALYSIS and COMPETITIVE_ANALYSIS report types", () => {
    setReports([]);

    renderComponent();

    expect(mockUseProjectReports).toHaveBeenCalledWith(
      "org-1",
      "project-1",
      expect.objectContaining({
        types: [
          ReportType.FeatureTreeAnalysis,
          ReportType.CompetitiveAnalysis,
        ],
        sortBy: "createdAt",
        sortOrder: "DESC",
      }),
    );
  });
});
