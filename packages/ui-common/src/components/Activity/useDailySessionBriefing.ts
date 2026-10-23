import { useMemo } from "react";
import {
  ReportSortBy,
  ReportSortOrder,
  ReportType,
  type ReportDto,
} from "../../api";
import { useProjectReports } from "../../data/hooks/useProjectReports";

// Maximum number of historical briefings exposed via the date dropdown.
const MAX_AVAILABLE_BRIEFINGS = 10;

const DAILY_SESSION_REPORT_TYPES: ReportType[] = [ReportType.DailySession];

// ---------------------------------------------------------------------------
// Return type
// ---------------------------------------------------------------------------

export interface DailySessionBriefingOption {
  createdAt: string;
  reportId: string;
}

export interface DailySessionBriefingData {
  dailySessionReport: ReportDto | null;
  reportId: string | undefined;
  isLoading: boolean;
  availableBriefings: DailySessionBriefingOption[];
  error: Error | null;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useDailySessionBriefing(
  organizationId: string | undefined,
  projectId: string | undefined,
  selectedReportId?: string
): DailySessionBriefingData {
  const { reports, isLoading, error } = useProjectReports(
    organizationId,
    projectId,
    {
      types: DAILY_SESSION_REPORT_TYPES,
      limit: MAX_AVAILABLE_BRIEFINGS,
      sortBy: ReportSortBy.CreatedAt,
      sortOrder: ReportSortOrder.Desc,
      enabled: !!organizationId && !!projectId,
      refetchOnStale: true,
    }
  );

  return useMemo<DailySessionBriefingData>(() => {
    const availableBriefings: DailySessionBriefingOption[] = reports.map(
      (report) => ({
        createdAt: report.createdAt,
        reportId: report.id,
      })
    );

    if (reports.length === 0) {
      return {
        dailySessionReport: null,
        reportId: undefined,
        isLoading,
        availableBriefings,
        error,
      };
    }

    const selected =
      (selectedReportId
        ? reports.find((report) => report.id === selectedReportId)
        : undefined) ?? reports[0];

    return {
      dailySessionReport: selected,
      reportId: selected.id,
      isLoading,
      availableBriefings,
      error,
    };
  }, [error, isLoading, reports, selectedReportId]);
}
