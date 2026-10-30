import { WebPathService } from "@hey-hey/ui-common";
import {
  EntityType,
  type AttentionEventResponse,
} from "@hey-hey/ui-common/api";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const toStringValue = (
  record: Record<string, unknown> | undefined,
  key: string,
): string | null => {
  if (!record) {
    return null;
  }

  const value = record[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
};

const toStringArray = (
  record: Record<string, unknown> | undefined,
  key: string,
): string[] => {
  if (!record) {
    return [];
  }

  const value = record[key];
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
};

export const getRecentlyViewedEntityName = (
  event: AttentionEventResponse,
): string => {
  const entity = isRecord(event.entity) ? event.entity : undefined;

  return (
    toStringValue(entity, "name") ??
    toStringValue(entity, "title") ??
    event.entityName
  );
};

export const getRecentlyViewedEntityIconType = (
  event: AttentionEventResponse,
): string => {
  if (event.entityType === EntityType.Task) {
    const entity = isRecord(event.entity) ? event.entity : undefined;
    const taskType = toStringValue(entity, "type");
    if (taskType === "FEATURE") {
      return "feature";
    }
    if (taskType === "GOAL") {
      return "goal";
    }
  }
  return event.entityType;
};

export const getRecentlyViewedEntityPath = (
  event: AttentionEventResponse,
  projectId: string,
): string | null => {
  switch (event.entityType.toLowerCase()) {
    case "agent_session":
      return WebPathService.agentSession({
        agentSessionId: event.entityId,
        projectId,
      });
    case "initiative":
      return WebPathService.initiativeDetail({
        initiativeId: event.entityId,
        projectId,
      });
    case "task":
      return WebPathService.task({
        taskId: event.entityId,
        projectId,
      });
    case "conversation":
      return WebPathService.conversation({
        conversationId: event.entityId,
        projectId,
      });
    case "design_doc":
      return WebPathService.designDoc({
        designDocId: event.entityId,
        projectId,
      });
    case "plan":
      return WebPathService.plan({
        planId: event.entityId,
        projectId,
      });
    case "project":
      return WebPathService.project(event.entityId);
    default:
      return null;
  }
};

const belongsToProject = (
  event: AttentionEventResponse,
  projectId: string,
): boolean => {
  const entity = isRecord(event.entity) ? event.entity : undefined;
  const entityType = event.entityType.toLowerCase();
  const entityProjectId = toStringValue(entity, "projectId");
  const originatingProjectId = toStringValue(entity, "originatingProjectId");
  const linkedProjectIds = toStringArray(entity, "linkedProjectIds");

  switch (entityType) {
    case "project":
      return event.entityId === projectId;
    case "conversation":
    case "design_doc":
    case "agent_session":
      return entityProjectId === projectId;
    case "initiative":
      return (
        originatingProjectId === projectId ||
        linkedProjectIds.includes(projectId)
      );
    case "plan":
      return originatingProjectId === projectId;
    case "task":
      return true;
    default:
      return entityProjectId === projectId;
  }
};

export const getProjectRecentlyViewedEvents = (
  events: AttentionEventResponse[],
  projectId: string,
): AttentionEventResponse[] => {
  const seen = new Set<string>();

  return events
    .filter((event) => belongsToProject(event, projectId))
    .filter((event) => {
      const path = getRecentlyViewedEntityPath(event, projectId);
      if (!path) {
        return false;
      }

      const key = `${event.entityType}:${event.entityId}`;
      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    });
};
