/**
 * PathService - Centralized path generation for consistent routing
 */

import type {
  ActivityCorrelationActivityType,
  ActivityCorrelationMode,
  ActivityCorrelationSource,
  ActivityMetricContinuationDto,
  ActivityHistoryFilterDto,
  EntityType,
} from "../api";

export interface OnboardingParams {
  projectId: string;
  step?: string;
  totalSteps?: string;
  stepTitle?: string;
  isNew?: boolean;
}

export interface InitiativeDetailParams {
  projectId: string;
  initiativeId: string;
}

export interface DesignDocParams {
  projectId: string;
  designDocId: string;
  /**
   * When true, the generated path carries `?editing=true`, opening the design
   * doc directly in edit mode.
   */
  editing?: boolean;
}

export interface ArtifactParams {
  projectId: string;
  artifactId: string;
}

export interface PlanRouteParams {
  projectId: string;
  planId: string;
}

export interface ProjectInitiativesParams {
  projectId: string;
  search?: string;
}

export interface ProjectLandingParams {
  projectId: string;
}

export interface ProjectAgentsCodingParams {
  projectId: string;
}

export interface ProjectDocumentEditParams {
  projectId: string;
  documentId: string;
}

export interface OrganizationServiceParams {
  organizationId: string;
  serviceId: string;
}

export interface InitiativeEditParams {
  projectId: string;
  initiativeId: string;
  conversationId?: string;
}

export interface TaskParams {
  projectId: string;
  initiativeId?: string;
  taskId: string;
}

export interface GoalParams {
  projectId: string;
  taskId: string;
}

export interface EvalRunSetupParams {
  projectId: string;
  evalId: string;
}

export interface EvalRunParams {
  projectId: string;
  evalId: string;
  runId: string;
}

export interface FeatureParams {
  projectId: string;
  featureId: string;
}

export interface AgentSessionParams {
  projectId: string;
  agentSessionId: string;
}

export interface ConversationParams {
  projectId: string;
  conversationId: string;
}

export interface ResolveAgentSessionParams {
  projectId: string;
  conversationId: string;
}

export interface MessageParams {
  projectId: string;
  messageId: string;
}

export interface EntityConversationParams {
  projectId: string;
  agentSessionId: string;
  conversationId: string;
  entityId: string;
  entityType: string;
}

export interface ServiceParams {
  projectId: string;
  serviceId: string;
}

export interface PlanParams {
  projectId: string;
  planId: string;
  stageId?: string;
  stepId?: string;
}

export interface PlanStageParams {
  projectId: string;
  planId: string;
  stageId: string;
}

export interface PlanStepParams {
  projectId: string;
  planId: string;
  stageId: string;
  stepId: string;
}

export interface PlanTaskParams {
  projectId: string;
  planId: string;
  taskId: string;
  initiativeId?: string;
}

export interface PlanAgentSessionParams {
  projectId: string;
  planId: string;
  stageId: string;
  stepId: string;
  agentSessionId: string;
}

export interface PlanDesignDocParams {
  projectId: string;
  planId: string;
  designDocId: string;
}

export interface DesignDocAgentSessionParams {
  projectId: string;
  designDocId: string;
  agentSessionId: string;
}

export interface PlanDesignDocAgentSessionParams {
  projectId: string;
  planId: string;
  designDocId: string;
  agentSessionId: string;
  stageId?: string;
  stepId?: string;
}

export interface GeneralAgentSessionParams {
  projectId: string;
  agentSessionId: string;
  designDocId?: string;
}

export interface UserParams {
  projectId: string;
  userId: string;
}

export interface OrganizationUserParams {
  organizationId: string;
  userId: string;
}

export interface ProposalParams {
  projectId: string;
  proposalId: string;
  /**
   * When true, the generated path carries `?editing=true`, opening the
   * proposal directly in edit mode (the refiner chat).
   */
  editing?: boolean;
  /**
   * Internal application path to restore after proposal review.
   */
  returnTo?: string;
}

export interface ProposalGroupParams {
  projectId: string;
  groupId: string;
}

export interface ActivityDetailParams {
  projectId: string;
  entityType: string;
  entityId: string;
  /**
   * Internal application path to restore after viewing the activity detail.
   */
  returnTo?: string;
}

