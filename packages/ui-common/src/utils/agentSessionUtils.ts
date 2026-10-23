import type { AgentSessionDto } from "../api";
import { EntityType } from "../api";
import type { WorkflowAboutType } from "../types";
import { log } from "./logger";
import type { LogCategory } from "./logger";

const LOG_CATEGORY: LogCategory = "general";

export interface WorkflowAboutInfo {
  workflowAboutId: string | undefined;
  workflowAboutType: WorkflowAboutType | undefined;
}

const ENTITY_TYPE_TO_WORKFLOW_ABOUT_TYPE: Partial<
  Record<EntityType, WorkflowAboutType>
> = {
  [EntityType.Task]: "task",
  [EntityType.Initiative]: "initiative",
  [EntityType.DesignDoc]: "design-doc",
  [EntityType.Proposal]: "proposal",
  [EntityType.AgentSession]: "agent-session",
  [EntityType.Conversation]: "conversation",
  [EntityType.Project]: "project",
};

/**
 * Resolve the canonical workflow-about spelling for an entity type.
 *
 * EntityType uses API-style uppercase/underscore values while workflow
 * metadata uses lowercase kebab-case values. Keep that translation in one
 * place so launchers do not accidentally persist values such as
 * `agent_session` instead of `agent-session`.
 */
export const getWorkflowAboutTypeForEntityType = (
  entityType: string,
): WorkflowAboutType | undefined => {
  const normalizedEntityType = entityType
    .trim()
    .toUpperCase()
    .replace(/-/g, "_");
  const matchingEntityType = Object.values(EntityType).find(
    (candidate) => candidate === normalizedEntityType,
  );

  return matchingEntityType
    ? ENTITY_TYPE_TO_WORKFLOW_ABOUT_TYPE[matchingEntityType]
    : undefined;
};

export const getWorkflowAboutInfoForAgentSession = (
  session: AgentSessionDto,
): WorkflowAboutInfo => {
  if (!session.entityType || !session.entityId) {
    log.error(LOG_CATEGORY, "Coding session has no about ID", {
      agentSessionId: session.id,
    });
    return { workflowAboutId: undefined, workflowAboutType: undefined };
  }

  const workflowAboutType = getWorkflowAboutTypeForEntityType(
    session.entityType,
  );
  if (!workflowAboutType) {
    log.error(LOG_CATEGORY, "Coding session has unknown about entityType", {
      agentSessionId: session.id,
      entityType: session.entityType,
    });
    return { workflowAboutId: session.entityId, workflowAboutType: undefined };
  }

  return { workflowAboutId: session.entityId, workflowAboutType };
};
