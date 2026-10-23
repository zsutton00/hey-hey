import { TERMS } from "../../i18n/terminology";
import React, { useMemo } from "react";
import { Box } from "@mui/material";
import { TargetEntityType } from "../../api";
import { usePathService } from "../../contexts";
import { useWorkItemTypeByKey } from "../../data/hooks/useWorkItemTypes";
import type { WorkItemResponseDto } from "../../data/collections/workItems";
import { EntityListItem, EntityGrid, taskAdapter } from "../Entity";
import { InteractionComponent } from "../InteractionComponent";
import { TaskListItemExpandable } from "./TaskListItemExpandable";

export interface TaskGridProps {
  tasks: WorkItemResponseDto[];
  loading?: boolean;
  readOnly?: boolean;
  onDelete?: (task: WorkItemResponseDto) => void;
  onCreateTask?: () => void;
  projectId: string;
  emptyMessage?: string;
  showCreateButton?: boolean;
  expandable?: boolean;
  organizationId?: string;
  initiativeId?: string;
  expandedTaskIds?: Set<string>;
  onToggleTaskExpand?: (taskId: string, expanded: boolean) => void;
}

export const TaskList: React.FC<TaskGridProps> = ({
  tasks,
  loading = false,
  readOnly = false,
  onDelete,
  onCreateTask,
  projectId,
  emptyMessage,
  showCreateButton = false,
  expandable = false,
  organizationId,
  initiativeId,
  expandedTaskIds,
  onToggleTaskExpand,
}) => {
  const pathService = usePathService();
  const taskType = useWorkItemTypeByKey(organizationId, projectId, "STANDARD");
  const createAction = {
    verb: "create" as const,
    noun: TERMS.Task,
    entityType: "task",
    workItemIcon: {
      typeKey: "STANDARD",
      definition: taskType.workItemTypeDefinition,
    },
  };

  const tasksLookup = useMemo(
    () => Object.fromEntries(tasks.map((t) => [t.id, { name: t.name }])),
    [tasks],
  );

  // Expandable mode rendering
  if (expandable && organizationId) {
    return (
      <Box
        sx={{
          width: "100%",
          p: 0,
        }}
        data-testid="task-grid"
      >
        <EntityGrid
          items={tasks}
          loading={loading}
          renderItem={(task) => (
            <InteractionComponent
              entityId={task.id}
              entityType={TargetEntityType.Task}
              entitySubtype={task.type}
              hasProposalSupport={task.hasProposalSupport ?? false}
              entityTitle={task.name}
              organizationId={organizationId}
              projectId={projectId}
            >
              <TaskListItemExpandable
                task={task}
                projectId={projectId}
                organizationId={organizationId}
                initiativeId={initiativeId}
                relatedTasks={tasksLookup}
                isExpanded={expandedTaskIds?.has(task.id)}
                onToggleExpand={(expanded) =>
                  onToggleTaskExpand?.(task.id, expanded)
                }
                onDelete={
                  onDelete && !readOnly
                    ? () => {
                        onDelete(task);
                      }
                    : undefined
                }
              />
            </InteractionComponent>
          )}
          keyExtractor={(task) => task.id}
          emptyMessage={emptyMessage || "Create your first task to get started"}
          showCreateButton={showCreateButton}
          onCreateItem={onCreateTask}
          createAction={createAction}
        />
      </Box>
    );
  }

  // Non-expandable mode rendering
  return (
    <Box
      sx={{
        width: "100%",
        p: 0,
      }}
      data-testid="task-grid"
    >
      <EntityGrid
        items={tasks}
        loading={loading}
        renderItem={(task) => {
          const props = taskAdapter.toEntityListItemProps(task, {
            projectId,
            initiativeId: task.initiativeId,
            pathService,
            relatedEntities: { tasks: tasksLookup },
          });

          return (
            <InteractionComponent
              entityId={task.id}
              entityType={TargetEntityType.Task}
              entitySubtype={task.type}
              hasProposalSupport={task.hasProposalSupport ?? false}
              entityTitle={task.name}
              organizationId={organizationId}
              projectId={projectId}
            >
              <EntityListItem
                {...props}
                onDelete={
                  onDelete && !readOnly
                    ? () => {
                        onDelete(task);
                      }
                    : undefined
                }
              />
            </InteractionComponent>
          );
        }}
        keyExtractor={(task) => task.id}
        emptyMessage={emptyMessage || "Create your first task to get started"}
        showCreateButton={showCreateButton}
        onCreateItem={onCreateTask}
        createAction={createAction}
      />
    </Box>
  );
};
