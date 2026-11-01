import { reportKeys } from "../collections/reports";
import { projectKeys } from "../collections/projects";
import { userKeys } from "../collections/users";
import { organizationKeys } from "../collections/organizationsDirectory";
import { integrationKeys } from "../collections/integrations";
import { localRepoBindingKeys } from "../collections/localRepoBindings";
import { promptTemplateKeys } from "../collections/entityPromptTemplates";
import {
  initiativeKeys,
  initiativeListMatchesProject,
} from "../collections/initiatives";
import { artifactKeys } from "../collections/artifacts";
import { implementationHintKeys } from "../collections/implementationHints";
import { fileReferenceKeys } from "../collections/fileReferenceCandidates";
import { helpKeys } from "../collections/help";
import { topologyKeys } from "../collections/topologyKeys";
import { workItemGraphKeys } from "../collections/workItemGraphs";
import { entityContextKeys } from "../collections/entityContext";
import { userWorkflowKeys } from "../collections/workflowExecutions";
import { outboxEventKeys } from "../collections/outboxEvents";
import { llmRequestStatusKeys } from "../collections/llmRequestStatus";
import { controllerInventoryKeys } from "../collections/controllerInventory";
import { privateBetaAccessRequestKeys } from "../collections/privateBetaAccessRequests";
import { privateBetaAdmissionModeKeys } from "../collections/privateBetaAdmissionMode";
import { adminOrganizationMemberKeys } from "../collections/adminOrganizationMembers";
import { adminOrganizationDetailKeys } from "../collections/adminOrganizationDetail";
import { editHistoryKeys } from "../collections/editHistory";
import { fileHistoryKeys } from "../collections/fileTouchHistory";
import { designDocKeys } from "../collections/designDocs";
import { activityKeys } from "../collections/activityCorrelations";
import type { QueryClient } from "@tanstack/react-query";
import { proposalKeys } from "../collections/proposals";
import { agentSessionKeys } from "../collections/agentSessions";
import { attentionEventKeys } from "../collections/attentionEvents";
import { conversationCliStatusKeys } from "../collections/conversationCliStatus";
import { conversationKeys } from "../collections/conversations";
import { entityStarKeys } from "../collections/entityStars";
import { featureContentKeys } from "../collections/featureDocumentContent";
import { machineKeys } from "../collections/machines";
import { messageKeys } from "../collections/messages";
import { privateBetaDisclosureKeys } from "../collections/privateBetaDisclosure";
import { serviceKeys } from "../collections/services";
import {
  workItemDetailFilter,
  workItemKeys,
} from "../collections/workItemLists";
import { workItemReferenceKeys } from "../collections/workItemReferences";
import { workItemTypeKeys } from "../collections/workItemTypes";
import { notificationKeys } from "../collections/notifications";
import { openItemsKeys } from "../collections/openItems";
import { invalidateWithFollowUpRead } from "./invalidateWithFollowUpRead";

/** Every TanStack-backed Data Layer root. */
export const dataLayerQueryRoots = () => [
  reportKeys.root(),
  projectKeys.root(),
  userKeys.root(),
  organizationKeys.root(),
  integrationKeys.root(),
  localRepoBindingKeys.root(),

  promptTemplateKeys.root(),
  initiativeKeys.root(),
  artifactKeys.root(),
  implementationHintKeys.root(),
  fileReferenceKeys.root(),
  helpKeys.root(),

  topologyKeys.root(),
  workItemGraphKeys.root(),
  entityContextKeys.root(),
  userWorkflowKeys.root(),
  outboxEventKeys.root(),
  llmRequestStatusKeys.root(),
  controllerInventoryKeys.root(),
  privateBetaAccessRequestKeys.root(),
  privateBetaAdmissionModeKeys.root(),
  adminOrganizationMemberKeys.root(),
  adminOrganizationDetailKeys.root(),

  editHistoryKeys.root(),
  fileHistoryKeys.root(),
  designDocKeys.root(),
  activityKeys.root(),
  proposalKeys.root(),
  workItemTypeKeys.root(),
  workItemReferenceKeys.root(),
  featureContentKeys.root(),
  workItemKeys.root(),
  serviceKeys.root(),
  entityStarKeys.root(),
  machineKeys.root(),
  privateBetaDisclosureKeys.root(),
  conversationKeys.root(),
  messageKeys.root(),
  agentSessionKeys.root(),
  attentionEventKeys.root(),
  conversationCliStatusKeys.root(),
  notificationKeys.root(),
  openItemsKeys.root(),
];

/**
 * Reconnect / forced refresh: every migrated dataset is invalidated and only
 * mounted queries re-read. Work-item reads in flight are restarted, since
 * events may have been missed while disconnected. Open Items is only marked
 * stale: its hook owns the reconnect read, which also replays offline work.
 */