type OrganizationActivityQueryParamsCommon = {
  organizationId: string;
  viewScope?: "project" | "organization";
  projectId?: string;
  userId?: string;
  entityType?: EntityType[];
  activityMode?: ActivityCorrelationMode;
  activityType?: ActivityCorrelationActivityType[];
  source?: ActivityCorrelationSource[];
  serviceId?: string;
  since?: string;
  until?: string;
  affectsMe?: boolean;
  sinceLastVisit?: boolean;
  limit?: number;
  offset?: number;
};

export type OrganizationActivityFilterParams =
  OrganizationActivityQueryParamsCommon & {
    metricContinuation?: never;
    historyFilter?: never;
  };

export type OrganizationActivityMetricParams = {
  organizationId: string;
  viewScope?: "project" | "organization";
  metricContinuation: ActivityMetricContinuationDto;
  historyFilter?: never;
  projectId?: never;
  userId?: never;
  entityType?: never;
  activityMode?: never;
  activityType?: never;
  source?: never;
  serviceId?: never;
  since?: never;
  until?: never;
  affectsMe?: never;
  sinceLastVisit?: never;
  limit?: number;
  offset?: number;
};

export type OrganizationActivityParams =
  | OrganizationActivityFilterParams
  | OrganizationActivityMetricParams
  | (Omit<
      OrganizationActivityMetricParams,
      "metricContinuation" | "historyFilter"
    > & {
      metricContinuation?: never;
      historyFilter: ActivityHistoryFilterDto;
    });

export interface ReportParams {
  projectId: string;
  reportId: string;
}

export interface OrganizationReportParams {
  organizationId: string;
  reportId: string;
}

export interface PathService {
  onboarding(params: OnboardingParams): string;
  onboardingInitiative(params: InitiativeEditParams): string;
  initiativeDetail(params: InitiativeDetailParams): string;
  task(params: TaskParams): string;
  goal(params: GoalParams): string;
  evalRunSetup(params: EvalRunSetupParams): string;
  evalRun(params: EvalRunParams): string;
  evalRunResults(params: EvalRunParams): string;
  feature(params: FeatureParams): string;
  designDoc(params: DesignDocParams): string;
  agentSession(params: AgentSessionParams): string;
  conversation(params: ConversationParams): string;
  sessionlessConversation(params: ConversationParams): string;
  resolveAgentSession(params: ResolveAgentSessionParams): string;
  resolveMessageById(params: MessageParams): string;
  entityConversation(params: EntityConversationParams): string;
  service(params: ServiceParams): string;
  organizationService(params: OrganizationServiceParams): string;
  createProjectReport(projectId: string): string;
  report(params: ReportParams): string;
  organizationReport(params: OrganizationReportParams): string;
  artifact(params: ArtifactParams): string;
  proposal(params: ProposalParams): string;
  proposalGroup(params: ProposalGroupParams): string;
  returnToOnboarding(projectId: string): string;
  project(projectId: string): string;
  plan(params: PlanRouteParams): string;
  planPath(params: PlanParams): string;
  planStage(params: PlanStageParams): string;
  planStep(params: PlanStepParams): string;
  planTask(params: PlanTaskParams): string;
  planAgentSession(params: PlanAgentSessionParams): string;
  planDesignDoc(params: PlanDesignDocParams): string;
  designDocAgentSession(params: DesignDocAgentSessionParams): string;
  generalAgentSession(params: GeneralAgentSessionParams): string;
  planDesignDocAgentSession(params: PlanDesignDocAgentSessionParams): string;
  user(params: UserParams): string;
  organizationUser(params: OrganizationUserParams): string;
  activityDetail(params: ActivityDetailParams): string;
  organizationActivity(params: OrganizationActivityParams): string;
  returnToProject(projectId: string): string;
  projects(): string;
  projectInitiatives(params: ProjectInitiativesParams): string;
  projectLanding(params: ProjectLandingParams): string;
  projectAgentsCoding(params: ProjectAgentsCodingParams): string;
  projectDocumentEdit(params: ProjectDocumentEditParams): string;
  scratchpad(projectId: string): string;
  recentlyViewed(params: ProjectLandingParams): string;
  extractProjectId(pathname: string): string | null;
  isOnboardingPath(pathname: string): boolean;
  isInitiativeEditPath(pathname: string): boolean;
}

