import { useReport } from "@hey-hey/ui-common/data";
import { useUserIdentity } from "@hey-hey/ui-common/hooks";
import { ReportViewer } from "@hey-hey/ui-common/components";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Stack,
  Typography,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import React from "react";
import { useNavigate, useParams } from "react-router-dom";

export const InternalReportDetailPage: React.FC = () => {
  const navigate = useNavigate();
  const { reportId } = useParams<{ reportId: string }>();
  const userIdentity = useUserIdentity();

  const {
    data: report,
    error,
    isLoading,
  } = useReport(userIdentity?.currentOrgId, reportId, {
    enabled: !!userIdentity?.currentOrgId && !!reportId,
  });

  if (!reportId) {
    return <Alert severity="error">Report ID is required</Alert>;
  }

  return (
    <Box sx={{ p: 3 }}>
      <Stack spacing={3}>
        <Stack alignItems="center" direction="row" spacing={2}>
          <Button
            component="a"
            href="/debug/internal-reports"
            onClick={(e: React.MouseEvent<HTMLAnchorElement>) => {
              if (!e.ctrlKey && !e.metaKey && !e.shiftKey) {
                e.preventDefault();
                navigate("/debug/internal-reports");
              }
            }}
            startIcon={<ArrowBackIcon />}
            variant="text"
          >
            Internal Reports
          </Button>
        </Stack>

        <Typography variant="h4">Report {reportId}</Typography>

        {isLoading ? (
          <Box
            sx={{
              display: "flex",
              justifyContent: "center",
              py: 3,
            }}
          >
            <CircularProgress size={24} />
          </Box>
        ) : null}

        {error ? (
          <Alert severity="error">{error.message}</Alert>
        ) : null}

        {report ? <ReportViewer report={report} /> : null}
      </Stack>
    </Box>
  );
};
