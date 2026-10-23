import {
  Box,
  FormControl,
  MenuItem,
  Paper,
  Select,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  type SelectChangeEvent,
} from "@mui/material";
import React from "react";
import {
  RecentActivityCorrelationMode,
  type RecentActivityCorrelationSort,
} from "../../api";
import type { ActivitySortOption } from "../../data/collections/activityCorrelations";
import type { CorrelatedActivityDisplayRecord } from "../../data/hooks/useCorrelatedActivity";
import {
  ActivityHistoryRow,
  ACTIVITY_HISTORY_COLUMNS,
  type ActivityExpandPayload,
} from "./ActivityHistoryRow";

const CORRELATED_ACTIVITY_MODE_OPTIONS = [
  {
    label: "Tasks",
    value: RecentActivityCorrelationMode.Task,
  },
  {
    label: "Coding Sessions",
    value: RecentActivityCorrelationMode.CodingSession,
  },
  {
    label: "Conversations",
    value: RecentActivityCorrelationMode.AgentSession,
  },
] as const;

export interface CorrelatedActivityListProps {
  records: CorrelatedActivityDisplayRecord[];
  emptyMessage?: string;
  showHeader?: boolean;
  selectedMode?: RecentActivityCorrelationMode;
  selectedSort?: RecentActivityCorrelationSort;
  sortOptions?: ActivitySortOption[];
  modeOptions?: readonly RecentActivityCorrelationMode[];
  onModeChange?: (mode: RecentActivityCorrelationMode) => void;
  onSortChange?: (sort: RecentActivityCorrelationSort) => void;
  projectId?: string;
  organizationId: string;
  onExpandActivity?: (payload: ActivityExpandPayload) => void;
}

export const CorrelatedActivityList: React.FC<CorrelatedActivityListProps> = ({
  records,
  emptyMessage = "No activity found",
  showHeader = true,
  selectedMode,
  selectedSort,
  sortOptions,
  modeOptions,
  onModeChange,
  onSortChange,
  projectId,
  onExpandActivity,
}) => {
  const visibleModeOptions = React.useMemo(() => {
    if (!modeOptions) {
      return CORRELATED_ACTIVITY_MODE_OPTIONS;
    }
    const allowed = new Set(modeOptions);
    return CORRELATED_ACTIVITY_MODE_OPTIONS.filter((option) =>
      allowed.has(option.value)
    );
  }, [modeOptions]);

  const showModeSelector =
    selectedMode !== undefined &&
    onModeChange !== undefined &&
    visibleModeOptions.length > 0;
  const showSortSelector =
    selectedSort !== undefined &&
    sortOptions !== undefined &&
    sortOptions.length > 0 &&
    onSortChange !== undefined;

  const handleSortChange = (event: SelectChangeEvent) => {
    onSortChange?.(event.target.value as RecentActivityCorrelationSort);
  };

  const handleModeChange = (
    _event: React.MouseEvent<HTMLElement>,
    nextMode: RecentActivityCorrelationMode | null
  ) => {
    if (!nextMode) {
      return;
    }

    onModeChange?.(nextMode);
  };

  return (
    <Stack data-testid="correlated-activity-list" spacing={1.5}>
      {showHeader && (showModeSelector || showSortSelector) ? (
        <Stack
          alignItems="center"
          direction="row"
          justifyContent="space-between"
          spacing={1}
        >
          {showModeSelector ? (
            <ToggleButtonGroup
              color="primary"
              data-testid="correlated-activity-mode-selector"
              exclusive
              onChange={handleModeChange}
              size="small"
              value={selectedMode}
            >
              {visibleModeOptions.map((option) => (
                <ToggleButton
                  data-testid={`correlated-activity-mode-${option.value}`}
                  key={option.value}
                  value={option.value}
                  sx={{
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {option.label}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
          ) : null}

          {showSortSelector ? (
            <FormControl size="small">
              <Select
                data-testid="correlated-activity-sort-selector"
                onChange={handleSortChange}
                value={selectedSort}
                variant="outlined"
                sx={{ minWidth: 140 }}
              >
                {sortOptions.map((option) => (
                  <MenuItem
                    data-testid={`correlated-activity-sort-${option.value}`}
                    key={option.value}
                    value={option.value}
                  >
                    {option.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          ) : null}
        </Stack>
      ) : null}

      {records.length === 0 ? (
        <Paper data-testid="correlated-activity-list-empty" sx={{ p: 2 }}>
          <Typography color="text.secondary" variant="body2">
            {emptyMessage}
          </Typography>
        </Paper>
      ) : (
        <Box data-testid="activity-history-results">
          <Stack
            direction="row"
            justifyContent="space-between"
            alignItems="center"
            sx={{ py: 1.5, borderTop: 1, borderColor: "divider" }}
          >
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {records.length} {records.length === 1 ? "result" : "results"}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Newest first
            </Typography>
          </Stack>
          <Box
            data-testid="activity-history-column-headings"
            sx={{
              display: { xs: "none", sm: "grid" },
              gridTemplateColumns: ACTIVITY_HISTORY_COLUMNS,
              columnGap: 2,
              px: 1.25,
              py: 1,
              borderBottom: 1,
              borderColor: "divider",
            }}
          >
            {(
              [
                "Source",
                "Current status",
                "Responsible user",
                "Created",
              ] as const
            ).map((label) => (
              <Typography key={label} variant="caption" color="text.secondary">
                {label}
              </Typography>
            ))}
          </Box>
          {records.map((record) => (
            <ActivityHistoryRow
              activity={record}
              key={record.activityId}
              onExpandActivity={onExpandActivity}
              projectId={
                projectId ??
                (record.kind === "entity" ? record.projectId : undefined)
              }
            />
          ))}
        </Box>
      )}
    </Stack>
  );
};
