import React, { useCallback } from "react";
import { fetchTaskHierarchy } from "../../data/api/fetchTaskHierarchy";
import type { WorkItemResponseDto } from "../../data/collections/workItems";
import { taskAdapter } from "../Entity/adapters";
import { EntityListItemExpandable } from "../Entity/EntityListItemExpandable";
import { usePathService } from "../../contexts";

export interface TaskListItemExpandableProps {
  task: WorkItemResponseDto;
  projectId: string;
  organizationId: string;
  initiativeId?: string;
  isExpanded?: boolean;
  onToggleExpand?: (expanded: boolean) => void;
  onDelete?: () => void;
  nestingLevel?: number;
  maxNestingLevel?: number;
  relatedTasks?: Record<string, { name: string }>;
}

export const TaskListItemExpandable: React.FC<TaskListItemExpandableProps> = ({
  task,
  projectId,
  organizationId,
  initiativeId,
  isExpanded,
  onToggleExpand,
  onDelete,
  nestingLevel = 0,
  maxNestingLevel = 5,
  relatedTasks,
}) => {
  const pathService = usePathService();

  const fetchChildren = useCallback(async (): Promise<WorkItemResponseDto[]> => {
    const hierarchy = await fetchTaskHierarchy(
      organizationId,
      projectId,
      task.id
    );
    return hierarchy.children;
  }, [organizationId, projectId, task.id]);

  const hasChildren = (task.childCounts?.total ?? 0) > 0;

  const adapterProps = taskAdapter.toEntityListItemProps(task, {
    projectId,
    initiativeId: initiativeId || task.initiativeId,
    pathService,
    relatedEntities: relatedTasks ? { tasks: relatedTasks } : undefined,
    onDelete,
  });

  return (
    <EntityListItemExpandable<WorkItemResponseDto>
      {...adapterProps}
      hasChildren={hasChildren}
      childrenCount={task.childCounts?.total}
      isExpanded={isExpanded}
      onToggleExpand={onToggleExpand}
      fetchChildren={fetchChildren}
      nestingLevel={nestingLevel}
      maxNestingLevel={maxNestingLevel}
      renderChildren={(children) => (
        <>
          {children.map((childTask) => (
            <TaskListItemExpandable
              key={childTask.id}
              task={childTask}
              projectId={projectId}
              organizationId={organizationId}
              initiativeId={initiativeId}
              nestingLevel={nestingLevel + 1}
              maxNestingLevel={maxNestingLevel}
              relatedTasks={relatedTasks}
            />
          ))}
        </>
      )}
    />
  );
};
