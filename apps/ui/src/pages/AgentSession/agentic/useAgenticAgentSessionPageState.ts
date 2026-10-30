import type { RunAttachmentReference } from "@hey-hey/ui-common/api";
import {
  AgentSessionType,
  type LocalPromptPlanInput,
  EntityType,
  WorkflowName,
} from "@hey-hey/ui-common/api";
import { WebPathService } from "@hey-hey/ui-common";
import { getTaskSectionContent } from "@hey-hey/ui-common/utils";
import {
  type AgentProvider,
  type SessionMethodSelection,
} from "@hey-hey/ui-common/agent-sessions-runtime";
import {
  isMachineExecutionReady,
  type SessionLaunchOptions,
} from "@hey-hey/ui-common/components";
import {
  isTask,
  type WorkItemResponseDto,
  useAgentSession,
  useConversation,
  useInitiative,
  useCanonicalPlanAggregate,
  useFullEntityContext,
  useProject,
  useUserPairedMachines,
  useWorkItem,
} from "@hey-hey/ui-common/data";
import { useUserIdentity } from "@hey-hey/ui-common/hooks";
import { useCallback, useMemo, useState } from "react";
import { flushSync } from "react-dom";
import { useLocation, useParams, useSearchParams } from "react-router-dom";
import {
  buildPlanDetailPath,
  buildPlanStepPath,
} from "../../Plan/planSessionRoutes";
import { buildTaskPathWithAgentTab } from "../../Task/taskSessionRoutes";
import {
  isProvider,
  resolveAgenticLaunchContext,
  type TaskLaunchSource,
} from "./agenticRuntimeUtils";

type AgenticPageMode = "setup" | "active" | "validation";

export interface AgenticSetupReadState {
  loading: boolean;
  fetched: boolean;
  error: string | null;
}

export const resolveAgenticSetupReadState = ({
  requiresTask,
  taskLoading,
  taskFetched,
  taskError,
  requiresContext,
  contextFetched,
  contextError,
  requiresPlan,
  planLoading,
  planError,
}: {
  requiresTask: boolean;
  taskLoading: boolean;
  taskFetched: boolean;
  taskError: string | null;
  requiresContext: boolean;
  contextFetched: boolean;
  contextError: string | null;
  requiresPlan: boolean;
  planLoading: boolean;
  planError: string | null;
}): AgenticSetupReadState => ({
  loading:
    (requiresTask && !taskFetched && !taskError && taskLoading) ||
    (requiresContext && !contextFetched && !contextError) ||
    (requiresPlan && planLoading),
  fetched:
    (!requiresTask || taskFetched || Boolean(taskError)) &&
    (!requiresContext || contextFetched || Boolean(contextError)) &&
    (!requiresPlan || !planLoading),
  error:
    (requiresTask ? taskError : null) ??
    (requiresContext ? contextError : null) ??
    (requiresPlan ? planError : null),
});

export interface AgenticSetupLaunchContext {
  planData: LocalPromptPlanInput | null;
  planWorktreeBranch: string | null;
  launchSource: TaskLaunchSource;
  launchPlanId: string | null;
  launchStepId: string | null;
  launchStageId: string | null;
}

