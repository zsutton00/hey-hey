import { EntityType } from "../../api";
import type { PathService } from "../../services";
import type {
  ActivityGanttEntityNode,
  ActivityGanttPlanScope,
} from "./activityGanttPrimitives";

interface ResolveEntityHrefInput {
  entityId: string;
  entityType: ActivityGanttEntityNode["entityType"];
  laneRole?: ActivityGanttEntityNode["laneRole"];
  projectId?: string;
  planScope?: ActivityGanttPlanScope;
  pathService: PathService;
}

export const resolveActivityGraphEntityHref = (
  input: ResolveEntityHrefInput,
): string | undefined => {
  const { entityId, entityType, projectId, planScope, pathService } = input;

  if (!projectId) {
    return undefined;
  }

  const planId = planScope?.planId;

  switch (entityType) {
    case EntityType.Task: {
      if (!planId) {
        return pathService.task({ projectId, taskId: entityId });
      }

      return pathService.planTask({
        projectId,
        planId,
        taskId: entityId,
      });
    }
    case EntityType.AgentSession:
      return resolveActivityGraphAgentSessionHref({
        agentSessionId: entityId,
        projectId,
        planScope,
        pathService,
      });
    case EntityType.Initiative:
      return pathService.initiativeDetail({
        projectId,
        initiativeId: entityId,
      });
    case EntityType.DesignDoc:
      return planId
        ? pathService.planDesignDoc({
            projectId,
            planId,
            designDocId: entityId,
          })
        : pathService.designDoc({
            projectId,
            designDocId: entityId,
          });
    case EntityType.Conversation:
      return pathService.conversation({
        projectId,
        conversationId: entityId,
      });
    case EntityType.Service:
      return pathService.service({
        projectId,
        serviceId: entityId,
      });
    case EntityType.Report:
      return pathService.report({ projectId, reportId: entityId });
    default:
      return pathService.activityDetail({
        projectId,
        entityType: String(entityType),
        entityId,
      });
  }
};

interface ResolveAgentSessionHrefInput {
  agentSessionId: string;
  projectId?: string;
  planScope?: ActivityGanttPlanScope;
  pathService: PathService;
}

export const resolveActivityGraphAgentSessionHref = (
  input: ResolveAgentSessionHrefInput,
): string | undefined => {
  const { agentSessionId, projectId, planScope, pathService } = input;

  if (!projectId) {
    return undefined;
  }

  const planId = planScope?.planId;
  if (planId && planScope?.stageId && planScope?.stepId) {
    return pathService.planAgentSession({
      projectId,
      planId,
      stageId: planScope.stageId,
      stepId: planScope.stepId,
      agentSessionId,
    });
  }

  return pathService.agentSession({
    projectId,
    agentSessionId,
  });
};
