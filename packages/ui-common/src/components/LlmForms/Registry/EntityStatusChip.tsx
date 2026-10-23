import { Chip, Skeleton } from "@mui/material";
import React, { memo } from "react";
import { useDesignDoc } from "../../../data/hooks/useDesignDoc";
import { useWorkItem } from "../../../data/hooks/useWorkItem";

interface EntityStatusChipProps {
  entityId: string;
  entityType: string;
  organizationId: string;
}

export const EntityStatusChip: React.FC<EntityStatusChipProps> = memo(
  ({ entityId, entityType, organizationId }) => {
    const entityTypeLower = entityType.toLowerCase();
    const isDesignDoc =
      entityTypeLower === "design_docs" || entityTypeLower === "design_doc";
    const isTask = entityTypeLower === "tasks" || entityTypeLower === "task";

    const { data: designDoc, isLoading: isLoadingDesignDoc } = useDesignDoc(
      organizationId,
      isDesignDoc ? entityId : undefined,
      { enabled: isDesignDoc }
    );

    const { workItem: task, isLoading: isLoadingTask } = useWorkItem(
      organizationId,
      "task",
      isTask ? entityId : "",
      { enabled: isTask }
    );

    const isLoading = isLoadingDesignDoc || isLoadingTask;
    const status = isDesignDoc
      ? designDoc?.status
      : isTask
      ? task?.status
      : null;

    if (isLoading) {
      return <Skeleton variant="rectangular" width={80} height={24} />;
    }

    if (!status) {
      return null;
    }

    const getStatusColor = (
      statusValue: string
    ):
      | "default"
      | "primary"
      | "secondary"
      | "success"
      | "error"
      | "warning" => {
      const statusStr = String(statusValue).toLowerCase();
      if (statusStr.includes("done") || statusStr.includes("complete")) {
        return "success";
      }
      if (
        statusStr.includes("progress") ||
        statusStr.includes("refining") ||
        statusStr.includes("generating")
      ) {
        return "primary";
      }
      if (statusStr.includes("backlog") || statusStr.includes("generated")) {
        return "default";
      }
      return "default";
    };

    const formatStatus = (statusValue: string): string => {
      return String(statusValue)
        .replace(/_/g, " ")
        .toLowerCase()
        .replace(/\b\w/g, (char) => char.toUpperCase());
    };

    return (
      <Chip
        label={formatStatus(status)}
        size="small"
        color={getStatusColor(status)}
        variant="outlined"
      />
    );
  }
);
