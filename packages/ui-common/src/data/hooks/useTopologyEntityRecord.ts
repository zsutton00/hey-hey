import { useEffect, useMemo, useState } from "react";
import type {
  ArtifactResponseDto,
  AgentSessionDto,
  ConversationResponseDto,
  DesignDocResponseDto,
  EntityType,
  InitiativeResponseDto,
  MessageRecordDto,
  ProjectResponseDto,
  ServiceDto,
  TaskResponseDto,
} from "../../api";
import { useArtifact } from "./useArtifact";
import { useAgentSession } from "./useAgentSession";
import { useConversation } from "./useConversation";
import { useDesignDoc } from "./useDesignDoc";
import { useInitiative } from "./useInitiative";
import { useMessage } from "./useMessage";
import { useProject } from "./useProject";
import { useService } from "./useService";
import { useWorkItem } from "./useWorkItem";

export type TopologyEntityRecordData =
  | ArtifactResponseDto
  | InitiativeResponseDto
  | ProjectResponseDto
  | TaskResponseDto
  | MessageRecordDto
  | ConversationResponseDto
  | DesignDocResponseDto
  | AgentSessionDto
  | ServiceDto;

export interface UseTopologyEntityRecordParams {
  organizationId: string | undefined;
  projectId: string | undefined;
  entityType: EntityType | undefined;
  entityId: string | undefined;
  enabled?: boolean;
}

export interface UseTopologyEntityRecordReturn {
  record: TopologyEntityRecordData | null;
  isLoading: boolean;
  error: Error | null;
}

export function useTopologyEntityRecord({
  organizationId,
  projectId,
  entityType,
  entityId,
  enabled = true,
}: UseTopologyEntityRecordParams): UseTopologyEntityRecordReturn {
  const isEnabled = enabled && !!organizationId && !!entityType && !!entityId;
  const safeOrgId = organizationId ?? "__noop__";
  const safeEntityId = entityId ?? "__noop__";

  const artifactQuery = useArtifact(organizationId, entityId, {
    enabled: isEnabled && entityType === "ARTIFACT",
  });

  const initiativeQuery = useInitiative(safeOrgId, safeEntityId, {
    enabled: isEnabled && entityType === "INITIATIVE",
  });

  const projectQuery = useProject(organizationId, entityId, {
    enabled: isEnabled && entityType === "PROJECT",
  });

  const taskQuery = useWorkItem(safeOrgId, "task", safeEntityId, {
    enabled: isEnabled && entityType === "TASK",
  });

  const conversationQuery = useConversation(
    organizationId,
    projectId,
    {
      conversationId: safeEntityId,
    },
    {
      enabled: isEnabled && entityType === "CONVERSATION" && !!projectId,
    }
  );

  const messageQuery = useMessage(organizationId, projectId, entityId, {
    enabled: isEnabled && entityType === "MESSAGE" && !!projectId,
  });

  const designDocQuery = useDesignDoc(organizationId, entityId, {
    enabled: isEnabled && entityType === "DESIGN_DOC",
  });

  const agentSessionQuery = useAgentSession(
    organizationId,
    projectId,
    entityId,
    {
      enabled: isEnabled && entityType === "AGENT_SESSION",
    }
  );

  const serviceQuery = useService(organizationId, entityId, {
    enabled: isEnabled && entityType === "SERVICE",
  });

  const record = useMemo<TopologyEntityRecordData | null>(() => {
    switch (entityType) {
      case "ARTIFACT":
        return artifactQuery.data ?? null;
      case "INITIATIVE":
        return initiativeQuery.data ?? null;
      case "PROJECT":
        return projectQuery.data ?? null;
      case "TASK":
        return (taskQuery.workItem as TaskResponseDto) ?? null;
      case "MESSAGE":
        return messageQuery.data ?? null;
      case "CONVERSATION":
        return conversationQuery.data ?? null;
      case "DESIGN_DOC":
        return designDocQuery.data ?? null;
      case "AGENT_SESSION":
        return agentSessionQuery.data ?? null;
      case "SERVICE":
        return serviceQuery.data ?? null;
      default:
        return null;
    }
  }, [
    artifactQuery.data,
    initiativeQuery.data,
    projectQuery.data,
    taskQuery.workItem,
    messageQuery.data,
    conversationQuery.data,
    designDocQuery.data,
    agentSessionQuery.data,
    serviceQuery.data,
    entityType,
  ]);

  const [error, setError] = useState<Error | null>(null);

  const errorMessage = useMemo(() => {
    if (!entityType || !entityId) {
      return "Entity type and id are required.";
    }

    if (
      (entityType === "CONVERSATION" || entityType === "MESSAGE") &&
      !projectId
    ) {
      return "projectId is required for conversation and message entities.";
    }

    switch (entityType) {
      case "ARTIFACT":
        return artifactQuery.error?.message ?? null;
      case "INITIATIVE":
        return initiativeQuery.error?.message ?? null;
      case "PROJECT":
        return projectQuery.error?.message ?? null;
      case "TASK":
        return taskQuery.error?.message ?? null;
      case "MESSAGE":
        return messageQuery.error?.message ?? null;
      case "CONVERSATION":
        return conversationQuery.error?.message ?? null;
      case "DESIGN_DOC":
        return designDocQuery.error?.message ?? null;
      case "AGENT_SESSION":
        return agentSessionQuery.error?.message ?? null;
      case "SERVICE":
        return serviceQuery.error?.message ?? null;
      default:
        return `Unsupported entity type: ${entityType}`;
    }
  }, [
    artifactQuery.error,
    initiativeQuery.error,
    projectQuery.error,
    taskQuery.error,
    messageQuery.error,
    conversationQuery.error,
    designDocQuery.error,
    agentSessionQuery.error,
    serviceQuery.error,
    entityType,
    entityId,
    projectId,
  ]);

  useEffect(() => {
    if (errorMessage) {
      setError(new Error(errorMessage));
    } else {
      setError(null);
    }
  }, [errorMessage]);

  const isLoading = useMemo(() => {
    switch (entityType) {
      case "ARTIFACT":
        return artifactQuery.isLoading;
      case "INITIATIVE":
        return initiativeQuery.isLoading;
      case "PROJECT":
        return projectQuery.isLoading;
      case "TASK":
        return taskQuery.isLoading;
      case "MESSAGE":
        return messageQuery.isLoading;
      case "CONVERSATION":
        return conversationQuery.isLoading;
      case "DESIGN_DOC":
        return designDocQuery.isLoading;
      case "AGENT_SESSION":
        return agentSessionQuery.isLoading;
      case "SERVICE":
        return serviceQuery.isLoading;
      default:
        return false;
    }
  }, [
    artifactQuery.isLoading,
    initiativeQuery.isLoading,
    projectQuery.isLoading,
    taskQuery.isLoading,
    messageQuery.isLoading,
    conversationQuery.isLoading,
    designDocQuery.isLoading,
    agentSessionQuery.isLoading,
    serviceQuery.isLoading,
    entityType,
  ]);

  return {
    record,
    isLoading,
    error,
  };
}
