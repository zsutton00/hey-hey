import {
  EntityType,
  type ActivateOpenItemRequest,
  type OpenItemPresentation,
  type OpenItemsTriageItem,
} from "../../api";
import {
  agentSessionsClient,
  conversationsClient,
  designDocsClient,
  entityContextClient,
  proposalsClient,
  unifiedApiClient,
} from "../../clients/serviceClients";

/** Fetch only on explicit reopen, using canonical presentation rather than the
 * reply's display snapshot. Held items never pass through activation. */
export async function triageReopenRequest(
  scope: { organizationId: string; projectId: string },
  item: OpenItemsTriageItem,
  idempotencyKey: string,
): Promise<ActivateOpenItemRequest> {
  const ref = { entityType: item.entityType, entityId: item.entityId };
  let lineage: ActivateOpenItemRequest["lineage"] = [];
  const presentation = await (async (): Promise<OpenItemPresentation> => {
    switch (item.entityType) {
      case EntityType.Task: {
        const task = (
          await unifiedApiClient.getTask({ ...scope, taskId: item.entityId })
        ).data.data;
        if (!task || task.status === "ARCHIVED")
          throw new Error("This work item is no longer available.");
        const context = (
          await entityContextClient.getEntityContext({
            ...scope,
            entityType: EntityType.Task,
            entityId: item.entityId,
            includeRelatedEntities: false,
            includeProposals: false,
            includeAvailableMcpTools: false,
            includePlan: true,
          })
        ).data.data;
        if (!context)
          throw new Error("This work item's ancestry is unavailable.");
        // Match canonical task activation: plan, stage, distinct parent, self.
        const planId = context.planContext?.parentPlan?.id;
        const stageId = context.planContext?.parentStage?.id;
        lineage = [
          ...new Set(
            [planId, stageId, task.parentTaskId, task.id].filter(
              (id): id is string => !!id,
            ),
          ),
        ].map((entityId) => ({ entityType: EntityType.Task, entityId }));
        const route =
          task.type === "GOAL"
            ? "goal"
            : task.type === "PLAN"
              ? "plan"
              : "task";
        return {
          label: task.name,
          workItemTypeKey: task.type,
          agentSessionType: null,
          routeParams: { workItemRoute: route },
        };
      }
      case EntityType.DesignDoc: {
        const doc = (
          await designDocsClient.getDesignDoc({
            ...scope,
            designDocId: item.entityId,
          })
        ).data.data;
        if (!doc) throw new Error("This design doc is no longer available.");
        return {
          label: doc.name,
          workItemTypeKey: null,
          agentSessionType: null,
          routeParams: {},
        };
      }
      case EntityType.Conversation: {
        const conversation = (
          await conversationsClient.getConversation({
            ...scope,
            conversationId: item.entityId,
          })
        ).data.data;
        if (!conversation?.title)
          throw new Error("This conversation's presentation is unavailable.");
        return {
          label: conversation.title,
          workItemTypeKey: null,
          agentSessionType: null,
          routeParams: {},
        };
      }
      case EntityType.AgentSession: {
        const session = (
          await agentSessionsClient.getAgentSession({
            ...scope,
            agentSessionId: item.entityId,
          })
        ).data.data;
        if (!session) throw new Error("This session is no longer available.");
        return {
          label: session.title,
          workItemTypeKey: null,
          agentSessionType: session.type,
          routeParams: {},
        };
      }
      case EntityType.Proposal: {
        const proposal = (
          await proposalsClient.getProposal({
            ...scope,
            proposalId: item.entityId,
          })
        ).data.data;
        if (!proposal?.title)
          throw new Error("This proposal's presentation is unavailable.");
        return {
          label: proposal.title,
          workItemTypeKey: null,
          agentSessionType: null,
          routeParams: {},
        };
      }
      default:
        throw new Error("This entity cannot be reopened in Open Items.");
    }
  })();
  return { idempotencyKey, item: ref, lineage, presentation };
}