export function invalidateAllDataLayerQueries(
  queryClient: QueryClient,
): Promise<void> {
  const [workItemRoot] = workItemKeys.root();
  return Promise.all(
    dataLayerQueryRoots().map((queryKey) =>
      queryKey[0] === reportKeys.root()[0] ||
      queryKey[0] === projectKeys.root()[0] ||
      queryKey[0] === userKeys.root()[0] ||
      queryKey[0] === organizationKeys.root()[0] ||
      queryKey[0] === integrationKeys.root()[0] ||
      queryKey[0] === localRepoBindingKeys.root()[0] ||
      queryKey[0] === promptTemplateKeys.root()[0] ||
      queryKey[0] === initiativeKeys.root()[0] ||
      queryKey[0] === artifactKeys.root()[0] ||
      queryKey[0] === implementationHintKeys.root()[0] ||
      queryKey[0] === fileReferenceKeys.root()[0] ||
      queryKey[0] === helpKeys.root()[0] ||
      queryKey[0] === topologyKeys.root()[0] ||
      queryKey[0] === workItemGraphKeys.root()[0] ||
      queryKey[0] === entityContextKeys.root()[0] ||
      queryKey[0] === userWorkflowKeys.root()[0] ||
      queryKey[0] === outboxEventKeys.root()[0] ||
      queryKey[0] === llmRequestStatusKeys.root()[0] ||
      queryKey[0] === controllerInventoryKeys.root()[0] ||
      queryKey[0] === privateBetaAccessRequestKeys.root()[0] ||
      queryKey[0] === privateBetaAdmissionModeKeys.root()[0] ||
      queryKey[0] === adminOrganizationMemberKeys.root()[0] ||
      queryKey[0] === adminOrganizationDetailKeys.root()[0] ||
      queryKey[0] === editHistoryKeys.root()[0] ||
      queryKey[0] === fileHistoryKeys.root()[0] ||
      queryKey[0] === designDocKeys.root()[0] ||
      queryKey[0] === activityKeys.root()[0] ||
      queryKey[0] === workItemRoot ||
      queryKey[0] === proposalKeys.root()[0] ||
      queryKey[0] === agentSessionKeys.root()[0]
        ? invalidateWithFollowUpRead(queryClient, { queryKey })
        : queryKey[0] === openItemsKeys.root()[0]
          ? queryClient.invalidateQueries({ queryKey, refetchType: "none" })
          : queryClient.invalidateQueries({ queryKey }),
    ),
  ).then(() => undefined);
}

/**
 * A work item was created, changed, moved or removed: reference lists,
 * work-item lists and hierarchies in that project (or, without a project, the
 * whole organization) are invalidated. With a `taskId`, single-item reads are
 * scoped to that item (in any project, since project-less reads key under
 * `""`) and feature content to its by-id entries plus subtree reads (whose
 * membership or contents may include it); without one, every work-item and
 * feature-content read in scope is invalidated.
 *
 * Work-item reads already in flight are cancelled and restarted
 * (`invalidateWithFollowUpRead`): an earlier response never satisfies the
 * invalidation.
 */
export function invalidateProjectWorkItemQueries(
  queryClient: QueryClient,
  organizationId: string,
  projectId?: string,
  taskId?: string,
): Promise<void> {
  const scope =
    projectId === undefined
      ? {
          references: workItemReferenceKeys.all(organizationId),
          content: featureContentKeys.all(organizationId),
          workItems: workItemKeys.all(organizationId),
        }
      : {
          references: workItemReferenceKeys.project(organizationId, projectId),
          content: featureContentKeys.project(organizationId, projectId),
          workItems: workItemKeys.project(organizationId, projectId),
        };
  // Work-item keys are [root, org, project, kind, params | taskId, variant].
  const workItemFilters =
    taskId === undefined
      ? [{ queryKey: scope.workItems }]
      : [
          {
            queryKey: scope.workItems,
            predicate: ({ queryKey }: { queryKey: readonly unknown[] }) =>
              queryKey[3] === "list" || queryKey[3] === "hierarchy",
          },
          workItemDetailFilter(organizationId, taskId),
        ];
  // Content keys are [root, org, project, projection, "byId" | "subtree", id].
  const contentFilter =
    taskId === undefined
      ? { queryKey: scope.content }
      : {
          queryKey: scope.content,
          predicate: ({ queryKey }: { queryKey: readonly unknown[] }) =>
            queryKey[4] === "subtree" ||
            (queryKey[4] === "byId" && queryKey[5] === taskId),
        };
  return Promise.all([
    invalidateWithFollowUpRead(queryClient, {
      queryKey:
        projectId === undefined
          ? [...proposalKeys.root(), organizationId]
          : proposalKeys.project(organizationId, projectId),
    }),
    queryClient.invalidateQueries({ queryKey: scope.references }),
    ...workItemFilters.map((filter) =>
      invalidateWithFollowUpRead(queryClient, filter),
    ),
    queryClient.invalidateQueries(contentFilter),
  ]).then(() => undefined);
}

/** The legacy event identifies the entity but does not distinguish task from initiative. */
export function invalidateEditHistoryUpdated(
  queryClient: QueryClient,
  event: {
    type: "edit-history.updated";
    organizationId: string;
    initiativeId?: string;
  },
): Promise<void> {
  if (!event.initiativeId) return Promise.resolve();
  const entityId = event.initiativeId;
  return Promise.all(
    (["initiative", "task"] as const).map((entityType) =>
      invalidateWithFollowUpRead(queryClient, {
        queryKey: editHistoryKeys.entity(
          event.organizationId,
          entityType,
          entityId,
        ),
        exact: true,
      }),
    ),
  ).then(() => undefined);
}

/** One filter prevents overlapping detail/list invalidations from restarting each other. */
export function invalidateInitiativeChange(
  queryClient: QueryClient,
  organizationId: string,
  projectId?: string,
  initiativeId?: string,
): Promise<void> {
  return invalidateWithFollowUpRead(queryClient, {
    queryKey: initiativeKeys.all(organizationId),
    predicate: ({ queryKey }) => {
      if (queryKey[2] === "detail")
        return !!initiativeId && queryKey[3] === initiativeId;
      if (queryKey[2] !== "list") return false;
      return initiativeListMatchesProject(queryKey, projectId);
    },
  });
}
