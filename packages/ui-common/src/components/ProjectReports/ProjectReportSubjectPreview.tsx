import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  FormControl,
  InputLabel,
  List,
  ListItem,
  MenuItem,
  Select,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";
import type {
  EntityType,
  ProjectReportPreviewRow,
  ProjectReportSubject,
} from "../../api";
import {
  PROJECT_REPORT_PAGE_SIZES,
  isSameSubject,
  type PreviewCounts,
  type ProjectReportExclusion,
  type ProjectReportPageSize,
  type ProjectReportPreviewView,
} from "./projectReportRequestState";

const humanizeEntityType = (entityType: EntityType): string => {
  const words = entityType.toLowerCase().replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};

const pluralize = (count: number, singular: string, plural: string) =>
  `${count.toLocaleString()} ${count === 1 ? singular : plural}`;

export type ProjectReportSubjectPreviewContent =
  | { view: "all"; rows: ProjectReportPreviewRow[]; total: number }
  | { view: "excluded"; rows: ProjectReportExclusion[]; total: number };

export interface ProjectReportSubjectPreviewProps {
  view: ProjectReportPreviewView;
  search: string;
  pageSize: ProjectReportPageSize;
  offset: number;
  /** Server counts for the current request; null while not current. */
  counts: PreviewCounts | null;
  /** Rows to display, or null when there is nothing to show yet. */
  content: ProjectReportSubjectPreviewContent | null;
  exclusions: ProjectReportExclusion[];
  isLoading: boolean;
  error: Error | null;
  disabled: boolean;
  onSearchChange: (search: string) => void;
  onViewChange: (view: ProjectReportPreviewView) => void;
  onPageSizeChange: (pageSize: ProjectReportPageSize) => void;
  onOffsetChange: (offset: number) => void;
  onToggleRow: (row: ProjectReportPreviewRow) => void;
  onRestoreSubject: (subject: ProjectReportSubject) => void;
  onClearExclusions: () => void;
  onRetry: () => void;
}

