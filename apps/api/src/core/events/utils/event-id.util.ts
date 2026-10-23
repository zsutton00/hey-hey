// Extract projectId and conversationId from various ServiceEvent shapes
import {
  ConversationId,
  DesignDocId,
  InitiativeId,
  OrganizationId,
  ProjectId,
  UserId,
} from 'src/types';
import { ExecutionContext } from 'src/types/execution-context';
import {
  ServiceEvent,
  isConversationEvents,
  isDesignDocEvents,
  isInitiativeEvents,
  isLLMEvents,
  isMessageCreatedEvent,
  isMessageUpdatedEvent,
  isImplementationHintEvents,
  isAgentSessionEvents,
  isProposalEvents,
  isProposalGroupEvents,
  isProjectEvents,
  isOrganizationEvents,
  isReportEvents,
  isMessageRealtimeEvent,
  isSubfacetEvents,
  isTaskEvents,
  isMachineRevokedEvent,
  isGitHubWebhookEvents,
  isHelpEvents,
} from '../types/domain-events';

export interface ExtractedIds {
  projectId?: ProjectId;
  conversationId?: ConversationId;
  organizationId: OrganizationId;
  initiativeId?: InitiativeId;
  designDocId?: DesignDocId;
  userId?: UserId;
}

/**
 * Derive projectId and conversationId from a ServiceEvent using its well-known
 * structure. Falls back to common payload fields if type guards don't match.
 */
export function extractEventIds(event: ServiceEvent): ExtractedIds {
  if (isHelpEvents(event)) {
    return {} as ExtractedIds;
  }

  // Machine events are not org-scoped, and the realtime bridge has no machine
  // handler — so these ids are never consumed for routing. Handle them up front
  // so the narrowing below can assume every remaining event carries an org on
  // its payload (the structural contract every other ServiceEvent shares).
  if (isMachineRevokedEvent(event)) {
    return {
      organizationId: '' as OrganizationId,
      userId: event.payload.userId as UserId,
    };
  }

  // All events have organizationId on payload (from ExecutionContext)
  const organizationId = event.payload.organizationId;

  // 1. Conversation events – aggregateId is the conversationId
  if (isConversationEvents(event)) {
    const conversationId = event.aggregateId;
    const projectId = event.payload.projectId;
    const userId = event.payload.userId;
    return { projectId, conversationId, organizationId, userId };
  }

  // 2. Message events – created/updated variants
  if (isMessageCreatedEvent(event)) {
    const msg = event.payload.message;

    return {
      projectId: msg?.projectId,
      conversationId: msg?.conversationId,
      userId: msg?.userId as UserId | undefined,
      organizationId,
    };
  }

  if (isMessageUpdatedEvent(event)) {
    return {
      projectId: event.payload.projectId,
      conversationId: event.payload.conversationId ?? undefined,
      userId: event.payload.userId,
      organizationId,
    };
  }

  if (isMessageRealtimeEvent(event)) {
    return {
      projectId: event.payload.projectId,
      conversationId: event.payload.conversationId,
      userId: event.payload.userId,
      organizationId,
    };
  }

  // 3. Project events – aggregateId is the projectId
  if (isProjectEvents(event)) {
    return {
      projectId: event.aggregateId,
      organizationId,
      userId: event.payload.userId,
    };
  }

  if (isOrganizationEvents(event)) {
    return { organizationId };
  }

  if (isGitHubWebhookEvents(event)) {
    return {
      organizationId,
      projectId: event.payload.projectId,
    };
  }

  // 4. LLM events carry ids in payload
  if (isLLMEvents(event)) {
    return {
      projectId: event.payload.projectId,
      conversationId: event.payload.conversationId ?? undefined,
      organizationId,
      userId: event.payload.userId,
    };
  }

  // 5. Task events – aggregateId is the taskId, initiativeId in payload
  if (isTaskEvents(event)) {
    const p = event.payload;
    return {
      organizationId,
      initiativeId: p.initiativeId,
      projectId: p.projectId,
      userId: event.payload.userId,
    };
  }

  // 6. Initiative events – aggregateId is the initiativeId
  if (isInitiativeEvents(event)) {
    const p = event.payload;
    return {
      initiativeId: event.aggregateId,
      organizationId,
      userId: event.payload.userId,
      projectId: p.projectId,
    };
  }

  // 7. Design doc events – aggregateId is the design doc ID
  if (isDesignDocEvents(event)) {
    return {
      organizationId,
      projectId: event.payload.projectId,
      designDocId: event.aggregateId as DesignDocId,
      userId: event.payload.userId,
    };
  }

  if (isImplementationHintEvents(event)) {
    const payload = event.payload as ExecutionContext;
    return {
      organizationId,
      projectId: payload.projectId,
      userId: payload.userId,
    };
  }

  if (isAgentSessionEvents(event)) {
    const payload = event.payload as {
      projectId?: ProjectId;
      conversationId?: ConversationId | null;
      userId?: UserId;
      agentSession?: {
        conversationId?: string;
        userId?: string;
      };
    };
    return {
      organizationId,
      projectId: payload.projectId,
      conversationId:
        payload.conversationId ??
        (payload.agentSession?.conversationId as ConversationId | undefined) ??
        undefined,
      userId:
        (payload.agentSession?.userId as UserId | undefined) ?? payload.userId,
    };
  }

  if (isProposalEvents(event)) {
    const payload = event.payload as ExecutionContext;
    return {
      organizationId,
      projectId: payload.projectId,
      conversationId: payload.conversationId ?? undefined,
      userId: payload.userId,
    };
  }

  if (isProposalGroupEvents(event)) {
    return {
      organizationId,
      projectId: event.payload.projectId,
    };
  }

  if (isReportEvents(event)) {
    const payload = event.payload as ExecutionContext & {
      report?: {
        projectId?: ProjectId | null;
      };
    };
    return {
      organizationId,
      projectId: payload.projectId ?? payload.report?.projectId ?? undefined,
      userId: payload.userId,
    };
  }

  if (isSubfacetEvents(event)) {
    const payload = event.payload as ExecutionContext;
    return {
      organizationId,
      projectId: payload.projectId,
      userId: event.payload.userId,
    };
  }

  // 8. Generic fallback – look at common payload fields

  const p = event.payload as ExecutionContext;
  return {
    projectId: p.projectId,
    userId: event.payload.userId,
    conversationId: p.conversationId ?? undefined,
    organizationId,
  };
}
