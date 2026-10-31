import React from "react";
import { Alert, Button, Chip, Stack, Typography } from "@mui/material";
import type { ProposalGroupSnapshot } from "../../api";
import { useWorkItem } from "../../data/hooks/useWorkItem";
import { usePathService } from "../../contexts/PathServiceContext";
import { JourneyScreen } from "./JourneyScreen";

export const SavedJourneyScreen: React.FC<{
  id: string;
  name: string;
  group: Pick<ProposalGroupSnapshot, "organizationId" | "projectId">;
}> = ({ id, name, group }) => {
  const read = useWorkItem(group.organizationId, "task", id, {
    projectId: group.projectId,
  });
  const paths = usePathService();
  if (read.isLoading) {
    return <Alert severity="info">Loading saved screen…</Alert>;
  }
  // Live non-Mockup references keep a labelled place in the journey.
  if (read.workItem && read.workItem.type !== "mockup") {
    return (
      <Typography sx={{ p: 2, border: "1px solid", borderColor: "divider" }}>
        {read.workItem.name}
      </Typography>
    );
  }
  if (!read.workItem || read.workItem.status === "ARCHIVED") {
    return (
      <Stack spacing={1}>
        <Alert severity="info">Screen unavailable</Alert>
        <Typography variant="subtitle2">{name}</Typography>
      </Stack>
    );
  }
  return (
    <JourneyScreen
      name={read.workItem.name}
      source={{ kind: "workItem", workItemId: id }}
      sections={read.workItem.sections ?? []}
      group={group}
    >
      <Stack
        data-testid="journey-saved-screen-review"
        data-work-item-id={id}
        spacing={1}
      >
        <Chip label="Accepted · saved screen" color="success" size="small" />
        <Button
          href={paths.task({ projectId: group.projectId, taskId: id })}
          aria-label={`Open saved screen ${read.workItem.name}`}
        >
          Open screen
        </Button>
      </Stack>
    </JourneyScreen>
  );
};
