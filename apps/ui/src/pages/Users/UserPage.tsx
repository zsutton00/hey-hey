import { CapsuleAction } from "@hey-hey/ui-common/components";
import { TrackingProvider } from "@hey-hey/ui-common/context";
import { useProject, useUsers } from "@hey-hey/ui-common/data";
import { useUserIdentity } from "@hey-hey/ui-common/hooks";
import { compose, TERMS } from "@hey-hey/ui-common/i18n";
import { WebPathService } from "@hey-hey/ui-common/services";
import type { OrganizationMemberResponseDto } from "@hey-hey/ui-common/api";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import ActivityIcon from "@mui/icons-material/Timeline";
import PersonIcon from "@mui/icons-material/Person";
import {
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  CircularProgress,
  Stack,
  Typography,
} from "@mui/material";
import { AnimatePresence, motion } from "motion/react";
import { parseAsStringLiteral, useQueryState } from "nuqs";
import React, { useCallback, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  DetailPageBody,
  DetailPageContainer,
  DetailPageHeader,
  DetailPageSidebar,
  DetailPageTabs,
  MetadataPanel,
  PageBreadcrumbs,
  type DetailPageTab,
  type MetadataItem,
} from "../../components/Layout";
import { AdminTab, buildAdminMetadataItems } from "../../components/Tabs";
import { AgentSessionsTab } from "../../components/Tabs/AgentSessionsTab";
import { tabTransitionVariants } from "../../utils/routeTransitions";
import { UserTasksTab } from "./UserTasksTab";
import { UserActivityTab } from "./UserActivityTab";

const TAB_VALUES = [
  "overview",
  "activity",
  "tasks",
  "agent-sessions",
  "admin",
] as const;

type TabValue = (typeof TAB_VALUES)[number];

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((part) => part.charAt(0))
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "N/A";
  return new Date(dateStr).toLocaleDateString();
}

