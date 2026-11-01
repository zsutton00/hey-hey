import { usePlatformAdminAccess } from "@hey-hey/ui-common/data";
import { WebPathService } from "@hey-hey/ui-common";
import type { ReasoningEffort } from "@hey-hey/ui-common/agent-sessions-runtime";
import {
  EntityType,
  WorkflowName,
  ValidationLaunchContextScopeEnum,
} from "@hey-hey/ui-common/api";
import {
  AgentBridgeTrackingProvider,
  AgenticSetupSection,
  CodingSession,
  DataStateBoundary,
  LocalRuntimeUnavailableAlert,
  useValidationLauncher,
  ValidationSession,
  type ConversationScrollPolicy,
} from "@hey-hey/ui-common/components";
import {
  CanonicalPageBoundary,
  type CanonicalPageComposition,
} from "@hey-hey/ui-common/context";
import { Alert, Box, Stack, Tab, Tabs } from "@mui/material";
import { AnimatePresence, motion } from "motion/react";
import { parseAsStringLiteral, useQueryState } from "nuqs";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useSuppressLayoutMainBottomSpacing } from "../../../components/Layout/LayoutMainBottomSpacingContext";
import { useLayoutMainScrollOwner } from "../../../components/Layout/LayoutMainScrollOwnerContext";
import { DataDebugTab } from "../../../components/Tabs/DataDebugTab";
import { tabTransitionVariants } from "../../../utils/routeTransitions";
import { AgentSessionDiscussActionCapsule } from "../AgentSessionDiscussActionCapsule";
import { AgentSessionStatusActionCapsule } from "../AgentSessionStatusActionCapsule";
import { buildAgentSessionPresentation } from "../agentSessionPresentation";
import { useAcknowledgeAgentSessionOutputAttentionOnOpen } from "../useAcknowledgeAgentSessionOutputAttentionOnOpen";
import { AgenticAgentSessionBreadcrumbs } from "./AgenticAgentSessionBreadcrumbs";
import { buildAgentSessionPageComposition } from "./agentSessionPageComposition";
import { useAgenticAgentSessionPageState } from "./useAgenticAgentSessionPageState";

interface AgenticAgentSessionPageProps {
  routeFamily: "project" | "plan" | "task";
  actions?: ReactNode;
  organizationId?: string;
  projectId?: string;
  taskId?: string;
  planId?: string;
  stageId?: string;
  stepId?: string;
  agentSessionId?: string;
  preview?: boolean;
}

const CODING_SESSION_LAYOUT_OPTIONS = { suppressMainScroll: false } as const;

