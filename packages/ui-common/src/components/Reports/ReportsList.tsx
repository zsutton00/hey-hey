import {
  Chip,
  LinearProgress,
  List,
  ListItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import React, { useMemo, useState } from "react";
import {
  type ReportAudience,
  ReportEntityRelation,
  ReportRelatedEntityType,
  ReportType,
  type ReportDto,
} from "../../api";
import { usePathService } from "../../contexts";
import {
  useReports,
  type ReportsSortBy,
  type ReportsSortDirection,
} from "../../data/hooks/useReports";

type RelationFilter = "ALL" | ReportEntityRelation;
type ReportTypeFilter = "ALL" | ReportType;

const SORT_BY_OPTIONS: ReadonlyArray<{
  value: ReportsSortBy;
  label: string;
}> = [
  { value: "createdAt", label: "Created date" },
  { value: "expiresAt", label: "Expiry date" },
  { value: "reportType", label: "Report type" },
  { value: "schemaVersion", label: "Schema version" },
];

const SORT_DIRECTION_OPTIONS: ReadonlyArray<{
  value: ReportsSortDirection;
  label: string;
}> = [
  { value: "desc", label: "Descending" },
  { value: "asc", label: "Ascending" },
];

const RELATION_FILTER_OPTIONS: ReadonlyArray<{
  value: RelationFilter;
  label: string;
}> = [
  { value: "ALL", label: "All relations" },
  { value: ReportEntityRelation.Primary, label: "Primary" },
  { value: ReportEntityRelation.Context, label: "Context" },
];

const parseReportTypeFilter = (value: string): ReportTypeFilter => {
  switch (value) {
    case ReportType.Snapshot:
      return value;
    default:
      return "ALL";
  }
};

const parseRelationFilter = (value: string): RelationFilter => {
  switch (value) {
    case ReportEntityRelation.Primary:
    case ReportEntityRelation.Context:
      return value;
    default:
      return "ALL";
  }
};

const parseSortBy = (value: string): ReportsSortBy => {
  switch (value) {
    case "createdAt":
    case "expiresAt":
    case "reportType":
    case "schemaVersion":
      return value;
    default:
      return "createdAt";
  }
};

const parseSortDirection = (value: string): ReportsSortDirection => {
  return value === "asc" ? "asc" : "desc";
};

const formatTimestamp = (value: string | null | undefined): string => {
  if (!value) {
    return "Never";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString();
};

const getPrimaryTaskId = (report: ReportDto): string | null => {
  const primaryTask = report.entities.find(
    (entity) =>
      entity.entityType === ReportRelatedEntityType.Task &&
      entity.relation === ReportEntityRelation.Primary,
  );
  return primaryTask?.entityId ?? null;
};

const matchesSearch = (report: ReportDto, searchTerm: string): boolean => {
  if (!searchTerm.trim()) {
    return true;
  }

  const normalizedTerm = searchTerm.toLowerCase();
  const searchableText = [
    report.id,
    report.reportType,
    report.sourceExecutionId ?? "",
    report.projectId ?? "",
    report.entities.map((entity) => entity.entityId).join(" "),
  ]
    .join(" ")
    .toLowerCase();

  return searchableText.includes(normalizedTerm);
};

const getReportHref = (input: {
  organizationId: string;
  report: ReportDto;
  projectId: string | undefined;
  pathService: ReturnType<typeof usePathService>;
}): string => {
  const projectId = input.report.projectId ?? input.projectId;
  if (projectId) {
    return input.pathService.report({
      projectId,
      reportId: input.report.id,
    });
  }

  return input.pathService.organizationReport({
    organizationId: input.organizationId,
    reportId: input.report.id,
  });
};

export interface ReportsListProps {
  organizationId: string;
  projectId?: string;
  audience?: ReportAudience;
  sourceExecutionId?: string;
  entityType?: ReportRelatedEntityType;
  entityId?: string;
  includeExpired?: boolean;
  limit?: number;
  loading?: boolean;
  emptyMessage?: string;
  onReportClick?: (report: ReportDto) => void;
}

export const ReportsList: React.FC<ReportsListProps> = ({
  organizationId,
  projectId,
  audience,
  sourceExecutionId,
  entityType,
  entityId,
  includeExpired,
  limit,
  loading: externalLoading = false,
  emptyMessage = "No reports found",
  onReportClick,
}) => {
  const pathService = usePathService();
  const [searchTerm, setSearchTerm] = useState("");
  const [reportTypeFilter, setReportTypeFilter] =
    useState<ReportTypeFilter>("ALL");
  const [relationFilter, setRelationFilter] = useState<RelationFilter>("ALL");
  const [sortBy, setSortBy] = useState<ReportsSortBy>("createdAt");
  const [sortDirection, setSortDirection] =
    useState<ReportsSortDirection>("desc");

  const { reports, isLoading } = useReports(organizationId, {
    projectId,
    audience,
    sourceExecutionId,
    entityType,
    entityId,
    reportType: reportTypeFilter === "ALL" ? undefined : reportTypeFilter,
    relation: relationFilter === "ALL" ? undefined : relationFilter,
    includeExpired,
    limit,
    sortBy,
    sortDirection,
  });

  const filteredReports = useMemo(
    () => reports.filter((report) => matchesSearch(report, searchTerm)),
    [reports, searchTerm],
  );

  const isLoadingState = isLoading || externalLoading;

  return (
    <Paper
      data-testid="reports-list"
      sx={(theme) => ({
        p: 2,
        width: "100%",
        backgroundColor:
          theme.palette.mode === "dark"
            ? theme.palette.grey[900]
            : "rgb(249, 249, 251)",
      })}
    >
      <Stack spacing={2}>
        <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
          <TextField
            label="Search reports"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            size="small"
            fullWidth
            inputProps={{ "data-testid": "reports-list-search-input" }}
          />
          <TextField
            label="Report type"
            select
            SelectProps={{
              native: true,
              inputProps: { "data-testid": "reports-list-report-type-filter" },
            }}
            size="small"
            value={reportTypeFilter}
            onChange={(event) =>
              setReportTypeFilter(parseReportTypeFilter(event.target.value))
            }
            sx={{ minWidth: 180 }}
          >
            <option value="ALL">All types</option>
            {Object.values(ReportType).map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </TextField>
          <TextField
            label="Relation"
            select
            SelectProps={{
              native: true,
              inputProps: { "data-testid": "reports-list-relation-filter" },
            }}
            size="small"
            value={relationFilter}
            onChange={(event) =>
              setRelationFilter(parseRelationFilter(event.target.value))
            }
            sx={{ minWidth: 160 }}
          >
            {RELATION_FILTER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </TextField>
          <TextField
            label="Sort by"
            select
            SelectProps={{
              native: true,
              inputProps: { "data-testid": "reports-list-sort-by" },
            }}
            size="small"
            value={sortBy}
            onChange={(event) => setSortBy(parseSortBy(event.target.value))}
            sx={{ minWidth: 160 }}
          >
            {SORT_BY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </TextField>
          <TextField
            label="Direction"
            select
            SelectProps={{
              native: true,
              inputProps: { "data-testid": "reports-list-sort-direction" },
            }}
            size="small"
            value={sortDirection}
            onChange={(event) =>
              setSortDirection(parseSortDirection(event.target.value))
            }
            sx={{ minWidth: 140 }}
          >
            {SORT_DIRECTION_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </TextField>
        </Stack>

        {isLoadingState ? (
          <LinearProgress data-testid="reports-list-loading" />
        ) : null}

        {!isLoadingState && filteredReports.length === 0 ? (
          <Typography
            color="text.secondary"
            data-testid="reports-list-empty"
            variant="body2"
          >
            {emptyMessage}
          </Typography>
        ) : null}

        <List data-testid="reports-list-items" disablePadding>
          {filteredReports.map((report) => {
            const primaryTaskId = getPrimaryTaskId(report);

            return (
              <ListItem
                key={report.id}
                data-testid={`reports-list-item-${report.id}`}
                disablePadding
                sx={{ mb: 1 }}
              >
                <Stack
                  component="a"
                  data-testid={`reports-list-link-${report.id}`}
                  href={getReportHref({
                    organizationId,
                    report,
                    projectId,
                    pathService,
                  })}
                  onClick={(e: React.MouseEvent<HTMLAnchorElement>) => {
                    if (
                      onReportClick &&
                      !e.ctrlKey &&
                      !e.metaKey &&
                      !e.shiftKey
                    ) {
                      e.preventDefault();
                      onReportClick(report);
                    }
                  }}
                  spacing={0.5}
                  sx={(theme) => ({
                    width: "100%",
                    px: 2,
                    py: 1.25,
                    textDecoration: "none",
                    color: "inherit",
                    borderRadius: 1,
                    transition: theme.transitions.create("background-color", {
                      duration: theme.transitions.duration.shortest,
                    }),
                    "&:hover": {
                      backgroundColor: theme.palette.action.hover,
                    },
                  })}
                >
                  <Stack
                    alignItems="center"
                    direction="row"
                    spacing={1}
                    sx={{ flexWrap: "wrap" }}
                  >
                    <Typography variant="subtitle2">{report.id}</Typography>
                    <Chip
                      color="primary"
                      label={report.reportType}
                      size="small"
                    />
                    <Chip
                      label={`v${report.schemaVersion}`}
                      size="small"
                      variant="outlined"
                    />
                  </Stack>
                  <Stack spacing={0.25}>
                    <Typography variant="caption">
                      Created: {formatTimestamp(report.createdAt)}
                    </Typography>
                    <Typography variant="caption">
                      Expires: {formatTimestamp(report.expiresAt)}
                    </Typography>
                    {primaryTaskId ? (
                      <Typography variant="caption">
                        Primary task: {primaryTaskId}
                      </Typography>
                    ) : null}
                  </Stack>
                </Stack>
              </ListItem>
            );
          })}
        </List>
      </Stack>
    </Paper>
  );
};
