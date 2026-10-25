import {
  useModalState,
  ModalWorkOwner,
} from "@hey-hey/ui-common/components/Modals";
import {
  getBuiltInWorkItemIconKey,
  getWorkItemTypePluralDisplayName,
  WORK_ITEM_TYPE_KEYS,
} from "../../types/workItemTypes";
import {
  ProjectStatus,
  WorkItemTypeLifecycleStatus,
  type ProjectResponseDto,
  type ServiceDto,
  type TaskResponseDto,
  type WorkItemTypeDefinitionDto,
  type WorkItemTypeSummaryDto,
} from "@hey-hey/ui-common/api";
import {
  useProjects,
  useServices,
  useWorkItemTypes,
  usePlatformAdminAccess,
} from "@hey-hey/ui-common/data";
import { useAuth, useOrganization, useTheme } from "@hey-hey/ui-common/context";
import { HeyHeyBranding } from "@hey-hey/ui-common/components/Homepage";
import { KEYS } from "@hey-hey/ui-common/i18n";
import { getAuthToken } from "@hey-hey/ui-common/services";
import { EntityIcon } from "@hey-hey/ui-common/components/Entity";
import Brightness4Icon from "@mui/icons-material/Brightness4";
import Brightness7Icon from "@mui/icons-material/Brightness7";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import CheckIcon from "@mui/icons-material/Check";
import DevicesIcon from "@mui/icons-material/Devices";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import {
  Avatar,
  Box,
  Button,
  Collapse,
  CircularProgress,
  Divider,
  IconButton,
  ListSubheader,
  MenuItem,
  Switch,
  Stack,
  Typography,
} from "@mui/material";
import { parseAsString, useQueryState } from "nuqs";
import React, { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { ExplorerMinimal } from "./ExplorerMinimal";
import { ExplorerSearch } from "./ExplorerSearch";
import { ExplorerTree } from "./ExplorerTree";
import { MOBILE_ACTIONS_CAPSULE_CLEARANCE } from "./mobileActionsCapsule";
import { OpenItemsSection } from "./OpenItemsSection";
import {
  filterExplorerSections,
  flattenExplorerSections,
} from "./explorerSectionProjection";
import {
  ExplorerWorkItemQuery,
  type ExplorerWorkItemQueryState,
} from "./ExplorerWorkItemQuery";
import type {
  ExplorerNode,
  ExplorerSection,
  ExplorerSidebarProps,
} from "./types";
import { ReportProblemDialog } from "../ReportProblem/ReportProblemDialog";
import { ReportProblemMenuItem } from "../ReportProblem/ReportProblemMenuItem";

type ExplorerTaskDto = Pick<
  TaskResponseDto,
  | "id"
  | "name"
  | "type"
  | "status"
  | "priority"
  | "childCounts"
  | "parentTaskId"
  | "updatedAt"
  | "createdAt"
> & { hasFeatureChildren?: boolean };

/**
 * Transform a registry-resolved work item into an explorer node.
 * The type-scoped query supplies the exact registry key; the resolved
 * definition supplies the icon and display behavior.
 */
function workItemToNode(
  workItem: ExplorerTaskDto,
  definition: WorkItemTypeDefinitionDto,
  effectiveSource: WorkItemTypeSummaryDto["effectiveSource"],
): ExplorerNode {
  const isFeature = definition.key === WORK_ITEM_TYPE_KEYS.Feature;
  return {
    id: workItem.id,
    type: isFeature
      ? "feature"
      : definition.key === WORK_ITEM_TYPE_KEYS.Goal
        ? "goal"
        : definition.key === "PLAN"
          ? "plan"
          : "work-item",
    name: workItem.name,
    status: workItem.status,
    priority: workItem.priority,
    parentId: isFeature ? (workItem.parentTaskId ?? undefined) : undefined,
    hasChildren: isFeature && (workItem.hasFeatureChildren ?? false),
    depth: 0,
    workItemTypeKey: definition.key,
    workItemIcon: { typeKey: definition.key, definition, effectiveSource },
    iconType:
      definition.iconKey ??
      getBuiltInWorkItemIconKey(definition.key, definition) ??
      "task",
    updatedAt: workItem.updatedAt ? new Date(workItem.updatedAt) : undefined,
    createdAt: workItem.createdAt ? new Date(workItem.createdAt) : undefined,
  };
}

/**
 * Transform service DTO to explorer node
 */
function serviceToNode(service: ServiceDto): ExplorerNode {
  return {
    id: service.id,
    type: "service",
    name: service.name,
    status: service.status,
    hasChildren: false,
    depth: 0,
    tags: service.tags,
    updatedAt: service.updatedAt ? new Date(service.updatedAt) : undefined,
    createdAt: service.createdAt ? new Date(service.createdAt) : undefined,
  };
}

function getWorkItemSectionPath(typeKey: string, projectId: string): string {
  switch (typeKey) {
    case WORK_ITEM_TYPE_KEYS.Feature:
      return `/projects/${projectId}/features`;
    case WORK_ITEM_TYPE_KEYS.Goal:
      return `/projects/${projectId}/goals`;
    case "PLAN":
      return `/projects/${projectId}/plans`;
    default:
      return `/projects/${projectId}/collections/${typeKey}`;
  }
}

function getProjectPath(
  project: Pick<ProjectResponseDto, "id" | "status">,
): string {
  return project.status === ProjectStatus.Active
    ? `/projects/${project.id}`
    : `/projects/${project.id}/onboarding`;
}

function areWorkItemQueryStatesEqual(
  previous: ExplorerWorkItemQueryState | undefined,
  next: ExplorerWorkItemQueryState,
): boolean {
  if (!previous) return false;
  if (
    previous.isLoading !== next.isLoading ||
    previous.error !== next.error ||
    previous.workItems.length !== next.workItems.length
  ) {
    return false;
  }

  return previous.workItems.every((previousItem, index) => {
    const nextItem = next.workItems[index];
    return (
      previousItem.id === nextItem.id &&
      previousItem.name === nextItem.name &&
      previousItem.type === nextItem.type &&
      previousItem.status === nextItem.status &&
      previousItem.priority === nextItem.priority &&
      previousItem.parentTaskId === nextItem.parentTaskId &&
      previousItem.updatedAt === nextItem.updatedAt &&
      previousItem.createdAt === nextItem.createdAt &&
      previousItem.childCounts?.total === nextItem.childCounts?.total &&
      previousItem.hasFeatureChildren === nextItem.hasFeatureChildren
    );
  });
}

/**
 * VSCode-style explorer sidebar for unified entity navigation
 */
export const ExplorerSidebar: React.FC<ExplorerSidebarProps> = ({
  projectId,
  organizationId,
  isMinimal,
  isMobileDrawer = false,
  onMobileNavigate,
}) => {
  const resolvedProjectId = projectId ?? "";
  const hasProjectContext = Boolean(projectId);
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { isAuthenticated, user, logout } = useAuth();
  const { mode, toggleMode } = useTheme();
  const { isPlatformAdmin } = usePlatformAdminAccess();
  const { organizations, currentOrganization, switchOrganization } =
    useOrganization();
  const organizationProjectsSectionKey = "organization-projects";

  const {
    projects,
    error: projectsError,
    isLoading: isLoadingProjects,
    isFetched: isProjectsFetched,
    isReady: isProjectsReady,
  } = useProjects(organizationId, {
    enabled: !hasProjectContext && Boolean(organizationId),
  });

  const isOrganizationProjectsLoading =
    !hasProjectContext &&
    (isLoadingProjects || !isProjectsFetched || !isProjectsReady);

  // Fetch current project and all projects for switching
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [reportProblemOpen, setReportProblemOpen, reportProblemOpenOwnerKey] =
    useModalState(false);
  const userMenuButtonRef = useRef<HTMLButtonElement>(null);

  // URL state for persistence
  const [urlSearchTerm, setUrlSearchTerm] = useQueryState(
    "explorer_search",
    parseAsString.withDefault(""),
  );
  const [visibleOpenItemsCount, setVisibleOpenItemsCount] = useState(0);

  // Start with all nodes collapsed
  const [expandedNodesSet, setExpandedNodesSet] = useState<Set<string>>(
    new Set<string>(),
  );

  // Track which entity groups are expanded (for lazy loading)
  const [expandedEntityGroups, setExpandedEntityGroups] = useState<Set<string>>(
    () => {
      try {
        const stored = localStorage.getItem("explorer_expanded_groups");
        if (stored) {
          const parsed = JSON.parse(stored) as string[];
          const groups = new Set(
            parsed.map((group) =>
              group === "coding_run" ? "agent_session" : group,
            ),
          );
          if (!hasProjectContext) {
            groups.add(organizationProjectsSectionKey);
          }
          return groups;
        }
      } catch (error) {
        console.error(
          "Failed to load expanded groups from localStorage:",
          error,
        );
      }
      return hasProjectContext
        ? new Set<string>()
        : new Set([organizationProjectsSectionKey]);
    },
  );

  // Determine whether to render the flat search result view.
  const isSearching = !!urlSearchTerm.trim();

  const {
    workItemTypes,
    isLoading: isLoadingWorkItemTypes,
    isReady: isWorkItemTypesReady,
  } = useWorkItemTypes(organizationId, {
    projectId,
    status: WorkItemTypeLifecycleStatus.Active,
    enabled: hasProjectContext,
  });

  const {
    services,
    isLoading: isLoadingServices,
    isFetched: isServicesFetched,
    error: servicesError,
  } = useServices(organizationId, {
    projectId,
    enabled: hasProjectContext,
  });

  const explorerWorkItemDefinitions = useMemo(
    () =>
      isWorkItemTypesReady
        ? workItemTypes.filter(
            (summary) =>
              summary.status === WorkItemTypeLifecycleStatus.Active &&
              summary.definition.capabilities?.showsInExplorerSidebar === true,
          )
        : [],
    [isWorkItemTypesReady, workItemTypes],
  );

  const [workItemQueryStates, setWorkItemQueryStates] = useState<
    Record<string, ExplorerWorkItemQueryState>
  >({});

  const handleWorkItemQueryStateChange = useCallback(
    (typeKey: string, state: ExplorerWorkItemQueryState) => {
      setWorkItemQueryStates((previous) => {
        const previousState = previous[typeKey];
        if (areWorkItemQueryStatesEqual(previousState, state)) {
          return previous;
        }

        return { ...previous, [typeKey]: state };
      });
    },
    [],
  );

  const workItemQueriesLoading =
    isWorkItemTypesReady &&
    explorerWorkItemDefinitions.some(
      (summary) =>
        workItemQueryStates[summary.definition.key]?.isLoading !== false,
    );

  // Only show global loading when searching (all data must load) or on initial load
  const isGlobalLoading =
    isSearching &&
    (isLoadingWorkItemTypes || workItemQueriesLoading || isLoadingServices);

  // Work items are supplementary to the shell and their collections can fail
  // independently. Keep the explorer chrome and the other sections available
  // when one type-specific request fails.
  const error = servicesError;

  const workItemNodesByType = useMemo(() => {
    const nodesByType = new Map<string, ExplorerNode[]>();

    for (const summary of explorerWorkItemDefinitions) {
      const nodes = (
        workItemQueryStates[summary.definition.key]?.workItems ?? []
      )
        .filter((workItem) => workItem.type === summary.definition.key)
        .map((workItem) =>
          workItemToNode(workItem, summary.definition, summary.effectiveSource),
        )
        .sort((a, b) =>
          a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
        );

      nodesByType.set(summary.definition.key, nodes);
    }

    return nodesByType;
  }, [explorerWorkItemDefinitions, workItemQueryStates]);

  const rawSections = useMemo<ExplorerSection[]>(() => {
    const configuredSections = explorerWorkItemDefinitions.map((summary) => {
      const key = `work-item:${summary.definition.key}`;
      const queryState = workItemQueryStates[summary.definition.key];
      const nodes = (workItemNodesByType.get(summary.definition.key) ?? []).map(
        (node) => ({ ...node, sectionKey: key }),
      );

      return {
        key,
        label:
          getWorkItemTypePluralDisplayName(summary.definition) ??
          summary.definition.name,
        path: getWorkItemSectionPath(summary.definition.key, resolvedProjectId),
        previewCollection:
          summary.definition.key === WORK_ITEM_TYPE_KEYS.Feature
            ? "features"
            : summary.definition.key === WORK_ITEM_TYPE_KEYS.Goal
              ? "goals"
              : summary.definition.key === "PLAN"
                ? "plans"
                : undefined,
        nodes,
        count:
          queryState?.isLoading || queryState?.error ? undefined : nodes.length,
        isLoading: queryState?.isLoading ?? isWorkItemTypesReady,
      } satisfies ExplorerSection;
    });

    const serviceNodes = (services ?? []).map((service) => ({
      ...serviceToNode(service),
      sectionKey: "services",
    }));

    return [
      ...configuredSections,
      {
        key: "services",
        label: "Services",
        path: `/projects/${resolvedProjectId}/services`,
        previewCollection: "services",
        nodes: serviceNodes,
        count: isLoadingServices ? undefined : serviceNodes.length,
        isLoading: isLoadingServices || isServicesFetched === false,
      },
    ];
  }, [
    explorerWorkItemDefinitions,
    isLoadingServices,
    isServicesFetched,
    isWorkItemTypesReady,
    resolvedProjectId,
    services,
    workItemQueryStates,
    workItemNodesByType,
  ]);

  const filteredSections = useMemo(
    () => filterExplorerSections(rawSections, urlSearchTerm),
    [rawSections, urlSearchTerm],
  );

  const filteredNodes = useMemo(
    () => flattenExplorerSections(filteredSections),
    [filteredSections],
  );

  // Handle search term change (debounced via nuqs)
  const handleSearchChange = useCallback(
    (term: string) => {
      setUrlSearchTerm(term);
    },
    [setUrlSearchTerm],
  );

  // Handle node toggle (expand/collapse)
  const handleToggleNode = useCallback((nodeId: string) => {
    setExpandedNodesSet((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  }, []);

  // Explorer rows navigate directly; the sidebar does not persist a separate
  // selected row state.
  const selectedNodeId: string | undefined = undefined;
  const handleSelectNode = useCallback((_node: ExplorerNode) => {}, []);

  // Handle toggle entity group
  const handleToggleEntityGroup = useCallback((groupType: string) => {
    setExpandedEntityGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupType)) {
        next.delete(groupType);
      } else {
        next.add(groupType);
      }
      try {
        localStorage.setItem(
          "explorer_expanded_groups",
          JSON.stringify(Array.from(next)),
        );
      } catch (error) {
        console.error("Failed to save expanded groups to localStorage:", error);
      }
      return next;
    });
  }, []);

  const handleUserMenuToggle = useCallback(() => {
    setIsUserMenuOpen((open) => !open);
  }, []);

  const handleUserMenuClose = useCallback(() => {
    setIsUserMenuOpen(false);
  }, []);

  const handleUserMenuNavigation = useCallback(
    (path: string) => {
      navigate(path);
      handleUserMenuClose();
      onMobileNavigate?.();
    },
    [handleUserMenuClose, navigate, onMobileNavigate],
  );

  const handleLogout = useCallback(async () => {
    await logout();
    handleUserMenuNavigation("/");
  }, [handleUserMenuNavigation, logout]);

  const handleOrgSwitch = useCallback(
    async (orgId: string) => {
      try {
        await switchOrganization(orgId);
      } catch {
        return;
      }
      handleUserMenuClose();
      onMobileNavigate?.();
    },
    [handleUserMenuClose, onMobileNavigate, switchOrganization],
  );

  const renderUserMenuContent = (): React.ReactNode[] => [
    <MenuItem key="user-menu-email" disabled>
      <Typography variant="body2" color="text.secondary">
        {user?.email}
      </Typography>
    </MenuItem>,
    <Divider key="user-menu-email-divider" />,
    <MenuItem
      key="user-menu-projects"
      onClick={() => handleUserMenuNavigation("/projects")}
    >
      {t(KEYS.navigation.myProjects)}
    </MenuItem>,
    ...(projectId
      ? [
          <MenuItem
            key="user-menu-settings"
            data-testid="user-menu-settings"
            component="a"
            href={`/projects/${projectId}/settings`}
            onClick={(e: React.MouseEvent<HTMLAnchorElement>) => {
              if (!e.ctrlKey && !e.metaKey && !e.shiftKey) {
                e.preventDefault();
                handleUserMenuNavigation(`/projects/${projectId}/settings`);
              }
            }}
          >
            {t(KEYS.navigation.settings)}
          </MenuItem>,
          <MenuItem
            key="user-menu-pairing"
            data-testid="user-menu-pairing"
            component="a"
            href={`/projects/${projectId}/settings?section=pairing`}
            onClick={(e: React.MouseEvent<HTMLAnchorElement>) => {
              if (!e.ctrlKey && !e.metaKey && !e.shiftKey) {
                e.preventDefault();
                handleUserMenuNavigation(
                  `/projects/${projectId}/settings?section=pairing`,
                );
              }
            }}
            sx={{ display: "flex", alignItems: "center", gap: 1 }}
          >
            <DevicesIcon fontSize="small" />
            {t("navigation.pairing", "Pairing")}
          </MenuItem>,
        ]
      : []),
    ...(isPlatformAdmin
      ? [
          <MenuItem
            key="user-menu-admin"
            data-testid="user-menu-admin"
            component="a"
            href="/admin"
            onClick={(event: React.MouseEvent<HTMLAnchorElement>) => {
              if (
                !event.ctrlKey &&
                !event.metaKey &&
                !event.shiftKey &&
                event.button === 0
              ) {
                event.preventDefault();
                handleUserMenuNavigation("/admin");
              }
            }}
          >
            {t("admin.title")}
          </MenuItem>,
        ]
      : []),
    ...(isPlatformAdmin
      ? [
          <Divider key="debug-divider" />,
          <MenuItem
            key="internal-reports"
            component="a"
            href="/debug/internal-reports"
            onClick={(e: React.MouseEvent<HTMLAnchorElement>) => {
              if (!e.ctrlKey && !e.metaKey && !e.shiftKey) {
                e.preventDefault();
                handleUserMenuNavigation("/debug/internal-reports");
              }
            }}
          >
            Internal Reports
          </MenuItem>,
        ]
      : []),
    ...(isPlatformAdmin
      ? [
          <Divider key="dev-divider" />,
          <ListSubheader
            key="dev-header"
            disableSticky
            sx={{ lineHeight: "30px" }}
          >
            Developer Tools
          </ListSubheader>,
          <MenuItem
            key="llm-tracking"
            component="a"
            href="/llm-tracking"
            onClick={(e: React.MouseEvent<HTMLAnchorElement>) => {
              if (!e.ctrlKey && !e.metaKey && !e.shiftKey) {
                e.preventDefault();
                handleUserMenuNavigation("/llm-tracking");
              }
            }}
          >
            LLM Tracking
          </MenuItem>,
          <MenuItem
            key="copy-token"
            onClick={() => {
              const token = getAuthToken();
              if (token) {
                navigator.clipboard.writeText(token);
              }
              handleUserMenuClose();
            }}
          >
            Copy Access Token
          </MenuItem>,
        ]
      : []),
    <Divider key="user-menu-theme-divider" />,
    <MenuItem
      key="user-menu-theme"
      sx={{ justifyContent: "space-between", gap: 2 }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        {mode === "light" ? (
          <Brightness4Icon fontSize="small" />
        ) : (
          <Brightness7Icon fontSize="small" />
        )}
        <Typography variant="body2">Dark mode</Typography>
      </Box>
      <Switch
        checked={mode === "dark"}
        onClick={(event) => event.stopPropagation()}
        onChange={toggleMode}
      />
    </MenuItem>,
    <Divider key="user-menu-organizations-divider" />,
    <Box
      component="a"
      key="user-menu-organizations"
      data-testid="user-menu-organizations"
      href="/organizations"
      onClick={(event: React.MouseEvent<HTMLAnchorElement>) => {
        if (
          !event.ctrlKey &&
          !event.metaKey &&
          !event.shiftKey &&
          event.button === 0
        ) {
          event.preventDefault();
          handleUserMenuNavigation("/organizations");
        }
      }}
      sx={{
        display: "flex",
        alignItems: "center",
        px: 1,
        py: 0.75,
        minHeight: 44,
        textDecoration: "none",
        cursor: "pointer",
        borderRadius: 1,
        transition: "background-color 0.2s",
        "&:hover": {
          bgcolor: "action.hover",
        },
      }}
    >
      <Typography
        variant="body2"
        sx={{
          fontWeight: 600,
          letterSpacing: 0.5,
          textTransform: "uppercase",
          fontSize: "0.8125rem",
          color: mode === "light" ? "heyhey.main" : "cadetblue",
        }}
      >
        Organizations
      </Typography>
    </Box>,
    ...organizations.map((organization) => (
      <MenuItem
        key={organization.id}
        data-testid="user-menu-organization-choice"
        data-organization-id={organization.id}
        onClick={() => handleOrgSwitch(organization.id)}
        sx={{ justifyContent: "space-between", gap: 2 }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography
            variant="body2"
            sx={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {organization.name}
          </Typography>
          {organization.description && (
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{
                display: "block",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {organization.description}
            </Typography>
          )}
        </Box>
        {organization.id === currentOrganization?.id && (
          <CheckIcon fontSize="small" color="primary" />
        )}
      </MenuItem>
    )),
    <Divider key="user-menu-report-divider" />,
    <ReportProblemMenuItem
      key="user-menu-report-problem"
      onSelect={() => {
        handleUserMenuClose();
        setReportProblemOpen(true);
      }}
    />,
    <MenuItem key="user-menu-logout" onClick={handleLogout}>
      {t(KEYS.auth.logout)}
    </MenuItem>,
  ];
  // Calculate result count
  const resultCount = isSearching
    ? filteredNodes.length + visibleOpenItemsCount
    : undefined;

  // Render minimal icon-only mode when drawer is narrow
  if (isMinimal && hasProjectContext) {
    return <ExplorerMinimal projectId={resolvedProjectId} />;
  }

  return (
    <Box
      sx={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        bgcolor: "background.paper",
        overflow: "hidden",
      }}
    >
      {hasProjectContext &&
        explorerWorkItemDefinitions.map((summary) => (
          <ExplorerWorkItemQuery
            definition={summary.definition}
            enabled={isWorkItemTypesReady}
            key={summary.definition.key}
            onStateChange={handleWorkItemQueryStateChange}
            organizationId={organizationId}
            projectId={resolvedProjectId}
          />
        ))}

      <Box sx={{ flexShrink: 0, borderBottom: 1, borderColor: "divider" }}>
        <Box sx={{ px: 1.5, pt: 1.25, pb: 1 }}>
          <Box
            component="button"
            onClick={() => navigate("/")}
            sx={{
              "& .MuiTypography-root": {
                color: mode === "light" ? "text.primary" : "common.white",
              },
              display: "flex",
              alignItems: "center",
              width: "100%",
              border: "none",
              background: "none",
              cursor: "pointer",
              p: 0,
              position: "relative",
              left: 6,
              textAlign: "left",
            }}
          >
            <HeyHeyBranding variant="header" />
          </Box>
        </Box>

        {hasProjectContext && (
          <ExplorerSearch
            searchTerm={urlSearchTerm}
            onSearchChange={handleSearchChange}
            resultCount={resultCount}
          />
        )}
      </Box>

      {/* Tree Content */}
      {hasProjectContext ? (
        <Box
          sx={{
            flexGrow: 1,
            overflow: "auto",
            px: 1,
            pt: 0.5,
            pb: 1,
          }}
        >
          {isGlobalLoading ? (
            <Stack
              alignItems="center"
              justifyContent="center"
              sx={{ height: "100%", py: 4 }}
            >
              <CircularProgress size={32} />
              <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                {t(KEYS.explorer.loading)}
              </Typography>
            </Stack>
          ) : error ? (
            <Stack alignItems="center" sx={{ py: 4 }}>
              <Typography variant="body2" color="error">
                {t(KEYS.explorer.error)}
              </Typography>
            </Stack>
          ) : (
            <>
              <OpenItemsSection
                organizationId={organizationId}
                projectId={resolvedProjectId}
                searchTerm={urlSearchTerm}
                onVisibleCountChange={setVisibleOpenItemsCount}
              />
              <Divider
                data-testid="open-items-features-divider"
                sx={{ my: 1 }}
              />
              <ExplorerTree
                nodes={filteredNodes}
                expandedNodes={expandedNodesSet}
                selectedNodeId={selectedNodeId}
                onToggleNode={handleToggleNode}
                onSelectNode={handleSelectNode}
                isSearching={isSearching}
                expandedEntityGroups={expandedEntityGroups}
                onToggleEntityGroup={handleToggleEntityGroup}
                sections={filteredSections}
                organizationId={organizationId}
                projectId={resolvedProjectId}
              />
            </>
          )}
        </Box>
      ) : (
        <Box
          data-testid="organization-projects"
          sx={{
            flexGrow: 1,
            overflow: "auto",
            px: 1,
            pt: 0.5,
            pb: 1,
          }}
        >
          <Box
            data-testid="organization-projects-header"
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 0.5,
              mb: 0.5,
            }}
          >
            <IconButton
              aria-label={`${expandedEntityGroups.has(organizationProjectsSectionKey) ? "Collapse" : "Expand"} projects`}
              data-testid="organization-projects-toggle"
              onClick={() =>
                handleToggleEntityGroup(organizationProjectsSectionKey)
              }
              size="small"
              sx={{
                color: mode === "light" ? "heyhey.main" : "cadetblue",
                flexShrink: 0,
              }}
            >
              {expandedEntityGroups.has(organizationProjectsSectionKey) ? (
                <ExpandMoreIcon fontSize="small" />
              ) : (
                <ChevronRightIcon fontSize="small" />
              )}
            </IconButton>
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                px: 1,
                py: 0.75,
                flex: 1,
                borderRadius: 1,
              }}
            >
              <Typography
                variant="body2"
                sx={{
                  fontWeight: 600,
                  letterSpacing: 0.5,
                  textTransform: "uppercase",
                  fontSize: "0.8125rem",
                  color: mode === "light" ? "heyhey.main" : "cadetblue",
                  textAlign: "left",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  flexGrow: 1,
                }}
              >
                PROJECTS (
                {isOrganizationProjectsLoading ? "…" : projects.length})
              </Typography>
            </Box>
          </Box>
          <Collapse
            in={expandedEntityGroups.has(organizationProjectsSectionKey)}
            timeout={200}
          >
            {projectsError ? (
              <Typography
                color="error"
                data-testid="organization-projects-error"
              >
                {t(KEYS.explorer.error)}
              </Typography>
            ) : isOrganizationProjectsLoading ? (
              <Stack
                alignItems="center"
                data-testid="organization-projects-loading"
                justifyContent="center"
                sx={{ py: 2 }}
              >
                <CircularProgress size={20} />
              </Stack>
            ) : projects.length === 0 ? (
              <Typography
                color="text.secondary"
                data-testid="organization-projects-empty"
              >
                {t("projects.noProjects", "No projects yet")}
              </Typography>
            ) : (
              <Stack spacing={0.5}>
                {projects.map((project) => {
                  const path = getProjectPath(project);
                  return (
                    <Box
                      component="a"
                      data-project-id={project.id}
                      data-testid={`organization-project-${project.id}`}
                      href={path}
                      key={project.id}
                      onClick={(event: React.MouseEvent<HTMLAnchorElement>) => {
                        if (
                          event.button === 0 &&
                          !event.ctrlKey &&
                          !event.metaKey &&
                          !event.shiftKey
                        ) {
                          event.preventDefault();
                          navigate(path);
                        }
                      }}
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        gap: 0,
                        bgcolor: "transparent",
                        borderRadius: 1,
                        transition: "background-color 0.2s",
                        "&:hover": { bgcolor: "action.hover" },
                      }}
                      tabIndex={0}
                    >
                      <Box sx={{ width: 28, flexShrink: 0 }} />
                      <Box
                        sx={{
                          display: "flex",
                          alignItems: "center",
                          gap: 1,
                          flex: 1,
                          px: 1,
                          width: "100%",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          py: 0.75,
                          cursor: "pointer",
                          textDecoration: "none",
                          color: "inherit",
                        }}
                      >
                        <Box
                          sx={{
                            display: "flex",
                            width: 24,
                            height: 24,
                            alignItems: "center",
                            justifyContent: "center",
                            flex: "0 0 24px",
                          }}
                        >
                          <EntityIcon entityType="project" size={24} />
                        </Box>
                        <Typography
                          variant="body2"
                          sx={{
                            flexGrow: 1,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            fontSize: "0.875rem",
                          }}
                        >
                          {project.name}
                        </Typography>
                      </Box>
                    </Box>
                  );
                })}
              </Stack>
            )}
          </Collapse>
        </Box>
      )}

      <Box
        data-testid={isMobileDrawer ? "mobile-account-container" : undefined}
        sx={{
          // The expanded action list can be taller than the drawer's remaining
          // space after the Explorer header. Let this region shrink on mobile
          // so the Collapse yields space while the account row stays pinned.
          flexShrink: isMobileDrawer ? 1 : 0,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          borderTop: 1,
          borderColor: "divider",
          p: 1,
          pb: isMobileDrawer
            ? `calc(${MOBILE_ACTIONS_CAPSULE_CLEARANCE}px + env(safe-area-inset-bottom))`
            : 1,
        }}
      >
        {isAuthenticated ? (
          <>
            <Collapse
              id="account-actions"
              in={isUserMenuOpen}
              role="group"
              aria-label="Account actions"
              tabIndex={0}
              timeout="auto"
              unmountOnExit
              sx={{
                minHeight: 0,
                order: 1,
                maxHeight: isMobileDrawer
                  ? `calc(100dvh - ${MOBILE_ACTIONS_CAPSULE_CLEARANCE}px - 60px - env(safe-area-inset-bottom))`
                  : "min(50vh, 480px)",
                maxWidth: "100%",
                overflowY: "auto",
                overflowX: "hidden",
                WebkitOverflowScrolling: "touch",
              }}
            >
              <Box
                sx={{
                  pt: 0.5,
                  pb: 1,
                }}
              >
                {renderUserMenuContent()}
              </Box>
            </Collapse>
            <Box
              component="button"
              ref={userMenuButtonRef}
              aria-label="Account menu"
              aria-expanded={isUserMenuOpen}
              aria-controls="account-actions"
              onClick={handleUserMenuToggle}
              sx={{
                flexShrink: 0,
                order: 2,
                width: "100%",
                minHeight: 44,
                display: "flex",
                alignItems: "center",
                gap: 1,
                px: 1,
                py: 0.75,
                border: "none",
                background: "none",
                borderRadius: 1,
                cursor: "pointer",
                color: "text.primary",
                textAlign: "left",
                "&:hover": {
                  bgcolor: "action.hover",
                },
                "&:focus-visible": {
                  outline: "2px solid",
                  outlineColor: "primary.main",
                  outlineOffset: 2,
                },
              }}
            >
              <Avatar sx={{ width: 28, height: 28 }}>
                {user?.name?.[0] || user?.email?.[0] || "U"}
              </Avatar>
              <Box sx={{ minWidth: 0 }}>
                <Typography
                  variant="body2"
                  sx={{
                    fontWeight: 600,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {user?.name || user?.email}
                </Typography>
                {currentOrganization && (
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{
                      display: "block",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {currentOrganization.name}
                  </Typography>
                )}
              </Box>
            </Box>
            <ModalWorkOwner.Provider value={reportProblemOpenOwnerKey}>
              <ReportProblemDialog
                open={reportProblemOpen}
                onClose={() => setReportProblemOpen(false)}
                productLocation={location.pathname + location.search}
                returnFocusRef={userMenuButtonRef}
              />
            </ModalWorkOwner.Provider>
          </>
        ) : (
          <Button
            fullWidth
            variant="outlined"
            onClick={() => navigate("/login")}
          >
            {t(KEYS.auth.login)}
          </Button>
        )}
      </Box>
    </Box>
  );
};
