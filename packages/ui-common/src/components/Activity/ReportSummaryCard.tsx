import { Chip, Paper, Stack, Typography } from "@mui/material";
import React from "react";
import type { ReportDto } from "../../api";
import { formatActivityTimestamp } from "./activityFormatting";

export interface ReportSummaryCardProps {
  report: ReportDto;
}

export const ReportSummaryCard: React.FC<ReportSummaryCardProps> = ({
  report,
}) => {
  return (
    <Paper
      data-testid={`activity-report-summary-${report.id}`}
      sx={{ p: 1.5 }}
      variant="outlined"
    >
      <Stack spacing={1.25}>
        <Stack
          alignItems={{ xs: "flex-start", sm: "center" }}
          direction={{ xs: "column", sm: "row" }}
          justifyContent="space-between"
          spacing={1}
        >
          <Typography
            data-testid={`activity-report-summary-title-${report.id}`}
            variant="subtitle1"
          >
            {report.title}
          </Typography>
          <Stack direction="row" spacing={0.75}>
            <Chip label={report.reportType} size="small" />
            <Chip
              label={`v${report.schemaVersion}`}
              size="small"
              variant="outlined"
            />
          </Stack>
        </Stack>

        <Typography
          color="text.secondary"
          data-testid={`activity-report-summary-created-at-${report.id}`}
          variant="caption"
        >
          Created {formatActivityTimestamp(report.createdAt)}
        </Typography>
      </Stack>
    </Paper>
  );
};
