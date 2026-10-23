import { Alert, Stack, Typography } from "@mui/material";
import type { FutureCompletionBlocker } from "../../api";
import { useWorkItem } from "../../data/hooks/useWorkItem";
import { EntityLinkWithPreview } from "../Entity";

export function FutureDependency({
  organizationId,
  projectId,
  taskId,
  blocker,
}: {
  organizationId: string;
  projectId: string;
  taskId: string;
  blocker: FutureCompletionBlocker | undefined;
}) {
  const { workItem, isLoading, error } = useWorkItem(
    organizationId,
    "task",
    taskId,
    { projectId },
  );
  if (isLoading) return <Typography>Loading linked work…</Typography>;
  if (error || !workItem || workItem.status === "ARCHIVED")
    return <Alert severity="warning">Linked work unavailable</Alert>;
  return (
    <Stack data-testid="future-dependency" data-task-id={taskId}>
      <EntityLinkWithPreview
        label={workItem.name}
        entityId={taskId}
        entityType="TASK"
        organizationId={organizationId}
        projectId={projectId}
      />
      {blocker && (
        <Typography color="warning.main">
          {blocker.reason.toLowerCase().replace(/_/g, " ")}
        </Typography>
      )}
    </Stack>
  );
}
