import React, { useCallback } from "react";
import FactCheckIcon from "@mui/icons-material/FactCheck";
import { CapsuleAction } from "../CapsuleAction";
import {
  useValidationLauncher,
  type ValidationScope,
} from "../../AgentSession/useValidationLauncher";
import type { AgentSessionDto } from "../../../api";

export interface ValidationCapsuleActionProps {
  scope: ValidationScope;
  entityId: string;
  organizationId: string;
  projectId: string;
  /** Optional task id stored on the agent session row. */
  taskId?: string;
  /** Optional plan id stored on the agent session row. */
  planId?: string;
  /** Optional service id. */
  serviceId?: string;
  /** Override the action id (defaults to `validation-<scope>`). */
  actionId?: string;
  /** Override the displayed label. */
  label?: string;
  /** Override the optional session title written on creation. */
  sessionTitle?: string;
  /** When false the action does not register. Defaults to true. */
  enabled?: boolean;
  /** Relative order within the page tier; defaults to 95 (after Discuss). */
  order?: number;
  /** Invoked once the validation agent session is successfully created. */
  onSessionCreated?: (session: AgentSessionDto) => void;
}

const DEFAULT_ORDER = 95;

const defaultActionId = (scope: ValidationScope): string =>
  `validation-${scope}`;

const defaultLabel = (scope: ValidationScope): string => {
  switch (scope) {
    case "task":
      return "Validate Task";
    case "parent_task":
      return "Validate Parent Task";
    case "plan_stage":
      return "Validate Plan Stage";
  }
};

export const ValidationCapsuleAction: React.FC<
  ValidationCapsuleActionProps
> = ({
  scope,
  entityId,
  organizationId,
  projectId,
  taskId,
  planId,
  serviceId,
  actionId,
  label,
  sessionTitle,
  enabled = true,
  order = DEFAULT_ORDER,
  onSessionCreated,
}) => {
  const launcher = useValidationLauncher({
    organizationId,
    projectId,
    ...(onSessionCreated ? { onSessionCreated } : {}),
  });

  const handleClick = useCallback(() => {
    void launcher.launch({
      scope,
      entityId,
      ...(taskId ? { taskId } : {}),
      ...(planId ? { planId } : {}),
      ...(serviceId ? { serviceId } : {}),
      ...(sessionTitle ? { title: sessionTitle } : {}),
    });
  }, [launcher, scope, entityId, taskId, planId, serviceId, sessionTitle]);

  if (!enabled || !organizationId || !projectId || !entityId) {
    return null;
  }

  return (
    <CapsuleAction
      id={actionId ?? defaultActionId(scope)}
      label={label ?? defaultLabel(scope)}
      icon={FactCheckIcon}
      actionGroup="page"
      tier="page"
      order={order}
      behavior="click"
      onClick={handleClick}
      inProgress={launcher.isPending}
      title={label ?? defaultLabel(scope)}
    />
  );
};
