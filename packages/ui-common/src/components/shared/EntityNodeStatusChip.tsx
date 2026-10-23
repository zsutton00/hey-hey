import { Chip } from "@mui/material";
import React from "react";
import { formatStatus, getStatusColorMapping } from "../../utils/statusUtils";

interface EntityNodeStatusChipProps {
  status?: string;
}

export const EntityNodeStatusChip: React.FC<EntityNodeStatusChipProps> = ({
  status,
}) => {
  if (!status) {
    return null;
  }

  return (
    <Chip
      label={formatStatus(status)}
      color={getStatusColorMapping(status)}
      size="small"
      variant="outlined"
    />
  );
};
