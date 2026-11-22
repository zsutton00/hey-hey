import { useApolloClient } from "@apollo/client/react";
import { QueryClient, useQueryClient } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  AgentSessionCurrentState,
  AgentSessionStatus,
  AgentSessionType,
  EntityType,
  WorkflowName,
  type AgentSessionDto,
} from "../../api";
import {
  toOpenApiAgentSessionId,
  toOpenApiOrganizationId,
  toOpenApiProjectId,
} from "../../clients/contractIdentifierAdapters";
import {
  conversationNode,
  FakeConversationServer,
  threadOf,
} from "../../test/conversationGraphQL";
import { useConversation } from "../hooks/useConversation";
import { useConversations } from "../hooks/useConversations";
import { useWorkflowConversations } from "../hooks/useWorkflowConversations";
import {
  reconcileAcceptedAgentLaunch,
  reconcileAgentSessionMutation,
} from "../agentLaunchReconciliation";
import { agentSessionKeys } from "../collections/agentSessions";

const launchScope = {
  organizationId: "org-1",
  projectId: "project-1",
  agentSessionId: "session-launch",
  conversationId: conversationNode.id,
};
const launchSession = {
  id: toOpenApiAgentSessionId(launchScope.agentSessionId),
  organizationId: toOpenApiOrganizationId(launchScope.organizationId),
  projectId: toOpenApiProjectId(launchScope.projectId),
  userId: "user-launch",
  machineId: "machine-launch",
  type: AgentSessionType.PlanGeneration,
  status: AgentSessionStatus.InProgress,
  currentState: AgentSessionCurrentState.Idle,
  sessionDate: "2026-09-01T00:00:00Z",
  conversationId: launchScope.conversationId,
  entityType: EntityType.Task,
  entityId: "plan-launch",
  createdAt: "2026-09-01T00:00:00Z",
  updatedAt: "2026-09-01T00:00:00Z",
  monitoringEnabled: false,
  autoDecide: false,
  hasUnsyncedChanges: false,
  title: "Plan generation",
} satisfies AgentSessionDto;

describe("agent launch reconciliation", () => {
  it("refreshes the launched conversation, its lists and the session reads without inventing lifecycle status", async () => {
    const server = new FakeConversationServer(threadOf(1));
    const { organizationId, projectId } = launchScope;
    const { result } = renderHook(
      () => ({
        detail: useConversation("org-1", "project-1", {
          conversationId: conversationNode.id,
        }),
        list: useConversations("org-1", "project-1"),
        workflow: useWorkflowConversations(
          "org-1",
          "project-1",
          WorkflowName.PlanFromDesignDoc,
          "plan-launch",
        ),
        client: useApolloClient(),
        queryClient: useQueryClient(),
      }),
      { wrapper: server.wrapper },
    );
    await waitFor(() => {
      expect(result.current.detail.isReady).toBe(true);
      expect(result.current.list.isReady).toBe(true);
      expect(result.current.workflow.isReady).toBe(true);
    });
    const { queryClient, client } = result.current;
    const sessionDetail = agentSessionKeys.detail(
      organizationId,
      projectId,
      launchScope.agentSessionId,
    );
    const feed = agentSessionKeys.paginated(organizationId, projectId, {});
    queryClient.setQueryData(sessionDetail, launchSession);
    queryClient.setQueryData(feed, { pages: [], pageParams: [] });
    const reads = (name: string) => server.received(name).length;
    const before = {
      detail: reads("GetConversation"),
      list: reads("GetActiveConversations"),
      workflow: reads("GetWorkflowConversations"),
    };

    reconcileAcceptedAgentLaunch(queryClient, client, launchScope);

    await waitFor(() => {
      expect(reads("GetConversation")).toBeGreaterThan(before.detail);
      expect(reads("GetActiveConversations")).toBeGreaterThan(before.list);
      expect(reads("GetWorkflowConversations")).toBeGreaterThan(
        before.workflow,
      );
    });
    for (const key of [sessionDetail, feed]) {
      expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true);
    }
    expect(result.current.detail.data?.status).toBe(conversationNode.status);
    expect(queryClient.getQueryData(sessionDetail)).toBe(launchSession);
  });

  it("propagates a saved session through the detail and every list holding it", () => {
    const queryClient = new QueryClient();
    const { organizationId, projectId } = launchScope;
    const list = agentSessionKeys.list(organizationId, projectId, {
      conversationId: launchScope.conversationId,
    });
    queryClient.setQueryData(list, [launchSession]);
    const saved = {
      ...launchSession,
      machineId: "selected-machine",
      status: AgentSessionStatus.InProgress,
    };
    reconcileAgentSessionMutation(queryClient, launchScope, saved);
    expect(
      queryClient.getQueryData<(typeof launchSession)[]>(list)?.[0]?.machineId,
    ).toBe("selected-machine");
    expect(
      queryClient.getQueryData(
        agentSessionKeys.detail(organizationId, projectId, launchSession.id),
      ),
    ).toEqual(saved);
  });
});
