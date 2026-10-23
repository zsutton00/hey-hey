import { useProject, useReport } from "@hey-hey/ui-common/data";
import { useUserIdentity } from "@hey-hey/ui-common/hooks";
import { Alert, Box, CircularProgress, Stack, Typography } from "@mui/material";
import React, { useMemo } from "react";
import { ReportViewer, narrowProjectReportPayload } from "@hey-hey/ui-common/components";
import { useNavigate, useParams } from "react-router-dom";
import { ReportType } from "@hey-hey/ui-common/api";
import { useOrganization } from "@hey-hey/ui-common/context";
import { NotificationAlertList } from "../../components/Notifications";
import {
  DetailPageContainer,
  DetailPageHeader,
  PageBreadcrumbs,
} from "../../components/Layout";
import { useProjectNotificationActivity } from "../../hooks/useProjectNotificationActivity";

export const ProjectReportPage: React.FC = () => {
  const navigate = useNavigate();
  const { projectId, reportId } = useParams<{
    projectId: string;
    reportId: string;
  }>();
  const userIdentity = useUserIdentity();
  const { currentOrganization } = useOrganization();
  const organizationId = currentOrganization?.id;
  const projectQuery = useProject(organizationId, projectId, { enabled: !!organizationId && !!projectId });

  const {
    data: report,
    error: reportError,
    isLoading: isReportLoading,
  } = useReport(organizationId, reportId, {
    enabled: !!organizationId && !!reportId,
  });

  const {
    alertItems,
    dismissNotification,
    error: activityError,
    isLoading: isActivityLoading,
    pagination,
  } = useProjectNotificationActivity({
    activityLimit: 50,
    organizationId: organizationId || "",
    projectId,
    userId: userIdentity?.userId,
    view: "full",
  });

  const relatedAlertItems = useMemo(
    () =>
      alertItems.filter((item) =>
        item.activity.reports.some((activityReport) => activityReport.id === reportId),
      ),
    [alertItems, reportId],
  );

  if (!projectId || !reportId) {
    return <Alert severity="error">Project ID and report ID are required</Alert>;
  }

  if (!organizationId) return <Alert severity="error">A current organization is required.</Alert>;
  if (projectQuery.isLoading || !projectQuery.isFetched) return <CircularProgress aria-label="Loading project" />;
  if (projectQuery.error || !projectQuery.data || projectQuery.data.id !== projectId || projectQuery.data.organizationId !== organizationId) return <Alert severity="error">This project is unavailable in the current organization.</Alert>;
  if (report && (report.projectId !== projectId || report.organizationId !== organizationId)) return <Alert severity="error">This report is unavailable in the current project.</Alert>;
  const payload = report?.reportType === ReportType.ProjectReport ? narrowProjectReportPayload(report) : null;
  if (payload && payload.scope.projectId !== projectId) return <Alert severity="error">This report is unavailable in the current project.</Alert>;
  const title = payload?.title || report?.title;

  return (
    <>
      <PageBreadcrumbs
        sx={{ mb: 2 }}
        items={[
          { label: "Projects", to: "/projects" },
          { label: projectQuery.data.name ?? "Project", to: `/projects/${projectId}`, type: "project" },
          { label: "Activity", to: `/projects/${projectId}/activity` },
          {
            label: "Report",
            to: `/projects/${projectId}/reports/${reportId}`,
            isCurrent: true,
          },
        ]}
      />

      <DetailPageContainer>
        <DetailPageHeader
          title={title || "Report"}
          subtitle={report ? `Created ${new Date(report.createdAt).toLocaleString()}` : undefined}
        />

        <Stack spacing={2} sx={{ px: 3, pb: 3 }}>
          {isReportLoading ? (
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

          {reportError ? <Alert severity="error">{reportError.message}</Alert> : null}

          {report ? <ReportViewer report={report} renderHeader={false} renderTitle={false} /> : null}
          {!isReportLoading && !reportError && !report ? <Alert severity="info">Report not found.</Alert> : null}

          <Stack spacing={1}>
            <Typography variant="h6">Related Activity</Typography>

            {activityError ? <Alert severity="error">{activityError.message}</Alert> : null}

            {isActivityLoading ? (
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

            {!isActivityLoading && !activityError ? (
              <NotificationAlertList
                emptyMessage="No related activity found"
                items={relatedAlertItems}
                onDismiss={(notificationId) => {
                  void dismissNotification(notificationId);
                }}
                onNavigateFullActivity={() => {
                  navigate(`/projects/${projectId}/activity`);
                }}
                pagination={pagination}
              />
            ) : null}
          </Stack>
        </Stack>
      </DetailPageContainer>
    </>
  );
};
