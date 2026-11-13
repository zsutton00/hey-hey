import { Chip } from "@mui/material";
import React from "react";
import { formatStatus, getStatusColorMapping } from "../../utils/statusUtils";
import {
  getWorkItemStatusLabel,
  type WorkItemStatusVocabulary,
} from "../../utils/workItemStatusVocabulary";

interface EntityNodeStatusChipProps {
  status?: string;
  /**
   * Present when the node is a work item: the status then reads from the
   * item's type definition, and shows exactly as saved while that definition
   * is unavailable. Other entities format their own status values.
   */
  workItem?: { definition: WorkItemStatusVocabulary | undefined };
}

export const EntityNodeStatusChip: React.FC<EntityNodeStatusChipProps> = ({
  status,
  workItem,
}) => {
  if (!status) {
    return null;
  }

  return (
    <Chip
      label={
        workItem
          ? getWorkItemStatusLabel(status, workItem.definition)
          : formatStatus(status)
      }
      color={getStatusColorMapping(status)}
      size="small"
      variant="outlined"
    />
  );
};
