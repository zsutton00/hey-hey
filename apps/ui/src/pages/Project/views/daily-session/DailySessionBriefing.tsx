import { ProjectHelpProvider } from "../../help/ProjectHelpProvider";
import {
  Box,
  FormControl,
  MenuItem,
  Select,
  Stack,
  Typography,
  useTheme,
  type SelectChangeEvent,
} from "@mui/material";
import {
  IntroHelpView,
  LoadingPanel,
  ReportCard,
} from "@hey-hey/ui-common/components";
import { ProjectStatus, ReportType } from "@hey-hey/ui-common/api";
import { useProject } from "@hey-hey/ui-common/data";
import { format, isToday, isYesterday } from "date-fns";
import React, { useCallback, useLayoutEffect, useRef } from "react";
import { useDailySessionBriefingReports } from "./useDailySessionBriefingReports";
import { isSelectedExistingWorkProject } from "../../help/projectSetupRoute";

export interface DailySessionBriefingProps {
  organizationId: string;
  projectId: string;
}

const NODE_INSTALLER_URL = "https://nodejs.org/";
const AGENT_BRIDGE_DOWNLOAD_LABEL = "Download Agent Bridge";

const formatBriefingLabel = (iso: string): string => {
  const date = new Date(iso);

  if (isNaN(date.getTime())) {
    return "";
  }

  if (isToday(date)) {
    return `Today, ${format(date, "h:mm a")}`;
  }

  if (isYesterday(date)) {
    return `Yesterday, ${format(date, "h:mm a")}`;
  }

  return format(date, "MMM d, h:mm a");
};

export const DailySessionBriefing: React.FC<DailySessionBriefingProps> = ({
  organizationId,
  projectId,
}) => {
  const theme = useTheme();
  const introContainerRef = useRef<HTMLDivElement>(null);
  const project = useProject(organizationId, projectId);
  const {
    availableBriefings,
    isLoading,
    reports,
    selectedParentReport,
    selectedParentReportId,
    selectParentReport,
  } = useDailySessionBriefingReports(organizationId, projectId);

  const handleBriefingChange = useCallback(
    (event: SelectChangeEvent<string>): void => {
      selectParentReport(event.target.value);
    },
    [selectParentReport],
  );

  const handleIntroLinkClickCapture = useCallback(
    (event: React.MouseEvent<HTMLDivElement>): void => {
      const anchor = (event.target as HTMLElement).closest("a");

      if (anchor?.href === NODE_INSTALLER_URL) {
        anchor.target = "_blank";
        anchor.rel = "noopener noreferrer";
      }
    },
    [],
  );

  useLayoutEffect(() => {
    const downloadButton = Array.from(
      introContainerRef.current?.querySelectorAll("button") ?? [],
    ).find(
      (button) => button.textContent?.trim() === AGENT_BRIDGE_DOWNLOAD_LABEL,
    );

    downloadButton?.remove();
  });

  if (!project.isFetched || isLoading) {
    return <LoadingPanel label="Loading briefing…" />;
  }

  const goalProgressReports = reports.filter(
    (report) => report.reportType === ReportType.GoalProgress,
  );
  const summaryReports = reports.filter(
    (report) => report.reportType === ReportType.SessionSummary,
  );
  const otherReports = reports.filter(
    (report) =>
      report.reportType !== ReportType.GoalProgress &&
      report.reportType !== ReportType.SessionSummary,
  );

  if (!selectedParentReport) {
    if (project.data?.status === ProjectStatus.Active) {
      return (
        <Box
          ref={introContainerRef}
          onClickCapture={handleIntroLinkClickCapture}
        >
          <ProjectHelpProvider
            organizationId={organizationId}
            projectId={projectId}
          >
            <IntroHelpView
              variant={
                isSelectedExistingWorkProject(project.data)
                  ? "existing-work"
                  : "generic"
              }
            />
          </ProjectHelpProvider>
        </Box>
      );
    }

    return (
      <Box
        sx={{ py: 4, textAlign: "center" }}
        data-testid="daily-session-warming"
      >
        <Typography variant="body2" color="text.secondary">
          Daily session is warming up — check back shortly.
        </Typography>
      </Box>
    );
  }

  return (
    <Box data-testid="daily-session-briefing">
      <Box
        sx={{
          display: "flex",
          justifyContent: "flex-end",
          alignItems: "flex-start",
          mb: 2,
        }}
      >
        {availableBriefings.length > 0 && selectedParentReportId ? (
          <FormControl size="small" variant="standard">
            <Select
              value={selectedParentReportId}
              onChange={handleBriefingChange}
              disableUnderline
              inputProps={{ "aria-label": "Select briefing date" }}
              sx={{
                fontSize: theme.typography.caption.fontSize,
                color: theme.palette.text.secondary,
                "& .MuiSelect-select": { py: 0 },
              }}
            >
              {availableBriefings.map((option) => (
                <MenuItem key={option.reportId} value={option.reportId}>
                  {formatBriefingLabel(option.createdAt)}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        ) : null}
      </Box>

      {reports.length === 0 ? (
        <Box
          sx={{ py: 4, textAlign: "center" }}
          data-testid="daily-session-no-reports"
        >
          <Typography variant="body2" color="text.secondary">
            This briefing does not have report cards yet.
          </Typography>
        </Box>
      ) : (
        <Stack spacing={2.5} data-testid="daily-session-report-list">
          {summaryReports.length > 0 && (
            <Stack spacing={3}>
              {summaryReports.map((report) => (
                <ReportCard
                  key={report.id}
                  report={report}
                  organizationId={organizationId}
                  projectId={projectId}
                  mentionMode="minimal"
                />
              ))}
            </Stack>
          )}

          {goalProgressReports.length > 0 && (
            <Box
              data-testid="goal-progress-report-set"
              sx={{
                display: "grid",
                gridTemplateColumns: {
                  xs: "1fr",
                  md: "repeat(2, minmax(0, 1fr))",
                  xl: "repeat(auto-fill, minmax(420px, 1fr))",
                },
                gap: 3,
              }}
            >
              {goalProgressReports.map((report) => (
                <ReportCard
                  key={report.id}
                  report={report}
                  organizationId={organizationId}
                  projectId={projectId}
                  mentionMode="minimal"
                />
              ))}
            </Box>
          )}

          {otherReports.length > 0 && (
            <Box
              data-testid="session-report-set"
              sx={{
                display: "grid",
                gridTemplateColumns: {
                  xs: "1fr",
                  md: "repeat(2, minmax(0, 1fr))",
                  xl: "repeat(auto-fill, minmax(420px, 1fr))",
                },
                gap: 3,
              }}
            >
              {otherReports.map((report) => (
                <ReportCard
                  key={report.id}
                  report={report}
                  organizationId={organizationId}
                  projectId={projectId}
                  mentionMode="minimal"
                />
              ))}
            </Box>
          )}
        </Stack>
      )}
    </Box>
  );
};