export const ProjectReportSubjectPreview = ({
  view,
  search,
  pageSize,
  offset,
  counts,
  content,
  exclusions,
  isLoading,
  error,
  disabled,
  onSearchChange,
  onViewChange,
  onPageSizeChange,
  onOffsetChange,
  onToggleRow,
  onRestoreSubject,
  onClearExclusions,
  onRetry,
}: ProjectReportSubjectPreviewProps) => {
  const isRowExcluded = (subject: ProjectReportSubject) =>
    exclusions.some((entry) => isSameSubject(entry.subject, subject));
  const total = content?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const pageNumber = Math.floor(offset / pageSize) + 1;

  return (
    <Stack
      spacing={1.5}
      component="section"
      aria-labelledby="project-report-preview-heading"
      data-testid="project-report-subject-preview"
    >
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="flex-start"
        flexWrap="wrap"
        gap={1}
      >
        <Box>
          <Typography
            id="project-report-preview-heading"
            variant="h6"
            component="h2"
          >
            Included entities
          </Typography>
          <Typography
            variant="body2"
            color="text.secondary"
            aria-live="polite"
            data-testid="project-report-preview-counts"
          >
            {counts ? (
              <>
                {counts.matchingSubjectCount.toLocaleString()} matching ·{" "}
                <strong>
                  {counts.includedSubjectCount.toLocaleString()} included
                </strong>{" "}
                · {counts.excludedSubjectCount.toLocaleString()} excluded
              </>
            ) : error ? (
              "Counts unavailable"
            ) : (
              "Updating counts…"
            )}
          </Typography>
        </Box>
        <Button
          size="small"
          onClick={onClearExclusions}
          disabled={disabled || exclusions.length === 0}
          data-testid="project-report-clear-exclusions"
        >
          Clear exclusions
        </Button>
      </Stack>
      <TextField
        type="search"
        size="small"
        label="Find in preview"
        placeholder="Search entity names…"
        value={search}
        onChange={(event) => onSearchChange(event.target.value)}
        fullWidth
        helperText="Search only changes this preview. It does not narrow the report."
        slotProps={{ htmlInput: { "data-testid": "project-report-preview-search" } }}
      />
      <Tabs
        value={view}
        onChange={(_event, next: ProjectReportPreviewView) => onViewChange(next)}
        aria-label="Preview view"
        data-testid="project-report-preview-tabs"
      >
        <Tab value="all" label="All matches" data-testid="project-report-view-all" />
        <Tab
          value="excluded"
          label={`Excluded (${exclusions.length.toLocaleString()})`}
          data-testid="project-report-view-excluded"
        />
      </Tabs>
      {error ? (
        <Alert
          severity="error"
          data-testid="project-report-preview-error"
          action={
            <Button color="inherit" size="small" onClick={onRetry}>
              Retry
            </Button>
          }
        >
          The preview could not be loaded. Your question and selections are
          kept.
        </Alert>
      ) : null}
      <Box
        aria-busy={isLoading}
        sx={{ position: "relative", opacity: isLoading && content ? 0.6 : 1 }}
      >
        {isLoading && !content ? (
          <Stack alignItems="center" sx={{ py: 4 }} role="status">
            <CircularProgress size={24} />
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              Loading matching entities…
            </Typography>
          </Stack>
        ) : null}
        {content && content.total === 0 && !isLoading ? (
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ py: 3 }}
            data-testid="project-report-preview-empty"
          >
            {content.view === "excluded"
              ? "No excluded entities match."
              : search.trim()
              ? "No matching entities fit this search."
              : "No entities have recorded activity in this scope."}
          </Typography>
        ) : null}
        {content && content.rows.length > 0 ? (
          <List disablePadding data-testid="project-report-preview-list">
            {content.view === "all"
              ? content.rows.map((row) => {
                  const excluded = isRowExcluded(row.subject);
                  const labelId = `project-report-row-${row.subject.entityType}-${row.subject.entityId}`;
                  return (
                    <ListItem
                      key={`${row.subject.entityType}:${row.subject.entityId}`}
                      divider
                      data-testid="project-report-preview-row"
                      data-entity-id={row.subject.entityId}
                      data-excluded={excluded ? "true" : "false"}
                      sx={{ bgcolor: excluded ? "action.hover" : undefined }}
                    >
                      <Checkbox
                        edge="start"
                        checked={!excluded}
                        disabled={disabled}
                        onChange={() => onToggleRow(row)}
                        slotProps={{
                          input: {
                            "aria-label": `Include ${row.title}`,
                          },
                        }}
                        data-testid="project-report-row-checkbox"
                      />
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography
                          id={labelId}
                          variant="body2"
                          fontWeight={600}
                          color={excluded ? "text.secondary" : "text.primary"}
                        >
                          {row.title}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" component="p">
                          {humanizeEntityType(row.subject.entityType)} ·{" "}
                          {pluralize(
                            row.matchingActivityCount,
                            "recorded change",
                            "recorded changes"
                          )}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" component="p">
                          {row.explanation}
                        </Typography>
                      </Box>
                      {excluded ? <Chip size="small" label="Excluded" /> : null}
                    </ListItem>
                  );
                })
              : content.rows.map((entry) => (
                  <ListItem
                    key={`${entry.subject.entityType}:${entry.subject.entityId}`}
                    divider
                    data-testid="project-report-excluded-row"
                    data-entity-id={entry.subject.entityId}
                    secondaryAction={
                      <Button
                        size="small"
                        disabled={disabled}
                        onClick={() => onRestoreSubject(entry.subject)}
                        aria-label={`Include ${entry.title}`}
                        data-testid="project-report-restore-subject"
                      >
                        Include
                      </Button>
                    }
                  >
                    <Box>
                      <Typography variant="body2" fontWeight={600}>
                        {entry.title}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {humanizeEntityType(entry.subject.entityType)}
                      </Typography>
                    </Box>
                  </ListItem>
                ))}
          </List>
        ) : null}
      </Box>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        justifyContent="space-between"
        alignItems={{ xs: "stretch", sm: "center" }}
        spacing={1}
        component="nav"
        aria-label="Preview pages"
      >
        <FormControl size="small" sx={{ minWidth: 110 }}>
          <InputLabel id="project-report-page-size-label">Per page</InputLabel>
          <Select
            labelId="project-report-page-size-label"
            label="Per page"
            value={pageSize}
            onChange={(event) =>
              onPageSizeChange(Number(event.target.value) as ProjectReportPageSize)
            }
            data-testid="project-report-page-size"
          >
            {PROJECT_REPORT_PAGE_SIZES.map((size) => (
              <MenuItem key={size} value={size}>
                {size}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <Stack direction="row" alignItems="center" spacing={1} justifyContent="space-between">
          <Button
            size="small"
            disabled={offset === 0}
            onClick={() => onOffsetChange(offset - pageSize)}
            data-testid="project-report-previous-page"
          >
            Previous
          </Button>
          <Typography variant="caption">
            Page {pageNumber.toLocaleString()} of {pageCount.toLocaleString()}
          </Typography>
          <Button
            size="small"
            disabled={offset + pageSize >= total}
            onClick={() => onOffsetChange(offset + pageSize)}
            data-testid="project-report-next-page"
          >
            Next
          </Button>
        </Stack>
      </Stack>
      <Typography variant="caption" color="text.secondary">
        Unchecked entities are excluded as report subjects. Related context may
        still be cited to explain included activity.
      </Typography>
    </Stack>
  );
};