const buildQueryString = (searchParams: URLSearchParams): string =>
  searchParams.toString() ? `?${searchParams.toString()}` : "";

const setOptionalQueryParam = (
  searchParams: URLSearchParams,
  key: string,
  value: string | number | boolean | undefined,
): void => {
  if (value !== undefined) {
    searchParams.set(key, String(value));
  }
};

const setStableArrayQueryParam = <T extends string>(
  searchParams: URLSearchParams,
  key: string,
  values: T[] | undefined,
): void => {
  if (!values || values.length === 0) {
    return;
  }

  const normalizedValues = [...new Set(values)].sort();
  searchParams.set(key, normalizedValues.join(","));
};

const setMetricProjectIdsQueryParam = (
  searchParams: URLSearchParams,
  projectIds: string[],
): void => {
  if (projectIds.length === 0) {
    searchParams.set("projectIds", "");
    return;
  }

  projectIds.forEach((projectId) => {
    searchParams.append("projectIds", projectId);
  });
};

const defaultPathService: PathService = {
  onboarding(params: OnboardingParams): string {
    const basePath = `/projects/${params.projectId}/onboarding`;
    const searchParams = new URLSearchParams();

    if (params.step) {
      searchParams.set("step", params.step);
    }
    if (params.totalSteps) {
      searchParams.set("totalSteps", params.totalSteps);
    }
    if (params.stepTitle) {
      searchParams.set("stepTitle", params.stepTitle);
    }
    if (params.isNew) {
      searchParams.set("isNew", "t");
    }

    return `${basePath}${buildQueryString(searchParams)}`;
  },

  onboardingInitiative(params: InitiativeEditParams): string {
    const basePath = `/projects/${params.projectId}/onboarding/initiatives/${params.initiativeId}`;
    const searchParams = new URLSearchParams();
    if (params.conversationId) {
      searchParams.set("conversationId", params.conversationId);
    }

    return `${basePath}${buildQueryString(searchParams)}`;
  },

  initiativeDetail(params: InitiativeDetailParams): string {
    return `/projects/${params.projectId}/initiatives/${params.initiativeId}`;
  },

  task(params: TaskParams): string {
    return `/projects/${params.projectId}/tasks/${params.taskId}`;
  },

  goal(params: GoalParams): string {
    return this.task({
      projectId: params.projectId,
      taskId: params.taskId,
    });
  },

  evalRunSetup(params: EvalRunSetupParams): string {
    return `/projects/${params.projectId}/evals/${params.evalId}/runs/new`;
  },

  evalRun(params: EvalRunParams): string {
    return `/projects/${params.projectId}/evals/${params.evalId}/runs/${params.runId}`;
  },

  evalRunResults(params: EvalRunParams): string {
    return `${this.evalRun(params)}/results`;
  },

  feature(params: FeatureParams): string {
    return `/projects/${params.projectId}/features/${params.featureId}`;
  },

  designDoc(params: DesignDocParams): string {
    const basePath = `/projects/${params.projectId}/design-docs/${params.designDocId}`;
    const searchParams = new URLSearchParams();
    if (params.editing) {
      searchParams.set("editing", "true");
    }
    return `${basePath}${buildQueryString(searchParams)}`;
  },

  agentSession(params: AgentSessionParams): string {
    return `/projects/${params.projectId}/resolve-agent-session-by-id/${params.agentSessionId}`;
  },

  conversation(params: ConversationParams): string {
    return this.resolveAgentSession(params);
  },

  sessionlessConversation(params: ConversationParams): string {
    return `/projects/${params.projectId}/sessionless-conversations/${params.conversationId}`;
  },

  resolveAgentSession(params: ResolveAgentSessionParams): string {
    return `/projects/${params.projectId}/resolve-agent-session/${params.conversationId}`;
  },

  resolveMessageById(params: MessageParams): string {
    return `/projects/${params.projectId}/resolve-message/${params.messageId}`;
  },

  entityConversation(params: EntityConversationParams): string {
    const searchParams = new URLSearchParams();
    searchParams.set("entityId", params.entityId);
    searchParams.set("entityType", params.entityType);
    return `/projects/${params.projectId}/agent-sessions/${
      params.agentSessionId
    }/entity-conversations/${params.conversationId}?${searchParams.toString()}`;
  },

  service(params: ServiceParams): string {
    return `/projects/${params.projectId}/services/${params.serviceId}`;
  },

  organizationService(params: OrganizationServiceParams): string {
    return `/organizations/${params.organizationId}/services/${params.serviceId}`;
  },

  createProjectReport(projectId: string): string {
    return `/projects/${projectId}/reports/new`;
  },

  report(params: ReportParams): string {
    return `/projects/${params.projectId}/reports/${params.reportId}`;
  },

  organizationReport(params: OrganizationReportParams): string {
    return `/organizations/${params.organizationId}/reports/${params.reportId}`;
  },

  artifact(params: ArtifactParams): string {
    return `/projects/${params.projectId}/artifacts/${params.artifactId}`;
  },

  proposal(params: ProposalParams): string {
    const basePath = `/projects/${params.projectId}/proposals/${params.proposalId}`;
    const searchParams = new URLSearchParams();
    if (params.editing) {
      searchParams.set("editing", "true");
    }
    if (params.returnTo !== undefined) {
      if (
        !params.returnTo.startsWith("/") ||
        params.returnTo.startsWith("//")
      ) {
        throw new Error(
          "Proposal returnTo must be an internal application path.",
        );
      }
      searchParams.set("returnTo", params.returnTo);
    }
    return `${basePath}${buildQueryString(searchParams)}`;
  },

  proposalGroup(params: ProposalGroupParams): string {
    return `/projects/${params.projectId}/proposal-groups/${params.groupId}`;
  },

  returnToOnboarding(projectId: string): string {
    return this.onboarding({ projectId });
  },

  project(projectId: string): string {
    return `/projects/${projectId}`;
  },

  plan({ planId, projectId }: PlanRouteParams): string {
    return `/projects/${projectId}/plans/${planId}`;
  },

  planPath(params: PlanParams): string {
    const basePath = `/projects/${params.projectId}/plans/${params.planId}`;
    const searchParams = new URLSearchParams();
    if (params.stageId) {
      searchParams.set("stage", params.stageId);
    }
    if (params.stepId) {
      searchParams.set("step", params.stepId);
    }

    return `${basePath}${buildQueryString(searchParams)}`;
  },

  planStage(params: PlanStageParams): string {
    return `/projects/${params.projectId}/plans/${params.planId}/stages/${params.stageId}`;
  },

  planStep(params: PlanStepParams): string {
    return `/projects/${params.projectId}/plans/${params.planId}/stages/${params.stageId}/steps/${params.stepId}`;
  },

  planTask(params: PlanTaskParams): string {
    const basePath = this.task({
      projectId: params.projectId,
      taskId: params.taskId,
      ...(params.initiativeId ? { initiativeId: params.initiativeId } : {}),
    });
    const searchParams = new URLSearchParams();
    searchParams.set("planId", params.planId);
    return `${basePath}${buildQueryString(searchParams)}`;
  },

  planAgentSession(params: PlanAgentSessionParams): string {
    return `/projects/${params.projectId}/plans/${params.planId}/stages/${params.stageId}/steps/${params.stepId}/agent-sessions/${params.agentSessionId}`;
  },

  planDesignDoc(params: PlanDesignDocParams): string {
    const basePath = this.designDoc({
      projectId: params.projectId,
      designDocId: params.designDocId,
    });
    const searchParams = new URLSearchParams();
    searchParams.set("planId", params.planId);
    return `${basePath}${buildQueryString(searchParams)}`;
  },

  designDocAgentSession(params: DesignDocAgentSessionParams): string {
    return `/projects/${params.projectId}/design-docs/${params.designDocId}?tab=sessions&sessionId=${params.agentSessionId}`;
  },

  generalAgentSession(params: GeneralAgentSessionParams): string {
    const searchParams = new URLSearchParams();
    searchParams.set("sessionId", params.agentSessionId);
    if (params.designDocId) {
      searchParams.set("designDocId", params.designDocId);
    }
    return `/projects/${
      params.projectId
    }/agent-sessions?${searchParams.toString()}`;
  },

  planDesignDocAgentSession(params: PlanDesignDocAgentSessionParams): string {
    const searchParams = new URLSearchParams();
    searchParams.set("planId", params.planId);
    searchParams.set("tab", "sessions");
    searchParams.set("sessionId", params.agentSessionId);
    if (params.stageId) {
      searchParams.set("stageId", params.stageId);
    }
    if (params.stepId) {
      searchParams.set("stepId", params.stepId);
    }
    return `/projects/${params.projectId}/design-docs/${
      params.designDocId
    }?${searchParams.toString()}`;
  },

  user(params: UserParams): string {
    return `/projects/${params.projectId}/users/${params.userId}`;
  },

  organizationUser(params: OrganizationUserParams): string {
    return `/organizations/${params.organizationId}/users/${params.userId}`;
  },

  activityDetail(params: ActivityDetailParams): string {
    const basePath = `/projects/${params.projectId}/activities/${params.entityType}-${params.entityId}`;
    const searchParams = new URLSearchParams();

    if (params.returnTo !== undefined) {
      if (
        !params.returnTo.startsWith("/") ||
        params.returnTo.startsWith("//")
      ) {
        throw new Error(
          "Activity detail returnTo must be an internal application path.",
        );
      }
      searchParams.set("returnTo", params.returnTo);
    }

    return `${basePath}${buildQueryString(searchParams)}`;
  },

  organizationActivity(params: OrganizationActivityParams): string {
    const searchParams = new URLSearchParams();
    setOptionalQueryParam(searchParams, "viewScope", params.viewScope);

    if (params.historyFilter !== undefined) {
      searchParams.set("historyFilter", JSON.stringify(params.historyFilter));
    } else if (params.metricContinuation !== undefined) {
      searchParams.set("metric", params.metricContinuation.metric);
      setMetricProjectIdsQueryParam(
        searchParams,
        params.metricContinuation.projectIds,
      );
      searchParams.set("windowStart", params.metricContinuation.windowStart);
      searchParams.set("windowEnd", params.metricContinuation.windowEnd);
      searchParams.set("actorScope", params.metricContinuation.actorScope.mode);
      if (params.metricContinuation.actorScope.mode === "PERSONAL") {
        searchParams.set(
          "actorUserId",
          params.metricContinuation.actorScope.userId,
        );
      }
    } else {
      setOptionalQueryParam(searchParams, "projectId", params.projectId);
      setOptionalQueryParam(searchParams, "userId", params.userId);
      setStableArrayQueryParam(searchParams, "entityType", params.entityType);
      setOptionalQueryParam(searchParams, "activityMode", params.activityMode);
      setStableArrayQueryParam(
        searchParams,
        "activityType",
        params.activityType,
      );
      setStableArrayQueryParam(searchParams, "source", params.source);
      setOptionalQueryParam(searchParams, "serviceId", params.serviceId);
      setOptionalQueryParam(searchParams, "since", params.since);
      setOptionalQueryParam(searchParams, "until", params.until);
      setOptionalQueryParam(searchParams, "affectsMe", params.affectsMe);
      setOptionalQueryParam(
        searchParams,
        "sinceLastVisit",
        params.sinceLastVisit,
      );
    }

    setOptionalQueryParam(searchParams, "limit", params.limit);
    setOptionalQueryParam(searchParams, "offset", params.offset);

    return `/organizations/${params.organizationId}/activity${buildQueryString(
      searchParams,
    )}`;
  },

  returnToProject(projectId: string): string {
    return `/projects/${projectId}`;
  },

  projects(): string {
    return "/projects";
  },

  projectInitiatives(params: ProjectInitiativesParams): string {
    const basePath = `/projects/${params.projectId}/initiatives`;
    const searchParams = new URLSearchParams();
    if (params.search) {
      searchParams.set("search", params.search);
    }
    return `${basePath}${buildQueryString(searchParams)}`;
  },

  projectLanding(params: ProjectLandingParams): string {
    return `/projects/${params.projectId}/landing`;
  },

  projectAgentsCoding(params: ProjectAgentsCodingParams): string {
    const searchParams = new URLSearchParams();
    searchParams.set("view", "coding");
    searchParams.set("tab", "agents");
    return `${this.project(params.projectId)}${buildQueryString(searchParams)}`;
  },

  projectDocumentEdit(params: ProjectDocumentEditParams): string {
    return `/projects/${params.projectId}/documents/${params.documentId}/edit`;
  },

  scratchpad(projectId: string): string {
    return `/projects/${projectId}/scratchpad`;
  },

  recentlyViewed(params: ProjectLandingParams): string {
    return `/projects/${params.projectId}/recently-viewed`;
  },

  extractProjectId(pathname: string): string | null {
    const match = pathname.match(/\/projects\/([^/]+)/);
    return match ? match[1] : null;
  },

  isOnboardingPath(pathname: string): boolean {
    return pathname.includes("/onboarding");
  },

  isInitiativeEditPath(pathname: string): boolean {
    return (
      pathname.includes("/onboarding/initiatives/") &&
      pathname.includes("/edit")
    );
  },
};

