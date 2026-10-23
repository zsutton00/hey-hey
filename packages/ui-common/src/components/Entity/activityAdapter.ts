import type { CorrelatedActivityDisplayRecord } from "../../data/hooks/useCorrelatedActivity";
import type { PathService } from "../../services/webPathService";
import { EntityType } from "../../api";
import { formatStatus } from "../../utils/statusUtils";
import type { EntityListItemProps } from "./EntityListItem";

export function activityAdapter(
  activity: CorrelatedActivityDisplayRecord,
  pathService: PathService,
  projectId?: string
): EntityListItemProps {
  const owningProjectId =
    activity.kind === "entity" ? activity.projectId : projectId;
  return {
    title: activity.title,
    displayMode: "list",
    href: owningProjectId
      ? sourceHref(
          activity.entityType,
          activity.entityId,
          owningProjectId,
          pathService
        )
      : undefined,
    metadata: [
      ...(activity.status
        ? [{ label: "Current status", value: formatStatus(activity.status) }]
        : []),
      ...(activity.responsibleUser
        ? [{ label: "Responsible user", value: activity.responsibleUser.name }]
        : []),
      ...(activity.entityCreatedAt
        ? [
            {
              label: "Created",
              value: new Date(activity.entityCreatedAt).toLocaleDateString(),
            },
          ]
        : []),
    ],
  };
}

function sourceHref(
  entityType: EntityType,
  entityId: string,
  projectId: string,
  pathService: PathService
): string | undefined {
  switch (entityType) {
    case EntityType.Task:
      return pathService.task({ projectId, taskId: entityId });
    case EntityType.AgentSession:
      return pathService.agentSession({ projectId, agentSessionId: entityId });
    case EntityType.Message:
      return pathService.resolveMessageById({ projectId, messageId: entityId });
    case EntityType.Conversation:
      return pathService.conversation({ projectId, conversationId: entityId });
    case EntityType.Initiative:
      return pathService.initiativeDetail({
        projectId,
        initiativeId: entityId,
      });
    case EntityType.DesignDoc:
      return pathService.designDoc({ projectId, designDocId: entityId });
    case EntityType.Service:
      return pathService.service({ projectId, serviceId: entityId });
    case EntityType.Report:
      return pathService.report({ projectId, reportId: entityId });
    case EntityType.Artifact:
      return pathService.artifact({ projectId, artifactId: entityId });
    case EntityType.Proposal:
      return pathService.proposal({ projectId, proposalId: entityId });
    case EntityType.User:
      return pathService.user({ projectId, userId: entityId });
    case EntityType.Project:
      return pathService.project(entityId);
    default:
      return undefined;
  }
}
