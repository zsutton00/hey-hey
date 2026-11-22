import type { ApolloClient } from "@apollo/client";
import type { QueryClient } from "@tanstack/react-query";
import type { AgentSessionDto } from "../api";
import {
  agentSessionKeys,
  invalidateAgentSessionDetail,
  writeAgentSession,
} from "./collections/agentSessions";
import {
  refreshConversation,
  refreshConversationLists,
} from "./graphql/conversationCache";
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
  graphqlClient: ApolloClient,
  scope: LaunchScope,
) {
  void invalidateAgentSessionDetail(
    queryClient,
    scope.organizationId,
    scope.projectId,
    scope.agentSessionId,
  );
  void refreshConversation(graphqlClient, scope.conversationId);
  void refreshConversationLists(graphqlClient);
  void invalidateWithFollowUpRead(queryClient, {
    queryKey: agentSessionKeys.paginatedLists(
      scope.organizationId,
      scope.projectId,
    ),
  });
}

export function reconcileAgentSessionMutation(
  queryClient: QueryClient,
  scope: { organizationId: string; projectId: string },
  session: AgentSessionDto,
) {
  writeAgentSession(
    queryClient,
    scope.organizationId,
    scope.projectId,
    session,
  );
}
