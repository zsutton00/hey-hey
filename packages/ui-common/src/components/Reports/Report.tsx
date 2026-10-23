import { CircularProgress, Paper, Stack, Typography } from "@mui/material";
import React from "react";
import type { ReportDto } from "../../api";
import { ReportViewer } from "./ReportViewer";
import { useReport } from "../../data/hooks/useReport";

type ReportByValueProps = {
  report: ReportDto;
  organizationId?: never;
  reportId?: never;
};

type ReportByIdProps = {
  organizationId: string;
  reportId: string;
  report?: never;
};

export type ReportProps = (ReportByValueProps | ReportByIdProps) & {
  loading?: boolean;
  emptyMessage?: string;
  /** Show the report as saved eval attempt output. */
  evaluationOutput?: boolean;
};

const isReportByValueProps = (
  props: ReportByValueProps | ReportByIdProps,
): props is ReportByValueProps => {
  return "report" in props;
};

export const Report: React.FC<ReportProps> = (props) => {
  const isStaticReport = isReportByValueProps(props);
  const query = useReport(
    isStaticReport ? undefined : props.organizationId,
    isStaticReport ? undefined : props.reportId,
    { enabled: !isStaticReport },
  );

  const report = isStaticReport ? props.report : query.data;
  const isLoading =
    (props.loading ?? false) || (!isStaticReport && query.isLoading);
  const emptyMessage = props.emptyMessage ?? "Report not found";

  if (isLoading) {
    return (
      <Paper
        data-testid="report-view-loading"
        sx={{ p: 3, display: "flex", justifyContent: "center" }}
      >
        <CircularProgress size={24} />
      </Paper>
    );
  }

  if (!report) {
    return (
      <Paper data-testid="report-view-empty" sx={{ p: 3 }}>
        <Typography color="text.secondary" variant="body2">
          {emptyMessage}
        </Typography>
      </Paper>
    );
  }

  return (
    <Stack data-testid="report-view" spacing={2}>
      <ReportViewer
        report={report}
        testIdPrefix="report-viewer"
        evaluationOutput={props.evaluationOutput}
      />
    </Stack>
  );
};
