import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Box,
  Breadcrumbs,
  CircularProgress,
  Link,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { parseAsString, useQueryState } from "nuqs";
import {
  useFeatureHierarchy,
  useFeatureDocumentContent,
  useWorkItemTypeByKey,
  useWorkItems,
  type FeatureHierarchyNode,
} from "@hey-hey/ui-common/data";
import { taskContentToSectionInputs } from "@hey-hey/ui-common/utils";
import { NewTaskModal, type NewTaskFormData } from "../../components/Tasks";
import { selectResolvedWorkItemSections } from "../../types/workItemTypes";
import {
  FeatureDocumentRenderer,
  type FeatureDocumentWorkItemInput,
} from "./FeatureDocumentRenderer";
import {
  FeaturesTableOfContents,
  filterNodeByIds,
  type TocEntry,
} from "./FeaturesTableOfContents";
import { sortByName } from "./featureTreeUtils";

type PendingDocumentWorkItem = FeatureDocumentWorkItemInput;

interface IndexedFeature {
  node: FeatureHierarchyNode;
  parentId: string | null;
  rootId: string;
}

const indexFeatures = (
  roots: FeatureHierarchyNode[],
): Map<string, IndexedFeature> => {
  const index = new Map<string, IndexedFeature>();
  const walk = (
    node: FeatureHierarchyNode,
    parentId: string | null,
    rootId: string,
  ): void => {
    index.set(node.feature.id, { node, parentId, rootId });
    node.children.forEach((child) => walk(child, node.feature.id, rootId));
  };
  roots.forEach((root) => walk(root, null, root.feature.id));
  return index;
};

interface DocumentSection {
  node: FeatureHierarchyNode;
  // 1 for the level's siblings, 2 for the open feature's children.
  depth: number;
  subFeatureCount: number;
}

export interface FeaturesDocumentView {
  organizationId: string;
  projectId: string;
  searchQuery?: string;
  mobileTocVisible?: boolean;
  isMobileSearchActive?: boolean;
  onMobileFeatureSelect?: (featureId: string, rootId: string) => void;
  // When provided, the TOC and document panel show only matched features and
  // their structural ancestors.
  matchedFeatureIds?: Set<string>;
}

