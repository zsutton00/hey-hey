import { Alert, Button, CircularProgress, Stack, Typography } from "@mui/material";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ReportSortBy, ReportSortOrder, ReportType, type ReportDto } from "../../api";
import { usePathService } from "../../contexts";
import { useProjectReports } from "../../data/hooks/useProjectReports";
import { Card } from "../Card";
import { readProjectReportMetadata } from "./projectReportMetadata";
import { ProjectReportHistoryPicker } from "./ProjectReportHistoryPicker";

const PAGE_SIZE = 8;
const FILTERS = { types: [ReportType.ProjectReport], sortBy: ReportSortBy.CreatedAt, sortOrder: ReportSortOrder.Desc };

export const ProjectReportsOverview = ({ organizationId, projectId }: { organizationId: string; projectId: string }) => {
  const navigate = useNavigate();
  const paths = usePathService();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [page, setPage] = useState(0);
  const latest = useProjectReports(organizationId, projectId, { ...FILTERS, limit: 1, offset: 0 });
  const history = useProjectReports(organizationId, projectId, { ...FILTERS, limit: PAGE_SIZE + 1, offset: page * PAGE_SIZE, enabled: historyOpen });
  const openReport = (report: ReportDto) => navigate(paths.report({ projectId, reportId: report.id }));
  const report = latest.reports[0];
  const metadata = report ? readProjectReportMetadata(report, organizationId, projectId) : null;
  return (
    <Card title="Project reports" dataTestId="project-reports-overview" inlineActionOnMobile
      action={
          <Button data-testid="project-report-create-route" onClick={() => navigate(paths.createProjectReport(projectId))}>Create report</Button>
      }>
      <Stack spacing={1}>
      {latest.error ? <Alert severity="error" action={<Button onClick={() => void latest.refetch()}>Retry</Button>}>Could not load project reports.</Alert>
        : !latest.isFetched || latest.isLoading ? <CircularProgress size={24} aria-label="Loading project reports" />
        : !report ? <Typography>No project reports yet.</Typography>
        : !metadata ? <Alert severity="error">The latest report metadata is unavailable.</Alert>
        : <Stack data-testid="project-report-latest" data-report-id={report.id}>
            <Button sx={{ alignSelf: "flex-start" }} onClick={() => openReport(report)}>{metadata.title}</Button>
            <Typography>{metadata.summary}</Typography>
            <Typography variant="caption" color="text.secondary">{metadata.period}</Typography>
          </Stack>}
      <Button sx={{ alignSelf: "flex-start" }} data-testid="project-report-history" onClick={() => { setPage(0); setHistoryOpen(true); }}>History</Button>
      </Stack>
      <ProjectReportHistoryPicker organizationId={organizationId} projectId={projectId}
        open={historyOpen} page={page} pageSize={PAGE_SIZE} history={history}
        onPage={setPage} onClose={() => setHistoryOpen(false)} onOpenReport={openReport} />
    </Card>
  );
};
