import { useMemo } from "react";
import { ReportType, type ReportDto } from "../../api";
import { useReports } from "../../data/hooks/useReports";

const RENDERABLE_REPORT_TYPES = new Set<string>([
  ReportType.GoalProgress,
  ReportType.RiskAlert,
  ReportType.SessionSummary,
]);

export interface UseDailySessionReportsReturn {
  reports: ReportDto[];
  isLoading: boolean;
  error: Error | null;
}

export function useDailySessionReports(
  organizationId: string | undefined,
  projectId: string | undefined,
  parentReportId: string | undefined
): UseDailySessionReportsReturn {
  const {
    reports: allReports,
    isLoading,
    error,
  } = useReports(organizationId, {
    projectId,
    parentReportId,
    enabled: !!organizationId && !!parentReportId,
    sortBy: "createdAt",
    sortDirection: "asc",
  });

  const reports = useMemo(
    () =>
      allReports.filter((r) => {
        if (!RENDERABLE_REPORT_TYPES.has(r.reportType)) return false;
        const payload = r.payload as { text?: string };
        return !!payload.text?.trim();
      }),
    [allReports]
  );

  return { reports, isLoading, error };
}
