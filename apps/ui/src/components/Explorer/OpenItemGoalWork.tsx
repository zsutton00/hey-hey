import { useState, type ReactNode } from "react";
import { createOpenItemEntity } from "@hey-hey/ui-common";
import {
  Alert,
  Box,
  Button,
  MenuItem,
  TextField,
  Typography,
} from "@mui/material";
import {
  EntityType,
  OpenItemGoalTrackedWorkFilter,
  type TrackedEntitySnapshot,
} from "@hey-hey/ui-common/api";
import { useOpenItemGoalWork } from "@hey-hey/ui-common/data";
import { useOpenItems } from "../../contexts/OpenItemsContext";
import type { OpenItem } from "../../contexts/openItemsModel";

const trackedEntityTypes: Partial<Record<EntityType, OpenItem["entityType"]>> =
  {
    [EntityType.Task]: "task",
    [EntityType.DesignDoc]: "design_doc",
    [EntityType.Initiative]: "initiative",
    [EntityType.Conversation]: "conversation",
  };

const toOpenItem = (work: TrackedEntitySnapshot): OpenItem | null => {
  const entityType = trackedEntityTypes[work.targetEntityType];
  return entityType
    ? {
        ...createOpenItemEntity(entityType, work.targetEntityId),
        title: work.title,
        lineage: undefined,
      }
    : null;
};

const filters = [
  [OpenItemGoalTrackedWorkFilter.ActiveAndBacklog, "Active and backlog"],
  [OpenItemGoalTrackedWorkFilter.Active, "Active only"],
  [OpenItemGoalTrackedWorkFilter.All, "All"],
  [OpenItemGoalTrackedWorkFilter.None, "None"],
] as const;

export function OpenItemGoalWork({
  organizationId,
  projectId,
  goalId,
  filter,
  depth,
  renderItem,
}: {
  organizationId: string;
  projectId: string;
  goalId: string;
  filter: OpenItemGoalTrackedWorkFilter;
  depth: number;
  renderItem: (item: OpenItem, depth: number) => ReactNode;
}) {
  const { setGoalFilter } = useOpenItems();
  const { work, isLoading, error, retry } = useOpenItemGoalWork(
    organizationId,
    projectId,
    goalId,
    filter,
  );
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const changeFilter = async (value: string) => {
    const selected = filters.find(([key]) => key === value)?.[0];
    if (!selected || saving) return;
    setSaving(true);
    setSaveError(!(await setGoalFilter(goalId, selected)));
    setSaving(false);
  };
  return (
    <Box
      data-testid="open-item-goal-work"
      data-goal-id={goalId}
      sx={{ pb: 0.5 }}
    >
      <TextField
        select
        size="small"
        label="Tracked work"
        value={filter}
        onChange={(event) => changeFilter(event.target.value)}
        disabled={saving}
        data-testid="open-item-goal-filter"
        sx={{
          my: 0.5,
          ml: `${8 + (depth + 1) * 20 + 28}px`,
          mr: 1,
          width: "auto",
          "& .MuiInputBase-root": { fontSize: "0.75rem" },
        }}
      >
        {filters.map(([key, label]) => (
          <MenuItem key={key} value={key}>
            {label}
          </MenuItem>
        ))}
      </TextField>
      {saveError && (
        <Alert severity="error" sx={{ ml: `${8 + (depth + 1) * 20 + 28}px` }}>
          Could not save filter. Choose it again to retry.
        </Alert>
      )}
      {error ? (
        <Alert
          severity="error"
          data-testid="open-item-goal-work-error"
          action={<Button onClick={retry}>Retry</Button>}
        >
          Could not load tracked work.
        </Alert>
      ) : isLoading ? (
        <Typography variant="caption" color="text.secondary" role="status">
          Loading tracked work…
        </Typography>
      ) : work.length === 0 ? (
        <Typography
          variant="caption"
          color="text.secondary"
          data-testid="open-item-goal-work-empty"
        >
          No matching work
        </Typography>
      ) : (
        work.flatMap((entry) => {
          const item = toOpenItem(entry);
          return item ? [renderItem(item, depth + 1)] : [];
        })
      )}
    </Box>
  );
}
