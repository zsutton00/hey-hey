import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ReportAudience,
  ReportType,
  type ReportDto,
  type ReportPayload,
} from "../../../api";
import { useReports } from "../../../data/hooks/useReports";
import { useDailySessionReports } from "../useDailySessionReports";

vi.mock("../../../data/hooks/useReports", () => ({
  useReports: vi.fn(),
}));

const mockUseReports = vi.mocked(useReports);

const buildReport = (
  id: string,
  reportType: ReportType,
  payload: ReportPayload
): ReportDto => ({
  id,
  organizationId: "org-1",
  projectId: "project-1",
  reportType,
  audience: ReportAudience.ProjectVisible,
  title: reportType,
  payload,
  version: 1,
  schemaVersion: 1,
  sourceExecutionId: "run-1",
  parentReportId: "parent-1",
  createdAt: "2026-03-02T09:00:00.000Z",
  expiresAt: "2026-03-20T09:00:00.000Z",
  entities: [],
});

const baseReportsReturn = {
  reports: [],
  data: [],
  isLoading: false,
  isFetching: false,
  isFetched: true,
  isReady: true,
  error: null,
  isStale: false,
  refetch: vi.fn(),
  markStale: vi.fn(),
};

describe("useDailySessionReports", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads child reports by parentReportId oldest-first", () => {
    mockUseReports.mockReturnValue(baseReportsReturn);

    renderHook(() => useDailySessionReports("org-1", "project-1", "parent-1"));

    expect(mockUseReports).toHaveBeenCalledWith("org-1", {
      projectId: "project-1",
      parentReportId: "parent-1",
      enabled: true,
      sortBy: "createdAt",
      sortDirection: "asc",
    });
  });

  it("keeps only renderable child reports with user-facing text", () => {
    const goalProgress = buildReport("goal", ReportType.GoalProgress, {
      reportType: "GOAL_PROGRESS",
      summary: "Goal progress summary",
      text: "Progress is on track.",
    });
    const riskAlert = buildReport("risk", ReportType.RiskAlert, {
      reportType: "RISK_ALERT",
      summary: "Risk summary",
      text: "A delivery risk needs attention.",
    });
    const sessionSummary = buildReport("summary", ReportType.SessionSummary, {
      reportType: "SESSION_SUMMARY",
      summary: "Session summary",
      text: "The daily session completed.",
    });
    const emptyText = buildReport("empty", ReportType.GoalProgress, {
      reportType: "GOAL_PROGRESS",
      summary: "Goal progress summary",
      text: " ",
    });
    const unsupported = buildReport("daily", ReportType.DailySession, {
      reportType: "DAILY_SESSION",
      summary: "Parent container.",
    });

    mockUseReports.mockReturnValue({
      ...baseReportsReturn,
      reports: [
        goalProgress,
        riskAlert,
        sessionSummary,
        emptyText,
        unsupported,
      ],
      data: [goalProgress, riskAlert, sessionSummary, emptyText, unsupported],
    });

    const { result } = renderHook(() =>
      useDailySessionReports("org-1", "project-1", "parent-1")
    );

    expect(result.current.reports.map((report) => report.id)).toEqual([
      "goal",
      "risk",
      "summary",
    ]);
  });
});
