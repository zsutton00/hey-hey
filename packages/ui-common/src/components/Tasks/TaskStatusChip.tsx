import type { WorkStatus } from "../../api";
import { getStatusColorMapping, getStatusLabel } from "../../utils/statusUtils";
import { Chip } from "@mui/material";

export const TaskStatusChip = ({ status }: { status: WorkStatus }) => {
  return (
    <Chip
      label={getStatusLabel(status)}
      color={getStatusColorMapping(status)}
      variant="outlined"
    />
  );
};
