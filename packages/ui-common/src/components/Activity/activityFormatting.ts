import { formatDistanceToNow } from "date-fns";
import {
  ActivityCorrelationLinkType,
  EntityType,
  type ActivityCorrelationLinkedEntityDto,
} from "../../api";

export const resolveAgentSessionDisplayTitle = (
  entityType: EntityType | string,
  title: string,
  linkedEntities: ActivityCorrelationLinkedEntityDto[]
): string => {
  if (entityType !== EntityType.AgentSession) {
    return title;
  }

  const parentEntity =
    linkedEntities.find(
      (e) => e.linkType === ActivityCorrelationLinkType.Parent
    ) ??
    linkedEntities.find(
      (e) => e.linkType === ActivityCorrelationLinkType.Related
    );

  if (!parentEntity?.title.trim()) {
    return title;
  }

  return `${parentEntity.title} - ${title}`;
};

export const formatActivityTimestamp = (timestamp: string): string => {
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) {
    return timestamp;
  }

  return parsed.toLocaleString();
};

export const formatActivityRelativeTimestamp = (timestamp: string): string => {
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) {
    return timestamp;
  }

  return formatDistanceToNow(parsed, { addSuffix: true });
};
