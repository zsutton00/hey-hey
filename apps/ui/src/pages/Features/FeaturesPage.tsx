import { WORK_ITEM_TYPE_KEYS } from "../../types/workItemTypes";
import React, { useState, useCallback, useEffect, useMemo } from "react";
import {
  Alert,
  Box,
  Button,
  Typography,
  useMediaQuery,
  useTheme,
  type SxProps,
  type Theme,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";
import { parseAsString, parseAsStringLiteral, useQueryState } from "nuqs";
import {
  AgentSessionType,
  EntityType,
  UnifiedSearchIntent,
} from "@hey-hey/ui-common/api";
import type {
  AgentSessionDto,
  CreateFeatureDto,
  UnifiedSearchResult,
} from "@hey-hey/ui-common/api";
import {
  buildDefaultSurfaceSelection,
  EntitySearchChat,
  NewFeatureModal,
  type EntitySearchChatProps,
  type SurfaceSelection,
} from "@hey-hey/ui-common/components";
import {
  useCreateAgentSession,
  useProject,
  useUnifiedSearch,
  useWorkItems,
} from "@hey-hey/ui-common/data";
import { useUserIdentity } from "@hey-hey/ui-common/hooks";
import {
  DetailPageContainer,
  DetailPageHeader,
  DetailPageTabs,
  PageBreadcrumbs,
} from "../../components/Layout";
import { useSuppressLayoutMainBottomSpacing } from "../../components/Layout/LayoutMainBottomSpacingContext";
import { SegmentedToggle } from "../../components/SegmentedToggle";
import { useRemainingViewportHeight } from "../../hooks/useRemainingViewportHeight";
import { usePreviewPresentation } from "../../contexts/PreviewPresentationContext";
import { DiscussFeatureTreeActionCapsule } from "./DiscussFeatureTreeActionCapsule";
import {
  FeatureContentSearch,
  type FeatureSearchMode,
} from "./FeatureContentSearch";
import { FeatureConversationsTab } from "./FeatureConversationsTab";
import { FeatureReportsTab } from "./FeatureReportsTab";
import { FeaturesDocumentView } from "./FeaturesDocumentView";
import { FeaturesTreeView } from "./FeaturesTreeView";

const FEATURES_PAGE_TABS = ["features", "reports", "conversations"] as const;
type FeaturesPageTab = (typeof FEATURES_PAGE_TABS)[number];

const FEATURES_PAGE_VIEWS = ["tree", "document"] as const;
type FeaturesPageView = (typeof FEATURES_PAGE_VIEWS)[number];
const TREE_LAYOUTS = ["left-to-right", "top-down"] as const;
type TreeLayout = (typeof TREE_LAYOUTS)[number];
const TREE_LAYOUT_STORAGE_KEY = "features-tree-layout";

const featureAgentSearchEntityTypes = [EntityType.Task] as NonNullable<
  EntitySearchChatProps["entityTypes"]
>;

export interface FeaturesPageProps {
  organizationId?: string;
  projectId?: string;
  preview?: boolean;
}

export const FeaturesPage: React.FC<FeaturesPageProps> = ({
  organizationId,
  projectId: projectIdProp,
  preview = false,
}) => {
  const { t } = useTranslation();
  const { projectId: routeProjectId } = useParams<{ projectId: string }>();
  const { currentOrgId: identityOrganizationId } = useUserIdentity() || {};
  const projectId = projectIdProp ?? routeProjectId;
  const currentOrgId = organizationId ?? identityOrganizationId;
  const theme = useTheme();
  const isMobileViewport = useMediaQuery(theme.breakpoints.down("md"));
  const isPreviewPresentation = usePreviewPresentation();

  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  const [activeTab, setActiveTab] = useQueryState(
    "tab",
    parseAsStringLiteral(FEATURES_PAGE_TABS).withDefault("features"),
  );

  const [view, setView] = useQueryState(
    "view",
    parseAsStringLiteral(FEATURES_PAGE_VIEWS).withDefault("document"),
  );
  const [layoutQuery, setLayoutQuery] = useQueryState(
    "layout",
    parseAsStringLiteral(TREE_LAYOUTS),
  );
  const [savedLayout, setSavedLayout] = useState<TreeLayout>(() => {
    try {
      return localStorage.getItem(TREE_LAYOUT_STORAGE_KEY) === "top-down"
        ? "top-down"
        : "left-to-right";
    } catch {
      return "left-to-right";
    }
  });
  const treeLayout = layoutQuery ?? savedLayout;
  useEffect(() => {
    if (!layoutQuery) return;
    setSavedLayout(layoutQuery);
    try {
      localStorage.setItem(TREE_LAYOUT_STORAGE_KEY, layoutQuery);
    } catch {
      /* Storage may be unavailable. */
    }
  }, [layoutQuery]);
  const handleLayoutChange = (layout: TreeLayout): void => {
    setSavedLayout(layout);
    void setLayoutQuery(layout);
    try {
      localStorage.setItem(TREE_LAYOUT_STORAGE_KEY, layout);
    } catch {
      /* Storage may be unavailable. */
    }
  };
  const [, setFeatureQuery] = useQueryState("feature", parseAsString);
  const [, setSectionQuery] = useQueryState("section", parseAsString);

  const [contentSearch, setContentSearch] = useQueryState(
    "contentSearch",
    parseAsString.withDefault(""),
  );

  const [searchMode, setSearchMode] = useState<FeatureSearchMode>(() =>
    contentSearch ? "content" : "title",
  );
  const [titleSearchQuery, setTitleSearchQuery] = useState("");
  const [isFeatureSearchFocused, setIsFeatureSearchFocused] = useState(false);
  const [hasMobileSearchSelection, setHasMobileSearchSelection] =
    useState(false);
  const [agentSearchQuery, setAgentSearchQuery] = useState("");
  const [agentInitialMessage, setAgentInitialMessage] = useState<string | null>(
    null,
  );
  const [agentSession, setAgentSession] = useState<AgentSessionDto | null>(
    null,
  );
  const [agentSearchError, setAgentSearchError] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<UnifiedSearchResult[]>([]);
  const [agentSelection, setAgentSelection] = useState<SurfaceSelection | null>(
    null,
  );

  const { data: project } = useProject(currentOrgId ?? "", projectId ?? "", {
    enabled: !!currentOrgId && !!projectId,
  });

  const { createTask } = useWorkItems(
    currentOrgId ?? "",
    "task",
    projectId ?? "",
    undefined,
    {
      taskType: WORK_ITEM_TYPE_KEYS.Feature,
      enabled: !!currentOrgId && !!projectId,
    },
  );

  const { unifiedSearch } = useUnifiedSearch(
    currentOrgId ?? "",
    projectId ?? "",
  );

  const createAgentSessionMutation = useCreateAgentSession({
    onSuccess: (session) => {
      setAgentSearchError(null);
      setAgentSession(session);
    },
    onError: (error) => {
      setAgentSearchError(
        error instanceof Error
          ? error.message
          : t("features.agentSearch.error", "Failed to start agent search."),
      );
    },
  });

  const runContentSearch = useCallback(
    async (query: string): Promise<void> => {
      if (!query.trim() || !currentOrgId || !projectId) return;
      const response = await unifiedSearch({
        intent: UnifiedSearchIntent.Semantic,
        query: query.trim(),
        common: {
          types: [EntityType.Task],
          taskTypes: [WORK_ITEM_TYPE_KEYS.Feature],
        },
      });
      setSearchResults(response?.results ?? []);
    },
    [currentOrgId, projectId, unifiedSearch],
  );

  useEffect(() => {
    if (searchMode === "content" && contentSearch) {
      void runContentSearch(contentSearch);
    } else {
      setSearchResults([]);
    }
  }, [contentSearch, runContentSearch, searchMode]);

  const handleCreateFeature = useCallback(
    async (formData: CreateFeatureDto): Promise<void> => {
      setIsCreating(true);
      try {
        await createTask({ ...formData, type: WORK_ITEM_TYPE_KEYS.Feature });
        setCreateModalOpen(false);
      } finally {
        setIsCreating(false);
      }
    },
    [createTask],
  );

  const handleFeatureSearchSelect = useCallback(
    (featureId: string, rootId: string): void => {
      setHasMobileSearchSelection(true);
      void setFeatureQuery(rootId);
      void setSectionQuery(featureId);
      void setView("document");
    },
    [setFeatureQuery, setSectionQuery, setView],
  );

  const handleFeatureSearchFocusChange = useCallback((focused: boolean) => {
    setIsFeatureSearchFocused(focused);
    if (focused) setHasMobileSearchSelection(false);
  }, []);

  const mobileTocVisible = !hasMobileSearchSelection;
  const featureSelectionPathActive =
    !hasMobileSearchSelection &&
    searchMode === "title" &&
    (isMobileViewport || isFeatureSearchFocused || !!titleSearchQuery.trim());

  const tabs = [
    { value: "features", label: t("features.tab.features", "Features") },
    { value: "reports", label: t("features.tab.reports", "Reports") },
    {
      value: "conversations",
      label: t("features.tab.conversations", "Conversations"),
    },
  ];

  const viewSegments = [
    {
      value: "document" as const,
      label: t("features.view.document", "Document"),
    },
    { value: "tree" as const, label: t("features.view.tree", "Tree") },
  ];

  const handleSearchModeChange = useCallback(
    (mode: FeatureSearchMode): void => {
      setSearchMode(mode);
      setAgentSearchError(null);
      if (mode !== "title") {
        setTitleSearchQuery("");
      }
      if (mode !== "content") {
        void setContentSearch(null);
      }
      if (mode !== "agent") {
        setAgentSearchQuery("");
        setAgentInitialMessage(null);
        setAgentSession(null);
      }
    },
    [setContentSearch],
  );

  const handleContentSearchSubmit = useCallback(
    (query: string): void => {
      const trimmed = query.trim();
      void setContentSearch(trimmed || null);
    },
    [setContentSearch],
  );

  const handleContentSearchClear = useCallback((): void => {
    void setContentSearch(null);
  }, [setContentSearch]);

  const handleAgentSearchSubmit = useCallback(
    (query: string): void => {
      const trimmed = query.trim();
      if (!trimmed || !currentOrgId || !projectId) return;
      const selection = buildDefaultSurfaceSelection();
      setAgentSelection(selection);
      setAgentSession(null);
      if (!selection) {
        setAgentSearchError(
          "No agent models are available. Connect your CLI and try again.",
        );
        return;
      }
      setAgentInitialMessage(`Search feature entities only for: ${trimmed}`);
      setAgentSearchError(null);
      createAgentSessionMutation.mutate({
        organizationId: currentOrgId,
        agentSession: {
          projectId,
          type: AgentSessionType.AgentSearch,
          sessionDate: new Date().toISOString(),
          title: trimmed,
        },
      });
    },
    [createAgentSessionMutation, currentOrgId, projectId],
  );

  const isContentSearchActive = searchMode === "content" && !!contentSearch;
  const isAgentSearchActive = searchMode === "agent" && !!agentSession;
  const isFeaturesTabActive = activeTab === "features";
  useSuppressLayoutMainBottomSpacing(isFeaturesTabActive);
  const { containerRef: featuresPageContainerRef, height: featuresPageHeight } =
    useRemainingViewportHeight(isFeaturesTabActive, 0);

  const boundedPageRootSx: SxProps<Theme> | undefined = isFeaturesTabActive
    ? {
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        minWidth: 0,
        width: "100%",
        boxSizing: "border-box",
        ...(featuresPageHeight === null
          ? {}
          : { height: `${featuresPageHeight}px` }),
      }
    : undefined;
  const boundedPagePaperSx = isFeaturesTabActive
    ? {
        display: "flex",
        flex: 1,
        flexDirection: "column",
        minHeight: 0,
        minWidth: 0,
        width: "100%",
        overflow: "hidden",
      }
    : undefined;

  const matchedFeatureIds = useMemo<Set<string> | undefined>(() => {
    if (!isContentSearchActive) return undefined;
    return new Set(
      searchResults.map((r) => r.entityId).filter((id): id is string => !!id),
    );
  }, [isContentSearchActive, searchResults]);

  return (
    <>
      {!preview && (
        <PageBreadcrumbs
          sx={{ mb: 2 }}
          items={[
            { label: "Projects", to: "/projects" },
            {
              label: project?.name ?? "Project",
              to: `/projects/${projectId}`,
              type: "project",
            },
            {
              label: t("features.title", "Features"),
              to: `/projects/${projectId}/features`,
              isCurrent: true,
            },
          ]}
        />
      )}

      <DetailPageContainer
        ref={featuresPageContainerRef}
        rootSx={boundedPageRootSx}
        paperSx={boundedPagePaperSx}
      >
        <Box
          sx={{
            mb: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "stretch",
            gap: 1,
            minWidth: 0,
          }}
        >
          <Box sx={{ flex: 1, minWidth: 0, width: "100%" }}>
            {!isPreviewPresentation && (
              <DetailPageHeader
                title={
                  <Box
                    data-testid="features-title-row"
                    sx={{
                      alignItems: "center",
                      display: "flex",
                      gap: 1,
                      justifyContent: "space-between",
                      width: "100%",
                    }}
                  >
                    <Typography
                      component="h1"
                      variant="h4"
                      sx={{
                        fontFamily:
                          '"Work Sans", "Atkinson Hyperlegible", "Roboto", "Helvetica", "Arial", sans-serif',
                        fontWeight: 600,
                      }}
                    >
                      {t("features.title", "Features")}
                    </Typography>
                    <Button
                      aria-label={t("features.createFeature", "Create Feature")}
                      data-testid="create-feature-button"
                      onClick={() => setCreateModalOpen(true)}
                      size="small"
                      startIcon={<AddIcon />}
                      sx={{ flexShrink: 0 }}
                      variant="contained"
                    >
                      <Box
                        component="span"
                        sx={{ display: { xs: "inline", sm: "none" } }}
                      >
                        {t("features.add", "Add")}
                      </Box>
                      <Box
                        component="span"
                        sx={{ display: { xs: "none", sm: "inline" } }}
                      >
                        {t("features.createFeature", "Create Feature")}
                      </Box>
                    </Button>
                  </Box>
                }
              />
            )}
          </Box>
          <Box
            data-testid="features-search-row"
            sx={{
              display: "flex",
              justifyContent: "flex-end",
              width: "100%",
              minWidth: 0,
            }}
          >
            <Box sx={{ width: { xs: "100%", md: "auto" }, minWidth: 0 }}>
              <FeatureContentSearch
                mode={searchMode}
                titleQuery={titleSearchQuery}
                contentQuery={contentSearch}
                agentQuery={agentSearchQuery}
                isAgentSearching={createAgentSessionMutation.isPending}
                onModeChange={handleSearchModeChange}
                onTitleQueryChange={setTitleSearchQuery}
                onContentSearchSubmit={handleContentSearchSubmit}
                onContentSearchClear={handleContentSearchClear}
                onAgentQueryChange={setAgentSearchQuery}
                onAgentSearchSubmit={handleAgentSearchSubmit}
                onFocusChange={handleFeatureSearchFocusChange}
              />
            </Box>
          </Box>
        </Box>

        <DetailPageTabs<FeaturesPageTab>
          value={activeTab}
          onChange={setActiveTab}
          tabs={tabs}
        />

        {activeTab === "features" && (
          <Box
            data-testid="features-page-active-tab"
            sx={{
              mt: 2,
              display: "flex",
              flex: 1,
              flexDirection: "column",
              minHeight: 0,
              minWidth: 0,
            }}
          >
            {!isContentSearchActive && !isAgentSearchActive && (
              <Box
                sx={{
                  mb: 2,
                  flexShrink: 0,
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 1,
                  flexWrap: "wrap",
                }}
              >
                <SegmentedToggle<FeaturesPageView>
                  segments={viewSegments}
                  value={view}
                  onChange={setView}
                />
                {view === "tree" && (
                  <Box data-testid="features-tree-layout-toggle">
                    <SegmentedToggle<TreeLayout>
                      segments={[
                        { value: "left-to-right", label: "Left-to-right" },
                        { value: "top-down", label: "Top-down" },
                      ]}
                      value={treeLayout}
                      onChange={handleLayoutChange}
                    />
                  </Box>
                )}
              </Box>
            )}
            <Box
              sx={{
                display: "flex",
                flex: 1,
                flexDirection: { xs: "column", md: "row" },
                minHeight: 0,
                minWidth: 0,
              }}
            >
              {isAgentSearchActive && agentSelection ? (
                <EntitySearchChat
                  organizationId={currentOrgId ?? ""}
                  projectId={projectId ?? ""}
                  agentSession={agentSession}
                  selection={agentSelection}
                  entityTypes={featureAgentSearchEntityTypes}
                  initialUserMessage={agentInitialMessage ?? undefined}
                />
              ) : agentSearchError && searchMode === "agent" ? (
                <Alert severity="error">{agentSearchError}</Alert>
              ) : isContentSearchActive ? (
                <FeaturesDocumentView
                  organizationId={currentOrgId ?? ""}
                  projectId={projectId ?? ""}
                  mobileTocVisible={mobileTocVisible && !isContentSearchActive}
                  isMobileSearchActive={featureSelectionPathActive}
                  onMobileFeatureSelect={handleFeatureSearchSelect}
                  matchedFeatureIds={matchedFeatureIds}
                />
              ) : (
                <>
                  {view === "tree" && (
                    <FeaturesTreeView
                      orientation={treeLayout}
                      organizationId={currentOrgId ?? ""}
                      projectId={projectId ?? ""}
                      projectName={project?.name}
                      searchQuery={titleSearchQuery}
                      onSearchChange={setTitleSearchQuery}
                      mobileTocVisible={mobileTocVisible}
                      isMobileSearchActive={featureSelectionPathActive}
                      onMobileFeatureSelect={handleFeatureSearchSelect}
                    />
                  )}
                  {view === "document" && (
                    <FeaturesDocumentView
                      organizationId={currentOrgId ?? ""}
                      projectId={projectId ?? ""}
                      mobileTocVisible={mobileTocVisible}
                      searchQuery={titleSearchQuery}
                      isMobileSearchActive={featureSelectionPathActive}
                      onMobileFeatureSelect={handleFeatureSearchSelect}
                    />
                  )}
                </>
              )}
            </Box>
          </Box>
        )}

        {activeTab === "reports" && (
          <Box sx={{ mt: 2 }} data-testid="features-page-reports-tab">
            <FeatureReportsTab
              organizationId={currentOrgId ?? ""}
              projectId={projectId ?? ""}
            />
          </Box>
        )}

        {activeTab === "conversations" && (
          <Box sx={{ mt: 2 }} data-testid="features-page-conversations-tab">
            <FeatureConversationsTab
              organizationId={currentOrgId ?? ""}
              projectId={projectId ?? ""}
            />
          </Box>
        )}

        <NewFeatureModal
          open={createModalOpen}
          onClose={() => setCreateModalOpen(false)}
          onSubmit={handleCreateFeature}
          isLoading={isCreating}
        />
      </DetailPageContainer>
      <DiscussFeatureTreeActionCapsule
        organizationId={currentOrgId}
        projectId={projectId}
      />
    </>
  );
};
