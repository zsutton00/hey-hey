import {
  Alert,
  Box,
  Button,
  ButtonBase,
  CircularProgress,
  Stack,
  Typography,
} from "@mui/material";
import { useEffect, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ReportSortBy,
  ReportSortOrder,
  ReportType,
  type ReportDto,
} from "../../api";
import { usePathService } from "../../contexts";
import { useProjectReports } from "../../data/hooks/useProjectReports";
import { logger } from "../../utils/logger";
import { Card } from "../Card";
import { readAuthoredBody } from "../Reports/viewer/projectReportBody";
import { HtmlCssReportBodyThumbnail } from "../shared/HtmlCssReportBodyThumbnail";
import { useRefElementWidth } from "../shared/useRefElementWidth";
import { readProjectReportMetadata } from "./projectReportMetadata";

const FILTERS = {
  types: [ReportType.ProjectReport],
  sortBy: ReportSortBy.CreatedAt,
  sortOrder: ReportSortOrder.Desc,
};

const GALLERY_SIZE = 3;
const NARROW = "@media (max-width:700px)";

const logFallback = (reportId: string, reason: string, detail?: string) =>
  logger.warn("ui", "Project report preview fell back to a plain tile", {
    reportId,
    reason,
    detail,
  });

interface TileProps {
  report: ReportDto;
  organizationId: string;
  projectId: string;
  featured: boolean;
  onOpen: (report: ReportDto) => void;
}

const ReportTile = ({
  report,
  organizationId,
  projectId,
  featured,
  onOpen,
}: TileProps) => {
  const previewRef = useRef<HTMLDivElement | null>(null);
  const width = useRefElementWidth(previewRef);
  const metadata = readProjectReportMetadata(report, organizationId, projectId);
  const { belongsHere, title, period } = metadata;
  const body = belongsHere
    ? readAuthoredBody(
        (report.payload as { body?: unknown } | null | undefined)?.body,
      )
    : null;
  const bodyUnusable = belongsHere && body === null;

  useEffect(() => {
    for (const issue of metadata.issues) {
      logFallback(report.id, issue.reason, issue.detail);
    }
    if (bodyUnusable) {
      logFallback(report.id, "body-unusable");
    }
    // Issues are derived from report/org/project; log once per report change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report, organizationId, projectId]);

  const caption = belongsHere ? (period ?? "Details unavailable") : null;
  const cropHeight = featured ? 440 : 150;

  const preview = body ? (
    <Box
      sx={{
        position: "relative",
        overflow: "hidden",
        height: cropHeight,
        ...(featured && { [NARROW]: { height: 320 } }),
      }}
    >
      <HtmlCssReportBodyThumbnail
        html={body.html}
        css={body.css}
        width={width}
        height={cropHeight}
        title={`Preview of ${title ?? "report"}`}
      />
      <Box
        sx={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: 48,
          pointerEvents: "none",
          background: "linear-gradient(to bottom, transparent, #fff)",
        }}
      />
    </Box>
  ) : belongsHere ? (
    <Box
      data-testid="project-report-preview-unavailable"
      sx={{
        height: cropHeight,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        bgcolor: "action.hover",
      }}
    >
      <Typography variant="caption" color="text.secondary">
        Preview unavailable
      </Typography>
    </Box>
  ) : null;

  const content = (
    <Stack spacing={0.5} sx={{ minWidth: 0 }}>
      <Box
        ref={previewRef}
        sx={{ border: 1, borderColor: "divider", bgcolor: "#f4f6f8" }}
      >
        {preview}
      </Box>
      {/* The preview already shows the report's own title and summary. */}
      {title !== null && !body && (
        <Typography variant="subtitle2" noWrap>
          {title}
        </Typography>
      )}
      {caption !== null && (
        <Typography variant="caption" color="text.secondary" noWrap>
          {caption}
        </Typography>
      )}
    </Stack>
  );

  return (
    <Box data-testid="project-report-preview" data-report-id={report.id}>
      {belongsHere ? (
        <ButtonBase
          data-testid="project-report-preview-open"
          aria-label={`Open ${title ?? "report"}`}
          onClick={() => onOpen(report)}
          sx={{ display: "block", width: "100%", textAlign: "left" }}
        >
          {content}
        </ButtonBase>
      ) : (
        content
      )}
    </Box>
  );
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
    limit: GALLERY_SIZE,
    offset: 0,
  });
  const openReport = (report: ReportDto) =>
    navigate(paths.report({ projectId, reportId: report.id }));
  const [featured, ...earlier] = latest.reports;

  const tile = (report: ReportDto, isFeatured: boolean) => (
    <ReportTile
      key={report.id}
      report={report}
      organizationId={organizationId}
      projectId={projectId}
      featured={isFeatured}
      onOpen={openReport}
    />
  );

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
        ) : !featured ? (
          <Typography>No project reports yet.</Typography>
        ) : (
          <Box
            sx={{
              display: "grid",
              gap: "20px",
              gridTemplateColumns:
                earlier.length > 0
                  ? "minmax(0,2fr) minmax(0,1fr)"
                  : "minmax(0,1fr)",
              [NARROW]: { gridTemplateColumns: "minmax(0,1fr)" },
            }}
          >
            <Box
              data-testid="project-report-latest"
              data-report-id={featured.id}
            >
              {tile(featured, true)}
            </Box>
            {earlier.length > 0 && (
              <Stack spacing="20px">
                {earlier.map((report) => tile(report, false))}
              </Stack>
            )}
          </Box>
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
