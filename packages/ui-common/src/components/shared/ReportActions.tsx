import {
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import React, { useState } from "react";
import type { ReportDto } from "../../api";
import { ReportViewer } from "../Reports";

export interface ReportActionsProps {
  reports: ReportDto[];
  topMargin: number;
}

export interface ReportDialogProps {
  report: ReportDto | null;
  onClose: () => void;
}

export const ReportDialog: React.FC<ReportDialogProps> = ({
  report,
  onClose,
}) => (
  <Dialog
    data-testid="report-actions-dialog"
    fullWidth
    maxWidth="md"
    onClose={onClose}
    open={report !== null}
  >
    {report ? (
      <>
        <DialogTitle
          sx={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          {report.title}
          <IconButton aria-label="Close" onClick={onClose} size="small">
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>
          <ReportViewer report={report} />
        </DialogContent>
      </>
    ) : null}
  </Dialog>
);

export const ReportActions: React.FC<ReportActionsProps> = ({
  reports,
  topMargin,
}) => {
  const [selectedReport, setSelectedReport] = useState<ReportDto | null>(null);

  if (reports.length === 0) {
    return null;
  }

  return (
    <>
      <Stack
        direction="row"
        spacing={1}
        sx={{ flexWrap: "wrap", rowGap: 1, mt: topMargin }}
      >
        {reports.map((report) => (
          <Button
            data-report-id={report.id}
            data-testid="report-action"
            key={report.id}
            onClick={() => setSelectedReport(report)}
            size="small"
            variant="outlined"
          >
            View {report.title} report
          </Button>
        ))}
      </Stack>

      <ReportDialog
        onClose={() => setSelectedReport(null)}
        report={selectedReport}
      />
    </>
  );
};