let activePathService: PathService = defaultPathService;

export const getPathService = (): PathService => activePathService;

export const setPathService = (pathService: PathService): void => {
  activePathService = pathService;
};

export const resetPathService = (): void => {
  activePathService = defaultPathService;
};

export class WebPathService {
  /**
   * Generate onboarding path
   */
  static onboarding(params: OnboardingParams): string {
    return getPathService().onboarding(params);
  }

  /**
   * Generate initiative edit path
   */
  static onboardingInitiative(params: InitiativeEditParams): string {
    return getPathService().onboardingInitiative(params);
  }

  /**
   * Generate initiative detail path
   */
  static initiativeDetail(params: InitiativeDetailParams): string {
    return getPathService().initiativeDetail(params);
  }

  /**
   * Generate task edit path
   */
  static task(params: TaskParams): string {
    return getPathService().task(params);
  }

  /**
   * Generate goal detail path
   */
  static goal(params: GoalParams): string {
    return getPathService().goal(params);
  }

  /**
   * Generate the path of an Eval's run setup page
   */
  static evalRunSetup(params: EvalRunSetupParams): string {
    return getPathService().evalRunSetup(params);
  }

  /**
   * Generate the path of one Eval run's progress page
   */
  static evalRun(params: EvalRunParams): string {
    return getPathService().evalRun(params);
  }

