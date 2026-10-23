import type { SxProps, Theme, SelectChangeEvent } from "@mui/material";
import {
  Box,
  FormControl,
  MenuItem,
  Select,
  Stack,
  Typography,
  useTheme,
} from "@mui/material";
import { format, isToday, isYesterday } from "date-fns";
import React, { useCallback, useState } from "react";

import { ProjectStatus, ReportType } from "../../api";
import { useProject } from "../../data/hooks/useProject";
import { useDailySessionBriefing } from "./useDailySessionBriefing";
import { useDailySessionReports } from "./useDailySessionReports";
import { ReportCard } from "./ReportCard";
import { LoadingPanel } from "../AgentSession/LoadingPanel";
import { IntroHelpView } from "../Help";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface DailySessionBriefingSlotProps {
  root?: SxProps<Theme>;
  scrollArea?: SxProps<Theme>;
}

export interface DailySessionBriefingProps {
  organizationId: string;
  projectId: string;
  slotProps?: DailySessionBriefingSlotProps;
}

// Main component
// ---------------------------------------------------------------------------

export const DailySessionBriefing: React.FC<DailySessionBriefingProps> = ({
  organizationId,
  projectId,
  slotProps,
}) => {
  const theme = useTheme();
  const [selectedBriefingId, setSelectedBriefingId] = useState<string | null>(
    null
  );

  // 1a. Fetch the project to determine which empty state to show.
  const project = useProject(organizationId, projectId);

  // Fetch durable parent DAILY_SESSION reports for the briefing selector.
  const {
    dailySessionReport,
    reportId,
    isLoading: isBriefingLoading,
    availableBriefings,
  } = useDailySessionBriefing(
    organizationId,
    projectId,
    selectedBriefingId ?? undefined
  );

  const handleBriefingChange = useCallback(
    (event: SelectChangeEvent<string>) => {
      setSelectedBriefingId(event.target.value || null);
    },
    []
  );

  const formatBriefingLabel = useCallback((iso: string): string => {
    const date = new Date(iso);
    if (isNaN(date.getTime())) return "";
    if (isToday(date)) return `Today, ${format(date, "h:mm a")}`;
    if (isYesterday(date)) return `Yesterday, ${format(date, "h:mm a")}`;
    return format(date, "MMM d, h:mm a");
  }, []);

  // 3b. Fetch child reports when a parent reportId is present.
  const { reports: sessionReports, isLoading: isReportsLoading } =
    useDailySessionReports(organizationId, projectId, reportId);

  const isLoading =
    !project.isFetched || isBriefingLoading || (!!reportId && isReportsLoading);

  if (isLoading) {
    return <LoadingPanel label="Loading briefing…" />;
  }

  const goalProgressReports = sessionReports.filter(
    (report) => report.payload.reportType === ReportType.GoalProgress
  );
  const summaryReports = sessionReports.filter(
    (report) => report.payload.reportType === ReportType.SessionSummary
  );
  const otherReports = sessionReports.filter(
    (report) =>
      report.payload.reportType !== ReportType.SessionSummary &&
      report.payload.reportType !== ReportType.GoalProgress
  );

  if (!dailySessionReport) {
    if (project.data?.status === ProjectStatus.Active) {
      return <IntroHelpView />;
    }
    return (
      <Box sx={{ py: 4, textAlign: "center" }}>
        <Typography variant="body2" color="text.secondary">
          Daily session is warming up — check back shortly.
        </Typography>
      </Box>
    );
  }

  return (
    <Box
      sx={[
        {},
        ...(Array.isArray(slotProps?.root)
          ? slotProps.root
          : slotProps?.root
          ? [slotProps.root]
          : []),
      ]}
    >
      <Box
        sx={{
          display: "flex",
          justifyContent: "flex-end",
          alignItems: "flex-start",
          mb: 2,
        }}
      >
        <Box
          sx={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            gap: 0.75,
          }}
        >
          {availableBriefings.length > 0 && (
            <FormControl size="small" variant="standard">
              <Select
                value={dailySessionReport.id}
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
          )}
        </Box>
      </Box>

      <Box
        sx={[
          { pb: 2 },
          ...(Array.isArray(slotProps?.scrollArea)
            ? slotProps.scrollArea
            : slotProps?.scrollArea
            ? [slotProps.scrollArea]
            : []),
        ]}
      >
        <Stack spacing={2.5}>
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
      </Box>
    </Box>
  );
};
