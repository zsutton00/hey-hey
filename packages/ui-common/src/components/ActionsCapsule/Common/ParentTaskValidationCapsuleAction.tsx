import React from "react";
import {
  ValidationCapsuleAction,
  type ValidationCapsuleActionProps,
} from "./ValidationCapsuleAction";
import { useTaskHierarchy } from "../../../data/hooks/useTaskHierarchy";

export interface ParentTaskValidationCapsuleActionProps
  extends Omit<ValidationCapsuleActionProps, "scope" | "entityId"> {
  /** Id of the parent task whose validation entry is being surfaced. */
  taskId: string;
}

/**
 * Validation entry for the parent-task surface. Tasks are treated as parent
 * tasks when they have at least one child task, so this wrapper queries the
 * task hierarchy and hides itself when the task is childless.
 */
export const ParentTaskValidationCapsuleAction: React.FC<
  ParentTaskValidationCapsuleActionProps
> = ({ taskId, organizationId, projectId, enabled = true, ...rest }) => {
  const { children, isFetched } = useTaskHierarchy(
    organizationId,
    projectId,
    taskId,
    {
      projectId,
      enabled: enabled && !!organizationId && !!projectId && !!taskId,
    }
  );

  const hasChildren = isFetched && children.length > 0;

  return (
    <ValidationCapsuleAction
      {...rest}
      scope="parent_task"
      entityId={taskId}
      taskId={taskId}
      organizationId={organizationId}
      projectId={projectId}
      enabled={enabled && hasChildren}
    />
  );
};
