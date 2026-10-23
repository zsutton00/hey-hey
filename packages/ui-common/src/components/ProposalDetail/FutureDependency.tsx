import { Alert, Stack, Typography } from "@mui/material";
import { useWorkItem } from "../../data/hooks/useWorkItem";
import { getStatusLabel } from "../../utils/statusUtils";
import { EntityLinkWithPreview } from "../Entity";

/** One piece of linked work a future waits on, with its current status. */
export function FutureDependency({
  organizationId,
  projectId,
  taskId,
}: {
  organizationId: string;
  projectId: string;
  taskId: string;
}) {
  const { workItem, isLoading, error } = useWorkItem(
    organizationId,
    "task",
    taskId,
    { projectId },
  );
  if (isLoading)
    return <Typography variant="body2">Loading linked work…</Typography>;
  if (error || !workItem || workItem.status === "ARCHIVED")
    return <Alert severity="warning">Linked work unavailable</Alert>;
  return (
    <Stack
      direction="row"
      spacing={0.75}
      alignItems="center"
      data-testid="future-dependency"
      data-task-id={taskId}
    >
      <EntityLinkWithPreview
        label={workItem.name}
        entityId={taskId}
        entityType="TASK"
        organizationId={organizationId}
        projectId={projectId}
      />
      <Typography variant="caption" color="text.secondary">
        {getStatusLabel(workItem.status)}
      </Typography>
    </Stack>
  );
}

/** Plain-text name of linked work, for use inside a sentence. */
export function FutureDependencyName({
  organizationId,
  projectId,
  taskId,
}: {
  organizationId: string;
  projectId: string;
  taskId: string;
}) {
  const { workItem } = useWorkItem(organizationId, "task", taskId, {
    projectId,
  });
  return <>{workItem?.name ?? "linked work"}</>;
}