export const FeaturesDocumentView: React.FC<FeaturesDocumentView> = ({
  organizationId,
  projectId,
  searchQuery,
  mobileTocVisible = true,
  isMobileSearchActive = false,
  onMobileFeatureSelect,
  matchedFeatureIds,
}) => {
  const { t } = useTranslation();
  const { roots, isLoading } = useFeatureHierarchy(organizationId, projectId);
  const {
    workItemTypeDefinition: featureTypeDefinition,
    isFetched: isFeatureTypeFetched,
  } = useWorkItemTypeByKey(organizationId, projectId, "FEATURE");
  const { createTask: createDocumentWorkItem } = useWorkItems(
    organizationId,
    "task",
    projectId,
    undefined,
    { enabled: false },
  );
  const [pendingWorkItem, setPendingWorkItem] =
    useState<PendingDocumentWorkItem | null>(null);
  const [isCreatingWorkItem, setIsCreatingWorkItem] = useState(false);
  const { workItemTypeDefinition, isFetched: isWorkItemTypeFetched } =
    useWorkItemTypeByKey(organizationId, projectId, pendingWorkItem?.type);
  const workItemSectionSelection = useMemo(
    () =>
      pendingWorkItem
        ? selectResolvedWorkItemSections({
            typeKey: pendingWorkItem.type,
            definition: workItemTypeDefinition,
            isFetched: isWorkItemTypeFetched,
          })
        : undefined,
    [isWorkItemTypeFetched, pendingWorkItem, workItemTypeDefinition],
  );
  const theme = useTheme();
  const isDesktopViewport = useMediaQuery(theme.breakpoints.up("md"));
  const [searchParams] = useSearchParams();

  // The URL is the only selection state: `section` names the open feature and
  // `feature` is honored for older links that only carry a root.
  const [selectedFeatureId, setSelectedFeatureId] = useQueryState(
    "feature",
    parseAsString,
  );
  const [sectionId, setSectionId] = useQueryState("section", parseAsString);
  const [expandedRequirementIds, setExpandedRequirementIds] = useState<
    Set<string>
  >(() => new Set());
  // Feature ids whose child entries are revealed in the table of contents.
  // Every section starts collapsed so the TOC opens as a scannable outline.
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());

  const handleOpenWorkItem = useCallback(
    (input: FeatureDocumentWorkItemInput) => {
      setPendingWorkItem(input);
    },
    [],
  );

  const handleCloseWorkItem = useCallback(() => {
    if (!isCreatingWorkItem) {
      setPendingWorkItem(null);
    }
  }, [isCreatingWorkItem]);

  const handleSubmitWorkItem = useCallback(
    async (formData: NewTaskFormData): Promise<void> => {
      if (
        !pendingWorkItem ||
        workItemSectionSelection?.status !== "resolved" ||
        !workItemTypeDefinition
      ) {
        return;
      }

      const initialStatus = workItemTypeDefinition.allowedStatuses[0];
      if (!initialStatus) {
        return;
      }

      try {
        setIsCreatingWorkItem(true);
        const { sectionContent = {}, ...taskFields } = formData;
        await createDocumentWorkItem({
          ...taskFields,
          sections: taskContentToSectionInputs(sectionContent, {
            includeEmpty: false,
            selection: workItemSectionSelection,
          }),
          parentTaskId: pendingWorkItem.parentFeatureId,
          type: pendingWorkItem.type,
          status: initialStatus,
        });
        setPendingWorkItem(null);
      } catch (error) {
        console.error("Failed to create Document work item:", error);
      } finally {
        setIsCreatingWorkItem(false);
      }
    },
    [
      createDocumentWorkItem,
      pendingWorkItem,
      workItemSectionSelection,
      workItemTypeDefinition,
    ],
  );

  const documentPanelRef = useRef<HTMLDivElement>(null);

  const featureIndex = useMemo(() => indexFeatures(roots), [roots]);
  const openId = sectionId ?? selectedFeatureId;
  // An unknown id falls back to the top level without an error.
  const openFeature = openId ? (featureIndex.get(openId) ?? null) : null;

  const breadcrumbs = useMemo(() => {
    const path: FeatureHierarchyNode[] = [];
    let current = openFeature;
    while (current) {
      path.unshift(current.node);
      current = current.parentId
        ? (featureIndex.get(current.parentId) ?? null)
        : null;
    }
    return path;
  }, [featureIndex, openFeature]);

  const sections = useMemo<DocumentSection[]>(() => {
    const isShown = (node: FeatureHierarchyNode): boolean =>
      !matchedFeatureIds || filterNodeByIds(node, matchedFeatureIds) !== null;
    const visibleChildren = (node: FeatureHierarchyNode) =>
      sortByName(node.children).filter(isShown);
    const parent = openFeature?.parentId
      ? featureIndex.get(openFeature.parentId)?.node
      : undefined;
    const level = sortByName(parent ? parent.children : roots).filter(isShown);
    return level.flatMap((node) => {
      const children = visibleChildren(node);
      const section: DocumentSection = {
        node,
        depth: 1,
        subFeatureCount: children.length,
      };
      if (node.feature.id !== openFeature?.node.feature.id) return [section];
      return [
        section,
        ...visibleChildren(node).map((child) => ({
          node: child,
          depth: 2,
          subFeatureCount: child.children.length,
        })),
      ];
    });
  }, [featureIndex, matchedFeatureIds, openFeature, roots]);

  const { entries: contentEntries, retry: retryContent } =
    useFeatureDocumentContent(
      organizationId,
      projectId,
      sections.map(({ node }) => node.feature.id),
    );
  // Siblings and children render together once all of them have content.
  const isContentResolved = sections.every(({ node }) => {
    const entry = contentEntries.get(node.feature.id);
    return entry?.status !== "loading" || Boolean(entry.data);
  });

  const selectFeature = useCallback(
    (featureId: string | null): void => {
      void setSectionId(featureId);
      void setSelectedFeatureId(null);
    },
    [setSectionId, setSelectedFeatureId],
  );

  // A new level starts at its top rather than at the previous scroll position.
  useEffect(() => {
    if (documentPanelRef.current) documentPanelRef.current.scrollTop = 0;
  }, [openFeature?.node.feature.id]);

  const hrefForSelection = useCallback(
    (featureId: string | null): string => {
      const params = new URLSearchParams(searchParams);
      params.delete("feature");
      if (featureId) params.set("section", featureId);
      else params.delete("section");
      return `?${params.toString()}`;
    },
    [searchParams],
  );

  const handleToggleExpand = (featureId: string): void => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(featureId)) next.delete(featureId);
      else next.add(featureId);
      return next;
    });
  };

  const handleToggleRequirements = useCallback((featureId: string): void => {
    setExpandedRequirementIds((previous) => {
      const next = new Set(previous);
      if (next.has(featureId)) next.delete(featureId);
      else next.add(featureId);
      return next;
    });
  }, []);

  const handleActivate = (entry: TocEntry): void => {
    if (isMobileSearchActive && onMobileFeatureSelect) {
      onMobileFeatureSelect(entry.node.feature.id, entry.rootId);
      return;
    }
    selectFeature(entry.node.feature.id);
  };

  if (isLoading) {
    return (
      <Box
        data-testid="features-wiki-view"
        sx={{ display: "flex", justifyContent: "center", py: 6 }}
      >
        <CircularProgress />
      </Box>
    );
  }

  const openFeatureId = openFeature?.node.feature.id ?? null;

  return (
    <Box
      data-testid="features-wiki-view"
      sx={{
        display: "flex",
        gap: 2,
        flex: 1,
        flexDirection: { xs: "column", md: "row" },
        minHeight: 0,
        minWidth: 0,
        width: "100%",
        overflow: "hidden",
      }}
    >
      <FeaturesTableOfContents
        roots={roots}
        mobileVisible={mobileTocVisible}
        searchQuery={searchQuery}
        matchedFeatureIds={matchedFeatureIds}
        expandedIds={expandedIds}
        selectedFeatureId={openFeature?.rootId ?? null}
        activeSectionId={openFeatureId}
        onActivate={handleActivate}
        onToggleExpand={handleToggleExpand}
      />
      <Box
        ref={documentPanelRef}
        data-testid="features-wiki-document-panel"
        aria-busy={!isContentResolved}
        sx={{
          position: "relative",
          display: {
            xs: mobileTocVisible ? "none" : "flex",
            md: "flex",
          },
          flex: 1,
          flexDirection: "column",
          minHeight: 0,
          minWidth: 0,
          width: "100%",
          maxWidth: "100%",
          boxSizing: "border-box",
          overflowY: "auto",
          overflowX: "hidden",
          overscrollBehaviorY: "contain",
          py: 1,
          px: 2,
          paddingBottom: "calc(100px + env(safe-area-inset-bottom))",
        }}
      >
        {breadcrumbs.length > 0 && (
          <Breadcrumbs
            aria-label={t("features.view.breadcrumbLabel", "Feature path")}
            data-testid="features-wiki-breadcrumbs"
            sx={{ mb: 1 }}
          >
            <Link
              href={hrefForSelection(null)}
              onClick={(event: React.MouseEvent<HTMLAnchorElement>) => {
                if (event.ctrlKey || event.metaKey || event.shiftKey) return;
                event.preventDefault();
                selectFeature(null);
              }}
              data-testid="features-wiki-breadcrumb-root"
              underline="hover"
            >
              {t("features.view.allFeatures", "All features")}
            </Link>
            {breadcrumbs.map((crumb, position) =>
              position === breadcrumbs.length - 1 ? (
                <Typography
                  key={crumb.feature.id}
                  color="text.primary"
                  aria-current="page"
                  data-testid={`features-wiki-breadcrumb-${crumb.feature.id}`}
                >
                  {crumb.feature.name}
                </Typography>
              ) : (
                <Link
                  key={crumb.feature.id}
                  href={hrefForSelection(crumb.feature.id)}
                  onClick={(event: React.MouseEvent<HTMLAnchorElement>) => {
                    if (event.ctrlKey || event.metaKey || event.shiftKey)
                      return;
                    event.preventDefault();
                    selectFeature(crumb.feature.id);
                  }}
                  data-testid={`features-wiki-breadcrumb-${crumb.feature.id}`}
                  underline="hover"
                >
                  {crumb.feature.name}
                </Link>
              ),
            )}
          </Breadcrumbs>
        )}
        {sections.length > 0 ? (
          isContentResolved ? (
            <Box
              data-testid="features-wiki-document-content"
              sx={{ width: "100%", minWidth: 0, flex: "0 0 auto" }}
            >
              {sections.map(({ node, depth, subFeatureCount }) => {
                const isOpen = node.feature.id === openFeatureId;
                return (
                  <FeatureDocumentRenderer
                    key={node.feature.id}
                    node={node}
                    contentState={
                      contentEntries.get(node.feature.id) ?? {
                        status: "loading",
                      }
                    }
                    onRetryContent={() => {
                      void retryContent(node.feature.id);
                    }}
                    organizationId={organizationId}
                    projectId={projectId}
                    workItemTypeDefinition={
                      isFeatureTypeFetched &&
                      featureTypeDefinition?.key === "FEATURE"
                        ? featureTypeDefinition
                        : undefined
                    }
                    depth={depth}
                    subFeatureCount={isOpen ? 0 : subFeatureCount}
                    subFeaturesHref={hrefForSelection(node.feature.id)}
                    onShowSubFeatures={() => selectFeature(node.feature.id)}
                    expandedRequirementIds={expandedRequirementIds}
                    onToggleRequirements={handleToggleRequirements}
                    showSectionActions={isDesktopViewport}
                    matchedFeatureIds={matchedFeatureIds}
                    activeSectionId={openFeatureId}
                    onCreateWorkItem={handleOpenWorkItem}
                  />
                );
              })}
            </Box>
          ) : (
            <Box
              role="status"
              aria-live="polite"
              data-testid="features-wiki-document-loading"
              sx={{ display: "flex", justifyContent: "center", py: 6 }}
            >
              <CircularProgress size={24} />
            </Box>
          )
        ) : (
          <Typography
            variant="body2"
            color="text.secondary"
            data-testid="features-wiki-document-empty"
          >
            {t(
              "features.view.wikiDocumentEmpty",
              "Select a feature to view its document.",
            )}
          </Typography>
        )}
      </Box>
      <NewTaskModal
        key={
          pendingWorkItem
            ? `${pendingWorkItem.type}-${pendingWorkItem.parentFeatureId}`
            : "closed"
        }
        open={pendingWorkItem !== null}
        onClose={handleCloseWorkItem}
        onSubmit={handleSubmitWorkItem}
        isLoading={isCreatingWorkItem}
        initiativeId=""
        sectionSelection={workItemSectionSelection}
      />
    </Box>
  );
};