export interface AgenticAgentSessionPageState {
  organizationId: string | null;
  userId: string | null;
  pathname: string;
  projectId: string | undefined;
  routeTaskId: string | undefined;
  planId: string | undefined;
  stageId: string | undefined;
  stepId: string | undefined;
  agentSessionId: string | undefined;
  projectQuery: ReturnType<typeof useProject>;
  agentSessionQuery: ReturnType<typeof useAgentSession>;
  taskQuery: ReturnType<typeof useWorkItem>;
  planQuery: ReturnType<typeof useCanonicalPlanAggregate>;
  setupRead: AgenticSetupReadState;
  initiativeQuery: ReturnType<typeof useInitiative>;
  agentSession: ReturnType<typeof useAgentSession>["agentSession"];
  taskData: WorkItemResponseDto | null;
  hasRequiredRouteParams: boolean;
  mode: AgenticPageMode;
  onPromptSubmitted: (
    selection: SessionMethodSelection,
    launchOptions: SessionLaunchOptions,
    promptDraft: string,
    attachments: RunAttachmentReference[],
  ) => void;
  conversationTitle: string | null;
  nodeDecisionWorkflowName: WorkflowName | undefined;
  sessionModel: string | null;
  sessionReasoningEffort: string | null;
  sessionMachineId: string | null;
  /**
   * Launch kickoff text the user authored in the wizard's step 3 (Submit
   * Prompt). Threaded into CodingSession as `initialPromptDraft` so the
   * surface auto-dispatches the start-run once on mount. Null on page
   * reload (URL doesn't carry it), which suppresses any auto-dispatch.
   */
  pendingInitialPromptDraft: string | null;
  pendingInitialPromptAttachments: RunAttachmentReference[];
  onInitialPromptAccepted: () => void;
  planPath: string;
  stepPath: string;
  taskOverviewPath: string | null;
  taskCodingTabPath: string | null;
  serviceId: string | null;
  taskServiceIds: string[];
  provider: AgentProvider | null;
  planWorktreeBranch: string | null;
  planData: LocalPromptPlanInput | null;
  planTitle: string | null;
  stepCrumbTitle: string;
  launchSource: TaskLaunchSource;
  launchPlanId: string | null;
  launchStepId: string | null;
  launchStageId: string | null;
}

export interface AgenticAgentSessionRouteContext {
  organizationId?: string;
  projectId?: string;
  taskId?: string;
  planId?: string;
  stageId?: string;
  stepId?: string;
  agentSessionId?: string;
  preview?: boolean;
}

export const resolveTaskServiceIds = (
  task: { serviceRelations?: readonly { serviceId: string }[] } | null,
): string[] =>
  (task?.serviceRelations ?? []).map((relation) => relation.serviceId);

export const resolveAgentSessionTaskId = ({
  routeTaskId,
  agentSessionEntityType,
  agentSessionEntityId,
}: {
  routeTaskId?: string;
  agentSessionEntityType?: EntityType | null;
  agentSessionEntityId?: string | null;
}): string | null => {
  if (routeTaskId) return routeTaskId;
  if (agentSessionEntityType !== EntityType.Task) return null;
  return agentSessionEntityId ?? null;
};

export const resolveCanonicalPlanWorktreeBranch = ({
  planId,
  aggregate,
}: {
  planId: string | undefined;
  aggregate: {
    plan: { id: string };
    configuration: { worktreeBranch: string | null };
  } | null;
}): string | null =>
  planId && aggregate?.plan.id === planId
    ? aggregate.configuration.worktreeBranch
    : null;

export const resolveSessionMachineId = ({
  routeMachineId,
  submittedMachineId,
  persistedMachineId,
  executionReadyMachineIds,
  machinesReady,
}: {
  routeMachineId: string | null;
  submittedMachineId: string | null;
  persistedMachineId?: string | null;
  executionReadyMachineIds: readonly string[];
  machinesReady: boolean;
}): string | null => {
  const explicitMachineId = [
    routeMachineId,
    submittedMachineId,
    persistedMachineId ?? null,
  ].find((machineId): machineId is string => Boolean(machineId?.trim()));

  if (explicitMachineId) return explicitMachineId;
  if (machinesReady && executionReadyMachineIds.length === 1) {
    return executionReadyMachineIds[0] ?? null;
  }
  return null;
};

export const captureSetupLaunchContext = ({
  planData,
  planWorktreeBranch,
  launchContext,
}: {
  planData: LocalPromptPlanInput | null;
  planWorktreeBranch: string | null;
  launchContext: Omit<
    AgenticSetupLaunchContext,
    "planData" | "planWorktreeBranch"
  >;
}): AgenticSetupLaunchContext => ({
  planData,
  planWorktreeBranch,
  ...launchContext,
});