  /**
   * Generate the path of one finished Eval run's results page
   */
  static evalRunResults(params: EvalRunParams): string {
    return getPathService().evalRunResults(params);
  }

  /**
   * Generate feature detail path
   */
  static feature(params: FeatureParams): string {
    return getPathService().feature(params);
  }

  /**
   * Generate design document edit path
   */
  static designDoc(params: DesignDocParams): string {
    return getPathService().designDoc(params);
  }

  /**
   * Generate coding session detail path
   */
  static agentSession(params: AgentSessionParams): string {
    return getPathService().agentSession(params);
  }

  /**
   * Generate conversation detail path
   */
  static conversation(params: ConversationParams): string {
    return getPathService().conversation(params);
  }

  /**
   * Generate the raw conversation destination after confirming it has no owner.
   */
  static sessionlessConversation(params: ConversationParams): string {
    return getPathService().sessionlessConversation(params);
  }

  /**
   * Generate the route that resolves a conversation to its owning agent session.
   */
  static resolveAgentSession(params: ResolveAgentSessionParams): string {
    return getPathService().resolveAgentSession(params);
  }

  /**
   * Generate path that resolves a message ID to its conversation (and agent
   * session, when one is associated with that conversation).
   */
  static resolveMessageById(params: MessageParams): string {
    return getPathService().resolveMessageById(params);
  }

