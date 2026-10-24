import { WebPathService } from "@hey-hey/ui-common";
import { DiscussCapsuleAction, PlanList } from "@hey-hey/ui-common/components";
import { EntityType } from "@hey-hey/ui-common/api";
import { TrackingProvider, useOrganization } from "@hey-hey/ui-common/context";
import {
  buildProjectWorkspaceNavigation,
  usePlatformAdminAccess,
  useProject,
  useProjectPlans,
  useWorkItemTypes,
} from "@hey-hey/ui-common/data";
import { useUserIdentity } from "@hey-hey/ui-common/hooks";
import { Box, Typography } from "@mui/material";
import { AnimatePresence, motion } from "motion/react";
import { parseAsString, useQueryStates } from "nuqs";
import React, { useCallback, useEffect, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  DetailPageContainer,
  DetailPageTabs,
  PageBreadcrumbs,
  type DetailPageTab,
} from "../../components/Layout";
import { SegmentedToggle } from "../../components/SegmentedToggle";
import {
  buildAdminMetadataItems,
  DesignDocsTab,
  ProjectWorkItemsTab,
  ProposalsTab,
} from "../../components/Tabs";
import { tabTransitionVariants } from "../../utils/routeTransitions";
import { ProjectHelpPage } from "../NewOrgLanding/ProjectHelpPage";
import { ProjectAdminDestination } from "./ProjectAdminDestination";
import { ProjectAgentsTab } from "./ProjectAgentsTab";
import { ProjectSettingsTab } from "./ProjectSettingsTab";
import { ProjectOverviewDestination } from "./views";
import {
  getProjectNavigationItemKey,
  getProjectNavigationItemLabel,
  PROJECT_DESTINATIONS,
  resolveProjectDestination,
  resolveProjectNavigationItem,
  type ProjectDestination,
} from "./projectNavigation";

