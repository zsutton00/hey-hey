import type {
  TaskResponseDto,
  WorkItemTypeDefinitionDto,
} from "@hey-hey/ui-common/api";
import { WorkStatus } from "@hey-hey/ui-common/api";
import { useWorkItems } from "@hey-hey/ui-common/data";
import React, { useEffect } from "react";
import { ExplorerFeatureQuery } from "./ExplorerFeatureQuery";
import { WORK_ITEM_TYPE_KEYS } from "../../types/workItemTypes";

export type ExplorerWorkItemQueryState = {
  workItems: Array<
    Pick<
      TaskResponseDto,
      | "id"
      | "name"
      | "type"
      | "status"
      | "priority"
      | "childCounts"
      | "parentTaskId"
      | "updatedAt"
      | "createdAt"
    > & { hasFeatureChildren?: boolean }
  >;
  isLoading: boolean;
  error: unknown;
};

export interface ExplorerWorkItemQueryProps {
  organizationId: string;
  projectId: string;
  definition: WorkItemTypeDefinitionDto;
  enabled: boolean;
  onStateChange: (typeKey: string, state: ExplorerWorkItemQueryState) => void;
}

const getTypeSpecificFilters = (typeKey: string) => {
  switch (typeKey) {
    case WORK_ITEM_TYPE_KEYS.Goal:
      return {
        includeTrackedEntities: false,
        status: WorkStatus.Active,
      };
    case "PLAN":
      return {
        status: [WorkStatus.Active, WorkStatus.Ready, WorkStatus.Backlog],
      };
    default:
      return { parentTaskId: null };
  }
};

const OtherWorkItemQuery: React.FC<ExplorerWorkItemQueryProps> = ({
  organizationId,
  projectId,
  definition,
  enabled,
  onStateChange,
}) => {
  const { workItems, isLoading, error } = useWorkItems(
    organizationId,
    "task",
    projectId,
    undefined,
    {
      ...getTypeSpecificFilters(definition.key),
      enabled,
      taskType: definition.key,
      websocketsEnabled: false,
    }
  );

  useEffect(() => {
    onStateChange(definition.key, {
      workItems,
      isLoading,
      error,
    });
  }, [definition.key, error, isLoading, onStateChange, workItems]);

  return null;
};

export const ExplorerWorkItemQuery: React.FC<ExplorerWorkItemQueryProps> = (
  props
) =>
  props.definition.key === WORK_ITEM_TYPE_KEYS.Feature ? (
    <ExplorerFeatureQuery {...props} />
  ) : (
    <OtherWorkItemQuery {...props} />
  );
