import type { QueryClient } from "@tanstack/react-query";
import type { AgentSessionDto } from "../api";
import {
  agentSessionKeys,
  invalidateAgentSessionDetail,
  writeAgentSession,
} from "./collections/agentSessions";
import {
  invalidateConversation,
  invalidateConversationLists,
} from "./collections/conversations";
import { invalidateWithFollowUpRead } from "./query/invalidateWithFollowUpRead";

interface LaunchScope {
  organizationId: string;
  projectId: string;
  agentSessionId: string;
  conversationId: string;
}

/** Acceptance is launch evidence, not a fabricated lifecycle status. Refresh canonical reads. */
export function reconcileAcceptedAgentLaunch(
  queryClient: QueryClient,
  scope: LaunchScope
) {
  void invalidateAgentSessionDetail(
    queryClient,
    scope.organizationId,
    scope.projectId,
    scope.agentSessionId
  );
  void invalidateConversation(queryClient, scope.conversationId);
  void invalidateConversationLists(
    queryClient,
    scope.organizationId,
    scope.projectId
  );
  void invalidateWithFollowUpRead(queryClient, {
    queryKey: agentSessionKeys.paginatedLists(
      scope.organizationId,
      scope.projectId
    ),
  });
}

export function reconcileAgentSessionMutation(
  queryClient: QueryClient,
  scope: { organizationId: string; projectId: string },
  session: AgentSessionDto
) {
  writeAgentSession(queryClient, scope.organizationId, scope.projectId, session);
}
