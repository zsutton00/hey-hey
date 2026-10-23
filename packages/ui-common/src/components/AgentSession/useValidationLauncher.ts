import { useCallback, useState } from "react";
import {
  AgentSessionType,
  EntityType,
  ValidationLaunchContextScopeEnum,
  type AgentSessionDto,
  type ValidationLaunchContext,
} from "../../api";
import { useCreateAgentSession } from "../../data/hooks/useCreateAgentSession";

export type ValidationScope = ValidationLaunchContextScopeEnum;

export interface ValidationLaunchInput {
  scope: ValidationScope;
  entityId: string;
  /**
   * Optional task id to associate with the agent session row's about-target.
   * Recommended for `task` and `parent_task` scopes so the session is
   * reachable from the task detail surface.
   */
  taskId?: string;
  /**
   * Optional plan id. Used as the about-target for `plan_stage` scope when
   * present so the session is reachable from the plan surface.
   */
  planId?: string;
  /** Optional service id when known up front. */
  serviceId?: string;
  /** Optional human-readable title; defaults to a scope-aware label. */
  title?: string;
}

export interface UseValidationLauncherInput {
  organizationId: string;
  projectId: string;
  onSessionCreated?: (session: AgentSessionDto) => void;
}

export interface UseValidationLauncherResult {
  launch: (input: ValidationLaunchInput) => Promise<AgentSessionDto | null>;
  isPending: boolean;
  error: string | null;
}

const buildValidationLaunchContext = (
  input: ValidationLaunchInput,
): ValidationLaunchContext => ({
  scope: input.scope,
  entityId: input.entityId,
});

const resolveAboutPair = (
  input: ValidationLaunchInput,
): { entityType: EntityType; entityId: string } | null => {
  switch (input.scope) {
    case ValidationLaunchContextScopeEnum.Task:
    case ValidationLaunchContextScopeEnum.ParentTask:
      return input.taskId
        ? { entityType: EntityType.Task, entityId: input.taskId }
        : null;
    case ValidationLaunchContextScopeEnum.PlanStage:
      if (input.planId)
        return { entityType: EntityType.Task, entityId: input.planId };
      return { entityType: EntityType.Task, entityId: input.entityId };
    default: {
      const exhaustive: never = input.scope;
      throw new Error(
        `resolveAboutPair: unhandled validation scope ${String(exhaustive)}`,
      );
    }
  }
};

const buildDefaultTitle = (scope: ValidationScope): string => {
  switch (scope) {
    case ValidationLaunchContextScopeEnum.Task:
      return "Validation: Task";
    case ValidationLaunchContextScopeEnum.ParentTask:
      return "Validation: Parent Task";
    case ValidationLaunchContextScopeEnum.PlanStage:
      return "Validation: Plan Stage";
    default: {
      const exhaustive: never = scope;
      throw new Error(
        `buildDefaultTitle: unhandled validation scope ${String(exhaustive)}`,
      );
    }
  }
};

export const useValidationLauncher = ({
  organizationId,
  projectId,
  onSessionCreated,
}: UseValidationLauncherInput): UseValidationLauncherResult => {
  const [error, setError] = useState<string | null>(null);

  const { mutate, isPending } = useCreateAgentSession({
    onSuccess: (session: AgentSessionDto) => {
      onSessionCreated?.(session);
    },
    onError: (err: Error) => {
      setError(err.message || "Failed to start validation session");
    },
  });

  const launch = useCallback(
    async (input: ValidationLaunchInput): Promise<AgentSessionDto | null> => {
      if (!organizationId || !projectId || !input.entityId) {
        return null;
      }
      setError(null);

      const aboutPair = resolveAboutPair(input);

      try {
        const session = await mutate({
          organizationId,
          agentSession: {
            projectId,
            sessionDate: new Date().toISOString(),
            title: input.title ?? buildDefaultTitle(input.scope),
            type: AgentSessionType.Validation,
            validationLaunchContext: buildValidationLaunchContext(input),
            ...(aboutPair
              ? {
                  entityType: aboutPair.entityType,
                  entityId: aboutPair.entityId,
                }
              : {}),
            ...(input.serviceId ? { serviceId: input.serviceId } : {}),
          },
        });
        return session;
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Failed to start validation session",
        );
        return null;
      }
    },
    [organizationId, projectId, mutate],
  );

  return { launch, isPending, error };
};