export const UserDetailPage: React.FC = () => {
  const { organizationId, projectId, userId } = useParams<{
    organizationId: string;
    projectId: string;
    userId: string;
  }>();
  const navigate = useNavigate();
  const { currentOrgId } = useUserIdentity() || {};
  const membershipOrganizationId = organizationId ?? currentOrgId;
  const pageScope = projectId
    ? { scope: "project" as const, projectId }
    : organizationId
    ? { scope: "organization" as const, organizationId }
    : null;
  const isProjectUserPage = pageScope?.scope === "project";
  const [isContextualRailVisible, setIsContextualRailVisible] =
    useState(true);

  const [activeTab, setActiveTab] = useQueryState(
    "tab",
    parseAsStringLiteral(TAB_VALUES).withDefault("overview")
  );

  const { data: users, isLoading: isLoadingUsers } = useUsers(
    membershipOrganizationId,
    {
      enabled: !!membershipOrganizationId,
    }
  );

  const { data: project } = useProject(
    membershipOrganizationId || "",
    projectId || "",
    {
      enabled: !!membershipOrganizationId && !!projectId,
      preferStale: true,
    }
  );

  const member: OrganizationMemberResponseDto | undefined = useMemo(
    () => users.find((m) => m.userId === userId),
    [users, userId]
  );

  const user = member?.user;

  const handleBack = useCallback((): void => {
    navigate(projectId ? `/projects/${projectId}` : "/organizations");
  }, [navigate, projectId]);

  const handleViewActivity = useCallback((): void => {
    void setActiveTab("activity");
  }, [setActiveTab]);

  const handleToggleContextualRail = useCallback(() => {
    setIsContextualRailVisible((previous) => !previous);
  }, []);

  const handleTabChange = useCallback(
    (
      nextValue: TabValue | ((old: TabValue) => TabValue | null) | null
    ): void => {
      void setActiveTab(nextValue);
    },
    [setActiveTab]
  );

  if (isLoadingUsers) {
    return (
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "400px",
          p: 4,
          gap: 2,
        }}
      >
        <CircularProgress size={40} />
        <Typography variant="h6" color="text.secondary">
          Loading user...
        </Typography>
      </Box>
    );
  }

  if (!member || !user || !userId || !pageScope || !membershipOrganizationId) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="warning" sx={{ mb: 2 }}>
          User not found
        </Alert>
        <Button startIcon={<ArrowBackIcon />} onClick={handleBack}>
          {isProjectUserPage ? "Back to Project" : "Back to Organizations"}
        </Button>
      </Box>
    );
  }

  const tabs: DetailPageTab[] = [
    { value: "overview", label: "Overview" },
    ...(isProjectUserPage
      ? [
          { value: "activity", label: "Activity" },
          { value: "tasks", label: TERMS.Tasks },
          { value: "agent-sessions", label: "Agent Sessions" },
        ]
      : []),
    { value: "admin", label: "Admin" },
  ];
  const visibleActiveTab =
    !isProjectUserPage &&
    (activeTab === "activity" ||
      activeTab === "tasks" ||
      activeTab === "agent-sessions")
      ? "overview"
      : activeTab;

  const pagePath =
    pageScope.scope === "project"
      ? WebPathService.user({ projectId: pageScope.projectId, userId })
      : WebPathService.organizationUser({
          organizationId: pageScope.organizationId,
          userId,
        });

  const metadataItems: MetadataItem[] = [
    {
      label: "Role",
      value: <Chip label={member.role} size="small" />,
    },
    {
      label: "Status",
      value: member.isActive ? "Active" : "Inactive",
    },
    {
      label: "Joined",
      value: formatDate(member.joinedAt),
    },
    {
      label: "Last Login",
      value: formatDate(user.lastLoginAt),
    },
  ];

  const adminMetadataItems = buildAdminMetadataItems({
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  });

  const titleNode = (
    <Stack direction="row" spacing={2} alignItems="center">
      <Avatar
        sx={{
          width: 48,
          height: 48,
          bgcolor: "primary.main",
          fontSize: "1.25rem",
        }}
      >
        {getInitials(user.name)}
      </Avatar>
      <Box>
        <Typography variant="h5" component="span">
          {user.name}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {user.email}
        </Typography>
      </Box>
    </Stack>
  );

  return (
    <TrackingProvider
      context={{
        page: {
          name: "user",
          path: pagePath,
        },
        attentionEntity: {
          id: userId,
          type: "project",
        },
      }}
    >
      {isProjectUserPage && (
        <CapsuleAction
          id={`view-activity-user-${userId}`}
          label="View Activity"
          icon={ActivityIcon}
          actionGroup="page"
          tier="page"
          order={100}
          behavior="click"
          onClick={handleViewActivity}
        />
      )}

      <PageBreadcrumbs
        sx={{ mb: 2 }}
        items={
          projectId
            ? [
                { label: "Projects", to: "/projects" },
                {
                  label: project?.name ?? compose("{{term.Project}}"),
                  to: `/projects/${projectId}`,
                  type: project?.name ? "project" : undefined,
                },
                {
                  label: user.name,
                  isCurrent: true,
                  type: "user",
                  typeLabel: "User",
                },
              ]
            : [
                { label: "Organizations", to: "/organizations" },
                {
                  label: user.name,
                  isCurrent: true,
                  type: "user",
                  typeLabel: "User",
                },
              ]
        }
      />

      <DetailPageContainer>
        <DetailPageHeader
          title={titleNode}
          priorityChip={
            <Chip label={member.role} size="small" icon={<PersonIcon />} />
          }
          metadata={`Joined ${formatDate(member.joinedAt)}`}
        />

        <DetailPageTabs
          value={visibleActiveTab}
          onChange={handleTabChange}
          tabs={tabs}
        />

        <AnimatePresence mode="wait">
          {visibleActiveTab === "overview" && (
            <motion.div
              key="overview"
              variants={tabTransitionVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
            >
              <DetailPageBody
                contextualRail={{
                  id: `user-contextual-rail-${user.id}`,
                  label: "Metadata",
                  expanded: isContextualRailVisible,
                  onToggle: handleToggleContextualRail,
                }}
                sidebar={
                  <DetailPageSidebar
                    navigation={null}
                    metadata={<MetadataPanel items={metadataItems} />}
                  />
                }
                content={
                  <Box>
                    <Typography variant="h6" sx={{ mb: 2 }}>
                      Profile
                    </Typography>
                    <Stack spacing={2}>
                      <Box>
                        <Typography variant="subtitle2" color="text.secondary">
                          Name
                        </Typography>
                        <Typography variant="body1">{user.name}</Typography>
                      </Box>
                      <Box>
                        <Typography variant="subtitle2" color="text.secondary">
                          Email
                        </Typography>
                        <Typography variant="body1">{user.email}</Typography>
                      </Box>
                      <Box>
                        <Typography variant="subtitle2" color="text.secondary">
                          Organization Role
                        </Typography>
                        <Chip label={member.role} size="small" />
                      </Box>
                      <Box>
                        <Typography variant="subtitle2" color="text.secondary">
                          Account Status
                        </Typography>
                        <Chip
                          label={member.isActive ? "Active" : "Inactive"}
                          size="small"
                          color={member.isActive ? "success" : "default"}
                        />
                      </Box>
                      <Box>
                        <Typography variant="subtitle2" color="text.secondary">
                          Member Since
                        </Typography>
                        <Typography variant="body1">
                          {formatDate(member.joinedAt)}
                        </Typography>
                      </Box>
                      <Box>
                        <Typography variant="subtitle2" color="text.secondary">
                          Last Login
                        </Typography>
                        <Typography variant="body1">
                          {formatDate(user.lastLoginAt)}
                        </Typography>
                      </Box>
                    </Stack>
                  </Box>
                }
              />
            </motion.div>
          )}

          {pageScope.scope === "project" && visibleActiveTab === "activity" && (
            <motion.div
              key="activity"
              variants={tabTransitionVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
            >
              <UserActivityTab
                organizationId={membershipOrganizationId}
                projectId={pageScope.projectId}
                userId={userId}
              />
            </motion.div>
          )}

          {pageScope.scope === "project" && visibleActiveTab === "tasks" && (
            <motion.div
              key="tasks"
              variants={tabTransitionVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
            >
              <UserTasksTab
                organizationId={membershipOrganizationId}
                projectId={pageScope.projectId}
                userId={userId}
              />
            </motion.div>
          )}

          {pageScope.scope === "project" &&
            visibleActiveTab === "agent-sessions" && (
              <motion.div
                key="agent-sessions"
                variants={tabTransitionVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
              >
                <AgentSessionsTab
                  organizationId={membershipOrganizationId}
                  projectId={pageScope.projectId}
                  enableFilters
                  emptyMessage="No agent sessions found for this user."
                />
              </motion.div>
            )}

          {visibleActiveTab === "admin" && (
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
        </AnimatePresence>
      </DetailPageContainer>
    </TrackingProvider>
  );
};

UserDetailPage.displayName = "UserDetailPage";
