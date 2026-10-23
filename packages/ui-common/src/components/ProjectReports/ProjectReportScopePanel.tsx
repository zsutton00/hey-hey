import {
  Alert,
  Box,
  Button,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import type { ProjectReportPreviewDto } from "../../api";
import { ActivityCorrelationSource } from "../../api";
import {
  PROJECT_REPORT_PERIOD_LABELS,
  type ProjectReportActivityFilter,
  type ProjectReportPeopleFilter,
  type ProjectReportPeriodKind,
  type ProjectReportRequestState,
  type ProjectReportScopeSelection,
} from "./projectReportRequestState";

const ACTIVITY_LABELS: Record<ProjectReportActivityFilter, string> = {
  all: "All activity",
  [ActivityCorrelationSource.AgentSession]: "Agent sessions",
  [ActivityCorrelationSource.AttentionEvent]: "Attention events",
  [ActivityCorrelationSource.TaskRelationship]: "Task relationships",
  [ActivityCorrelationSource.Report]: "Reports",
  [ActivityCorrelationSource.System]: "System",
};

const ACTIVITY_OPTIONS = Object.keys(
  ACTIVITY_LABELS
) as ProjectReportActivityFilter[];

const formatBound = (iso: string, timeZone: string): string =>
  new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(new Date(iso));

const formatTime = (iso: string, timeZone: string): string =>
  new Intl.DateTimeFormat(undefined, { timeStyle: "short", timeZone }).format(
    new Date(iso)
  );

export interface ProjectReportScopePanelProps {
  state: ProjectReportRequestState;
  preview: ProjectReportPreviewDto | null;
  isPreviewLoading: boolean;
  disabled: boolean;
  onScopeChange: (selection: ProjectReportScopeSelection) => void;
  onDismissScopeReset: () => void;
  onRefresh: () => void;
}

export const ProjectReportScopePanel = ({
  state,
  preview,
  isPreviewLoading,
  disabled,
  onScopeChange,
  onDismissScopeReset,
  onRefresh,
}: ProjectReportScopePanelProps) => {
  const { selection } = state;
  const changePeriodKind = (kind: ProjectReportPeriodKind) => {
    if (kind === "custom") {
      const current = state.scope.ok ? state.scope.scope : null;
      onScopeChange({
        ...selection,
        period: {
          kind: "custom",
          start: current ? toLocalInput(current.windowStart) : "",
          end: current ? toLocalInput(current.windowEnd) : "",
        },
      });
      return;
    }
    onScopeChange({ ...selection, period: { kind } });
  };

  return (
    <Stack spacing={2} data-testid="project-report-scope-panel">
      <Typography variant="h6" component="h2">
        Report scope
      </Typography>
      <FormControl size="small" fullWidth disabled={disabled}>
        <InputLabel id="project-report-period-label">Period</InputLabel>
        <Select
          labelId="project-report-period-label"
          label="Period"
          value={selection.period.kind}
          onChange={(event) =>
            changePeriodKind(event.target.value as ProjectReportPeriodKind)
          }
          data-testid="project-report-period"
        >
          {(Object.keys(PROJECT_REPORT_PERIOD_LABELS) as ProjectReportPeriodKind[]).map(
            (kind) => (
              <MenuItem key={kind} value={kind}>
                {PROJECT_REPORT_PERIOD_LABELS[kind]}
              </MenuItem>
            )
          )}
        </Select>
      </FormControl>
      {selection.period.kind === "custom" ? (
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
          <TextField
            type="datetime-local"
            label="Start"
            size="small"
            fullWidth
            disabled={disabled}
            value={selection.period.start}
            onChange={(event) =>
              selection.period.kind === "custom" &&
              onScopeChange({
                ...selection,
                period: { ...selection.period, start: event.target.value },
              })
            }
            slotProps={{
              inputLabel: { shrink: true },
              htmlInput: { "data-testid": "project-report-custom-start" },
            }}
          />
          <TextField
            type="datetime-local"
            label="End"
            size="small"
            fullWidth
            disabled={disabled}
            value={selection.period.end}
            onChange={(event) =>
              selection.period.kind === "custom" &&
              onScopeChange({
                ...selection,
                period: { ...selection.period, end: event.target.value },
              })
            }
            slotProps={{
              inputLabel: { shrink: true },
              htmlInput: { "data-testid": "project-report-custom-end" },
            }}
          />
        </Stack>
      ) : null}
      {state.scope.ok ? (
        <Typography
          variant="body2"
          color="text.secondary"
          data-testid="project-report-resolved-period"
        >
          {formatBound(state.scope.scope.windowStart, state.scope.scope.timeZone)}{" "}
          – {formatBound(state.scope.scope.windowEnd, state.scope.scope.timeZone)}
          <br />
          {state.scope.scope.timeZone} · start inclusive, end exclusive
        </Typography>
      ) : (
        <Alert severity="error" data-testid="project-report-scope-invalid">
          {state.scope.reason}
        </Alert>
      )}
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
        <FormControl size="small" fullWidth disabled={disabled}>
          <InputLabel id="project-report-people-label">People</InputLabel>
          <Select
            labelId="project-report-people-label"
            label="People"
            value={selection.people}
            onChange={(event) =>
              onScopeChange({
                ...selection,
                people: event.target.value as ProjectReportPeopleFilter,
              })
            }
            data-testid="project-report-people"
          >
            <MenuItem value="everyone">Everyone</MenuItem>
            <MenuItem value="me">Only my activity</MenuItem>
          </Select>
        </FormControl>
        <FormControl size="small" fullWidth disabled={disabled}>
          <InputLabel id="project-report-activity-label">Activity</InputLabel>
          <Select
            labelId="project-report-activity-label"
            label="Activity"
            value={selection.activity}
            onChange={(event) =>
              onScopeChange({
                ...selection,
                activity: event.target.value as ProjectReportActivityFilter,
              })
            }
            data-testid="project-report-activity"
          >
            {ACTIVITY_OPTIONS.map((option) => (
              <MenuItem key={option} value={option}>
                {ACTIVITY_LABELS[option]}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </Stack>
      <Typography variant="caption" color="text.secondary">
        Changing scope refreshes the list and clears exclusions.
      </Typography>
      {state.scopeResetExclusionCount > 0 ? (
        <Alert
          severity="info"
          onClose={onDismissScopeReset}
          data-testid="project-report-scope-reset-notice"
        >
          Scope changed, so {state.scopeResetExclusionCount}{" "}
          {state.scopeResetExclusionCount === 1 ? "exclusion was" : "exclusions were"}{" "}
          cleared.
        </Alert>
      ) : null}
      <Box
        sx={{
          bgcolor: "action.hover",
          borderRadius: 2,
          p: 2,
        }}
        data-testid="project-report-scope-summary"
      >
        <Typography variant="overline" color="primary">
          Report will cover
        </Typography>
        <Typography variant="h5" component="p" aria-live="polite">
          {preview && !isPreviewLoading
            ? `${preview.includedSubjectCount.toLocaleString()} ${
                preview.includedSubjectCount === 1 ? "entity" : "entities"
              }`
            : "Loading scope…"}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          All matching entities are included unless you uncheck them, even on
          other pages.
        </Typography>
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          sx={{ mt: 1 }}
        >
          {preview && !isPreviewLoading && state.scope.ok ? (
            <Typography variant="caption" color="text.secondary">
              Scope captured at{" "}
              {formatTime(preview.queriedAt, state.scope.scope.timeZone)}
            </Typography>
          ) : (
            <span />
          )}
          <Button
            size="small"
            onClick={onRefresh}
            disabled={disabled || !state.scope.ok}
            data-testid="project-report-refresh-scope"
          >
            Refresh scope
          </Button>
        </Stack>
      </Box>
    </Stack>
  );
};

const pad = (value: number): string => String(value).padStart(2, "0");

/** Formats an instant for a `datetime-local` input in the browser's zone. */
const toLocalInput = (iso: string): string => {
  const date = new Date(iso);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
