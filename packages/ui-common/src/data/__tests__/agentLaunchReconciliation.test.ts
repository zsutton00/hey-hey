import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import {
  AgentSessionStatus,
  ConversationStatus,
  WorkflowName,
} from "../../api";
import {
  launchConversation,
  launchScope,
  launchSession,
} from "../../test/planLaunchHarness";
import {
  reconcileAcceptedAgentLaunch,
  reconcileAgentSessionMutation,
} from "../agentLaunchReconciliation";
import { agentSessionKeys } from "../collections/agentSessions";
import { conversationKeys } from "../collections/conversations";

describe("agent launch reconciliation", () => {
  it("invalidates fresh detail and workflow query variants without inventing lifecycle status", () => {
    const queryClient = new QueryClient();
    const { organizationId, projectId } = launchScope;
    const sessionDetail = agentSessionKeys.detail(
      organizationId,
      projectId,
      launchScope.agentSessionId
    );
    const feed = agentSessionKeys.paginated(organizationId, projectId, {});
    queryClient.setQueryData(sessionDetail, launchSession);
    queryClient.setQueryData(feed, { pages: [], pageParams: [] });
    const detail = conversationKeys.envelope(
      organizationId,
      projectId,
      launchScope.conversationId,
      true
    );
    const workflow = conversationKeys.workflowList(organizationId, projectId, {
      workflowName: WorkflowName.PlanFromDesignDoc,
      workflowAboutId: "plan-launch",
    });
    const filtered = conversationKeys.workflowList(organizationId, projectId, {
      workflowName: WorkflowName.PlanFromDesignDoc,
      workflowAboutId: "plan-launch",
      status: ConversationStatus.Started,
    });
    const unrelated = conversationKeys.workflowList(
      organizationId,
      "other-project",
      {
        workflowName: WorkflowName.PlanFromDesignDoc,
        workflowAboutId: "other-plan",
      }
    );
    queryClient.setQueryData(detail, launchConversation);
    queryClient.setQueryData(workflow, [launchConversation]);
    for (const queryKey of [filtered, unrelated])
      queryClient.setQueryData(queryKey, []);

    reconcileAcceptedAgentLaunch(queryClient, launchScope);

    for (const key of [detail, workflow, filtered, sessionDetail, feed])
      expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(unrelated)?.isInvalidated).toBe(false);
    expect(
      queryClient.getQueryData<typeof launchConversation>(detail)?.status
    ).toBe(ConversationStatus.NotStarted);
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
      queryClient.getQueryData<(typeof launchSession)[]>(list)?.[0]?.machineId
    ).toBe("selected-machine");
    expect(
      queryClient.getQueryData(
        agentSessionKeys.detail(organizationId, projectId, launchSession.id)
      )
    ).toEqual(saved);
  });
});
