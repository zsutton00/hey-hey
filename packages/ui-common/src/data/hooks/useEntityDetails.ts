import { useState, useEffect } from "react";
import type {
  AgentSessionDto,
  ConversationResponseDto,
  InitiativeResponseDto,
  DesignDocResponseDto,
  MessageRecordDto,
  ProposalResponseDto,
  ReportDto,
  ServiceDto,
  TaskResponseDto,
} from "../../api";
import { useInitiative } from "./useInitiative";
import { useDesignDoc } from "./useDesignDoc";
import { useWorkItem } from "./useWorkItem";
import { useService } from "./useService";
import { useMessage } from "./useMessage";
import { useConversation } from "./useConversation";
import { useAgentSession } from "./useAgentSession";
import { useReport } from "./useReport";
import { useProposal } from "./useProposal";
import { resolvePreviewEntityType } from "../../utils/mentionFormatting";
import type { WorkItemResponseDto } from "../collections/workItems";
import { isPlanWorkItem, type PlanWorkItem } from "../plans/canonicalPlan";

export type EntityDetailsData =
  | InitiativeResponseDto
  | DesignDocResponseDto
  | WorkItemResponseDto
  | ServiceDto
  | MessageRecordDto
  | ConversationResponseDto
  | AgentSessionDto
  | PlanWorkItem
  | ProposalResponseDto
  | ReportDto;

export interface UseEntityDetailsParams {
  entityId: string;
  entityType: string;
  organizationId: string;
  projectId?: string;
  includeEdges?: boolean;
  enabled: boolean;
}

export interface UseEntityDetailsReturn {
  data: EntityDetailsData | null;
  isLoading: boolean;
  error: Error | null;
}

export const useEntityDetails = ({
  entityId,
  entityType,
  organizationId,
  projectId,
  includeEdges,
  enabled: enabledParam,
}: UseEntityDetailsParams): UseEntityDetailsReturn => {
  // A disabled or ID-less lookup never fetches, so it must not surface errors
  // cached under its (empty) query key either.
  const enabled = enabledParam && !!entityId;
  const [error, setError] = useState<Error | null>(null);
  const baseEntityType = resolvePreviewEntityType(entityType);

  const initiativeResult = useInitiative(
    organizationId,
    baseEntityType === "initiative" && enabled ? entityId : "",
    { enabled: baseEntityType === "initiative" && enabled }
  );

  const designDocResult = useDesignDoc(
    organizationId,
    baseEntityType === "design_doc" && enabled ? entityId : "",
    { enabled: baseEntityType === "design_doc" && enabled }
  );

  const isWorkItemType = baseEntityType === "task" || baseEntityType === "plan";
  const taskResult = useWorkItem(
    organizationId,
    "task",
    isWorkItemType && enabled ? entityId : "",
    {
      enabled: isWorkItemType && enabled,
      projectId,
      includeEdges,
    }
  );

  const serviceResult = useService(
    organizationId,
    baseEntityType === "service" && enabled ? entityId : undefined,
    { enabled: baseEntityType === "service" && enabled }
  );

  const isMessageType = baseEntityType === "message";
  const messageResult = useMessage(
    isMessageType && enabled ? organizationId : undefined,
    isMessageType && enabled ? projectId : undefined,
    isMessageType && enabled ? entityId : undefined,
    { enabled: isMessageType && enabled }
  );

  const isAgentSessionType = baseEntityType === "agent_session";
  const agentSessionResult = useAgentSession(
    isAgentSessionType && enabled ? organizationId : undefined,
    isAgentSessionType && enabled ? projectId : undefined,
    isAgentSessionType && enabled ? entityId : undefined,
    { enabled: isAgentSessionType && enabled }
  );

  const isConversationType = baseEntityType === "conversation";
  const conversationResult = useConversation(
    isConversationType && enabled ? organizationId : undefined,
    isConversationType && enabled ? projectId : undefined,
    { conversationId: isConversationType && enabled ? entityId : "" },
    {
      enabled: isConversationType && enabled && !!entityId,
      enablePolling: false,
    }
  );

  const isPlanType = baseEntityType === "plan";

  const isReportType = baseEntityType === "report";
  const reportResult = useReport(
    isReportType && enabled ? organizationId : undefined,
    isReportType && enabled ? entityId : undefined,
    { enabled: isReportType && enabled }
  );

  const isProposalType = baseEntityType === "proposal";
  const proposalResult = useProposal(
    isProposalType && enabled ? organizationId : undefined,
    isProposalType && enabled ? projectId : undefined,
    isProposalType && enabled ? entityId : undefined,
    { enabled: isProposalType && enabled }
  );

  let data: EntityDetailsData | null = null;
  let isLoading = false;

  let errorMsg: string | null = null;
  if (baseEntityType === "initiative") {
    data = initiativeResult.data as InitiativeResponseDto | null;
    isLoading = initiativeResult.isLoading;
    if (initiativeResult.error?.message) {
      errorMsg = initiativeResult.error.message;
    }
  } else if (baseEntityType === "design_doc") {
    data = designDocResult.data as DesignDocResponseDto | null;
    isLoading = designDocResult.isLoading;
    if (designDocResult.error?.message) {
      errorMsg = designDocResult.error.message;
    }
  } else if (baseEntityType === "task") {
    data = taskResult.workItem as TaskResponseDto | null;
    isLoading = taskResult.isLoading;
    if (taskResult.error?.message) {
      errorMsg = taskResult.error.message;
    }
  } else if (baseEntityType === "service") {
    data = serviceResult.data as ServiceDto | null;
    isLoading = serviceResult.isLoading;
    if (serviceResult.error?.message) {
      errorMsg = serviceResult.error.message;
    }
  } else if (isMessageType) {
    data = messageResult.data;
    isLoading = messageResult.isLoading;
    if (messageResult.error?.message) {
      errorMsg = messageResult.error.message;
    }
  } else if (isConversationType) {
    data = conversationResult.data;
    isLoading = conversationResult.isLoading;
    if (conversationResult.error?.message) {
      errorMsg = conversationResult.error.message;
    }
  } else if (isAgentSessionType) {
    data = agentSessionResult.data;
    isLoading = agentSessionResult.isLoading;
    if (agentSessionResult.error?.message) {
      errorMsg = agentSessionResult.error.message;
    }
  } else if (isPlanType) {
    const candidate = taskResult.workItem;
    data = candidate && isPlanWorkItem(candidate) ? candidate : null;
    isLoading = taskResult.isLoading;
    if (taskResult.error?.message) {
      errorMsg = taskResult.error.message;
    } else if (
      taskResult.isFetched &&
      candidate &&
      !isPlanWorkItem(candidate)
    ) {
      errorMsg = "The requested entity is not a canonical Plan.";
    }
  } else if (isReportType) {
    data = reportResult.data;
    isLoading = reportResult.isLoading;
    if (reportResult.error?.message) {
      errorMsg = reportResult.error.message;
    }
  } else if (isProposalType) {
    data = proposalResult.proposal;
    isLoading = proposalResult.isLoading;
    if (proposalResult.error?.message) {
      errorMsg = proposalResult.error.message;
    }
  } else {
    errorMsg = `Entity type "${entityType}" not yet supported for preview`;
  }

  if (!enabled) {
    errorMsg = null;
  }

  useEffect(() => {
    setError(errorMsg ? new Error(errorMsg) : null);
  }, [errorMsg]);

  return {
    data,
    isLoading,
    error,
  };
};
