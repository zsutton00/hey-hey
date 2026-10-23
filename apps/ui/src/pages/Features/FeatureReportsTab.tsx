import { Box, Button, CircularProgress, Stack, Typography } from "@mui/material";
import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ReportType } from "@hey-hey/ui-common/api";
import { ReportCard } from "@hey-hey/ui-common/components";
import { useProjectReports } from "@hey-hey/ui-common/data";

const PAGE_SIZE = 20;
const FEATURE_REPORT_TYPES: ReportType[] = [
  ReportType.FeatureTreeAnalysis,
  ReportType.CompetitiveAnalysis,
];

export interface FeatureReportsTabProps {
  organizationId: string;
  projectId: string;
}

export const FeatureReportsTab: React.FC<FeatureReportsTabProps> = ({
  organizationId,
  projectId,
}) => {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);

  const limit = page * PAGE_SIZE;

  const { reports, isLoading, isFetching, isReady } = useProjectReports(
    organizationId,
    projectId,
    {
      types: FEATURE_REPORT_TYPES,
      limit,
      sortBy: "createdAt",
      sortOrder: "DESC",
    },
  );

  const visibleReports = useMemo(() => reports.slice(0, limit), [reports, limit]);

  const canLoadMore = reports.length >= limit;

  if (isLoading) {
    return (
      <Box
        sx={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          py: 6,
        }}
        data-testid="feature-reports-loading"
      >
        <CircularProgress size={32} />
      </Box>
    );
  }

  if (isReady && reports.length === 0) {
    return (
      <Box
        sx={{ py: 6, textAlign: "center" }}
        data-testid="feature-reports-empty"
      >
        <Typography variant="body1" color="text.secondary">
          {t(
            "features.reports.empty",
            "No feature tree analyses or competitive comparisons yet — kick off a Feature Tree Conversation to generate one.",
          )}
        </Typography>
      </Box>
    );
  }

  return (
    <Stack spacing={2} data-testid="feature-reports-list">
      {visibleReports.map((report) => (
        <ReportCard
          key={report.id}
          report={report}
          organizationId={organizationId}
          projectId={projectId}
        />
      ))}
      {canLoadMore && (
        <Box sx={{ display: "flex", justifyContent: "center", pt: 1 }}>
          <Button
            variant="outlined"
            onClick={() => setPage((prev) => prev + 1)}
            disabled={isFetching}
            data-testid="feature-reports-load-more"
          >
            {isFetching
              ? t("common.loading", "Loading…")
              : t("features.reports.loadMore", "Load more")}
          </Button>
        </Box>
      )}
    </Stack>
  );
};