export const ProjectPage: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const { userId } = useUserIdentity() || {};
  const { currentOrganization } = useOrganization();
  const currentOrgId = currentOrganization?.id;
  const navigate = useNavigate();
  const [{ tab: activeTab, type: activeType }, setNavigationState] =
    useQueryStates({
      tab: parseAsString.withDefault("overview"),
      type: parseAsString,
    });
  const { isPlatformAdmin } = usePlatformAdminAccess();
  const requestedDestination = resolveProjectDestination(activeTab);
  // Admin is for platform admins only; anyone else lands on Overview.
  const activeDestination =
    requestedDestination === "admin" && !isPlatformAdmin
      ? "overview"
      : requestedDestination;

  const projectQuery = useProject(currentOrgId || "", projectId || "", {
    enabled: !!currentOrgId && !!projectId,
  });
  const { data: project } = projectQuery;
  useEffect(() => {
    if (!projectQuery.isLoading && projectQuery.error && currentOrgId) {
      navigate(WebPathService.projects(), { replace: true });
    }
  }, [currentOrgId, navigate, projectQuery.error, projectQuery.isLoading]);
  const { plans = [], isLoading: isPlansLoading } = useProjectPlans(
    currentOrgId,
    projectId,
    { enabled: !!currentOrgId && !!projectId },
  );
  const { workItemTypes, isReady: areWorkItemTypesReady } = useWorkItemTypes(
    currentOrgId,
    {
      projectId,
      enabled: !!currentOrgId && !!projectId,
    },
  );

  const navigation = useMemo(
    () =>
      areWorkItemTypesReady && projectId
        ? buildProjectWorkspaceNavigation(workItemTypes, projectId)
        : undefined,
    [areWorkItemTypesReady, projectId, workItemTypes],
  );
  const selectedNavigationItem = useMemo(
    () =>
      areWorkItemTypesReady
        ? resolveProjectNavigationItem(
            navigation?.groups ?? [],
            activeTab,
            activeType,
          )
        : undefined,
    [activeTab, activeType, areWorkItemTypesReady, navigation],
  );
  const selectedNavigationGroup = navigation?.groups.find(
    (group) => group.key === activeDestination,
  );

  const handleProjectTabChange = useCallback(
    (value: string | ((old: string) => string | null) | null): void => {
      if (typeof value !== "string") return;
      const destination = value as ProjectDestination;
      const group = navigation?.groups.find(
        (candidate) => candidate.key === destination,
      );
      void setNavigationState(
        {
          tab: destination,
          type: group
            ? group.items[0]
              ? getProjectNavigationItemKey(group.items[0])
              : null
            : activeType,
        },
        { history: "push" },
      );
    },
    [activeType, navigation, setNavigationState],
  );

  const handleProjectTypeChange = useCallback(
    (value: string): void => {
      void setNavigationState(
        { tab: activeDestination, type: value },
        { history: "push" },
      );
    },
    [activeDestination, setNavigationState],
  );

  const tabs: DetailPageTab[] = PROJECT_DESTINATIONS.filter(
    (destination) => destination.value !== "admin" || isPlatformAdmin,
  ).map((destination) => ({
    value: destination.value,
    label: destination.label,
  }));
  const adminMetadataItems = buildAdminMetadataItems({
    createdBy: project?.createdBy,
    createdAt: project?.createdAt,
    updatedAt: project?.updatedAt,
  });
  const projectPath = WebPathService.project(projectId!);

  const registryDestinationContent =
    (activeDestination === "work" || activeDestination === "knowledge") &&
    areWorkItemTypesReady ? (
      <Box sx={{ mt: 2 }}>
        {selectedNavigationGroup && selectedNavigationGroup.items.length > 0 ? (
          <>
            <Box sx={{ mb: 3, maxWidth: "100%", minWidth: 0 }}>
              <SegmentedToggle
                segments={selectedNavigationGroup.items.map((item) => ({
                  value: getProjectNavigationItemKey(item),
                  label: getProjectNavigationItemLabel(item),
                }))}
                value={
                  selectedNavigationItem
                    ? getProjectNavigationItemKey(selectedNavigationItem)
                    : ""
                }
                onChange={handleProjectTypeChange}
                mobileDropdown
                scrollable
              />
            </Box>
            {selectedNavigationItem?.kind === "registry-work-item" ? (
              <ProjectWorkItemsTab
                organizationId={currentOrgId!}
                projectId={projectId!}
                taskType={selectedNavigationItem.typeKey}
                title={selectedNavigationItem.name}
                emptyMessage={`No ${selectedNavigationItem.name.toLowerCase()} in this project yet.`}
              />
            ) : selectedNavigationItem?.kind === "design-doc" ? (
              <DesignDocsTab
                organizationId={currentOrgId!}
                projectId={projectId!}
                enableFilters
                emptyMessage="No design documents in this project yet."
              />
            ) : selectedNavigationItem?.kind === "plan" ? (
              <PlanList
                plans={plans}
                projectId={projectId!}
                organizationId={currentOrgId!}
                isLoading={isPlansLoading}
                emptyMessage="No plans in this project yet."
              />
            ) : null}
          </>
        ) : (
          <Typography color="text.secondary">
            No work item types are available for this project.
          </Typography>
        )}
      </Box>
    ) : null;

  return (
    <TrackingProvider
      context={{ page: { name: "project", path: projectPath } }}
    >
      <PageBreadcrumbs
        sx={{ mb: 2 }}
        items={[
          { label: "Projects", to: WebPathService.projects() },
          {
            label: project?.name || "Project",
            to: projectPath,
            isCurrent: true,
            type: "project",
          },
        ]}
      />
      <DetailPageContainer>
        <Box
          sx={{ display: "flex", alignItems: "center", gap: 2, minWidth: 0 }}
        >
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <DetailPageTabs
              value={activeDestination}
              onChange={handleProjectTabChange}
              tabs={tabs}
              overflow="scroll"
            />
          </Box>
          {project && currentOrgId && (
            <DiscussCapsuleAction
              entityId={project.id}
              entityType={EntityType.Project}
              entityTitle={project.name}
              organizationId={currentOrgId}
              projectId={project.id}
            />
          )}
        </Box>

        <AnimatePresence mode="wait">
          {activeDestination === "overview" && (
            <motion.div
              key="overview"
              variants={tabTransitionVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
            >
              <ProjectOverviewDestination
                organizationId={currentOrgId!}
                projectId={projectId!}
                project={project}
                isLoading={projectQuery.isLoading}
                error={projectQuery.error}
                onRetry={() => void projectQuery.refetch()}
              />
            </motion.div>
          )}

          {(activeDestination === "work" ||
            activeDestination === "knowledge") && (
            <motion.div
              key={`${activeDestination}:${
                selectedNavigationItem
                  ? getProjectNavigationItemKey(selectedNavigationItem)
                  : "empty"
              }`}
              variants={tabTransitionVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
            >
              {registryDestinationContent}
            </motion.div>
          )}

          {activeDestination === "reviews" && (
            <motion.div
              key="reviews"
              variants={tabTransitionVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
            >
              <Box sx={{ mt: 2 }}>
                <ProposalsTab
                  organizationId={currentOrgId!}
                  projectId={projectId!}
                />
              </Box>
            </motion.div>
          )}

          {activeDestination === "agents" && (
            <motion.div
              key="agents"
              variants={tabTransitionVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
            >
              <ProjectAgentsTab
                organizationId={currentOrgId!}
                projectId={projectId!}
                userId={userId!}
              />
            </motion.div>
          )}

          {activeDestination === "settings" && (
            <motion.div
              key="settings"
              variants={tabTransitionVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
            >
              <ProjectSettingsTab
                metadataItems={adminMetadataItems}
                organizationId={currentOrgId!}
                projectId={projectId!}
              />
            </motion.div>
          )}

          {activeDestination === "admin" && (
            <motion.div
              key="admin"
              variants={tabTransitionVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
            >
              <ProjectAdminDestination
                projectId={projectId!}
                organizationId={currentOrgId!}
              />
            </motion.div>
          )}

          {activeDestination === "help" && (
            <motion.div
              key="help"
              variants={tabTransitionVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
            >
              <ProjectHelpPage
                organizationId={currentOrgId!}
                projectId={projectId!}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </DetailPageContainer>
    </TrackingProvider>
  );
};

ProjectPage.displayName = "ProjectPage";