export const AgenticAgentSessionPage = ({
  routeFamily,
  actions,
  organizationId: organizationIdOverride,
  projectId: projectIdOverride,
  taskId,
  planId: planIdOverride,
  stageId,
  stepId,
  agentSessionId: agentSessionIdOverride,
  preview = false,
}: AgenticAgentSessionPageProps) => {
  const { isPlatformAdmin } = usePlatformAdminAccess();
  const [routeActiveDebugTab, setRouteActiveDebugTab] = useQueryState(
    "debugTab",
    parseAsStringLiteral(["session", "data-debug"] as const).withDefault(
      "session",
    ),
  );
  const [previewActiveDebugTab, setPreviewActiveDebugTab] = useState<
    "session" | "data-debug"
  >("session");
  const activeDebugTab = preview ? previewActiveDebugTab : routeActiveDebugTab;
  const setActiveDebugTab = useCallback(
    (value: "session" | "data-debug") => {
      if (preview) {
        setPreviewActiveDebugTab(value);
        return;
      }
      void setRouteActiveDebugTab(value);
    },
    [preview, setRouteActiveDebugTab],
  );
  const {
    organizationId,
    userId,
    pathname,
    projectId,
    routeTaskId,
    planId,
    stageId: resolvedStageId,
    stepId: resolvedStepId,
    agentSessionId,
    projectQuery,
    agentSessionQuery,
    setupRead,
    initiativeQuery,
    agentSession,
    taskData,
    conversationTitle,
    hasRequiredRouteParams,
    mode,
    onPromptSubmitted,
    planPath,
    stepPath,
    taskOverviewPath,
    taskCodingTabPath,
    serviceId,
    taskServiceIds,
    provider,
    planWorktreeBranch,
    planData,
    planTitle,
    stepCrumbTitle,
    launchPlanId,
    launchStepId,
    launchStageId,
    nodeDecisionWorkflowName,
    sessionModel,
    sessionReasoningEffort,
    sessionMachineId,
    pendingInitialPromptDraft,
    pendingInitialPromptAttachments,
    onInitialPromptAccepted,
  } = useAgenticAgentSessionPageState(routeFamily, {
    organizationId: organizationIdOverride,
    projectId: projectIdOverride,
    taskId,
    planId: planIdOverride,
    stageId,
    stepId,
    agentSessionId: agentSessionIdOverride,
    preview,
  });
  const layoutMainScrollOwner = useLayoutMainScrollOwner();
  const mainContentRef = layoutMainScrollOwner?.mainContentRef ?? null;
  const codingSessionScrollPolicy = useMemo<ConversationScrollPolicy>(
    () =>
      mainContentRef
        ? { mode: "owned", ownerRef: mainContentRef }
        : { mode: "disabled" },
    [mainContentRef],
  );
  useAcknowledgeAgentSessionOutputAttentionOnOpen({
    organizationId,
    projectId,
    agentSessionId,
    enabled:
      !preview &&
      agentSessionQuery.isFetched &&
      !agentSessionQuery.error &&
      !!agentSession,
  });
  const hasActiveCodingSession =
    mode === "active" &&
    provider !== null &&
    (serviceId !== null ||
      nodeDecisionWorkflowName === WorkflowName.FeatureSync);
  useSuppressLayoutMainBottomSpacing(
    !preview && hasActiveCodingSession,
    CODING_SESSION_LAYOUT_OPTIONS,
  );

  const navigate = useNavigate();
  const { launch: launchValidation } = useValidationLauncher({
    organizationId: organizationId ?? "",
    projectId: projectId ?? "",
    onSessionCreated: (session) => {
      navigate(
        WebPathService.agentSession({
          projectId: projectId ?? "",
          agentSessionId: session.id,
        }),
      );
    },
  });

  if (
    !hasRequiredRouteParams ||
    !organizationId ||
    !projectId ||
    !agentSessionId
  ) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">Missing required route parameters.</Alert>
      </Box>
    );
  }

  const initialDataLoading =
    agentSessionQuery.isLoading || projectQuery.isLoading;
  const initialDataFetched =
    agentSessionQuery.isFetched && projectQuery.isFetched;
  const requiredReadsLoading =
    initialDataLoading || (mode === "setup" && setupRead.loading);
  const requiredReadsFetched =
    initialDataFetched && (mode !== "setup" || setupRead.fetched);

  if (requiredReadsLoading || !requiredReadsFetched) {
    return (
      <DataStateBoundary
        loading={requiredReadsLoading}
        fetched={requiredReadsFetched}
      >
        {null}
      </DataStateBoundary>
    );
  }

  if (agentSessionQuery.error) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">{agentSessionQuery.error.message}</Alert>
      </Box>
    );
  }

  if (!agentSession) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="warning">Coding session not found.</Alert>
      </Box>
    );
  }

  const aboutTaskId =
    agentSession.entityType === EntityType.Task
      ? agentSession.entityId
      : undefined;

  const validationTaskId = aboutTaskId ?? taskData?.id;
  const onLaunchValidation = validationTaskId
    ? async () => {
        await launchValidation({
          scope: ValidationLaunchContextScopeEnum.Task,
          entityId: validationTaskId,
          taskId: validationTaskId,
        });
      }
    : undefined;

  if (mode === "setup" && setupRead.error) {
    return <Alert severity="error">{setupRead.error}</Alert>;
  }

  if (mode === "setup" && aboutTaskId && !taskData) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="warning">
          Task data could not be loaded for this coding session.
        </Alert>
      </Box>
    );
  }

  const showStatusAction =
    agentSession.status === "NOT_STARTED" ||
    agentSession.status === "IN_PROGRESS" ||
    agentSession.status === "COMPLETED" ||
    agentSession.status === "ERRORED";
  const pageComposition: CanonicalPageComposition =
    buildAgentSessionPageComposition({
      preview,
      routeFamily,
      agentSessionId: agentSession.id,
      planId,
      stageId: resolvedStageId,
      stepId: resolvedStepId,
      taskId: taskData?.id ?? routeTaskId,
      presentation: buildAgentSessionPresentation(
        agentSession,
        undefined,
        undefined,
        conversationTitle,
        taskData && taskData.id === agentSession.entityId
          ? taskData.name
          : undefined,
      ),
    });
  const attentionLineage = getAttentionLineage(pageComposition);
  const hasTaskNavigation = Boolean(taskOverviewPath && taskCodingTabPath);
  const showSessionNavigation = hasTaskNavigation || isPlatformAdmin;
  const activeNavigationTab =
    isPlatformAdmin && activeDebugTab === "data-debug" ? "data-debug" : false;

  const handleNavigationTabChange = (
    _event: React.SyntheticEvent,
    nextTab: string,
  ) => {
    if (nextTab === "data-debug") {
      setActiveDebugTab("data-debug");
      return;
    }

    if (!hasTaskNavigation && nextTab === "session") {
      setActiveDebugTab("session");
      return;
    }

    if (preview) {
      return;
    }

    if (nextTab === "task-overview" && taskOverviewPath) {
      navigate(taskOverviewPath);
    } else if (nextTab === "coding-sessions" && taskCodingTabPath) {
      navigate(taskCodingTabPath);
    }
  };

  return (
    <AgentBridgeTrackingProvider
      agentSessionId={agentSession.id}
      taskId={taskData?.id}
      pagePath={pathname}
      pageSection={mode}
      lineage={attentionLineage}
      agentSessionName={agentSession.title ?? undefined}
      taskName={taskData?.name ?? undefined}
      taskStatus={taskData?.status ?? undefined}
      taskPriority={taskData?.priority ?? undefined}
      projectId={projectId}
      projectName={projectQuery.data?.name ?? undefined}
      serviceId={serviceId ?? undefined}
      provider={provider ?? undefined}
    >
      <CanonicalPageBoundary composition={pageComposition}>
        {!preview && (
          <AgenticAgentSessionBreadcrumbs
            routeFamily={routeFamily}
            organizationId={organizationId}
            projectId={projectId}
            projectName={projectQuery.data?.name}
            planId={planId}
            planPath={planPath}
            planTitle={planTitle}
            stepPath={stepPath}
            stepCrumbTitle={stepCrumbTitle}
            initiativeName={initiativeQuery.data?.name}
            taskData={taskData}
            taskCodingTabPath={taskCodingTabPath}
            agentSession={agentSession}
            serviceId={serviceId}
          />
        )}

        <Stack
          spacing={2}
          sx={{
            width: "100%",
            maxWidth: "100%",
          }}
        >
          {!preview && (
            <AgentSessionDiscussActionCapsule
              organizationId={organizationId}
              projectId={projectId}
              agentSession={agentSession}
            />
          )}

          {showStatusAction || actions ? (
            <Stack
              direction="row"
              spacing={1}
              alignItems="center"
              justifyContent="flex-end"
              flexWrap="wrap"
            >
              {showStatusAction ? (
                <AgentSessionStatusActionCapsule
                  organizationId={organizationId}
                  projectId={projectId}
                  agentSession={agentSession}
                  taskData={taskData}
                  onStatusUpdated={() => agentSessionQuery.refetch()}
                />
              ) : null}
              {actions ?? null}
            </Stack>
          ) : null}

          {showSessionNavigation ? (
            <Tabs
              value={hasTaskNavigation ? activeNavigationTab : activeDebugTab}
              onChange={handleNavigationTabChange}
              sx={{ borderBottom: 1, borderColor: "divider" }}
              variant="scrollable"
              scrollButtons="auto"
            >
              {hasTaskNavigation ? (
                <Tab label="Task Overview" value="task-overview" />
              ) : (
                <Tab label="Session" value="session" />
              )}
              {hasTaskNavigation ? (
                <Tab label="Agent Sessions" value="coding-sessions" />
              ) : null}
              {isPlatformAdmin ? (
                <Tab label="Data Debug" value="data-debug" />
              ) : null}
            </Tabs>
          ) : null}

          <AnimatePresence mode="wait">
            {(!isPlatformAdmin || activeDebugTab === "session") && (
              <motion.div
                key="session"
                variants={tabTransitionVariants}
                initial={false}
                animate="visible"
                exit="exit"
                style={{ width: "100%" }}
              >
                {mode === "setup" ? (
                  <AgenticSetupSection
                    organizationId={organizationId}
                    projectId={projectId}
                    agentSessionId={agentSession.id}
                    userId={userId}
                    boundServiceId={serviceId}
                    taskServiceIds={taskServiceIds}
                    boundProvider={provider}
                    lockedWorktreeBranch={planWorktreeBranch}
                    onPromptSubmitted={onPromptSubmitted}
                    onLaunchValidation={onLaunchValidation}
                    taskData={taskData}
                  />
                ) : null}

                {mode === "validation" ? (
                  <ValidationSession
                    organizationId={organizationId}
                    projectId={projectId}
                    agentSession={agentSession}
                    taskData={taskData}
                  />
                ) : null}

                {mode === "active" ? (
                  provider &&
                  (serviceId ||
                    nodeDecisionWorkflowName === WorkflowName.FeatureSync) ? (
                    <CodingSession
                      organizationId={organizationId}
                      agentSession={agentSession}
                      projectId={projectId}
                      launchPlanId={launchPlanId}
                      launchStepId={launchStepId}
                      launchStageId={launchStageId}
                      taskData={taskData}
                      planData={planData}
                      initiativeData={initiativeQuery.data ?? null}
                      provider={provider}
                      serviceId={serviceId ?? undefined}
                      workflowName={nodeDecisionWorkflowName}
                      model={sessionModel ?? undefined}
                      reasoningEffort={
                        (sessionReasoningEffort ?? undefined) as
                          ReasoningEffort | undefined
                      }
                      machineId={sessionMachineId ?? undefined}
                      initialPromptDraft={pendingInitialPromptDraft}
                      initialPromptAttachments={pendingInitialPromptAttachments}
                      onInitialPromptAccepted={onInitialPromptAccepted}
                      scrollPolicy={codingSessionScrollPolicy}
                      taskContextStickyTop={
                        layoutMainScrollOwner?.taskContextStickyTop
                      }
                    />
                  ) : (
                    <Stack spacing={2}>
                      <Alert severity="error">
                        Service or provider is not configured for this coding
                        session.
                      </Alert>
                      <LocalRuntimeUnavailableAlert error={null} />
                    </Stack>
                  )
                ) : null}
              </motion.div>
            )}

            {isPlatformAdmin && activeDebugTab === "data-debug" && (
              <motion.div
                key="data-debug"
                variants={tabTransitionVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
              >
                <DataDebugTab
                  organizationId={organizationId}
                  projectId={projectId ?? ""}
                  entityId={agentSessionId ?? ""}
                  entityType="agent_session"
                />
              </motion.div>
            )}
          </AnimatePresence>
        </Stack>
      </CanonicalPageBoundary>
    </AgentBridgeTrackingProvider>
  );
};

function getAttentionLineage(composition: CanonicalPageComposition) {
  switch (composition.kind) {
    case "canonical":
      return composition.descriptor.lineage;
    case "observational":
      return undefined;
    default:
      return assertNever(composition);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unsupported agent-session composition: ${String(value)}`);
}