  /**
   * Generate entity conversation path (dedicated agent-session-backed renderer)
   */
  static entityConversation(params: EntityConversationParams): string {
    return getPathService().entityConversation(params);
  }

  /**
   * Generate service detail path
   */
  static service(params: ServiceParams): string {
    return getPathService().service(params);
  }

  /**
   * Generate organization service detail path
   */
  static organizationService(params: OrganizationServiceParams): string {
    return getPathService().organizationService(params);
  }

  /**
   * Generate report detail path.
   */
  static createProjectReport(projectId: string): string {
    return getPathService().createProjectReport(projectId);
  }

  static report(params: ReportParams): string {
    return getPathService().report(params);
  }

  /**
   * Generate organization-scoped report detail path.
   */
  static organizationReport(params: OrganizationReportParams): string {
    return getPathService().organizationReport(params);
  }

  /**
   * Generate artifact path
   */
  static artifact(params: ArtifactParams): string {
    return getPathService().artifact(params);
  }

  /**
   * Generate proposal detail path
   */
  static proposal(params: ProposalParams): string {
    return getPathService().proposal(params);
  }

  /**
   * Generate proposal group review path.
   */
  static proposalGroup(params: ProposalGroupParams): string {
    return getPathService().proposalGroup(params);
  }

  /**
   * Generate return path from initiative edit back to onboarding
   */
  static returnToOnboarding(projectId: string): string {
    return getPathService().returnToOnboarding(projectId);
  }

