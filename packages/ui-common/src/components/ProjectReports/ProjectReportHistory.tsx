import {
  Alert,
  Button,
  CircularProgress,
  List,
  ListItem,
  Link as MuiLink,
  Stack,
  Typography,
} from "@mui/material";
import { ProjectReportStatus } from "../../api";
import { useProjectReportHistory } from "../../data/hooks/useProjectReportHistory";
import { useRetryProjectReportRequest } from "../../data/hooks/useCreateProjectReportRequest";
import { useReport } from "../../data/hooks/useReport";
import { WebPathService } from "../../services/webPathService";
import { Link as RouterLink } from "react-router-dom";

const PAGE_SIZE = 20;

export interface ProjectReportHistoryProps {
  organizationId: string;
  projectId: string;
  offset: number;
  onOffsetChange: (offset: number) => void;
  onCreate: () => void;
}

function ReportHistoryTitleLink({
  organizationId,
  projectId,
  reportId,
}: {
  organizationId: string;
  projectId: string;
  reportId: string;
}) {
  const report = useReport(organizationId, reportId);
  return (
    <MuiLink
      component={RouterLink}
      to={WebPathService.report({ projectId, reportId })}
      data-testid="project-report-history-report-link"
      data-report-id={reportId}
    >
      {report.isLoading
        ? "Loading report name…"
        : (report.data?.title ?? "Report name unavailable")}
    </MuiLink>
  );
}

export function ProjectReportHistory({
  organizationId,
  projectId,
  offset,
  onOffsetChange,
  onCreate,
}: ProjectReportHistoryProps) {
  const history = useProjectReportHistory(
    organizationId,
    projectId,
    offset,
    PAGE_SIZE,
  );
  const retryMutation = useRetryProjectReportRequest();
  const entries = history.page?.entries ?? [];
  const handleRetry = async (requestId: string, expectedAttemptId: string) => {
    try {
      await retryMutation.mutate({
        organizationId,
        projectId,
        requestId,
        retry: { expectedAttemptId, idempotencyKey: crypto.randomUUID() },
      });
      await history.refetch();
    } catch {
      // Mutation state renders the failure beside the relevant action.
    }
  };

  return (
    <Stack spacing={2} data-testid="project-report-history-page">
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography variant="h4">Reports</Typography>
        <Button
          variant="contained"
          data-testid="project-report-history-create"
          onClick={onCreate}
        >
          Create report
        </Button>
      </Stack>
      {history.error ? (
        <Alert
          severity="error"
          action={<Button onClick={() => void history.refetch()}>Retry</Button>}
        >
          Could not load report history.
        </Alert>
      ) : !history.isFetched || history.isLoading ? (
        <CircularProgress size={24} aria-label="Loading report history" />
      ) : entries.length === 0 ? (
        <Stack spacing={1}>
          <Typography>No reports yet.</Typography>
          <Button onClick={onCreate}>Create report</Button>
        </Stack>
      ) : (
        <List>
          {entries.map((entry) => {
            if (entry.type === "SAVED_REPORT") {
              return (
                <ListItem key={`report:${entry.reportId}`}>
                  <Stack>
                    <ReportHistoryTitleLink
                      organizationId={organizationId}
                      projectId={projectId}
                      reportId={entry.reportId}
                    />
                    <Typography variant="caption">
                      {new Date(entry.createdAt).toLocaleString()}
                    </Typography>
                  </Stack>
                </ListItem>
              );
            }
            const reportId = entry.latestAttempt.reportId;
            return (
              <ListItem
                key={`request:${entry.requestId}`}
                alignItems="flex-start"
              >
                <Stack
                  spacing={0.5}
                  sx={{ width: "100%" }}
                  data-testid="project-report-history-request"
                  data-request-id={entry.requestId}
                >
                  <Typography>{entry.submission.question}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {entry.status.toLowerCase()} ·{" "}
                    {new Date(entry.createdAt).toLocaleString()}
                  </Typography>
                  {entry.status === ProjectReportStatus.Failed ? (
                    <>
                      <Alert severity="error">
                        {entry.latestAttempt.failure?.message ??
                          "Report generation failed."}
                      </Alert>
                      {entry.latestAttempt.failure?.retryable && (
                        <Button
                          disabled={retryMutation.isPending}
                          onClick={() =>
                            void handleRetry(
                              entry.requestId,
                              entry.latestAttempt.id,
                            )
                          }
                        >
                          Retry report
                        </Button>
                      )}
                      {retryMutation.isError && (
                        <Alert severity="error">
                          Could not retry report. Try again.
                        </Alert>
                      )}
                    </>
                  ) : null}
                  {entry.status === ProjectReportStatus.Completed &&
                  reportId ? (
                    <ReportHistoryTitleLink
                      organizationId={organizationId}
                      projectId={projectId}
                      reportId={reportId}
                    />
                  ) : null}
                </Stack>
              </ListItem>
            );
          })}
        </List>
      )}
      <Stack direction="row" justifyContent="space-between">
        <Button
          disabled={offset === 0 || history.isFetching}
          onClick={() => onOffsetChange(Math.max(0, offset - PAGE_SIZE))}
        >
          Newer
        </Button>
        <Typography variant="caption">
          {history.page
            ? `${Math.min(offset + 1, history.page.total)}–${Math.min(offset + entries.length, history.page.total)} of ${history.page.total}`
            : ""}
        </Typography>
        <Button
          disabled={!history.page?.nextOffset || history.isFetching}
          onClick={() => onOffsetChange(history.page?.nextOffset ?? offset)}
        >
          Older
        </Button>
      </Stack>
    </Stack>
  );
}
