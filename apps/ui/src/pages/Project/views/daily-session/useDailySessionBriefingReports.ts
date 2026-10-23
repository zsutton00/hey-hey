import {
  useReports,
  useWebsocketSubscriptions,
  type UseReportsReturn,
} from "@hey-hey/ui-common/data";
import {
  ReportType,
  type NotificationDto,
  type ReportDto,
} from "@hey-hey/ui-common/api";
import { useCallback, useEffect, useMemo, useState } from "react";

const MAX_AVAILABLE_BRIEFINGS = 10;

const RENDERABLE_REPORT_TYPES = new Set<ReportType>([
  ReportType.GoalProgress,
  ReportType.RiskAlert,
  ReportType.SessionSummary,
]);

type SelectionState =
  | { mode: "implicit" }
  | { mode: "explicit"; reportId: string; report: ReportDto | null };

interface DailySessionBriefingOption {
  createdAt: string;
  reportId: string;
}

export interface UseDailySessionBriefingReportsReturn {
  availableBriefings: DailySessionBriefingOption[];
  error: Error | null;
  isFetching: boolean;
  isLoading: boolean;
  isSelectionExplicit: boolean;
  refresh: () => void;
  reports: ReportDto[];
  selectedParentReport: ReportDto | null;
  selectedParentReportId: string | null;
  selectParentReport: (reportId: string) => void;
}

const getRenderableReports = (reports: ReportDto[]): ReportDto[] =>
  reports.filter((report) => {
    if (!RENDERABLE_REPORT_TYPES.has(report.reportType)) {
      return false;
    }

    const payload = report.payload as { text?: string };
    return Boolean(payload.text?.trim());
  });

const getReportById = (
  reports: ReportDto[],
  reportId: string | null | undefined,
): ReportDto | null => {
  if (!reportId) {
    return null;
  }

  return reports.find((report) => report.id === reportId) ?? null;
};

const isRelevantNotification = (notification: NotificationDto): boolean => {
  if (notification.eventType === "session_report_ready") {
    return notification.payload.reportType === ReportType.DailySession;
  }

  return notification.eventType === "report.created";
};

const callStaleAndRefetch = (
  query: Pick<UseReportsReturn, "markStale" | "refetch">,
): void => {
  query.markStale();
  void query.refetch();
};

export const useDailySessionBriefingReports = (
  organizationId: string | undefined,
  projectId: string | undefined,
): UseDailySessionBriefingReportsReturn => {
  const [selection, setSelection] = useState<SelectionState>({
    mode: "implicit",
  });

  const parentReportsQuery = useReports(organizationId, {
    projectId,
    reportType: ReportType.DailySession,
    limit: MAX_AVAILABLE_BRIEFINGS,
    sortBy: "createdAt",
    sortDirection: "desc",
    enabled: Boolean(organizationId && projectId),
    refetchOnStale: true,
    refetchOnWindowFocus: true,
  });

  const parentReports = parentReportsQuery.reports;
  const latestParentReport = parentReports[0] ?? null;

  const explicitParentReport =
    selection.mode === "explicit"
      ? (getReportById(parentReports, selection.reportId) ?? selection.report)
      : null;

  const selectedParentReport =
    selection.mode === "explicit" ? explicitParentReport : latestParentReport;

  const selectedParentReportId =
    selectedParentReport?.id ??
    (selection.mode === "explicit" ? selection.reportId : null);

  const childReportsQuery = useReports(organizationId, {
    projectId,
    parentReportId: selectedParentReportId ?? undefined,
    enabled: Boolean(organizationId && projectId && selectedParentReportId),
    sortBy: "createdAt",
    sortDirection: "asc",
    refetchOnStale: true,
    refetchOnWindowFocus: true,
  });

  const refresh = useCallback((): void => {
    callStaleAndRefetch(parentReportsQuery);

    if (selectedParentReportId) {
      callStaleAndRefetch(childReportsQuery);
    }
  }, [childReportsQuery, parentReportsQuery, selectedParentReportId]);

  const selectParentReport = useCallback(
    (reportId: string): void => {
      if (!reportId || reportId === latestParentReport?.id) {
        setSelection({ mode: "implicit" });
        return;
      }

      setSelection({
        mode: "explicit",
        reportId,
        report: getReportById(parentReports, reportId),
      });
    },
    [latestParentReport?.id, parentReports],
  );

  useWebsocketSubscriptions(
    {
      projectIds: projectId ? [projectId] : [],
      events: {
        onSystemNotification: (event) => {
          if (event.organizationId !== organizationId) {
            return;
          }

          if (event.projectId && event.projectId !== projectId) {
            return;
          }

          if (isRelevantNotification(event.notification)) {
            refresh();
          }
        },
      },
    },
    { enabled: Boolean(organizationId && projectId) },
  );

  useEffect(() => {
    const handleVisible = (): void => {
      if (document.visibilityState === "visible") {
        refresh();
      }
    };

    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", handleVisible);

    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", handleVisible);
    };
  }, [refresh]);

  const availableBriefings = useMemo<DailySessionBriefingOption[]>(() => {
    const options = parentReports.map((report) => ({
      createdAt: report.createdAt,
      reportId: report.id,
    }));

    if (
      selection.mode === "explicit" &&
      selectedParentReport &&
      !options.some((option) => option.reportId === selectedParentReport.id)
    ) {
      options.push({
        createdAt: selectedParentReport.createdAt,
        reportId: selectedParentReport.id,
      });
    }

    return options;
  }, [parentReports, selectedParentReport, selection.mode]);

  const reports = useMemo(
    () => getRenderableReports(childReportsQuery.reports),
    [childReportsQuery.reports],
  );

  return {
    availableBriefings,
    error: parentReportsQuery.error ?? childReportsQuery.error,
    isFetching: parentReportsQuery.isFetching || childReportsQuery.isFetching,
    isLoading:
      parentReportsQuery.isLoading ||
      (Boolean(selectedParentReportId) && childReportsQuery.isLoading),
    isSelectionExplicit: selection.mode === "explicit",
    refresh,
    reports,
    selectedParentReport,
    selectedParentReportId,
    selectParentReport,
  };
};
