import React from "react";
import { Alert, Stack, Typography } from "@mui/material";
import type { ProposalGroupSnapshot } from "../../api";
import { useWorkItem } from "../../data/hooks/useWorkItem";
import { JourneyScreen } from "./JourneyScreen";

export const SavedJourneyScreen: React.FC<{
  id: string;
  name: string;
  group: Pick<ProposalGroupSnapshot, "organizationId" | "projectId">;
  onOpenFullSize?: () => void;
  fullSize?: boolean;
}> = ({ id, name, group, onOpenFullSize, fullSize }) => {
  const read = useWorkItem(group.organizationId, "task", id, {
    projectId: group.projectId,
  });
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
      onOpenFullSize={onOpenFullSize}
      fullSize={fullSize}
    />
  );
};
