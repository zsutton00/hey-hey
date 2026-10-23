import React, {
  useState,
  useMemo,
  useCallback,
  useRef,
  useLayoutEffect,
  useEffect,
} from "react";
import {
  Box,
  Divider,
  TextField,
  Typography,
  InputAdornment,
  LinearProgress,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import TreeIcon from "@mui/icons-material/AccountTree";
import { useNavigate } from "react-router-dom";
import {
  useDroppable,
  useDndContext as useCoreDndContext,
} from "@dnd-kit/core";
import {
  EntityType,
  FeatureHierarchyEntryDtoRelationshipTypeEnum,
  TargetEntityType,
  type FeatureHierarchyEntryDto,
} from "../../api";
import type { WorkItemResponseDto } from "../../data/collections/workItems";
import {
  useFeatureTree,
  type LocalFeatureNeighborhoodContext,
} from "../../data/hooks/useFeatureTree";
import type { UseFeatureTreeReturn } from "../../data/hooks/useFeatureTree";
import type { FeatureTreeNode as TreeNodeType } from "../../data/hooks/useFeatureTree";
import { useFullEntityContext } from "../../data/hooks/useFullEntityContext";
import { useFeatureTreePageData } from "../../data/hooks/useFeatureHierarchy";
import { usePathService } from "../../contexts";
import { InteractionComponent } from "../InteractionComponent";
import { FeatureTreeNode } from "./FeatureTreeNode";
import { RelatedFeatureAttachment } from "./RelatedFeatureNode";

interface FeatureTreeVisualizationBaseProps {
  orientation?: "left-to-right" | "top-down";
  treeData?: UseFeatureTreeReturn;
  organizationId: string;
  projectId: string;
  projectName?: string;
  focusedFeatureId?: string;
  /**
   * Whether this instance owns active-feature focus navigation. Use this when
   * multiple tree instances are mounted so only the visible one scrolls.
   */
  focusNavigationEnabled?: boolean;
  /**
   * When true (default), fill the parent container height and scroll internally.
   * When false, size to the natural height of the rendered tree so the parent
   * grows to fit the content with no inner scrollbar.
   */
  fillHeight?: boolean;
  /**
   * When provided alongside onSearchChange, the parent owns the search input
   * and the component renders without its built-in search TextField.
   */
  searchQuery?: string;
  onSearchChange?: (value: string) => void;
}

export type FeatureTreeVisualizationProps =
  | (FeatureTreeVisualizationBaseProps & {
      dataSource?: "project";
      activeFeatureId?: string;
    })
  | (FeatureTreeVisualizationBaseProps & {
      dataSource: "local-neighborhood";
      activeFeatureId: string;
    });

const CONNECTOR_WIDTH = 40;
const ROOT_DROP_ID = "feature-tree-root-drop";
const EMPTY_STATE_HEIGHT = 400;

interface ReparentDragData {
  type: "feature-reparent";
  featureId: string;
  sourceId: string;
}

interface RequiredReadState {
  isLoading: boolean;
  isFetched: boolean;
  error: string | null;
}

type FeatureTreePresentationState =
  | { status: "loading" }
  | { status: "failed"; message: string }
  | { status: "empty" }
  | { status: "ready" };

function getFeatureTreePresentationState({
  treeRead,
  contextRead,
  hasFeatures,
}: {
  treeRead: RequiredReadState;
  contextRead: RequiredReadState | null;
  hasFeatures: boolean;
}): FeatureTreePresentationState {
  const readError = treeRead.error ?? contextRead?.error ?? null;
  if (readError !== null) {
    return { status: "failed", message: readError };
  }

  const requiredReads = contextRead ? [treeRead, contextRead] : [treeRead];
  const readsAreReady = requiredReads.every(
    (read) => read.isFetched && !read.isLoading
  );
  if (!readsAreReady) {
    return { status: "loading" };
  }

  return hasFeatures ? { status: "ready" } : { status: "empty" };
}

function FeatureTreeLoadingState({
  fillHeight,
}: {
  fillHeight: boolean;
}): React.ReactElement {
  return (
    <Box
      data-testid="feature-tree-loading-state"
      role="status"
      aria-label="Loading feature tree"
      sx={{
        width: "100%",
        ...(fillHeight && { height: "100%" }),
      }}
    >
      <LinearProgress
        aria-label="Loading feature tree data"
        data-testid="feature-tree-loading-progress"
      />
    </Box>
  );
}

function FeatureTreeReadyReveal({
  children,
  fillHeight,
}: {
  children: React.ReactNode;
  fillHeight: boolean;
}): React.ReactElement {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(true);
  }, []);

  return (
    <Box
      data-testid="feature-tree-ready"
      sx={{
        width: "100%",
        ...(fillHeight && { height: "100%" }),
        opacity: visible ? 1 : 0,
        transition: "opacity 180ms ease",
      }}
    >
      {children}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Filtering helpers (search + focus)
// ---------------------------------------------------------------------------

function getAncestorIds(
  nodeId: string,
  parentMap: Map<string, string | null>
): Set<string> {
  const ancestors = new Set<string>();
  let current = parentMap.get(nodeId);
  while (current) {
    ancestors.add(current);
    current = parentMap.get(current);
  }
  return ancestors;
}

function buildParentMap(roots: TreeNodeType[]): Map<string, string | null> {
  const map = new Map<string, string | null>();
  function walk(node: TreeNodeType, parentId: string | null) {
    map.set(node.feature.id, parentId);
    for (const child of node.children) {
      walk(child, node.feature.id);
    }
  }
  for (const root of roots) {
    walk(root, null);
  }
  return map;
}

function collectSubtreeIds(node: TreeNodeType): Set<string> {
  const ids = new Set<string>();
  function walk(n: TreeNodeType) {
    ids.add(n.feature.id);
    for (const child of n.children) walk(child);
  }
  walk(node);
  return ids;
}

function findNode(roots: TreeNodeType[], id: string): TreeNodeType | undefined {
  for (const root of roots) {
    if (root.feature.id === id) return root;
    const found = findNode(root.children, id);
    if (found) return found;
  }
  return undefined;
}

interface FilterResult {
  visibleIds: Set<string> | null;
  matchIds: Set<string>;
  focusAncestorPath: Set<string>;
}

function computeFilter(
  roots: TreeNodeType[],
  searchQuery: string,
  focusedFeatureId: string | undefined
): FilterResult {
  const parentMap = buildParentMap(roots);
  const matchIds = new Set<string>();
  const focusAncestorPath = new Set<string>();

  // Search filter
  let searchVisible: Set<string> | null = null;
  const query = searchQuery.trim().toLowerCase();
  if (query) {
    searchVisible = new Set<string>();
    for (const [nodeId] of parentMap) {
      const node = findNode(roots, nodeId);
      if (node && node.feature.name.toLowerCase().includes(query)) {
        matchIds.add(nodeId);
        searchVisible.add(nodeId);
        for (const a of getAncestorIds(nodeId, parentMap)) {
          searchVisible.add(a);
        }
      }
    }
  }

  // Focus filter
  let focusVisible: Set<string> | null = null;
  if (focusedFeatureId) {
    focusVisible = new Set<string>();
    const ancestors = getAncestorIds(focusedFeatureId, parentMap);
    for (const a of ancestors) {
      focusVisible.add(a);
      focusAncestorPath.add(a);
    }
    focusVisible.add(focusedFeatureId);
    focusAncestorPath.add(focusedFeatureId);
    const focusedNode = findNode(roots, focusedFeatureId);
    if (focusedNode) {
      for (const id of collectSubtreeIds(focusedNode)) {
        focusVisible.add(id);
      }
    }
  }

  // Intersect
  let visibleIds: Set<string> | null = null;
  if (searchVisible && focusVisible) {
    visibleIds = new Set<string>();
    for (const id of searchVisible) {
      if (focusVisible.has(id)) visibleIds.add(id);
    }
  } else {
    visibleIds = searchVisible ?? focusVisible;
  }

  return { visibleIds, matchIds, focusAncestorPath };
}

// ---------------------------------------------------------------------------
// SVG connector between a parent node and its children column
// ---------------------------------------------------------------------------

function TreeConnector({
  parentCardRef,
  childCardRefs,
  childIds,
  orientation,
}: {
  parentCardRef: React.RefObject<HTMLDivElement | null>;
  childCardRefs: React.RefObject<Map<string, HTMLDivElement>>;
  childIds: string[];
  orientation: "left-to-right" | "top-down";
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [paths, setPaths] = useState<string[]>([]);

  useLayoutEffect(() => {
    function update() {
      const svg = svgRef.current;
      const parentCard = parentCardRef.current;
      if (!svg || !parentCard) return;

      const svgRect = svg.getBoundingClientRect();
      const parentRect = parentCard.getBoundingClientRect();
      const parentY = parentRect.top + parentRect.height / 2 - svgRect.top;

      const newPaths: string[] = [];
      for (const id of childIds) {
        const el = childCardRefs.current.get(id);
        if (!el) continue;
        const childRect = el.getBoundingClientRect();
        const childY = childRect.top + childRect.height / 2 - svgRect.top;
        const midX = CONNECTOR_WIDTH / 2;
        if (orientation === "top-down") {
          const parentX = parentRect.left + parentRect.width / 2 - svgRect.left;
          const childX = childRect.left + childRect.width / 2 - svgRect.left;
          newPaths.push(
            `M ${parentX},0 C ${parentX},${midX} ${childX},${midX} ${childX},${CONNECTOR_WIDTH}`,
          );
        } else {
          newPaths.push(
            `M 0,${parentY} C ${midX},${parentY} ${midX},${childY} ${CONNECTOR_WIDTH},${childY}`,
          );
        }
      }
      setPaths(newPaths);
    }

    update();

    const observer = new ResizeObserver(update);
    if (svgRef.current?.parentElement) {
      observer.observe(svgRef.current.parentElement);
    }
    return () => observer.disconnect();
  }, [childIds, parentCardRef, childCardRefs, orientation]);

  return (
    <svg
      ref={svgRef}
      width={orientation === "top-down" ? "100%" : CONNECTOR_WIDTH}
      height={orientation === "top-down" ? CONNECTOR_WIDTH : undefined}
      style={{
        flexShrink: 0,
        overflow: "visible",
        alignSelf: "stretch",
      }}
    >
      {paths.map((d, i) => (
        <path
          key={i}
          d={d}
          fill="none"
          stroke="rgba(100, 100, 100, 0.4)"
          strokeWidth={2}
        />
      ))}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Recursive tree branch
// ---------------------------------------------------------------------------

interface TreeBranchProps {
  orientation: "left-to-right" | "top-down";
  node: TreeNodeType;
  visibleIds: Set<string> | null;
  matchIds: Set<string>;
  focusAncestorPath: Set<string>;
  collapsedIds: Set<string>;
  activeFeatureId?: string;
  onToggleCollapse: (id: string) => void;
  onNodeClick: (featureId: string, event: React.MouseEvent) => void;
  getFeatureHref: (featureId: string) => string;
  organizationId: string;
  projectId: string;
  descendantsOfActive: Set<string>;
  errorMap: Map<string, string>;
  onClearError: (featureId: string) => void;
  onReparentDrop: (draggedFeatureId: string, targetFeatureId: string) => void;
  onNodeRef: (featureId: string, el: HTMLDivElement | null) => void;
  connectionPointRef?: (el: HTMLDivElement | null) => void;
  relatedEntries: FeatureHierarchyEntryDto[];
  allFeatures: WorkItemResponseDto[];
  relatedExpanded: boolean;
  onToggleRelatedExpanded: () => void;
}

function TreeBranch({
  orientation,
  node,
  visibleIds,
  matchIds,
  focusAncestorPath,
  collapsedIds,
  activeFeatureId,
  onToggleCollapse,
  onNodeClick,
  getFeatureHref,
  organizationId,
  projectId,
  descendantsOfActive,
  errorMap,
  onClearError,
  onReparentDrop,
  onNodeRef,
  connectionPointRef,
  relatedEntries,
  allFeatures,
  relatedExpanded,
  onToggleRelatedExpanded,
}: TreeBranchProps) {
  const parentCardRef = useRef<HTMLDivElement | null>(null);
  const childCardRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const isActive = node.feature.id === activeFeatureId;

  const setCardRef = useCallback(
    (el: HTMLDivElement | null) => {
      parentCardRef.current = el;
      onNodeRef(node.feature.id, el);
      connectionPointRef?.(el);
    },
    [connectionPointRef, node.feature.id, onNodeRef]
  );

  const visibleChildren = useMemo(() => {
    if (!visibleIds) return node.children;
    return node.children.filter((c) => visibleIds.has(c.feature.id));
  }, [node.children, visibleIds]);

  const isCollapsed = collapsedIds.has(node.feature.id);
  const showChildren = visibleChildren.length > 0 && !isCollapsed;
  const isHighlighted = matchIds.has(node.feature.id);
  const childIds = useMemo(
    () => visibleChildren.map((c) => c.feature.id),
    [visibleChildren]
  );

  // Auto-collapse siblings that aren't on the focus path
  const isFocusAncestor = focusAncestorPath.has(node.feature.id);

  const featureId = node.feature.id;
  const handleClearError = useCallback(
    () => onClearError(featureId),
    [onClearError, featureId]
  );

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: orientation === "top-down" ? "column" : "row",
        alignItems: orientation === "top-down" ? "center" : "flex-start",
        width: orientation === "top-down" ? "max-content" : undefined,
      }}
    >
      <Box ref={setCardRef} sx={{ flexShrink: 0 }}>
        <InteractionComponent
          entityId={node.feature.id}
          entityType={TargetEntityType.Task}
          entitySubtype={node.feature.type}
          hasProposalSupport
          organizationId={organizationId}
          projectId={projectId}
          entityTitle={node.feature.name}
          // Proposal-drag is intentionally disabled on tree cards: feature-reparent
          // drag (wired in FeatureTreeNode) is the only drag we want here.
          draggable={false}
        >
          <FeatureTreeNode
            feature={node.feature}
            isHighlighted={isHighlighted}
            isActive={isActive}
            hasChildren={visibleChildren.length > 0}
            isCollapsed={isCollapsed}
            taskCount={Math.max(
              0,
              (node.feature.childCounts?.total ?? 0) - node.children.length
            )}
            onToggleCollapse={() => onToggleCollapse(node.feature.id)}
            onClick={onNodeClick}
            href={getFeatureHref(node.feature.id)}
            descendantsOfActive={descendantsOfActive}
            errorMessage={errorMap.get(node.feature.id)}
            onClearError={handleClearError}
            onReparentDrop={onReparentDrop}
          />
        </InteractionComponent>
      </Box>

      {orientation === "top-down" && isActive && relatedEntries.length > 0 && (
        <RelatedFeatureAttachment
          entries={relatedEntries}
          allFeatures={allFeatures}
          organizationId={organizationId}
          projectId={projectId}
          onNodeClick={onNodeClick}
          getFeatureHref={getFeatureHref}
          descendantsOfActive={descendantsOfActive}
          errorMap={errorMap}
          onClearError={onClearError}
          onReparentDrop={onReparentDrop}
          expanded={relatedExpanded}
          onToggleExpanded={onToggleRelatedExpanded}
        />
      )}
      {showChildren && (
        <>
          <TreeConnector
            parentCardRef={parentCardRef}
            childCardRefs={childCardRefs}
            childIds={childIds}
            orientation={orientation}
          />
          <Box
            sx={{
              display: "flex",
              flexDirection: orientation === "top-down" ? "row" : "column",
              alignItems: "flex-start",
              gap: 1.5,
              py: 0.5,
            }}
          >
            {visibleChildren.map((child) => {
              const childOnFocusPath = focusAncestorPath.has(child.feature.id);
              const autoCollapsed =
                isFocusAncestor &&
                !childOnFocusPath &&
                focusAncestorPath.size > 0;
              const childIsActive = child.feature.id === activeFeatureId;

              return (
                <React.Fragment key={child.feature.id}>
                  <TreeBranch
                    orientation={orientation}
                    node={child}
                    visibleIds={visibleIds}
                    matchIds={matchIds}
                    focusAncestorPath={focusAncestorPath}
                    collapsedIds={
                      autoCollapsed
                        ? new Set([...collapsedIds, child.feature.id])
                        : collapsedIds
                    }
                    activeFeatureId={activeFeatureId}
                    onToggleCollapse={onToggleCollapse}
                    onNodeClick={onNodeClick}
                    getFeatureHref={getFeatureHref}
                    organizationId={organizationId}
                    projectId={projectId}
                    descendantsOfActive={descendantsOfActive}
                    errorMap={errorMap}
                    onClearError={onClearError}
                    onReparentDrop={onReparentDrop}
                    onNodeRef={onNodeRef}
                    relatedEntries={relatedEntries}
                    allFeatures={allFeatures}
                    relatedExpanded={relatedExpanded}
                    onToggleRelatedExpanded={onToggleRelatedExpanded}
                    connectionPointRef={(el) => {
                      if (el) childCardRefs.current.set(child.feature.id, el);
                      else childCardRefs.current.delete(child.feature.id);
                    }}
                  />
                  {orientation === "left-to-right" &&
                    childIsActive &&
                    relatedEntries.length > 0 && (
                      <RelatedFeatureAttachment
                        entries={relatedEntries}
                        allFeatures={allFeatures}
                        organizationId={organizationId}
                        projectId={projectId}
                        onNodeClick={onNodeClick}
                        getFeatureHref={getFeatureHref}
                        descendantsOfActive={descendantsOfActive}
                        errorMap={errorMap}
                        onClearError={onClearError}
                        onReparentDrop={onReparentDrop}
                        expanded={relatedExpanded}
                        onToggleExpanded={onToggleRelatedExpanded}
                      />
                    )}
                </React.Fragment>
              );
            })}
          </Box>
        </>
      )}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

/**
 * Project trees build structure from the cached feature hierarchy and hydrate
 * only tag/count metadata, so no feature sections are requested.
 */
const ProjectFeatureTreeVisualization: React.FC<
  FeatureTreeVisualizationProps
> = (props) => {
  const treeData = useFeatureTreePageData(
    props.organizationId,
    props.projectId
  );
  return <FeatureTreeVisualizationView {...props} treeData={treeData} />;
};

export const FeatureTreeVisualization: React.FC<
  FeatureTreeVisualizationProps
> = (props) =>
  props.dataSource === "local-neighborhood" || props.treeData ? (
    <FeatureTreeVisualizationView {...props} />
  ) : (
    <ProjectFeatureTreeVisualization {...props} />
  );

const FeatureTreeVisualizationView: React.FC<
  FeatureTreeVisualizationProps
> = ({
  organizationId,
  projectId,
  projectName,
  dataSource = "project",
  focusedFeatureId,
  activeFeatureId,
  focusNavigationEnabled = true,
  fillHeight = true,
  orientation = "left-to-right",
  searchQuery: controlledSearchQuery,
  onSearchChange,
  treeData,
}) => {
  const pathService = usePathService();
  const navigate = useNavigate();

  const isSearchControlled =
    controlledSearchQuery !== undefined && onSearchChange !== undefined;
  const [internalSearchQuery, setInternalSearchQuery] = useState("");
  const searchQuery = isSearchControlled
    ? controlledSearchQuery
    : internalSearchQuery;
  const setSearchQuery = isSearchControlled
    ? onSearchChange
    : setInternalSearchQuery;
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const [relatedExpanded, setRelatedExpanded] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const nodeRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const lastFocusedFeatureIdRef = useRef<string | undefined>(undefined);

  const handleNodeRef = useCallback(
    (featureId: string, el: HTMLDivElement | null) => {
      if (el) nodeRefs.current.set(featureId, el);
      else nodeRefs.current.delete(featureId);
    },
    []
  );

  // The ref guard makes active-feature identity the trigger. Running after each
  // commit lets the newly ready DOM satisfy a pending focus without coupling
  // focus navigation to any read or reveal state.
  useLayoutEffect(() => {
    if (!activeFeatureId) {
      lastFocusedFeatureIdRef.current = undefined;
      return;
    }
    if (
      !focusNavigationEnabled ||
      lastFocusedFeatureIdRef.current === activeFeatureId
    ) {
      return;
    }

    const container = scrollContainerRef.current;
    const node = nodeRefs.current.get(activeFeatureId);
    if (!container || !node) return;

    const containerRect = container.getBoundingClientRect();
    const nodeRect = node.getBoundingClientRect();
    const viewportWidth = container.clientWidth || containerRect.width;
    const nodeCenter =
      nodeRect.left -
      containerRect.left +
      container.scrollLeft +
      nodeRect.width / 2;

    container.scrollLeft = Math.max(0, nodeCenter - viewportWidth / 2);
    if (orientation === "top-down") {
      const viewportHeight = container.clientHeight || containerRect.height;
      const nodeCenterY =
        nodeRect.top -
        containerRect.top +
        container.scrollTop +
        nodeRect.height / 2;
      container.scrollTop = Math.max(0, nodeCenterY - viewportHeight / 2);
    }
    lastFocusedFeatureIdRef.current = activeFeatureId;
  });

  const {
    data: seedContext,
    isLoading: isContextLoading,
    isFetched: isContextFetched,
    error: contextError,
  } = useFullEntityContext({
    organizationId,
    projectId,
    entityType: EntityType.Task,
    entityId: activeFeatureId ?? "",
    enabled: !!activeFeatureId,
    includeFeatureHierarchy: true,
    includeRelatedEntities: false,
    includeProposals: false,
    includeAvailableMcpTools: false,
  });

  const localNeighborhood: LocalFeatureNeighborhoodContext | undefined =
    dataSource === "local-neighborhood" && activeFeatureId
      ? {
          focusedFeatureId: activeFeatureId,
        }
      : undefined;
  const {
    roots,
    allFeatures,
    descendantsMap,
    isLoading,
    isFetched,
    error,
    reparent,
    errorMap,
    clearError,
  } = useFeatureTree(
    organizationId,
    projectId,
    treeData,
    dataSource === "local-neighborhood" ? localNeighborhood : undefined,
  );

  const relatedEntries = useMemo<FeatureHierarchyEntryDto[]>(() => {
    const hierarchy = seedContext?.featureHierarchy ?? [];
    return hierarchy.filter(
      (e) =>
        e.relationshipType !==
        FeatureHierarchyEntryDtoRelationshipTypeEnum.Structural
    );
  }, [seedContext]);

  useEffect(() => {
    setRelatedExpanded(false);
  }, [activeFeatureId]);

  const { active } = useCoreDndContext();
  const activeData = active?.data.current as
    | Partial<ReparentDragData>
    | undefined;
  const isFeatureReparentDrag = activeData?.type === "feature-reparent";
  const activeReparentFeatureId = isFeatureReparentDrag
    ? activeData?.featureId ?? null
    : null;

  const descendantsOfActive = useMemo(() => {
    if (!activeReparentFeatureId) return new Set<string>();
    return descendantsMap.get(activeReparentFeatureId) ?? new Set<string>();
  }, [activeReparentFeatureId, descendantsMap]);

  const getFeatureHref = useCallback(
    (featureId: string): string => {
      return pathService.feature({ projectId, featureId });
    },
    [pathService, projectId]
  );

  const handleNodeClick = useCallback(
    (featureId: string, event: React.MouseEvent) => {
      if (
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.button === 1
      ) {
        return;
      }
      event.preventDefault();
      navigate(getFeatureHref(featureId));
    },
    [navigate, getFeatureHref]
  );

  const handleToggleCollapse = useCallback((id: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const dispatchReparent = useCallback(
    async (draggedFeatureId: string, targetFeatureId: string | null) => {
      const dragged = allFeatures.find((f) => f.id === draggedFeatureId);
      if (!dragged) return;
      if (targetFeatureId === draggedFeatureId) return;
      if (
        targetFeatureId &&
        descendantsMap.get(draggedFeatureId)?.has(targetFeatureId)
      ) {
        return;
      }
      if ((dragged.parentTaskId ?? null) === targetFeatureId) return;
      try {
        await reparent(draggedFeatureId, targetFeatureId);
        if (relatedEntries.some((entry) => entry.id === draggedFeatureId)) {
          setRelatedExpanded(false);
        }
      } catch {
        // Failure is captured in errorMap and rendered on the dragged card.
      }
    },
    [allFeatures, descendantsMap, reparent, relatedEntries]
  );

  const handleReparentDropOnNode = useCallback(
    (draggedFeatureId: string, targetFeatureId: string) => {
      dispatchReparent(draggedFeatureId, targetFeatureId);
    },
    [dispatchReparent]
  );

  const handleRootDrop = useCallback(
    ({ sourceId }: { sourceId: string }) => {
      dispatchReparent(sourceId, null);
    },
    [dispatchReparent]
  );

  const draggedFeature = activeReparentFeatureId
    ? allFeatures.find((f) => f.id === activeReparentFeatureId)
    : undefined;
  const rootDropDisabled =
    !isFeatureReparentDrag ||
    !draggedFeature ||
    (draggedFeature.parentTaskId ?? null) === null;

  const { setNodeRef: setRootDropRef, isOver: isRootOver } = useDroppable({
    id: ROOT_DROP_ID,
    disabled: rootDropDisabled,
    data: {
      type: "feature-reparent",
      onDrop: handleRootDrop,
    },
  });

  const { visibleIds, matchIds, focusAncestorPath } = useMemo(
    () => computeFilter(roots, searchQuery, focusedFeatureId),
    [roots, searchQuery, focusedFeatureId]
  );

  const visibleRoots = useMemo(() => {
    if (!visibleIds) return roots;
    return roots.filter((r) => visibleIds.has(r.feature.id));
  }, [roots, visibleIds]);

  const presentationState = getFeatureTreePresentationState({
    treeRead: {
      isLoading,
      isFetched,
      error: error?.message ?? null,
    },
    contextRead: activeFeatureId && dataSource !== "local-neighborhood"
      ? {
          isLoading: isContextLoading,
          isFetched: isContextFetched,
          error: contextError,
        }
      : null,
    hasFeatures: roots.length > 0,
  });

  const isRootDropHovered = isRootOver && !rootDropDisabled;
  const treeIsReady = presentationState.status === "ready";

  return (
    <Box sx={{ width: "100%", ...(fillHeight && { height: "100%" }) }}>
      {treeIsReady && !isSearchControlled && (
        <Box sx={{ px: 1, py: 1 }}>
          <TextField
            size="small"
            placeholder="Search features..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" />
                  </InputAdornment>
                ),
              },
            }}
            sx={{ width: 280 }}
          />
        </Box>
      )}

      <Box
        ref={scrollContainerRef}
        data-testid="feature-tree-scroll-viewport"
        sx={{
          width: "100%",
          ...(treeIsReady && {
            p: 2,
            overflowX: "auto",
            overflowY: "hidden",
            ...(fillHeight && {
              height: isSearchControlled ? "100%" : "calc(100% - 56px)",
              overflowY: "auto",
            }),
          }),
        }}
      >
        {presentationState.status === "failed" ? (
          <Box data-testid="feature-tree-error" sx={{ p: 3 }}>
            <Typography color="error">
              Failed to load feature tree: {presentationState.message}
            </Typography>
          </Box>
        ) : presentationState.status === "loading" ? (
          <FeatureTreeLoadingState fillHeight={fillHeight} />
        ) : presentationState.status === "empty" ? (
          <Box
            data-testid="feature-tree-empty"
            sx={{
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              height: EMPTY_STATE_HEIGHT,
            }}
          >
            <Typography color="text.secondary">
              No features to visualize. Create a feature to get started.
            </Typography>
          </Box>
        ) : (
          <FeatureTreeReadyReveal fillHeight={fillHeight}>
            <Box
              sx={{
                display: "flex",
                flexDirection: orientation === "top-down" ? "column" : "row",
                alignItems:
                  orientation === "top-down" ? "center" : "flex-start",
                width: orientation === "top-down" ? "max-content" : undefined,
              }}
            >
              {projectName && (
                <Box
                  ref={setRootDropRef}
                  sx={{
                    width: 220,
                    px: 2,
                    py: 1.25,
                    backgroundColor: "primary.main",
                    borderRadius: 2,
                    boxShadow: isRootDropHovered ? 6 : 3,
                    outline: isRootDropHovered ? "2px solid" : "none",
                    outlineColor: "primary.light",
                    outlineOffset: 2,
                    display: "flex",
                    alignItems: "center",
                    gap: 1,
                    flexShrink: 0,
                    mr:
                      orientation === "left-to-right"
                        ? `${CONNECTOR_WIDTH}px`
                        : 0,
                    mb: orientation === "top-down" ? `${CONNECTOR_WIDTH}px` : 0,
                    transition: "all 0.15s ease",
                  }}
                >
                  <TreeIcon
                    sx={{
                      color: "primary.contrastText",
                      fontSize: 18,
                      flexShrink: 0,
                    }}
                  />
                  <Typography
                    variant="body2"
                    sx={{
                      fontWeight: 600,
                      color: "primary.contrastText",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {projectName}
                  </Typography>
                </Box>
              )}

              <Box
                sx={{
                  display: "flex",
                  flexDirection: orientation === "top-down" ? "row" : "column",
                  alignItems: "flex-start",
                  gap: 1.5,
                  py: 0.5,
                }}
              >
                {visibleRoots.map((root, index) => {
                  const rootIsActive = root.feature.id === activeFeatureId;
                  return (
                    <React.Fragment key={root.feature.id}>
                      {orientation === "left-to-right" && index > 0 && (
                        <Divider />
                      )}
                      <TreeBranch
                        orientation={orientation}
                        node={root}
                        visibleIds={visibleIds}
                        matchIds={matchIds}
                        focusAncestorPath={focusAncestorPath}
                        collapsedIds={collapsedIds}
                        activeFeatureId={activeFeatureId}
                        onToggleCollapse={handleToggleCollapse}
                        onNodeClick={handleNodeClick}
                        getFeatureHref={getFeatureHref}
                        organizationId={organizationId}
                        projectId={projectId}
                        descendantsOfActive={descendantsOfActive}
                        errorMap={errorMap}
                        onClearError={clearError}
                        onReparentDrop={handleReparentDropOnNode}
                        onNodeRef={handleNodeRef}
                        relatedEntries={relatedEntries}
                        allFeatures={allFeatures}
                        relatedExpanded={relatedExpanded}
                        onToggleRelatedExpanded={() =>
                          setRelatedExpanded((value) => !value)
                        }
                      />
                      {orientation === "left-to-right" &&
                        rootIsActive &&
                        relatedEntries.length > 0 && (
                          <RelatedFeatureAttachment
                            entries={relatedEntries}
                            allFeatures={allFeatures}
                            organizationId={organizationId}
                            projectId={projectId}
                            onNodeClick={handleNodeClick}
                            getFeatureHref={getFeatureHref}
                            descendantsOfActive={descendantsOfActive}
                            errorMap={errorMap}
                            onClearError={clearError}
                            onReparentDrop={handleReparentDropOnNode}
                            expanded={relatedExpanded}
                            onToggleExpanded={() =>
                              setRelatedExpanded((value) => !value)
                            }
                          />
                        )}
                    </React.Fragment>
                  );
                })}
              </Box>
            </Box>
          </FeatureTreeReadyReveal>
        )}
      </Box>
    </Box>
  );
};

export default FeatureTreeVisualization;
