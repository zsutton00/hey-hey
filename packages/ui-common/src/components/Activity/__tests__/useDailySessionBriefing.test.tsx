import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ReportAudience,
  ReportSortBy,
  ReportSortOrder,
  ReportType,
  type ReportDto,
} from "../../../api";
import { useProjectReports } from "../../../data/hooks/useProjectReports";
import { useDailySessionBriefing } from "../useDailySessionBriefing";

vi.mock("../../../data/hooks/useProjectReports", () => ({
  useProjectReports: vi.fn(),
}));

const mockUseProjectReports = vi.mocked(useProjectReports);

const buildParentReport = (id: string, createdAt: string): ReportDto => ({
  id,
  organizationId: "org-1",
  projectId: "project-1",
  reportType: ReportType.DailySession,
  audience: ReportAudience.ProjectVisible,
  title: "Daily Session",
  payload: {
    reportType: "DAILY_SESSION",
    summary: "Daily session parent report grouping child reports.",
  },
  version: 1,
  schemaVersion: 1,
  sourceExecutionId: "run-1",
  parentReportId: null,
  createdAt,
  expiresAt: "2026-03-20T09:00:00.000Z",
  entities: [],
});

const baseProjectReportsReturn = {
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

describe("useDailySessionBriefing", () => {
  const newestParent = buildParentReport(
    "parent-new",
    "2026-03-03T09:00:00.000Z"
  );
  const olderParent = buildParentReport(
    "parent-old",
    "2026-03-02T09:00:00.000Z"
  );

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseProjectReports.mockReturnValue({
      ...baseProjectReportsReturn,
      reports: [newestParent, olderParent],
      data: [newestParent, olderParent],
    });
  });

  it("loads recent parent DAILY_SESSION reports newest-first for the selector", () => {
    const { result } = renderHook(() =>
      useDailySessionBriefing("org-1", "project-1")
    );

    expect(mockUseProjectReports).toHaveBeenCalledWith("org-1", "project-1", {
      types: [ReportType.DailySession],
      limit: 10,
      sortBy: ReportSortBy.CreatedAt,
      sortOrder: ReportSortOrder.Desc,
      enabled: true,
      refetchOnStale: true,
    });
    expect(result.current.dailySessionReport).toBe(newestParent);
    expect(result.current.reportId).toBe("parent-new");
    expect(result.current.availableBriefings).toEqual([
      {
        createdAt: "2026-03-03T09:00:00.000Z",
        reportId: "parent-new",
      },
      {
        createdAt: "2026-03-02T09:00:00.000Z",
        reportId: "parent-old",
      },
    ]);
  });

  it("selects the requested parent report when it is present", () => {
    const { result } = renderHook(() =>
      useDailySessionBriefing("org-1", "project-1", "parent-old")
    );

    expect(result.current.dailySessionReport).toBe(olderParent);
    expect(result.current.reportId).toBe("parent-old");
  });

  it("falls back to the newest parent report when the requested report is missing", () => {
    const { result } = renderHook(() =>
      useDailySessionBriefing("org-1", "project-1", "missing-parent")
    );

    expect(result.current.dailySessionReport).toBe(newestParent);
    expect(result.current.reportId).toBe("parent-new");
  });

  it("returns no selected report when no parent briefing exists", () => {
    mockUseProjectReports.mockReturnValue({
      ...baseProjectReportsReturn,
      reports: [],
      data: [],
    });

    const { result } = renderHook(() =>
      useDailySessionBriefing("org-1", "project-1")
    );

    expect(result.current.dailySessionReport).toBeNull();
    expect(result.current.reportId).toBeUndefined();
    expect(result.current.availableBriefings).toEqual([]);
  });
});
