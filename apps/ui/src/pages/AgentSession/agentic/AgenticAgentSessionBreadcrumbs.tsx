import {
  useFullEntityContext,
  useService,
  useTaskHierarchy,
} from "@hey-hey/ui-common/data";
import { compose } from "@hey-hey/ui-common/i18n";
import { WebPathService } from "@hey-hey/ui-common/services";
import { EntityType, type TaskResponseDto } from "@hey-hey/ui-common/api";
import type { BreadcrumbItem } from "@hey-hey/ui-common/utils";

import { PageBreadcrumbs } from "../../../components/Layout";
import {
  buildTaskBreadcrumbItems,
  getStructuralFeatureAncestors,
} from "../../../components/TaskBreadcrumbs";
import { useFeatureAncestors } from "../../../components/useFeatureAncestors";
import { buildAgentSessionLabel } from "./agentSessionLabel";

interface AgenticAgentSessionBreadcrumbTaskData {
  id: string;
  name: string;
  type?: string;
  initiativeId?: string | null;
}

interface AgenticAgentSessionBreadcrumbAgentSessionData {
  title?: string | null;
  initiativeId?: string | null;
  service?: {
    name?: string | null;
  } | null;
}

interface AgenticAgentSessionBreadcrumbsProps {
  routeFamily: "project" | "plan" | "task";
  organizationId: string;
  projectId: string;
  projectName?: string;
  planId?: string;
  planPath: string;
  planTitle?: string | null;
  stepPath: string;
  stepCrumbTitle: string;
  initiativeName?: string | null;
  taskData: AgenticAgentSessionBreadcrumbTaskData | null;
  taskCodingTabPath: string | null;
  agentSession: AgenticAgentSessionBreadcrumbAgentSessionData;
  serviceId: string | null;
}

export const AgenticAgentSessionBreadcrumbs = ({
  routeFamily,
  organizationId,
  projectId,
  projectName,
  planId,
  planPath,
  planTitle,
  stepPath,
  stepCrumbTitle,
  taskData,
  agentSession,
  serviceId,
}: AgenticAgentSessionBreadcrumbsProps) => {
  const embeddedServiceName = agentSession.service?.name?.trim();
  const shouldFetchService = Boolean(
    organizationId && serviceId?.trim() && !embeddedServiceName
  );
  const serviceQuery = useService(organizationId, serviceId ?? undefined, {
    enabled: shouldFetchService,
    preferStale: true,
  });

  const shouldFetchHierarchy = Boolean(routeFamily === "task" && taskData?.id);
  const { hierarchy } = useTaskHierarchy(
    organizationId,
    projectId,
    taskData?.id ?? "",
    {
      enabled: shouldFetchHierarchy,
      includeAgentSessionCounts: false,
      includeDesignDocCounts: false,
    }
  );

  const cachedAncestry = useFeatureAncestors({
    organizationId,
    projectId,
    task: hierarchy?.task,
    parent: hierarchy?.parent,
  });
  // The entity-context read is only the fallback for chains the cached
  // hierarchy cannot resolve.
  const { data: fallbackContext } = useFullEntityContext({
    organizationId,
    projectId,
    entityType: EntityType.Task,
    entityId: hierarchy?.task?.id ?? "",
    enabled: cachedAncestry.needsFallback,
    includeRelatedEntities: false,
    includeFeatureHierarchy: true,
    includeProposals: false,
    includeAvailableMcpTools: false,
  });
  const featureAncestors = cachedAncestry.isFromCache
    ? cachedAncestry.ancestors
    : getStructuralFeatureAncestors(fallbackContext?.featureHierarchy);

  const serviceName = embeddedServiceName || serviceQuery.data?.name?.trim();
  const parentLabel =
    routeFamily === "task"
      ? hierarchy?.task?.name ?? taskData?.name ?? undefined
      : routeFamily === "plan"
      ? stepCrumbTitle
      : undefined;
  const sessionLabel = buildAgentSessionLabel(
    agentSession,
    serviceName,
    parentLabel
  );

  // Task route family — use shared TaskBreadcrumbs items
  if (routeFamily === "task" && hierarchy?.task) {
    const items = buildTaskBreadcrumbItems({
      projectId,
      projectName,
      task: hierarchy.task as TaskResponseDto,
      parent: hierarchy.parent,
      featureAncestors,
      childLabel: sessionLabel,
      childType: "agent_session",
      childTypeLabel: "coding session",
    });
    return <PageBreadcrumbs items={items} />;
  }

  // Plan and project route families
  const items: BreadcrumbItem[] = [
    { label: "Projects", to: "/projects", type: "project" },
    {
      label: projectName ?? compose("{{term.Project}}"),
      to: `/projects/${projectId}`,
      type: "project",
      kind: "project",
    },
  ];

  if (routeFamily === "plan" && planId) {
    items.push({
      label: planTitle ?? "Plan",
      to: planPath,
      type: "plan",
    });
    items.push({
      label: stepCrumbTitle,
      to: stepPath,
      type: "step",
    });
  } else if (taskData) {
    items.push({
      label: taskData.name,
      to: WebPathService.task({ projectId, taskId: taskData.id }),
      type: "task",
      entityId: taskData.id,
    });
  }

  items.push({
    label: sessionLabel,
    isCurrent: true,
    type: "agent_session",
    kind: "entity",
    typeLabel: "coding session",
  });

  return <PageBreadcrumbs items={items} />;
};