export const useAgenticAgentSessionPageState = (
  _routeFamily: "project" | "plan" | "task",
  routeContext?: AgenticAgentSessionRouteContext,
): AgenticAgentSessionPageState => {
  const { currentOrgId, userId } = useUserIdentity() || {};
  const organizationId = routeContext?.organizationId ?? currentOrgId ?? null;

  const location = useLocation();

  const {
    projectId: routeProjectId,
    taskId: routeTaskIdParam,
    planId: routePlanId,
    stageId: routeStageId,
    stepId: routeStepId,
    agentSessionId: routeAgentSessionId,
  } = useParams<{
    projectId: string;
    initiativeId?: string;
    taskId?: string;
    planId?: string;
    stageId?: string;
    stepId?: string;
    agentSessionId: string;
  }>();

  const projectId = routeContext?.projectId ?? routeProjectId;
  const routeTaskId = routeContext?.taskId ?? routeTaskIdParam;
  const explicitPlanId = routeContext?.planId ?? routePlanId;
  const explicitStageId = routeContext?.stageId ?? routeStageId;
  const stepId = routeContext?.stepId ?? routeStepId;
  const agentSessionId = routeContext?.agentSessionId ?? routeAgentSessionId;
  const preview = routeContext?.preview ?? false;

  const [routeSearchParams, setRouteSearchParams] = useSearchParams();
  const [previewSearchParams, setPreviewSearchParams] = useState(
    () => new URLSearchParams(),
  );
  const searchParams = preview ? previewSearchParams : routeSearchParams;

  const projectQuery = useProject(organizationId ?? undefined, projectId, {
    enabled: Boolean(organizationId && projectId),
    preferStale: true,
  });

  const agentSessionQuery = useAgentSession(
    organizationId ?? undefined,
    projectId,
    agentSessionId,
    {
      enabled: Boolean(organizationId && agentSessionId),
    },
  );

  const agentSession = agentSessionQuery.agentSession;

  const pairedMachinesQuery = useUserPairedMachines();
  const executionReadyMachineIds = useMemo(
    () =>
      pairedMachinesQuery.machines
        .filter(isMachineExecutionReady)
        .map((machine) => machine.machineId),
    [pairedMachinesQuery.machines],
  );

  // The conversation carries the durable workflow identity, set server-side and
  // surviving a page reload that drops the `sessionMethod` query params. We feed
  // it to the coding session so node decisions (e.g. plan approval) keep working
  // post-reload. The flags mirror AgentConversationView's so this dedupes onto
  // the same cached fetch rather than triggering a second one.
  const sessionConversationId = agentSession?.conversationId ?? null;
  const conversationQuery = useConversation(
    organizationId ?? undefined,
    projectId,
    { conversationId: sessionConversationId ?? "" },
    {
      enabled: Boolean(organizationId && projectId && sessionConversationId),
      includeSuggestionDecisions: true,
    },
  );
  const nodeDecisionWorkflowName: WorkflowName | undefined =
    conversationQuery.data?.workflowName;

  const setupOrActive = searchParams.get("mode");
  const hasBoundConfiguration = Boolean(
    agentSession?.provider &&
    (agentSession.launchServiceId ||
      nodeDecisionWorkflowName === WorkflowName.FeatureSync),
  );
  const isValidationSession =
    agentSession?.type === AgentSessionType.Validation;
  const mode: AgenticPageMode = isValidationSession
    ? "validation"
    : setupOrActive === "setup"
      ? "setup"
      : hasBoundConfiguration
        ? "active"
        : "setup";

  const agentSessionTaskId = resolveAgentSessionTaskId({
    routeTaskId,
    agentSessionEntityType: agentSession?.entityType,
    agentSessionEntityId: agentSession?.entityId,
  });
  const taskQuery = useWorkItem(
    organizationId ?? "",
    "task",
    agentSessionTaskId ?? "__noop__",
    {
      projectId,
      enabled: Boolean(organizationId && projectId && agentSessionTaskId),
      includeServiceRelations: true,
    },
  );

  const taskData =
    taskQuery.workItem && isTask(taskQuery.workItem)
      ? taskQuery.workItem
      : null;

  const taskContextQuery = useFullEntityContext({
    organizationId: organizationId ?? "",
    projectId: projectId ?? "",
    entityType: EntityType.Task,
    entityId: taskData?.id ?? "",
    enabled: Boolean(organizationId && projectId && taskData?.id),
    includeRelatedEntities: false,
    includeFeatureHierarchy: false,
    includeProposals: false,
    includeAvailableMcpTools: false,
  });
  const taskContext = taskContextQuery.data;
  const planId = explicitPlanId ?? taskContext?.planContext?.parentPlan?.id;
  const stageId = explicitStageId ?? taskContext?.planContext?.parentStage?.id;
  const planQuery = useCanonicalPlanAggregate(
    organizationId ?? "",
    projectId ?? "",
    mode === "setup" ? (planId ?? "") : "",
  );
  const canonicalPlan = planQuery.aggregate?.plan;

  const initiativeQuery = useInitiative(
    organizationId ?? "",
    taskData?.initiativeId ?? "",
    {
      enabled: Boolean(organizationId && taskData?.initiativeId),
    },
  );

  const hasRequiredRouteParams = Boolean(
    organizationId && projectId && agentSessionId,
  );

  const sessionModel = searchParams.get("sessionModel");
  const sessionReasoningEffort = searchParams.get("sessionReasoningEffort");
  const [submittedMachineId, setSubmittedMachineId] = useState<string | null>(
    null,
  );
  const sessionMachineId = resolveSessionMachineId({
    routeMachineId: searchParams.get("sessionMachineId"),
    submittedMachineId,
    persistedMachineId: agentSession?.machineId,
    executionReadyMachineIds,
    machinesReady: pairedMachinesQuery.isReady,
  });

  // Holds the kickoff text the user authored in the wizard's step 3 (Submit
  // Prompt). Flowed into CodingSession on the next mount as
  // `initialPromptDraft` so the surface auto-dispatches the start-run once.
  // Kept in component state (not the URL) so a page reload does not re-fire
  // the dispatch — the session is already IN_PROGRESS by then.
  const [pendingLaunch, setPendingLaunch] = useState<{
    agentSessionId: string;
    prompt: string;
    attachments: RunAttachmentReference[];
  } | null>(null);
  const currentLaunch =
    pendingLaunch?.agentSessionId === agentSessionId ? pendingLaunch : null;
  const pendingInitialPromptDraft = currentLaunch?.prompt ?? null;
  const pendingInitialPromptAttachments = currentLaunch?.attachments ?? [];
  const onInitialPromptAccepted = useCallback(() => {
    setPendingLaunch((current) =>
      current?.agentSessionId === agentSessionId ? null : current,
    );
  }, [agentSessionId]);

  const setupPlanData = useMemo(() => {
    if (!planId || canonicalPlan?.id !== planId) return null;
    return {
      id: canonicalPlan.id,
      title: canonicalPlan.name,
      description:
        getTaskSectionContent(canonicalPlan.sections, "description") ??
        undefined,
    };
  }, [canonicalPlan, planId]);
  const setupPlanWorktreeBranch = resolveCanonicalPlanWorktreeBranch({
    planId,
    aggregate: planQuery.aggregate,
  });
  const setupLaunchContext = useMemo(
    () => resolveAgenticLaunchContext({ planId, stepId, stageId }),
    [planId, stageId, stepId],
  );
  const requiresSetupTask = mode === "setup" && Boolean(agentSessionTaskId);
  const requiresSetupContext =
    mode === "setup" && Boolean(taskData?.id) && !explicitPlanId;
  const requiresSetupPlan = mode === "setup" && Boolean(planId);
  const setupRead = resolveAgenticSetupReadState({
    requiresTask: requiresSetupTask,
    taskLoading: taskQuery.isLoading,
    taskFetched: taskQuery.isFetched,
    taskError: taskQuery.error?.message ?? null,
    requiresContext: requiresSetupContext,
    contextFetched: taskContextQuery.isFetched,
    contextError: taskContextQuery.error,
    requiresPlan: requiresSetupPlan,
    planLoading: planQuery.status === "loading",
    planError: planQuery.status === "error" ? planQuery.error.message : null,
  });
  const [capturedSetupLaunchContext, setCapturedSetupLaunchContext] =
    useState<AgenticSetupLaunchContext | null>(null);

  const onPromptSubmitted = useCallback(
    (
      _selection: SessionMethodSelection,
      launchOptions: SessionLaunchOptions,
      promptDraft: string,
      attachments: RunAttachmentReference[],
    ) => {
      if (!agentSessionId) return;
      const nextParams = new URLSearchParams(searchParams);
      nextParams.set("mode", "active");
      if (launchOptions.model) {
        nextParams.set("sessionModel", launchOptions.model);
      }
      if (launchOptions.reasoningEffort) {
        nextParams.set("sessionReasoningEffort", launchOptions.reasoningEffort);
      }
      if (launchOptions.machineId) {
        nextParams.set("sessionMachineId", launchOptions.machineId);
      }
      flushSync(() => {
        setPendingLaunch({ agentSessionId, prompt: promptDraft, attachments });
        setSubmittedMachineId(launchOptions.machineId ?? null);
        setCapturedSetupLaunchContext(
          captureSetupLaunchContext({
            planData: setupPlanData,
            planWorktreeBranch: setupPlanWorktreeBranch,
            launchContext: setupLaunchContext,
          }),
        );
      });
      if (preview) {
        setPreviewSearchParams(nextParams);
      } else {
        setRouteSearchParams(nextParams, { replace: true });
      }
      void agentSessionQuery.refetch();
    },
    [
      agentSessionId,
      agentSessionQuery,
      preview,
      searchParams,
      setRouteSearchParams,
      setupLaunchContext,
      setupPlanData,
      setupPlanWorktreeBranch,
    ],
  );

  const planPath = useMemo(
    () => (projectId && planId ? buildPlanDetailPath(projectId, planId) : ""),
    [planId, projectId],
  );
  const stepPath = useMemo(
    () =>
      projectId && planId
        ? buildPlanStepPath(projectId, planId, stageId, stepId)
        : "",
    [planId, projectId, stageId, stepId],
  );

  const serviceId = agentSession?.launchServiceId ?? null;
  const taskServiceIds = useMemo(
    () => resolveTaskServiceIds(taskData),
    [taskData],
  );
  const provider = isProvider(agentSession?.provider)
    ? agentSession.provider
    : null;

  const planData =
    mode === "setup"
      ? setupPlanData
      : (capturedSetupLaunchContext?.planData ?? null);
  const planWorktreeBranch =
    mode === "setup"
      ? setupPlanWorktreeBranch
      : (capturedSetupLaunchContext?.planWorktreeBranch ?? null);
  const planTitle =
    taskContext?.planContext?.parentPlan?.displayName ??
    planQuery.aggregate?.plan.name ??
    null;
  const stepCrumbTitle = taskData?.name || "Task";

  const taskNavigationPaths = useMemo(
    () => buildAgentSessionTaskNavigationPaths(projectId, taskData?.id),
    [projectId, taskData?.id],
  );

  const launchContext =
    mode === "setup" || !capturedSetupLaunchContext
      ? setupLaunchContext
      : capturedSetupLaunchContext;

  return {
    organizationId,
    userId: userId ?? null,
    pathname: preview
      ? `/projects/${projectId}/agent-sessions/${agentSessionId}/preview`
      : location.pathname,
    projectId,
    routeTaskId,
    planId,
    stageId,
    stepId,
    agentSessionId,
    projectQuery,
    agentSessionQuery,
    taskQuery,
    planQuery,
    setupRead,
    initiativeQuery,
    agentSession,
    taskData: taskData ?? null,
    hasRequiredRouteParams,
    mode,
    onPromptSubmitted,
    conversationTitle: conversationQuery.data?.title ?? null,
    nodeDecisionWorkflowName,
    sessionModel,
    sessionReasoningEffort,
    sessionMachineId,
    pendingInitialPromptDraft,
    pendingInitialPromptAttachments,
    onInitialPromptAccepted,
    planPath,
    stepPath,
    taskOverviewPath: taskNavigationPaths.taskOverviewPath,
    taskCodingTabPath: taskNavigationPaths.taskCodingTabPath,
    serviceId,
    taskServiceIds,
    provider,
    planWorktreeBranch,
    planData,
    planTitle,
    stepCrumbTitle,
    launchSource: launchContext.launchSource,
    launchPlanId: launchContext.launchPlanId,
    launchStepId: launchContext.launchStepId,
    launchStageId: launchContext.launchStageId,
  };
};

export const buildAgentSessionTaskNavigationPaths = (
  projectId?: string,
  taskId?: string,
): {
  taskOverviewPath: string | null;
  taskCodingTabPath: string | null;
} => {
  if (!projectId || !taskId) {
    return { taskOverviewPath: null, taskCodingTabPath: null };
  }

  return {
    taskOverviewPath: WebPathService.task({ projectId, taskId }),
    taskCodingTabPath: buildTaskPathWithAgentTab(projectId, "", taskId),
  };
};