  /**
   * Generate return path from initiative edit back to active project
   */
  static project(projectId: string): string {
    return getPathService().project(projectId);
  }

  /**
   * Generate return path from initiative edit back to active project
   */
  static plan(params: PlanRouteParams): string {
    return getPathService().plan(params);
  }

  /**
   * Generate plan path, optionally targeting a stage and step.
   */
  static planPath(params: PlanParams): string {
    return getPathService().planPath(params);
  }

  /**
   * Generate plan stage path.
   */
  static planStage(params: PlanStageParams): string {
    return getPathService().planStage(params);
  }

  /**
   * Generate plan step path.
   */
  static planStep(params: PlanStepParams): string {
    return getPathService().planStep(params);
  }

  /**
   * Generate task path scoped to a plan context.
   */
  static planTask(params: PlanTaskParams): string {
    return getPathService().planTask(params);
  }

  /**
   * Generate coding session path scoped to a plan context.
   */
  static planAgentSession(params: PlanAgentSessionParams): string {
    return getPathService().planAgentSession(params);
  }

  /**
   * Generate design doc path scoped to a plan context.
   */
  static planDesignDoc(params: PlanDesignDocParams): string {
    return getPathService().planDesignDoc(params);
  }

  static designDocAgentSession(params: DesignDocAgentSessionParams): string {
    return getPathService().designDocAgentSession(params);
  }

  static planDesignDocAgentSession(
    params: PlanDesignDocAgentSessionParams,
  ): string {
    return getPathService().planDesignDocAgentSession(params);
  }

  static generalAgentSession(params: GeneralAgentSessionParams): string {
    return getPathService().generalAgentSession(params);
  }

  /**
   * Generate activity detail path.
   */
  static user(params: UserParams): string {
    return getPathService().user(params);
  }

  static organizationUser(params: OrganizationUserParams): string {
    return getPathService().organizationUser(params);
  }

  static activityDetail(params: ActivityDetailParams): string {
    return getPathService().activityDetail(params);
  }

  static organizationActivity(params: OrganizationActivityParams): string {
    return getPathService().organizationActivity(params);
  }

  /**
   * Generate return path from initiative edit back to active project
   */
  static returnToProject(projectId: string): string {
    return getPathService().returnToProject(projectId);
  }

  /**
   * Generate projects root path.
   */
  static projects(): string {
    return getPathService().projects();
  }

  /**
   * Generate initiatives list path.
   */
  static projectInitiatives(params: ProjectInitiativesParams): string {
    return getPathService().projectInitiatives(params);
  }

  /**
   * Generate project landing path.
   */
  static projectLanding(params: ProjectLandingParams): string {
    return getPathService().projectLanding(params);
  }

  /**
   * Generate the project Agents destination with Coding selected.
   */
  static projectAgentsCoding(params: ProjectAgentsCodingParams): string {
    return getPathService().projectAgentsCoding(params);
  }

  /**
   * Generate project document edit path.
   */
  static projectDocumentEdit(params: ProjectDocumentEditParams): string {
    return getPathService().projectDocumentEdit(params);
  }

  /**
   * Extract project ID from current path
   */
  static scratchpad(projectId: string): string {
    return getPathService().scratchpad(projectId);
  }

  /**
   * Generate project-scoped recently viewed page path.
   */
  static recentlyViewed(params: ProjectLandingParams): string {
    return getPathService().recentlyViewed(params);
  }

  static extractProjectId(pathname: string): string | null {
    return getPathService().extractProjectId(pathname);
  }

  /**
   * Check if current path is in onboarding flow
   */
  static isOnboardingPath(pathname: string): boolean {
    return getPathService().isOnboardingPath(pathname);
  }

  /**
   * Check if current path is initiative edit
   */
  static isInitiativeEditPath(pathname: string): boolean {
    return getPathService().isInitiativeEditPath(pathname);
  }
}

export { defaultPathService };
