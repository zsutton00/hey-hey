import { Typography } from "@mui/material";
import React from "react";
import type { ReportDto } from "../../../api";

export interface StandardReportContentProps {
  report: ReportDto;
  reportTestId: string;
}

export const StandardReportContent: React.FC<StandardReportContentProps> = ({
  report,
  reportTestId,
}) => {
  return (
    <Typography
      color="text.secondary"
      data-testid={`${reportTestId}-empty`}
      variant="body2"
    >
      No renderer available for report type {report.reportType}.
    </Typography>
  );
};
