import { getWorkflowAboutInfoForAgentSession } from "@hey-hey/ui-common";
import {
  EntityType,
  type AgentSessionDto,
  type InitiativeResponseDto,
  type ProjectResponseDto,
  type TaskResponseDto,
} from "@hey-hey/ui-common/api";
import { TrackingProvider } from "@hey-hey/ui-common/context";
import {
  useAgentSession,
  useInitiative,
  useProject,
  useTaskHierarchy,
} from "@hey-hey/ui-common/data";
import { useUserIdentity } from "@hey-hey/ui-common/hooks";
import { compose } from "@hey-hey/ui-common/i18n";
import { WebPathService } from "@hey-hey/ui-common/services";
import { Alert, Box, Chip, CircularProgress, Typography } from "@mui/material";
import { AnimatePresence, motion } from "motion/react";
import { parseAsString, useQueryState } from "nuqs";
import React, { useCallback, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { ActiveConversation } from "../../components/Conversation/ActiveConversation";
import {
  DetailPageContainer,
  DetailPageHeader,
  DetailPageTabs,
  PageBreadcrumbs,
  type DetailPageTab,
} from "../../components/Layout";
import type { BreadcrumbItem } from "@hey-hey/ui-common/utils";
import { AdminTab, buildAdminMetadataItems } from "../../components/Tabs";
import { ConversationListTab } from "../../components/Tabs/ConversationListTab";
import { ImplementationHintsTab } from "../../components/Tabs/ImplementationHintsTab";
import { tabTransitionVariants } from "../../utils/routeTransitions";
import { AgentSessionDiscussActionCapsule } from "./AgentSessionDiscussActionCapsule";

type TrackingContextOverride = React.ComponentProps<
  typeof TrackingProvider
>["context"];

interface AgentSessionBreadcrumbContext {
  project?: ProjectResponseDto | null;
  initiative?: InitiativeResponseDto | null;
  task?: TaskResponseDto | null;
  agentSession: AgentSessionDto;
}

export interface AgentSessionViewProps {
  organizationId?: string | null;
  projectId?: string;
  agentSessionId?: string;
  breadcrumbs?:
    | React.ReactNode
    | ((context: AgentSessionBreadcrumbContext) => React.ReactNode);
  actions?: React.ReactNode;
  tabs?: DetailPageTab[];
  tabContentOverrides?: Partial<Record<string, React.ReactNode>>;
  container?: (children: React.ReactNode) => React.ReactNode;
  disableTracking?: boolean;
  trackingContextOverride?: TrackingContextOverride;
  defaultTab?: string;
  conversationId?: string;
}

const useDefaultAgentSessionTabs = (): DetailPageTab[] => {
  return useMemo(
    () => [
      { value: "conversations", label: "Conversations" },
      { value: "hints", label: "Implementation Hints" },
      { value: "admin", label: "Admin" },
    ],
    [],
  );
};

export const AgentSessionView: React.FC<AgentSessionViewProps> = ({
  organizationId,
  projectId,
  agentSessionId,
  breadcrumbs,
  actions,
  tabs,
  tabContentOverrides,
  container,
  disableTracking = false,
  trackingContextOverride,
  defaultTab,
  conversationId,
}) => {
  const navigate = useNavigate();
  const { currentOrgId } = useUserIdentity() || {};
  const resolvedOrgId = organizationId ?? currentOrgId;
  const defaultTabs = useDefaultAgentSessionTabs();
  const tabsToRender = tabs ?? defaultTabs;
  const tabValues = useMemo(
    () => tabsToRender.map((tab) => tab.value),
    [tabsToRender],
  );
  const defaultTabValue = useMemo(() => {
    // Default to "hints" tab when hintId is in the URL
    if (
      new URLSearchParams(window.location.search).has("hintId") &&
      tabValues.includes("hints")
    ) {
      return "hints";
    }
    if (defaultTab && tabValues.includes(defaultTab)) {
      return defaultTab;
    }
    return tabsToRender[0]?.value ?? "conversations";
  }, [defaultTab, tabValues, tabsToRender]);
  const [activeTab, setActiveTab] = useQueryState(
    "tab",
    parseAsString.withDefault(defaultTabValue),
  );

  useEffect(() => {
    if (!tabValues.includes(activeTab)) {
      void setActiveTab(defaultTabValue);
    }
  }, [activeTab, defaultTabValue, setActiveTab, tabValues]);

  const {
    agentSession,
    isLoading: isSessionsLoading,
    isFetched: isSessionsFetched,
  } = useAgentSession(resolvedOrgId, projectId, agentSessionId, {
    enabled: !!resolvedOrgId && !!agentSessionId,
  });

  const {
    data: project,
    isLoading: isProjectLoading,
    error: projectError,
  } = useProject(resolvedOrgId, projectId, {
    enabled: !!resolvedOrgId && !!projectId,
    preferStale: true,
  });

  const aboutInitiativeId =
    agentSession?.entityType === EntityType.Initiative
      ? agentSession.entityId
      : undefined;
  const aboutTaskId =
    agentSession?.entityType === EntityType.Task
      ? agentSession.entityId
      : undefined;

  const { data: initiative } = useInitiative(
    resolvedOrgId || "",
    aboutInitiativeId || "",
    {
      enabled: !!resolvedOrgId && !!aboutInitiativeId,
    },
  );

  const { task } = useTaskHierarchy(
    resolvedOrgId || "",
    projectId || "",
    aboutTaskId || "",
    {
      enabled: !!resolvedOrgId && !!aboutTaskId,
    },
  );

  const conversationPathForId = useCallback(
    (conversationId: string) => {
      if (!projectId) return "";
      return WebPathService.conversation({ projectId, conversationId });
    },
    [projectId],
  );
  const backToConversationsPath = useMemo(() => {
    if (!projectId || !agentSessionId) {
      return "";
    }
    return `${WebPathService.agentSession({
      projectId,
      agentSessionId,
    })}?tab=conversations`;
  }, [agentSessionId, projectId]);

  const renderDefaultBreadcrumbs = useCallback(() => {
    if (!agentSession) return null;
    const items: BreadcrumbItem[] = [
      { label: "Projects", to: "/projects", type: "project" },
      {
        label: project?.name ?? compose("{{term.Project}}"),
        to: `/projects/${projectId}`,
        type: project?.name ? "project" : undefined,
      },
    ];
    if (initiative) {
      items.push({
        label: initiative.name,
        to: WebPathService.initiativeDetail({
          projectId: projectId!,
          initiativeId: initiative.id,
        }),
        type: "initiative",
      });
    }
    if (task && aboutInitiativeId) {
      items.push({
        label: task.name,
        to: WebPathService.task({
          projectId: projectId!,
          initiativeId: aboutInitiativeId,
          taskId: task.id,
        }),
        type: "task",
        entityId: task.id,
      });
    }
    items.push({ label: "Coding Session", isCurrent: true });
    return <PageBreadcrumbs sx={{ mb: 2 }} items={items} />;
  }, [
    agentSession,
    aboutInitiativeId,
    initiative,
    project?.name,
    projectId,
    task,
  ]);

  const resolvedBreadcrumbs = useMemo(() => {
    if (!agentSession) return null;
    if (typeof breadcrumbs === "function") {
      return breadcrumbs({
        project,
        initiative,
        task,
        agentSession,
      });
    }
    if (breadcrumbs) {
      return breadcrumbs;
    }
    return renderDefaultBreadcrumbs();
  }, [
    breadcrumbs,
    agentSession,
    initiative,
    project,
    renderDefaultBreadcrumbs,
    task,
  ]);

  if (!resolvedOrgId || !projectId || !agentSessionId) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">
          Missing required route parameters. Please check the URL.
        </Alert>
      </Box>
    );
  }

  if (projectError) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">
          Failed to load project. Please try again later.
        </Alert>
      </Box>
    );
  }

  if (isSessionsLoading || isProjectLoading || !isSessionsFetched) {
    return (
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "40vh",
          gap: 2,
        }}
      >
        <CircularProgress />
        <Typography variant="body1" color="text.secondary">
          Loading coding session...
        </Typography>
      </Box>
    );
  }

  if (!agentSession) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="warning" sx={{ mb: 2 }}>
          Coding session not found.
        </Alert>
        <Typography
          variant="body2"
          color="primary"
          sx={{ cursor: "pointer" }}
          onClick={() => navigate(`/projects/${projectId}`)}
        >
          Return to project
        </Typography>
      </Box>
    );
  }

  const aboutInfo = getWorkflowAboutInfoForAgentSession(agentSession);
  const tabOverride = tabContentOverrides?.[activeTab] ?? null;
  const adminMetadataItems = buildAdminMetadataItems({
    createdAt: agentSession.createdAt,
    updatedAt: agentSession.updatedAt,
  });

  const content = (
    <>
      <DetailPageHeader
        title={agentSession?.title || "Agent Session"}
        metadataComponent={
          agentSession ? (
            <Chip
              size="small"
              label={new Date(agentSession.sessionDate).toLocaleDateString()}
            />
          ) : undefined
        }
        metadata={
          agentSession?.updatedAt
            ? `Updated ${new Date(agentSession.updatedAt).toLocaleString()}`
            : undefined
        }
      />

      <DetailPageTabs
        value={activeTab}
        onChange={setActiveTab}
        tabs={tabsToRender}
      />

      <AnimatePresence mode="wait">
        {tabOverride ? (
          <motion.div
            key={`custom-${activeTab}`}
            variants={tabTransitionVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
          >
            {tabOverride}
          </motion.div>
        ) : (
          <>
            {activeTab === "hints" && (
              <motion.div
                key="hints"
                variants={tabTransitionVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
              >
                <ImplementationHintsTab
                  organizationId={resolvedOrgId ?? ""}
                  projectId={projectId}
                  agentSessionId={agentSessionId}
                  enableFilters={true}
                  enabled={activeTab === "hints"}
                />
              </motion.div>
            )}

            {activeTab === "conversations" && (
              <motion.div
                key="conversations"
                variants={tabTransitionVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
              >
                {conversationId ? (
                  <ActiveConversation
                    organizationId={resolvedOrgId ?? ""}
                    projectId={projectId}
                    conversationId={conversationId}
                    onBack={() => {
                      if (backToConversationsPath) {
                        navigate(backToConversationsPath);
                      }
                    }}
                  />
                ) : aboutInfo.workflowAboutId && aboutInfo.workflowAboutType ? (
                  <ConversationListTab
                    organizationId={resolvedOrgId ?? ""}
                    projectId={projectId}
                    workflowName="coding-prompts"
                    workflowAboutId={aboutInfo.workflowAboutId}
                    workflowAboutType={aboutInfo.workflowAboutType}
                    activeConversationId={agentSession?.conversationId}
                    conversationPathForId={conversationPathForId}
                  />
                ) : (
                  <Box sx={{ p: 3 }}>
                    <Alert severity="error">
                      Missing conversation context for this coding session.
                    </Alert>
                  </Box>
                )}
              </motion.div>
            )}

            {activeTab === "admin" && (
              <motion.div
                key="admin"
                variants={tabTransitionVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
              >
                <AdminTab metadataItems={adminMetadataItems} />
              </motion.div>
            )}
          </>
        )}
      </AnimatePresence>
    </>
  );

  const wrappedContent = (
    <>
      {actions}
      <AgentSessionDiscussActionCapsule
        organizationId={resolvedOrgId}
        projectId={projectId}
        agentSession={agentSession}
      />
      {resolvedBreadcrumbs}
      {container ? (
        container(content)
      ) : (
        <DetailPageContainer>{content}</DetailPageContainer>
      )}
    </>
  );

  if (disableTracking) {
    return wrappedContent;
  }

  return (
    <TrackingProvider
      context={{
        page: {
          name: "agent-session",
          path: WebPathService.agentSession({
            projectId: projectId!,
            agentSessionId: agentSessionId!,
          }),
        },
        agentSession: {
          id: agentSession.id,
          name: agentSession.title || "Agent Session",
        },
        attentionEntity: {
          id: agentSession.id,
          type: "agent_session",
          name: agentSession.title || "Agent Session",
          status: agentSession.status,
          projectId: agentSession.projectId,
        },
        ...trackingContextOverride,
      }}
    >
      {wrappedContent}
    </TrackingProvider>
  );
};
