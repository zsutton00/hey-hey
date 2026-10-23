import type { ReportDto } from "@hey-hey/ui-common/api";
import {
  Alert,
  Box,
  Button,
  Collapse,
  Snackbar,
  Stack,
  Typography,
} from "@mui/material";
import React, { useEffect, useMemo, useState } from "react";
import { ReportSummaryCard } from "@hey-hey/ui-common/components";

export interface NotificationToastProps {
  notificationId: string;
  onClose: () => void;
  onDismiss?: (notificationId: string) => void;
  onNavigateReport?: (reportId: string) => void;
  onNavigateTask?: (taskId: string) => void;
  report: ReportDto | null;
  reportId: string;
  taskId: string | null;
  title: string;
  topNextStep: string | null;
  verificationHint: string | null;
}

export const NotificationToast: React.FC<NotificationToastProps> = ({
  notificationId,
  onClose,
  onDismiss,
  onNavigateReport,
  onNavigateTask,
  report,
  reportId,
  taskId,
  title,
  topNextStep,
  verificationHint,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    setIsExpanded(false);
  }, [notificationId]);

  const compactSummary = useMemo(() => {
    const details: string[] = [];

    if (topNextStep) {
      details.push(`Next: ${topNextStep}`);
    }

    if (verificationHint) {
      details.push(`Verify: ${verificationHint}`);
    }

    if (details.length === 0) {
      return "A new report is available.";
    }

    return details.join(" | ");
  }, [topNextStep, verificationHint]);

  return (
    <Snackbar
      anchorOrigin={{
        horizontal: "right",
        vertical: "bottom",
      }}
      autoHideDuration={10000}
      onClose={(_, reason) => {
        if (reason === "clickaway") {
          return;
        }

        onClose();
      }}
      open
    >
      <Alert
        action={
          <Stack direction="row" spacing={1}>
            <Button
              color="inherit"
              onClick={() => setIsExpanded((expanded) => !expanded)}
              size="small"
            >
              {isExpanded ? "Collapse" : "Expand"}
            </Button>
            <Button
              color="inherit"
              onClick={() => {
                onDismiss?.(notificationId);
              }}
              size="small"
            >
              Dismiss
            </Button>
          </Stack>
        }
        data-testid="notification-toast"
        onClose={onClose}
        severity="info"
        sx={{
          alignItems: "flex-start",
          width: 560,
          maxWidth: "calc(100vw - 24px)",
        }}
        variant="filled"
      >
        <Stack spacing={1.25}>
          <Box>
            <Typography fontWeight={600} variant="body2">
              {title}
            </Typography>
            <Typography variant="caption">{compactSummary}</Typography>
          </Box>

          <Stack direction="row" spacing={1}>
            <Button
              color="inherit"
              onClick={() => {
                onNavigateReport?.(reportId);
              }}
              size="small"
              variant="outlined"
            >
              Open report
            </Button>
            {taskId ? (
              <Button
                color="inherit"
                onClick={() => {
                  onNavigateTask?.(taskId);
                }}
                size="small"
                variant="outlined"
              >
                Open task
              </Button>
            ) : null}
          </Stack>

          <Collapse in={isExpanded} timeout="auto" unmountOnExit>
            {report ? (
              <ReportSummaryCard report={report} />
            ) : (
              <Typography variant="caption">
                Report details are loading.
              </Typography>
            )}
          </Collapse>
        </Stack>
      </Alert>
    </Snackbar>
  );
};
