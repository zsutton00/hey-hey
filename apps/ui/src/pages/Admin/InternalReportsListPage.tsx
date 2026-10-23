import { ReportAudience } from "@hey-hey/ui-common/api";
import { ReportsList } from "@hey-hey/ui-common/components";
import { useUserIdentity } from "@hey-hey/ui-common/hooks";
import { Alert, Box, Typography } from "@mui/material";
import React from "react";
import { useNavigate } from "react-router-dom";
import type { ReportDto } from "@hey-hey/ui-common/api";

export const InternalReportsListPage: React.FC = () => {
  const navigate = useNavigate();
  const { currentOrgId } = useUserIdentity() || {};

  const handleReportClick = (report: ReportDto): void => {
    navigate(`/debug/internal-reports/${report.id}`);
  };

  if (!currentOrgId) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="warning">
          Please select an organization to view internal reports.
        </Alert>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h4" sx={{ mb: 3 }}>
        Internal Reports
      </Typography>

      <ReportsList
        audience={ReportAudience.WorkflowOnly}
        organizationId={currentOrgId}
        emptyMessage="No internal reports found"
        onReportClick={handleReportClick}
      />
    </Box>
  );
};
