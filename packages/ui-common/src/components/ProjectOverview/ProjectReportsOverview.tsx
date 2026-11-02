import {
  Alert,
  Button,
  CircularProgress,
  Stack,
  Typography,
} from "@mui/material";
import { Link, useNavigate } from "react-router-dom";
import {
  ReportSortBy,
  ReportSortOrder,
  ReportType,
  type ReportDto,
} from "../../api";
import { usePathService } from "../../contexts";
import { useProjectReports } from "../../data/hooks/useProjectReports";
import { Card } from "../Card";
import { readProjectReportMetadata } from "./projectReportMetadata";

const FILTERS = {
  types: [ReportType.ProjectReport],
  sortBy: ReportSortBy.CreatedAt,
  sortOrder: ReportSortOrder.Desc,
};

export const ProjectReportsOverview = ({
  organizationId,
  projectId,
}: {
  organizationId: string;
  projectId: string;
}) => {
  const navigate = useNavigate();
  const paths = usePathService();
  const latest = useProjectReports(organizationId, projectId, {
    ...FILTERS,
    limit: 1,
    offset: 0,
  });
  const openReport = (report: ReportDto) =>
    navigate(paths.report({ projectId, reportId: report.id }));
  const report = latest.reports[0];
  const metadata = report
    ? readProjectReportMetadata(report, organizationId, projectId)
    : null;
  return (
    <Card
      title="Project reports"
      dataTestId="project-reports-overview"
      inlineActionOnMobile
      action={
        <Button
          data-testid="project-report-create-route"
          onClick={() => navigate(paths.createProjectReport(projectId))}
        >
          Create report
        </Button>
      }
    >
      <Stack spacing={1}>
        {latest.error ? (
          <Alert
            severity="error"
            action={
              <Button onClick={() => void latest.refetch()}>Retry</Button>
            }
          >
            Could not load project reports.
          </Alert>
        ) : !latest.isFetched || latest.isLoading ? (
          <CircularProgress size={24} aria-label="Loading project reports" />
        ) : !report ? (
          <Typography>No project reports yet.</Typography>
        ) : !metadata ? (
          <Alert severity="error">
            The latest report metadata is unavailable.
          </Alert>
        ) : (
          <Stack data-testid="project-report-latest" data-report-id={report.id}>
            <Button
              sx={{ alignSelf: "flex-start" }}
              onClick={() => openReport(report)}
            >
              {metadata.title}
            </Button>
            <Typography>{metadata.summary}</Typography>
            <Typography variant="caption" color="text.secondary">
              {metadata.period}
            </Typography>
          </Stack>
        )}
        <Button
          component={Link}
          to={paths.projectReportHistory(projectId)}
          sx={{ alignSelf: "flex-start" }}
          data-testid="project-report-history"
        >
          View history
        </Button>
      </Stack>
    </Card>
  );
};
