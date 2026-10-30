import type { TaskResponseDto } from "../../api/api";

import { getStatusColorMapping, getStatusLabel } from "../../utils/statusUtils";
import { Chip } from "@mui/material";

export const TaskStatusChip = ({
  status,
}: {
  status: TaskResponseDto["status"];
}) => {
  return (
    <Chip
      label={getStatusLabel(status)}
      color={getStatusColorMapping(status)}
      variant="outlined"
    />
  );
};
