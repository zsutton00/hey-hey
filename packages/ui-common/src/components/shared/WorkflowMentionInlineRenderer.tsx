import { useModalState } from "../Modals/useModalState";
import { ModalWorkOwner } from "../Modals/ModalWorkOwner";
import { FunctionalDialog as Dialog } from "../Modals/FunctionalDialog";
import { DiagramReferenceActions } from "./DiagramReferenceActions";
import { DIAGRAM_TASK_TYPE } from "../../constants/taskTypes";
import { MentionArtifactCard } from "./MentionArtifactCard";
import { useMentionExpansion } from "./MentionExpansionContext";
import {
  DIAGRAM_LAYOUT_CANDIDATES,
  type DiagramLayoutCandidate,
  type DiagramLayoutDirection,
} from "./diagramLayoutCandidates";
import { useDiagramLayoutComparison } from "./useDiagramLayoutComparison";
import {
  buildDiagramLayoutGroupHints,
  computeBoundaryBoxes,
  DIAGRAM_GROUPS_SECTION_KEY,
  parseDiagramGroups,
  type DiagramBoundaryBox,
} from "./diagramGroupBoundaries";
import { useDiagramLayoutPreference } from "./useDiagramLayoutPreference";
import AccountTreeIcon from "@mui/icons-material/AccountTree";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import CategoryOutlinedIcon from "@mui/icons-material/CategoryOutlined";
import CloudOutlinedIcon from "@mui/icons-material/CloudOutlined";
import CodeIcon from "@mui/icons-material/Code";
import CloseIcon from "@mui/icons-material/Close";
import HubIcon from "@mui/icons-material/Hub";
import Inventory2Icon from "@mui/icons-material/Inventory2";
import FitScreenIcon from "@mui/icons-material/FitScreen";
import OpenInFullIcon from "@mui/icons-material/OpenInFull";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import PersonIcon from "@mui/icons-material/Person";
import PsychologyIcon from "@mui/icons-material/Psychology";
import PlayCircleOutlineIcon from "@mui/icons-material/PlayCircleOutline";
import StopCircleOutlinedIcon from "@mui/icons-material/StopCircleOutlined";
import StorageIcon from "@mui/icons-material/Storage";
import WidgetsIcon from "@mui/icons-material/Widgets";
import WebAssetIcon from "@mui/icons-material/WebAsset";
import ZoomInIcon from "@mui/icons-material/ZoomIn";
import ZoomOutIcon from "@mui/icons-material/ZoomOut";
import {
  AgentEdgeCategory,
  AgentEdgeDirection,
  AgentEdgeType,
  DiagramKind,
  DiagramLevel,
  TargetEntityType,
  type AgentEdgeEndpointEntityType,
  type AgentEdgeResponseDto,
  type ProjectedWorkItem,
  type ProjectedWorkItemRelationship,
  type WorkItemChangeSetIdentity,
  type WorkItemChangeSetPosition,
  type WorkItemChangeSetRelationshipIdentity,
  type WorkItemGraphParticipationResponseDto,
  type WorkItemGraphLayoutValue,
  type WorkItemTypeDefinitionDto,
  type DiagramElementMetadata,
  type DiagramGroup,
  type DiagramMetadata,
  type DiagramElementRoleDefinition,
} from "../../api";
import type { WorkItemResponseDto } from "../../data/collections/workItems";
import {
  Box,
  Alert,
  Button,
  DialogContent,
  DialogTitle,
  IconButton,
  Skeleton,
  Stack,
  Tooltip,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  type SxProps,
  type Theme,
} from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
import React, {
  memo,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ComponentType } from "react";
import type { SvgIconProps } from "@mui/material";
import {
  Link as RouterLink,
  MemoryRouter,
  useInRouterContext,
} from "react-router-dom";
import {
  BaseEdge,
  EdgeLabelRenderer,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  getNodesBounds,
  getViewportForBounds,
  getSmoothStepPath,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
  type Connection,
  type HandleType,
  useNodesInitialized,
  useReactFlow,
  useUpdateNodeInternals,
  ViewportPortal,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useProjectContext } from "../../contexts";
import { useOptionalConversationScrollPolicy } from "../Conversation/hooks/useConversationScrolling";
import { useWorkItem } from "../../data/hooks/useWorkItem";
import { useWorkItemGraph } from "../../data/hooks/useWorkItemGraph";
import { useWorkItemTypeByKey } from "../../data/hooks/useWorkItemTypes";
import { getTaskContentFromSections } from "../../utils/workItemSections";
import {
  formatWorkflowCompactDescription,
  formatWorkflowMentionDescription,
} from "../../utils/workflowDescriptionFormatting";
import {
  MentionBadgeInner,
  type MentionMode,
} from "../SmarterTextAreaCard/MentionBadge";
import { EntityHoverCard } from "../SmarterTextAreaCard/EntityHoverCard";
import { MentionEditorContext } from "../SmarterTextAreaCard/EditorContext";
import { renderInlineMentions } from "../SmarterTextAreaCard/renderInlineMentions";
import type { EntityMention } from "../SmarterTextAreaCard/types";
import { InteractionComponent } from "../InteractionComponent";
import { getPathService } from "../../services/webPathService";
import {
  getEntityIcon,
  resolveWorkItemIcon,
  resolveWorkItemIconPresentation,
} from "../../utils/entityIcons";
import { DecisionIcon } from "../../utils/icons/Decision";
import {
  ReportMentionInlineRenderer,
  REPORT_MENTION_ENTITY_TYPE,
} from "./ReportMentionInlineRenderer";
import {
  isWorkItemMention,
  WorkItemMentionInlineRenderer,
} from "./WorkItemMentionInlineRenderer";
import {
  getVisibleCanvasCenter,
  resolveDiagramExplorationTarget,
  resolveEmptyCanvasContextMenu,
  resolveConnectionCompletion,
  resolveNodeContextMenu,
  resolveNodeDragCompletion,
  resolveReconnectCompletion,
  type WorkItemGraphEmptyCanvasContextMenu,
  type WorkItemGraphNodeContextMenu,
} from "./workflowGraphInteractions";
import { getAuthoredWorkflowStepColor } from "./workflowGraphNodePresentation";
import type {
  PreferredLayoutDeparture,
  PreferredWorkItemGraphShape,
} from "./workItemGraphLayout";

const WORKFLOW_MENTION_ENTITY_TYPE = "workflow" as const;
const DIAGRAM_MENTION_ENTITY_TYPE = "diagram" as const;
const FLOW_EDGE_TYPES = [
  AgentEdgeType.Standard,
  AgentEdgeType.Conditional,
  AgentEdgeType.Loop,
] as const;

const WORKFLOW_STEP_NODE_TYPE = "workflowStep" as const;
const WORKFLOW_FLOW_EDGE_TYPE = "workflowFlow" as const;
const WORKFLOW_GRAPH_INTERACTION_SCOPE = "workflow-graph" as const;
const PROJECTED_EDGE_TIMESTAMP = "1970-01-01T00:00:00.000Z";
const WORKFLOW_GRAPH_NODE_SIZE = 140;
const WORKFLOW_GRAPH_PADDING = 24;
const WORKFLOW_GRAPH_X_GAP = 264;
const WORKFLOW_GRAPH_Y_GAP = 216;
const WORKFLOW_GRAPH_RETURN_EDGE_GUTTER_RATIO = 0.5;
const WORKFLOW_GRAPH_CROSS_BAND_LANE_GAP = 8;
const WORKFLOW_GRAPH_CONDITIONAL_MARKER_LENGTH = 18;
const WORKFLOW_GRAPH_CONDITIONAL_MARKER_HALF_WIDTH = 8;
const WORKFLOW_GRAPH_CONDITIONAL_MARKER_OUTLINE_WIDTH = 2;
const WORKFLOW_GRAPH_LOCAL_RETURN_CLEARANCE = 12;
const WORKFLOW_GRAPH_LOCAL_RETURN_LABEL_HEIGHT = 36;
const WORKFLOW_GRAPH_MIN_GROUPS_PER_BAND = 2;
const WORKFLOW_GRAPH_MAX_BANDS = 3;
const WORKFLOW_GRAPH_SCROLLBAR_ALLOWANCE = 20;
const WORKFLOW_GRAPH_MAX_HEIGHT = 760;
const WORKFLOW_GRAPH_MIN_VIEWPORT_HEIGHT = 220;
const WORKFLOW_MENTION_PRELOAD_ROOT_MARGIN = "1500px 0px";
const WORKFLOW_GRAPH_EDGE_LABEL_WIDTH = 72;
const WORKFLOW_GRAPH_EDGE_LABEL_MAX_LINES = 2;
const WORKFLOW_GRAPH_FIT_VIEW_PADDING = 0.2;
const WORKFLOW_GRAPH_MIN_ZOOM = 0.3;
const WORKFLOW_GRAPH_MAX_ZOOM = 1.75;
const WORKFLOW_GRAPH_DIALOG_HEIGHT = "92vh";
const WORKFLOW_FULFILLED_COUNT_SIZE = 28;

// React Flow disables pointer events for non-selectable edges unless it receives a click handler.
const enableReadOnlyWorkflowEdgeHover = (): void => {};

type WorkflowGraphSizeMode = "small" | "medium" | "large";

interface WorkflowGraphSizeConfig {
  nodeSize: number;
  padding: number;
  xGap: number;
  yGap: number;
  edgeLabelWidth: number;
  edgeLabelYOffset: number;
  titleLineClamp: number;
  summaryLineClamp: number;
  titleFontSize: string;
  titleMinHeight: string;
  summaryFontSize: string;
  cardPadding: number;
  tooltipMinWidth: number;
  tooltipMaxWidth: number;
}

const DEFAULT_WORKFLOW_GRAPH_SIZE_MODE: WorkflowGraphSizeMode = "medium";

const WORKFLOW_GRAPH_SIZE_CONFIGS: Record<
  WorkflowGraphSizeMode,
  WorkflowGraphSizeConfig
> = {
  small: {
    nodeSize: 104,
    padding: 20,
    xGap: 216,
    yGap: 180,
    edgeLabelWidth: 64,
    edgeLabelYOffset: 8,
    titleLineClamp: 2,
    summaryLineClamp: 2,
    titleFontSize: "0.75rem",
    titleMinHeight: "1.875rem",
    summaryFontSize: "0.6875rem",
    cardPadding: 1,
    tooltipMinWidth: 220,
    tooltipMaxWidth: 360,
  },
  medium: {
    nodeSize: WORKFLOW_GRAPH_NODE_SIZE,
    padding: WORKFLOW_GRAPH_PADDING,
    xGap: WORKFLOW_GRAPH_X_GAP,
    yGap: WORKFLOW_GRAPH_Y_GAP,
    edgeLabelWidth: WORKFLOW_GRAPH_EDGE_LABEL_WIDTH,
    edgeLabelYOffset: 10,
    titleLineClamp: 2,
    summaryLineClamp: 2,
    titleFontSize: "0.875rem",
    titleMinHeight: "2.1875rem",
    summaryFontSize: "0.875rem",
    cardPadding: 1.5,
    tooltipMinWidth: 220,
    tooltipMaxWidth: 380,
  },
  large: {
    nodeSize: WORKFLOW_GRAPH_NODE_SIZE * 2,
    padding: 32,
    xGap: 504,
    yGap: 396,
    edgeLabelWidth: WORKFLOW_GRAPH_EDGE_LABEL_WIDTH * 2,
    edgeLabelYOffset: 18,
    titleLineClamp: 5,
    summaryLineClamp: 6,
    titleFontSize: "0.875rem",
    titleMinHeight: "2.1875rem",
    summaryFontSize: "0.875rem",
    cardPadding: 2,
    tooltipMinWidth: 300,
    tooltipMaxWidth: 520,
  },
};

const WORKFLOW_GRAPH_SIZE_LABELS: Record<WorkflowGraphSizeMode, string> = {
  small: "S",
  medium: "M",
  large: "L",
};

const WORKFLOW_GRAPH_SIZE_MODES: WorkflowGraphSizeMode[] = [
  "small",
  "medium",
  "large",
];

type WorkflowGraphNode = Node<
  WorkflowStepNodeData,
  typeof WORKFLOW_STEP_NODE_TYPE
>;
type WorkflowGraphFlowEdge = Edge<
  WorkflowFlowEdgeData,
  typeof WORKFLOW_FLOW_EDGE_TYPE
>;
type WorkflowGraphEdge = WorkflowGraphFlowEdge;
type WorkflowGraphFlowInstance = ReactFlowInstance<
  WorkflowGraphNode,
  WorkflowGraphEdge
>;
type WorkflowGraphSurfaceVariant = "inline" | "fullscreen";

export type WorkflowGraphPresentationState = "added" | "authored";

const DEFAULT_WORKFLOW_GRAPH_PRESENTATION_STATE: WorkflowGraphPresentationState =
  "added";

type FlowEdgeType = (typeof FLOW_EDGE_TYPES)[number];

interface WorkflowMentionInlineRendererProps {
  mention: EntityMention;
  mode?: MentionMode;
}

type GraphWorkItem = Omit<WorkItemResponseDto, "sections"> & {
  sections?: WorkItemResponseDto["sections"] | ProjectedWorkItem["sections"];
};

export interface WorkflowGraphSurfaceData {
  workflow: GraphWorkItem;
  steps: GraphWorkItem[];
  edges: AgentEdgeResponseDto[];
  participation: WorkItemGraphParticipationResponseDto | null;
  workflowTypeDefinition?: WorkItemTypeDefinitionDto;
  nodeTypeDefinition?: WorkItemTypeDefinitionDto;
  layout?: WorkItemGraphLayoutValue | null;
}

export interface WorkflowGraphDirectEntityLink {
  sourceNodeId: string;
  targetEntityId: string;
  targetEntityType: AgentEdgeEndpointEntityType | TargetEntityType;
  targetWorkItemType?: string;
  targetTitle: string;
  relationshipType: string;
}

interface WorkflowGraphRenderedEntityLink extends WorkflowGraphDirectEntityLink {
  href: string;
  Icon: ComponentType<SvgIconProps>;
}

interface WorkflowFulfillmentTargetData {
  id: string;
  title: string;
}

interface WorkflowStepNodeData extends Record<string, unknown> {
  referenceIcon?: ComponentType<SvgIconProps>;
  referenceSelected?: boolean;
  onSelectReference?: () => void;
  canonicalReference?: DiagramElementMetadata["canonicalReference"];
  onExpandReference?: () => void;
  entityId: string;
  entityType: typeof TargetEntityType.Task;
  entitySubtype: string;
  entityTitle: string;
  organizationId: string;
  projectId: string;
  href: string;
  disableLinks: boolean;
  isEditable: boolean;
  canStartConnection: boolean;
  title: string;
  summary: string;
  description: string;
  handles: WorkflowStepHandleState;
  onNodeHover?: (nodeId: string | undefined) => void;
  isDropTarget: boolean;
  isHighlighted: boolean;
  isCreated: boolean;
  presentationState: WorkflowGraphPresentationState;
  isDiagram: boolean;
  diffStatus?: WorkflowGraphDiffStatus;
  authoredColor?: string;
  diagramRole?: string;
  diagramRoleKey?: DiagramElementRoleDefinition["key"];
  diagramRoleIcon?: ComponentType<SvgIconProps>;
  diagramNotation?: DiagramElementRoleDefinition["notation"];
  directEntityLinks: WorkflowGraphRenderedEntityLink[];
  fulfilledByTargets: WorkflowFulfillmentTargetData[];
  sizeConfig: WorkflowGraphSizeConfig;
  sizeMode: WorkflowGraphSizeMode;
}

interface WorkflowStepHandleState {
  hasLeftSourceHandle: boolean;
  hasLeftTargetHandle: boolean;
  hasRightSourceHandle: boolean;
  hasRightTargetHandle: boolean;
  forwardSourceHandleIds: string[];
  hasLoopSourceHandle: boolean;
  hasLoopTargetHandle: boolean;
  hasCrossBandTargetHandle: boolean;
  returnSourceHandleIds: string[];
  returnTargetHandleIds: string[];
}

type WorkflowFlowEdgeRoute =
  | { kind: "mainline"; lane: null; labelAnchor: "edge" }
  | {
      kind: "forward-branch";
      lane: number;
      siblingCount: number;
      labelAnchor: "between-nodes";
    }
  | {
      kind: "return";
      lane: number;
      gutterY: number;
      labelAnchor: "gutter-lane";
    }
  | {
      kind: "local-return";
      side: "left" | "right";
      lane: number;
      gutterX: number;
      labelAnchor: "side-lane";
    }
  | {
      kind: "cross-band";
      lane: number;
      gutterX: number;
      gutterY: number;
      labelAnchor: "outer-gutter";
    }
  | { kind: "loop"; lane: null; labelAnchor: "edge" };

interface WorkflowFlowEdgeData extends Record<string, unknown> {
  isTooltipOpen: boolean;
  edgeType: FlowEdgeType;
  label?: string;
  route: WorkflowFlowEdgeRoute;
  isHighlighted: boolean;
  onHoverStart?: () => void;
  onHoverEnd?: () => void;
  isCreated: boolean;
  presentationState: WorkflowGraphPresentationState;
  diffStatus?: WorkflowGraphDiffStatus;
  sizeConfig: WorkflowGraphSizeConfig;
  sizeMode: WorkflowGraphSizeMode;
}

type WorkflowLayoutEdge = AgentEdgeResponseDto & {
  type: typeof AgentEdgeType.Standard | typeof AgentEdgeType.Conditional;
  direction: typeof AgentEdgeDirection.Forward;
};

export interface WorkflowGraphModel {
  nodes: WorkflowGraphNode[];
  edges: WorkflowGraphEdge[];
  width: number;
  height: number;
  canvasHeight: number;
  layoutMode: "horizontal" | "wrapped";
  preferredLayout?: WorkflowGraphPreferredLayoutSummary;
}

export interface WorkflowGraphPreferredLayoutSummary {
  requested: PreferredWorkItemGraphShape;
  actual: PreferredWorkItemGraphShape;
  departures: readonly PreferredLayoutDeparture[];
}

interface WorkflowGraphModelOptions {
  disableLinks: boolean;
  highlightedStepId?: string;
  highlightedEdgeId?: string;
  hoveredNodeId?: string;
  sizeMode?: WorkflowGraphSizeMode;
  viewportWidth?: number;
  authoredPositions?: ReadonlyMap<string, WorkItemChangeSetPosition>;
  preferredLayout?: PreferredWorkItemGraphShape;
  editable?: boolean;
  reconnectableEdgeIds?: ReadonlySet<string>;
  createdNodeIds?: ReadonlySet<string>;
  createdEdgeIds?: ReadonlySet<string>;
  createdEdgeColor?: string;
  presentationState?: WorkflowGraphPresentationState;
  diffStatusByNodeId?: ReadonlyMap<string, WorkflowGraphDiffStatus>;
  diffStatusByEdgeId?: ReadonlyMap<string, WorkflowGraphDiffStatus>;
  diffEdgeColors?: Readonly<Record<WorkflowGraphDiffStatus, string>>;
  onExpandReference?: (entityId: string) => void;
  directEntityLinks?: readonly WorkflowGraphDirectEntityLink[];
}

const DEFAULT_WORKFLOW_GRAPH_MODEL_OPTIONS: WorkflowGraphModelOptions = {
  disableLinks: false,
};

export interface WorkItemGraphProjectionData {
  layoutSource: "authored" | "canonical";
  projectedRoot: ProjectedWorkItem;
  children: readonly ProjectedWorkItem[];
  incidentRelationships: readonly ProjectedWorkItemRelationship[];
  identityLabels?: Readonly<Record<string, string>>;
  externalEntities?: readonly WorkItemGraphExternalEntity[];
  effectiveLayout: {
    nodes: ReadonlyArray<{
      node: WorkItemChangeSetIdentity;
      position: WorkItemChangeSetPosition;
    }>;
  };
}

export interface WorkItemGraphExternalEntity {
  identity: WorkItemChangeSetIdentity;
  name: string;
  type: string;
}

export interface WorkflowGraphCreatedElements {
  children: readonly WorkItemChangeSetIdentity[];
  relationships: readonly WorkItemChangeSetRelationshipIdentity[];
}

export type WorkflowGraphDiffStatus = "added" | "changed" | "deleted";

const isWorkflowGraphAddedPresentation = ({
  isCreated,
  diffStatus,
  presentationState,
}: {
  isCreated: boolean;
  diffStatus: WorkflowGraphDiffStatus | undefined;
  presentationState: WorkflowGraphPresentationState;
}): boolean =>
  presentationState === "added" && (isCreated || diffStatus === "added");

const isWorkflowGraphDiffPresentation = (
  diffStatus: WorkflowGraphDiffStatus | undefined,
  presentationState: WorkflowGraphPresentationState,
): boolean =>
  Boolean(diffStatus) &&
  !(presentationState === "authored" && diffStatus === "added");

export interface WorkflowGraphDiffElements {
  added: WorkflowGraphCreatedElements;
  changed: WorkflowGraphCreatedElements;
  deleted: WorkflowGraphCreatedElements;
}

export interface WorkItemGraphConnectionGesture {
  source: WorkItemChangeSetIdentity;
  target: WorkItemChangeSetIdentity;
}

export interface WorkItemGraphReconnectGesture extends WorkItemGraphConnectionGesture {
  relationship: WorkItemChangeSetRelationshipIdentity;
}

export interface WorkItemGraphSelection {
  children: readonly WorkItemChangeSetIdentity[];
  relationships: readonly WorkItemChangeSetRelationshipIdentity[];
}

export interface WorkItemGraphEmptyCanvasDrop {
  source: WorkItemChangeSetIdentity;
  position: WorkItemChangeSetPosition;
}

interface WorkflowGraphSurfaceProps {
  graphData?: WorkflowGraphSurfaceData;
  projection?: WorkItemGraphProjectionData;
  allowFullscreen?: boolean;
  disableLinks?: boolean;
  highlightedStepId?: string;
  createdElements?: WorkflowGraphCreatedElements;
  diffElements?: WorkflowGraphDiffElements;
  presentationState?: WorkflowGraphPresentationState;
  organizationId?: string;
  projectId?: string;
  mode?: "view" | "edit";
  allowNodeDragging?: boolean;
  allowConnections?: boolean;
  allowReconnection?: boolean;
  reconnectableRelationships?: readonly WorkItemChangeSetRelationshipIdentity[];
  onNodeDragStop?: (
    child: WorkItemChangeSetIdentity,
    position: WorkItemChangeSetPosition,
    displayedLayout: WorkItemGraphProjectionData["effectiveLayout"]["nodes"],
  ) => void;
  onConnect?: (gesture: WorkItemGraphConnectionGesture) => void;
  onReconnect?: (gesture: WorkItemGraphReconnectGesture) => void;
  onNodeContextMenu?: (menu: WorkItemGraphNodeContextMenu) => void;
  onEmptyCanvasContextMenu?: (
    menu: WorkItemGraphEmptyCanvasContextMenu,
  ) => void;
  onSelectionChange?: (selection: WorkItemGraphSelection) => void;
  onEmptyCanvasDrop?: (drop: WorkItemGraphEmptyCanvasDrop) => void;
  onVisibleCanvasPositionChange?: (position: WorkItemChangeSetPosition) => void;
  /** Reports whether a layout preview currently suspends editing. */
  onLayoutPreviewChange?: (previewing: boolean) => void;
  explorationAncestors?: readonly string[];
  participation?: WorkItemGraphParticipationResponseDto | null;
  directEntityLinks?: readonly WorkflowGraphDirectEntityLink[];
}

interface WorkflowGraphViewportSurfaceProps {
  layoutComparisonControls: {
    candidate: DiagramLayoutCandidate;
    direction: DiagramLayoutDirection;
    automaticCandidate: DiagramLayoutCandidate;
    automaticDirection: DiagramLayoutDirection;
    previewRequested: boolean;
    onPreviewCancel: () => void;
    onCandidateChange: (candidate: DiagramLayoutCandidate) => void;
    onDirectionChange: (direction: DiagramLayoutDirection) => void;
  };
  graphData: WorkflowGraphSurfaceData;
  projection?: WorkItemGraphProjectionData;
  graphSizeMode: WorkflowGraphSizeMode;
  disableLinks: boolean;
  highlightedStepId?: string;
  highlightedEdgeId?: string;
  hoveredNodeId?: string;
  onNodeHover?: (nodeId: string | undefined) => void;
  onEdgeMouseEnter?: (edgeId: string) => void;
  onEdgeMouseLeave?: (edgeId: string) => void;
  onViewportPointerLeave?: () => void;
  createdElements?: WorkflowGraphCreatedElements;
  diffElements?: WorkflowGraphDiffElements;
  presentationState?: WorkflowGraphPresentationState;
  workflowHref?: string;
  variant: WorkflowGraphSurfaceVariant;
  allowFullscreen?: boolean;
  onOpenFullscreen?: () => void;
  onSizeModeChange: (sizeMode: WorkflowGraphSizeMode) => void;
  open?: boolean;
  onExpandReference?: (entityId: string) => void;
  directEntityLinks?: readonly WorkflowGraphDirectEntityLink[];
  interaction?: Pick<
    WorkflowGraphSurfaceProps,
    | "mode"
    | "allowNodeDragging"
    | "allowConnections"
    | "allowReconnection"
    | "reconnectableRelationships"
    | "onNodeDragStop"
    | "onConnect"
    | "onReconnect"
    | "onNodeContextMenu"
    | "onEmptyCanvasContextMenu"
    | "onSelectionChange"
    | "onEmptyCanvasDrop"
    | "onVisibleCanvasPositionChange"
    | "onLayoutPreviewChange"
  >;
}

interface WorkflowGraphViewportControllerProps {
  enableInitialFit: boolean;
  hasGraphNodes: boolean;
  onReady: (instance: WorkflowGraphFlowInstance) => void;
  open: boolean;
}

interface WorkflowGraphTitleProps {
  graphData: WorkflowGraphSurfaceData;
  testId:
    | "workflow-inline-diagram-title-link"
    | "workflow-fullscreen-diagram-title-link"
    | "workflow-fullscreen-dialog-title-link";
  workflowHref?: string;
}

interface WorkflowEdgeLabelProps {
  edgeId?: string;
  label: string;
  labelX: number;
  labelY: number;
  sizeConfig?: WorkflowGraphSizeConfig;
  sizeMode?: WorkflowGraphSizeMode;
  isHighlighted?: boolean;
  isTooltipOpen?: boolean;
  diffStatus?: WorkflowGraphDiffStatus;
  presentationState?: WorkflowGraphPresentationState;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}

const isWorkflowMention = (mention: EntityMention): boolean =>
  mention.entityType === WORKFLOW_MENTION_ENTITY_TYPE;

const isDiagramMention = (mention: EntityMention): boolean =>
  mention.entityType.toLowerCase() === DIAGRAM_MENTION_ENTITY_TYPE;

const parseJsonSection = (
  sections: GraphWorkItem["sections"],
  key: string,
): unknown => {
  const section = sections?.find((section) => section.key === key);
  if (!section) return null;
  const value: unknown =
    "materializedMarkdown" in section
      ? section.materializedMarkdown
      : section.content;
  if (typeof value !== "string") return value ?? null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
};

export const getDiagramMetadata = (
  workItem: GraphWorkItem,
): DiagramMetadata | null => {
  const value = parseJsonSection(workItem.sections, "diagramMetadata");
  if (
    typeof value !== "object" ||
    value === null ||
    !("kind" in value) ||
    !("level" in value) ||
    !Object.values(DiagramKind).includes(
      value.kind as DiagramMetadata["kind"],
    ) ||
    !Object.values(DiagramLevel).includes(
      value.level as DiagramMetadata["level"],
    )
  ) {
    return null;
  }
  return {
    kind: value.kind as DiagramMetadata["kind"],
    level: value.level as DiagramMetadata["level"],
  };
};

/**
 * Authored groups from the type-declared groups section. Proposal and draft
 * projections carry the same section, so every rendering reads one value.
 */
export const getDiagramGroups = (
  graphData: Pick<
    WorkflowGraphSurfaceData,
    "workflow" | "workflowTypeDefinition"
  >,
): DiagramGroup[] =>
  parseDiagramGroups(
    parseJsonSection(
      graphData.workflow.sections,
      graphData.workflowTypeDefinition?.capabilities?.graph?.groups
        ?.sectionKey ?? DIAGRAM_GROUPS_SECTION_KEY,
    ),
  );

/** Group hints for automatic layout, keyed by rendered step node ids. */
const diagramLayoutGroupsFor = (
  groups: readonly DiagramGroup[],
  stepNodeIds: readonly string[],
) => {
  const hints = buildDiagramLayoutGroupHints(groups, new Set(stepNodeIds));
  return hints ? { groups: hints } : {};
};

const DIAGRAM_BOUNDARY_INTRUSION_SIZE = 20;

/**
 * Boundaries are painted beneath nodes inside the flow viewport, so they pan
 * and zoom with the graph and follow dragged nodes without reflowing them.
 */
const DiagramBoundaryLayer: React.FC<{
  boxes: readonly DiagramBoundaryBox[];
  nodeRects: ReadonlyMap<
    string,
    { x: number; y: number; width: number; height: number }
  >;
  testIdPrefix: string;
}> = ({ boxes, nodeRects, testIdPrefix }) => {
  const theme = useTheme();
  const intrusions = boxes.flatMap((box) =>
    box.intrudingNodeIds.map((nodeId) => ({ box, nodeId })),
  );
  return (
    <ViewportPortal>
      <Box
        data-testid={`${testIdPrefix}-boundaries`}
        sx={{
          position: "absolute",
          inset: 0,
          zIndex: -1,
          pointerEvents: "none",
        }}
      >
        {boxes.map((box) => {
          const color = theme.palette.diagramGroups[box.color];
          return (
            <Box
              key={box.id}
              data-testid={`${testIdPrefix}-boundary-${box.id}`}
              data-meaning={box.meaning}
              data-depth={box.depth}
              data-color={box.color}
              sx={{
                position: "absolute",
                left: box.x,
                top: box.y,
                width: box.width,
                height: box.height,
                borderRadius: 2,
                borderWidth: box.factual ? 1.5 : 1,
                borderStyle: box.factual ? "solid" : "dashed",
                borderColor: alpha(color, 0.8),
                backgroundColor: alpha(
                  color,
                  Math.min(0.08 + box.depth * 0.025, 0.18),
                ),
              }}
            >
              <Typography
                variant="caption"
                sx={{
                  position: "absolute",
                  top: 4,
                  left: 10,
                  color,
                  backgroundColor: theme.palette.background.paper,
                  border: `1px solid ${alpha(color, 0.5)}`,
                  borderRadius: 1,
                  px: 0.75,
                  fontWeight: 600,
                  fontStyle: "normal",
                  whiteSpace: "nowrap",
                }}
              >
                {box.label}
              </Typography>
            </Box>
          );
        })}
        {intrusions.map(({ box, nodeId }) => {
          const rect = nodeRects.get(nodeId);
          if (!rect) return null;
          return (
            <Tooltip
              key={`${box.id}:${nodeId}`}
              title={`Shown inside ${box.label} but not a member. Re-run automatic layout or update the group.`}
            >
              <Box
                data-testid={`${testIdPrefix}-boundary-intrusion-${nodeId}`}
                sx={{
                  position: "absolute",
                  left:
                    rect.x + rect.width - DIAGRAM_BOUNDARY_INTRUSION_SIZE / 2,
                  top: rect.y - DIAGRAM_BOUNDARY_INTRUSION_SIZE / 2,
                  width: DIAGRAM_BOUNDARY_INTRUSION_SIZE,
                  height: DIAGRAM_BOUNDARY_INTRUSION_SIZE,
                  pointerEvents: "auto",
                  color: theme.palette.warning.main,
                  display: "flex",
                }}
              >
                <WarningAmberIcon
                  sx={{ fontSize: DIAGRAM_BOUNDARY_INTRUSION_SIZE }}
                />
              </Box>
            </Tooltip>
          );
        })}
      </Box>
    </ViewportPortal>
  );
};

export const getDiagramElementMetadata = (
  workItem: GraphWorkItem,
): DiagramElementMetadata | null =>
  (() => {
    const value = parseJsonSection(workItem.sections, "diagramElementMetadata");
    if (
      typeof value !== "object" ||
      value === null ||
      !("role" in value) ||
      typeof value.role !== "string"
    )
      return null;
    const canonicalReference =
      "canonicalReference" in value &&
      typeof value.canonicalReference === "object" &&
      value.canonicalReference !== null &&
      "entityId" in value.canonicalReference &&
      typeof value.canonicalReference.entityId === "string" &&
      "entityType" in value.canonicalReference &&
      (value.canonicalReference.entityType === TargetEntityType.Task ||
        value.canonicalReference.entityType === TargetEntityType.Service)
        ? {
            entityId: value.canonicalReference.entityId,
            entityType: value.canonicalReference.entityType,
          }
        : undefined;
    return {
      role: value.role,
      ...(canonicalReference ? { canonicalReference } : {}),
    };
  })();

const getDiagramRoleDefinitions = (
  definition?: WorkItemTypeDefinitionDto,
): DiagramElementRoleDefinition[] =>
  definition?.sections.find(
    (section) => section.key === "diagramElementMetadata",
  )?.diagramElementPolicy?.roles ?? [];

const DIAGRAM_ROLE_ICONS: Readonly<
  Record<string, ComponentType<SvgIconProps>>
> = {
  GENERIC: CategoryOutlinedIcon,
  PERSON: PersonIcon,
  AGENT: PsychologyIcon,
  START: PlayCircleOutlineIcon,
  END: StopCircleOutlinedIcon,
  SOFTWARE_SYSTEM: HubIcon,
  CONTAINER: Inventory2Icon,
  COMPONENT: WidgetsIcon,
  CODE: CodeIcon,
  DATABASE: StorageIcon,
  UI: WebAssetIcon,
  PRODUCT: Inventory2Icon,
  DECISION: DecisionIcon,
  EXTERNAL_SYSTEM: CloudOutlinedIcon,
  DIAGRAM_REFERENCE: AccountTreeIcon,
};

const getDiagramRoleIcon = (
  roleKey: string,
  notation?: DiagramElementRoleDefinition["notation"],
): ComponentType<SvgIconProps> => {
  const knownRoleIcon = DIAGRAM_ROLE_ICONS[roleKey];
  if (knownRoleIcon) return knownRoleIcon;

  switch (notation) {
    case "person":
      return PersonIcon;
    case "cylinder":
      return StorageIcon;
    case "diamond":
      return DecisionIcon;
    case "frame":
      return AccountTreeIcon;
    case "box":
    default:
      return CategoryOutlinedIcon;
  }
};

const getDirectEntityHref = (
  entityType: AgentEdgeEndpointEntityType | TargetEntityType,
  entityId: string,
  projectId: string,
): string | undefined => {
  const paths = getPathService();
  switch (entityType.toUpperCase()) {
    case "TASK":
    case "BUG":
    case "WORKFLOW":
    case "DIAGRAM":
    case "DIAGRAM_ELEMENT":
    case "CONTRACT":
      return paths.task({ projectId, taskId: entityId });
    case "SERVICE":
      return paths.service({ projectId, serviceId: entityId });
    case "DESIGN_DOC":
      return paths.designDoc({ projectId, designDocId: entityId });
    case "INITIATIVE":
      return paths.initiativeDetail({ projectId, initiativeId: entityId });
    case "FEATURE":
      return paths.feature({ projectId, featureId: entityId });
    case "AGENT_SESSION":
      return paths.agentSession({ projectId, agentSessionId: entityId });
    case "CONVERSATION":
      return paths.resolveAgentSession({ projectId, conversationId: entityId });
    case "MESSAGE":
      return paths.resolveMessageById({ projectId, messageId: entityId });
    case "REPORT":
      return paths.report({ projectId, reportId: entityId });
    case "PROPOSAL":
      return paths.proposal({ projectId, proposalId: entityId });
    case "PROJECT":
      return paths.project(entityId);
    case "ARTIFACT":
      return paths.artifact({ projectId, artifactId: entityId });
    default:
      return undefined;
  }
};

const getDirectEntityLinksByNodeId = (
  steps: readonly GraphWorkItem[],
  edges: readonly AgentEdgeResponseDto[],
  directEntityLinks: readonly WorkflowGraphDirectEntityLink[],
  projectId: string,
): Map<string, WorkflowGraphRenderedEntityLink[]> => {
  const stepIds = new Set(steps.map((step) => step.id));
  const linksByNodeId = new Map<string, WorkflowGraphRenderedEntityLink[]>();
  const addLink = (link: WorkflowGraphDirectEntityLink): void => {
    const targetTitle = link.targetTitle.trim();
    if (!stepIds.has(link.sourceNodeId) || !targetTitle) return;
    const href = getDirectEntityHref(
      link.targetEntityType,
      link.targetEntityId,
      projectId,
    );
    if (!href) return;
    const existing = linksByNodeId.get(link.sourceNodeId) ?? [];
    linksByNodeId.set(link.sourceNodeId, [
      ...existing,
      {
        ...link,
        targetTitle,
        href,
        Icon: getEntityIcon(link.targetEntityType),
      },
    ]);
  };

  edges.forEach((edge) => {
    if (isFlowEdge(edge) || !edge.targetEntityType) return;
    const targetTitle = getEdgeNodeName(edge, "targetNodeName");
    if (!targetTitle) return;
    addLink({
      sourceNodeId: edge.sourceNodeId,
      targetEntityId: edge.targetNodeId,
      targetEntityType: edge.targetEntityType,
      ...(edge.targetNodeType
        ? { targetWorkItemType: edge.targetNodeType }
        : {}),
      targetTitle,
      relationshipType: edge.type,
    });
  });
  directEntityLinks.forEach(addLink);
  return linksByNodeId;
};

const formatDiagramSemanticLabel = (value: string): string =>
  value
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/^\w/, (character) => character.toUpperCase());

const isReportMention = (mention: EntityMention): boolean =>
  mention.entityType === REPORT_MENTION_ENTITY_TYPE;

const isWorkflow = (
  workItem: WorkItemResponseDto | null,
): workItem is WorkItemResponseDto & { type: "workflow" } =>
  workItem?.type === "workflow";

const isWorkflowStep = (
  workItem: WorkItemResponseDto,
): workItem is WorkItemResponseDto & { type: "workflow_step" } =>
  workItem.type === "workflow_step";

const buildWorkflowStepHref = (
  step: WorkflowGraphSurfaceData["steps"][number],
): string =>
  getPathService().task({
    projectId: step.projectId,
    taskId: step.id,
  });

const hasWorkflowIdentity = (
  workflow: WorkflowGraphSurfaceData["workflow"],
): boolean =>
  typeof workflow.id === "string" &&
  workflow.id.trim().length > 0 &&
  typeof workflow.name === "string" &&
  workflow.name.trim().length > 0 &&
  typeof workflow.organizationId === "string" &&
  workflow.organizationId.trim().length > 0 &&
  typeof workflow.projectId === "string" &&
  workflow.projectId.trim().length > 0;

// Projections may legitimately lack scope; they still render, with links and
// previews disabled.
const hasProjectedWorkflowIdentity = (
  workflow: WorkflowGraphSurfaceData["workflow"],
): boolean =>
  typeof workflow.id === "string" &&
  workflow.id.trim().length > 0 &&
  typeof workflow.name === "string" &&
  workflow.name.trim().length > 0;

const buildWorkflowHref = (
  workflow: WorkflowGraphSurfaceData["workflow"],
): string | undefined => {
  if (!hasWorkflowIdentity(workflow)) {
    return undefined;
  }

  const href = getPathService().task({
    projectId: workflow.projectId,
    taskId: workflow.id,
  });

  return typeof href === "string" && href.trim().length > 0 ? href : undefined;
};

const workItemIdentityKey = (identity: WorkItemChangeSetIdentity): string =>
  identity.refType === "existing"
    ? identity.id
    : `temporary:${identity.tempId}`;

const draftIdentityKey = (identity: WorkItemChangeSetIdentity): string =>
  identity.refType === "existing"
    ? `existing:${identity.id}`
    : `temporary:${identity.tempId}`;

const relationshipIdentityKey = (
  identity: WorkItemChangeSetRelationshipIdentity,
): string =>
  identity.refType === "existing"
    ? `existing:${identity.id}`
    : `temporary:${identity.tempId}`;

export interface WorkflowGraphScope {
  organizationId: string;
  projectId: string;
}

// A projection without scope omits organizationId/projectId so every
// downstream fetch (hover previews, type lookups) stays disabled; never
// substitute a placeholder, which would be sent to the API as a path id.
const projectedWorkItemToSurfaceWorkItem = (
  workItem: ProjectedWorkItem,
  type: string,
  root: ProjectedWorkItem | undefined,
  scope: WorkflowGraphScope | null,
): GraphWorkItem =>
  ({
    id: workItemIdentityKey(workItem.identity),
    name: workItem.name,
    type,
    ...(scope
      ? { organizationId: scope.organizationId, projectId: scope.projectId }
      : {}),
    source: "agent",
    status: workItem.status,
    priority: workItem.priority,
    dueDate: workItem.dueDate,
    assigneeId: workItem.assigneeId,
    tag: workItem.tag,
    parentTaskId: root ? workItemIdentityKey(root.identity) : undefined,
    sections: workItem.sections,
  }) as GraphWorkItem;

const projectedRelationshipMetadataValue = (
  relationship: ProjectedWorkItemRelationship,
  keys: readonly string[],
): string | null => {
  const metadata = relationship.metadata;
  if (typeof metadata !== "object" || metadata === null) return null;

  for (const key of keys) {
    const value = (metadata as Record<string, unknown>)[key];
    if (typeof value === "string" && value.trim()) return value;
  }

  return null;
};

const projectedEndpointMetadata = ({
  identity,
  projectedNodes,
  identityLabels,
  externalEntities,
}: {
  identity: WorkItemChangeSetIdentity;
  projectedNodes: readonly ProjectedWorkItem[];
  identityLabels: Readonly<Record<string, string>>;
  externalEntities: readonly WorkItemGraphExternalEntity[];
}): { name: string | null; type: string | null } => {
  const identityKey = workItemIdentityKey(identity);
  const projectedNode = projectedNodes.find(
    (node) => workItemIdentityKey(node.identity) === identityKey,
  );
  if (projectedNode) {
    return { name: projectedNode.name, type: projectedNode.type };
  }

  const externalEntity = externalEntities.find(
    (entity) => workItemIdentityKey(entity.identity) === identityKey,
  );
  if (externalEntity) {
    return { name: externalEntity.name, type: externalEntity.type };
  }

  return {
    // The API keys existing items as `existing:<id>`; accept bare ids too.
    name:
      identityLabels[draftIdentityKey(identity)] ??
      identityLabels[identityKey] ??
      null,
    type: null,
  };
};

const projectedRelationshipToSurfaceEdge = (
  relationship: ProjectedWorkItemRelationship,
  projectedNodes: readonly ProjectedWorkItem[],
  identityLabels: Readonly<Record<string, string>>,
  externalEntities: readonly WorkItemGraphExternalEntity[],
): AgentEdgeResponseDto => {
  const source = projectedEndpointMetadata({
    identity: relationship.source,
    projectedNodes,
    identityLabels,
    externalEntities,
  });
  const target = projectedEndpointMetadata({
    identity: relationship.target,
    projectedNodes,
    identityLabels,
    externalEntities,
  });
  const targetNodeName =
    projectedRelationshipMetadataValue(relationship, [
      "targetNodeName",
      "targetName",
    ]) ?? target.name;
  const targetNodeType =
    projectedRelationshipMetadataValue(relationship, [
      "targetNodeType",
      "targetWorkItemTypeKey",
      "targetType",
    ]) ?? target.type;

  return {
    id: relationshipIdentityKey(relationship.identity),
    type: relationship.edgeType,
    category: relationship.category,
    sourceNodeId: workItemIdentityKey(relationship.source),
    sourceEntityType: relationship.sourceEntityType,
    sourceNodeName: source.name,
    targetNodeId: workItemIdentityKey(relationship.target),
    targetEntityType: relationship.targetEntityType,
    targetNodeName,
    targetNodeType,
    direction: relationship.direction,
    predicate: relationship.predicate,
    reasoning: relationship.reasoning ?? "",
    metadata: relationship.metadata,
    createdAt: PROJECTED_EDGE_TIMESTAMP,
    updatedAt: PROJECTED_EDGE_TIMESTAMP,
  };
};

type ProjectableWorkItemGraph = Pick<
  WorkItemGraphProjectionData,
  | "projectedRoot"
  | "children"
  | "incidentRelationships"
  | "identityLabels"
  | "externalEntities"
>;

export const projectWorkItemGraphForWorkflowSurface = (
  projection: ProjectableWorkItemGraph,
  scope: WorkflowGraphScope,
  options?: { includeDeleted?: boolean },
): WorkflowGraphSurfaceData => projectWorkItemGraph(projection, scope, options);

const projectWorkItemGraph = (
  projection: ProjectableWorkItemGraph,
  scope: WorkflowGraphScope | null,
  options?: { includeDeleted?: boolean },
): WorkflowGraphSurfaceData => {
  const projectedNodes = [projection.projectedRoot, ...projection.children];
  const identityLabels = projection.identityLabels ?? {};
  const externalEntities = projection.externalEntities ?? [];

  return {
    workflow: projectedWorkItemToSurfaceWorkItem(
      projection.projectedRoot,
      projection.projectedRoot.type,
      undefined,
      scope,
    ) as WorkflowGraphSurfaceData["workflow"],
    steps: projection.children
      .filter((child) => options?.includeDeleted || !child.deleted)
      .map(
        (child) =>
          projectedWorkItemToSurfaceWorkItem(
            child,
            child.type,
            projection.projectedRoot,
            scope,
          ) as WorkflowGraphSurfaceData["steps"][number],
      ),
    edges: projection.incidentRelationships
      .filter(
        (relationship) => options?.includeDeleted || !relationship.deleted,
      )
      .map((relationship) =>
        projectedRelationshipToSurfaceEdge(
          relationship,
          projectedNodes,
          identityLabels,
          externalEntities,
        ),
      ),
    participation: null,
  };
};

const pointerEventPoint = (
  event: MouseEvent | TouchEvent,
): { x: number; y: number } => {
  if ("changedTouches" in event) {
    const touch = event.changedTouches[0];
    return { x: touch?.clientX ?? 0, y: touch?.clientY ?? 0 };
  }
  return { x: event.clientX, y: event.clientY };
};

const isFlowEdge = (
  edge: AgentEdgeResponseDto,
): edge is AgentEdgeResponseDto & { type: FlowEdgeType } =>
  edge.category === AgentEdgeCategory.Flow &&
  FLOW_EDGE_TYPES.includes(edge.type as FlowEdgeType);

const isFulfilledByEdge = (
  edge: AgentEdgeResponseDto,
): edge is AgentEdgeResponseDto & { type: typeof AgentEdgeType.FulfilledBy } =>
  edge.type === AgentEdgeType.FulfilledBy;

const getEdgeNodeName = (
  edge: AgentEdgeResponseDto,
  key: "sourceNodeName" | "targetNodeName",
): string | null => {
  const value = (
    edge as AgentEdgeResponseDto & {
      sourceNodeName?: unknown;
      targetNodeName?: unknown;
    }
  )[key];
  return typeof value === "string" && value.trim() ? value : null;
};

const dedupeEdges = (
  edgeLists: Array<AgentEdgeResponseDto[] | undefined>,
): AgentEdgeResponseDto[] => {
  const byId = new Map<string, AgentEdgeResponseDto>();

  edgeLists
    .flatMap((edges) => edges ?? [])
    .forEach((edge) => {
      byId.set(edge.id, edge);
    });

  return Array.from(byId.values());
};

const hydrateWorkflowGraphEdges = (
  graphData: WorkflowGraphSurfaceData,
): WorkflowGraphSurfaceData => ({
  ...graphData,
  edges: dedupeEdges([
    graphData.edges,
    graphData.workflow.edges,
    ...graphData.steps.map((step) => step.edges),
  ]),
});

const getStepSummary = (step: GraphWorkItem): string =>
  formatWorkflowCompactDescription(
    getTaskContentFromSections(step.sections).description,
  );

const getStepDescription = (step: GraphWorkItem): string =>
  formatWorkflowMentionDescription(
    getTaskContentFromSections(step.sections).description,
  );

const getFulfilledByTargetsByStepId = ({
  steps,
  edges,
}: Pick<WorkflowGraphSurfaceData, "steps" | "edges">): Map<
  string,
  WorkflowFulfillmentTargetData[]
> => {
  const stepIds = new Set(steps.map((step) => step.id));
  const targetsByStepId = new Map<string, WorkflowFulfillmentTargetData[]>();

  edges.filter(isFulfilledByEdge).forEach((edge) => {
    if (!stepIds.has(edge.sourceNodeId)) {
      return;
    }

    const existingTargets = targetsByStepId.get(edge.sourceNodeId) ?? [];
    if (existingTargets.some((target) => target.id === edge.targetNodeId)) {
      return;
    }

    const title = getEdgeNodeName(edge, "targetNodeName");
    if (!title) {
      return;
    }
    targetsByStepId.set(edge.sourceNodeId, [
      ...existingTargets,
      {
        id: edge.targetNodeId,
        title,
      },
    ]);
  });

  return targetsByStepId;
};

const getEdgeLabel = (edge: AgentEdgeResponseDto): string | undefined => {
  if (edge.type !== AgentEdgeType.Conditional) {
    return undefined;
  }

  const predicate = edge.predicate?.trim();
  if (!predicate) {
    return undefined;
  }

  return predicate;
};

const getEdgeStyle = (edge: AgentEdgeResponseDto): Edge["style"] => {
  if (edge.type === AgentEdgeType.Loop) {
    return { strokeDasharray: "6 4", strokeWidth: 2 };
  }

  if (edge.type === AgentEdgeType.Conditional) {
    return { strokeDasharray: "1 6", strokeLinecap: "round", strokeWidth: 2 };
  }

  return { strokeWidth: 2 };
};

const getWorkflowGraphHighlightTextColor = (theme: Theme): string =>
  theme.palette.primary.main;

const CONDITIONAL_MARKER_BASE_DIRECTION: Record<
  Position,
  { x: number; y: number }
> = {
  [Position.Left]: { x: -1, y: 0 },
  [Position.Right]: { x: 1, y: 0 },
  [Position.Top]: { x: 0, y: -1 },
  [Position.Bottom]: { x: 0, y: 1 },
};

const getConditionalTargetMarkerPoints = ({
  targetPosition,
  targetX,
  targetY,
}: {
  targetPosition: Position;
  targetX: number;
  targetY: number;
}): string => {
  const direction = CONDITIONAL_MARKER_BASE_DIRECTION[targetPosition];
  const baseX =
    targetX + direction.x * WORKFLOW_GRAPH_CONDITIONAL_MARKER_LENGTH;
  const baseY =
    targetY + direction.y * WORKFLOW_GRAPH_CONDITIONAL_MARKER_LENGTH;
  const perpendicularX = -direction.y;
  const perpendicularY = direction.x;

  return [
    `${targetX},${targetY}`,
    `${baseX + perpendicularX * WORKFLOW_GRAPH_CONDITIONAL_MARKER_HALF_WIDTH},${
      baseY + perpendicularY * WORKFLOW_GRAPH_CONDITIONAL_MARKER_HALF_WIDTH
    }`,
    `${baseX - perpendicularX * WORKFLOW_GRAPH_CONDITIONAL_MARKER_HALF_WIDTH},${
      baseY - perpendicularY * WORKFLOW_GRAPH_CONDITIONAL_MARKER_HALF_WIDTH
    }`,
  ].join(" ");
};

interface WorkflowConditionalTargetMarkerProps {
  edgeId: string;
  isHighlighted: boolean;
  strokeColor: string;
  targetPosition: Position;
  targetX: number;
  targetY: number;
}

export const WorkflowConditionalTargetMarker: React.FC<
  WorkflowConditionalTargetMarkerProps
> = ({
  edgeId,
  isHighlighted,
  strokeColor,
  targetPosition,
  targetX,
  targetY,
}) => {
  const theme = useTheme();

  return (
    <polygon
      data-testid="workflow-conditional-target-marker"
      data-edge-id={edgeId}
      data-edge-highlighted={String(isHighlighted)}
      points={getConditionalTargetMarkerPoints({
        targetPosition,
        targetX,
        targetY,
      })}
      fill={strokeColor}
      stroke={theme.palette.background.paper}
      strokeWidth={WORKFLOW_GRAPH_CONDITIONAL_MARKER_OUTLINE_WIDTH}
      strokeLinejoin="round"
      pointerEvents="none"
    />
  );
};

export const WorkflowEdgeLabel: React.FC<WorkflowEdgeLabelProps> = ({
  edgeId,
  label,
  labelX,
  labelY,
  sizeConfig,
  sizeMode = DEFAULT_WORKFLOW_GRAPH_SIZE_MODE,
  isHighlighted = false,
  isTooltipOpen,
  diffStatus,
  presentationState = DEFAULT_WORKFLOW_GRAPH_PRESENTATION_STATE,
  onMouseEnter,
  onMouseLeave,
}) => {
  const theme = useTheme();
  const resolvedSizeConfig =
    sizeConfig ?? WORKFLOW_GRAPH_SIZE_CONFIGS[sizeMode];
  const tooltipFontSize = sizeMode === "small" ? "0.8125rem" : "0.875rem";
  const highlightTextColor = getWorkflowGraphHighlightTextColor(theme);
  const diffColor =
    diffStatus === "deleted"
      ? theme.palette.error.main
      : isWorkflowGraphDiffPresentation(diffStatus, presentationState)
        ? theme.palette.success.main
        : undefined;

  return (
    <Tooltip
      arrow
      // The full label is read-only. Let the pointer keep hitting the edge
      // underneath it so opening the tooltip cannot end its own hover.
      disableInteractive
      open={isTooltipOpen}
      placement="top"
      slotProps={{
        tooltip: {
          sx: {
            maxWidth: resolvedSizeConfig.tooltipMaxWidth,
            p: 1.25,
          },
        },
      }}
      title={
        <Typography
          data-testid="workflow-inline-edge-label-tooltip"
          variant="body2"
          sx={{ fontSize: tooltipFontSize, lineHeight: 1.45 }}
        >
          {label}
        </Typography>
      }
    >
      <Box
        className="nodrag nopan"
        data-testid="workflow-inline-edge-label"
        data-workflow-hover-edge-id={edgeId}
        data-workflow-graph-size={sizeMode}
        data-workflow-edge-highlighted={String(isHighlighted)}
        data-workflow-edge-diff={diffStatus ?? "unchanged"}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        sx={{
          position: "absolute",
          transform: `translate(-50%, 0) translate(${labelX}px, ${
            labelY + resolvedSizeConfig.edgeLabelYOffset
          }px)`,
          pointerEvents: "all",
          width: resolvedSizeConfig.edgeLabelWidth,
          zIndex: isHighlighted ? 1 : 0,
          bgcolor: diffColor
            ? alpha(diffColor, theme.palette.mode === "dark" ? 0.22 : 0.1)
            : isHighlighted
              ? "background.paper"
              : "transparent",
          border: diffColor ? `1px solid ${diffColor}` : undefined,
          borderRadius: 0.5,
          boxShadow: isHighlighted ? 2 : 0,
        }}
      >
        <Typography
          variant="caption"
          sx={{
            color: diffColor
              ? diffColor
              : isHighlighted
                ? highlightTextColor
                : "text.secondary",
            display: "-webkit-box",
            fontWeight: isHighlighted ? 700 : 600,
            lineHeight: 1.2,
            overflow: "hidden",
            overflowWrap: "anywhere",
            textAlign: "center",
            WebkitBoxOrient: "vertical",
            WebkitLineClamp: WORKFLOW_GRAPH_EDGE_LABEL_MAX_LINES,
            whiteSpace: "normal",
          }}
        >
          {label}
        </Typography>
      </Box>
    </Tooltip>
  );
};

const WorkflowFlowEdge = memo(
  ({
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    markerEnd,
    style,
    data,
  }: EdgeProps<Edge<WorkflowFlowEdgeData, typeof WORKFLOW_FLOW_EDGE_TYPE>>) => {
    const theme = useTheme();
    const pathOptions = {
      sourceX,
      sourceY,
      sourcePosition,
      targetX,
      targetY,
      targetPosition,
    };
    const [smoothPath, pathLabelX, pathLabelY] = getSmoothStepPath(pathOptions);
    const edgePath =
      data?.route.kind === "return"
        ? getReturnEdgePath({
            sourceX,
            sourceY,
            targetX,
            targetY,
            gutterY: data.route.gutterY,
          })
        : data?.route.kind === "local-return"
          ? getLocalReturnEdgePath({
              sourceX,
              sourceY,
              targetX,
              targetY,
              gutterX: data.route.gutterX,
            })
          : data?.route.kind === "cross-band"
            ? getCrossBandEdgePath({
                sourceX,
                sourceY,
                targetX,
                targetY,
                gutterX: data.route.gutterX,
                gutterY: data.route.gutterY,
              })
            : smoothPath;
    const [labelX, labelY] = getWorkflowEdgeLabelPosition({
      route: data?.route,
      sourceX,
      sourceY,
      sourcePosition,
      targetX,
      targetY,
      pathLabelX,
      pathLabelY,
      sizeConfig: data?.sizeConfig,
    });
    const label = data?.label?.trim();
    const isEdgeHighlighted = data?.isHighlighted === true;
    const diffColor =
      data?.diffStatus === "deleted"
        ? theme.palette.error.main
        : isWorkflowGraphDiffPresentation(
              data?.diffStatus,
              data?.presentationState ??
                DEFAULT_WORKFLOW_GRAPH_PRESENTATION_STATE,
            )
          ? theme.palette.success.main
          : undefined;
    const isAddedPresentation = isWorkflowGraphAddedPresentation({
      isCreated: data?.isCreated === true,
      diffStatus: data?.diffStatus,
      presentationState:
        data?.presentationState ?? DEFAULT_WORKFLOW_GRAPH_PRESENTATION_STATE,
    });
    const edgeStyle = isEdgeHighlighted
      ? {
          ...style,
          opacity: 1,
          stroke:
            diffColor ??
            (isAddedPresentation
              ? theme.palette.success.main
              : theme.palette.primary.main),
          strokeWidth: 3,
        }
      : diffColor
        ? { ...style, stroke: diffColor, opacity: 1 }
        : isAddedPresentation
          ? { ...style, stroke: theme.palette.success.main, opacity: 1 }
          : style;
    const edgeStrokeColor =
      typeof edgeStyle?.stroke === "string"
        ? edgeStyle.stroke
        : theme.palette.text.secondary;
    const isConditional = data?.edgeType === AgentEdgeType.Conditional;

    return (
      <g data-workflow-hover-edge-id={id}>
        <BaseEdge
          id={id}
          path={edgePath}
          markerEnd={isConditional ? undefined : markerEnd}
          style={edgeStyle}
        />
        {isConditional && (
          <WorkflowConditionalTargetMarker
            edgeId={id}
            isHighlighted={isEdgeHighlighted}
            strokeColor={edgeStrokeColor}
            targetPosition={targetPosition}
            targetX={targetX}
            targetY={targetY}
          />
        )}
        <path
          className="react-flow__edge-interaction"
          data-testid="workflow-inline-edge-hit-area"
          data-edge-id={id}
          data-edge-highlighted={String(isEdgeHighlighted)}
          data-edge-created={String(data?.isCreated === true)}
          data-edge-diff={data?.diffStatus ?? "unchanged"}
          d={edgePath}
          fill="none"
          stroke="transparent"
          strokeWidth={24}
          onMouseEnter={() => {
            data?.onHoverStart?.();
          }}
          onMouseLeave={() => {
            data?.onHoverEnd?.();
          }}
        />
        {label && (
          <EdgeLabelRenderer>
            <WorkflowEdgeLabel
              edgeId={id}
              label={label}
              labelX={labelX}
              labelY={labelY}
              sizeConfig={data?.sizeConfig}
              sizeMode={data?.sizeMode}
              isHighlighted={isEdgeHighlighted}
              isTooltipOpen={data?.isTooltipOpen === true}
              diffStatus={data?.diffStatus}
              presentationState={data?.presentationState}
              onMouseEnter={() => {
                data?.onHoverStart?.();
              }}
              onMouseLeave={() => {
                data?.onHoverEnd?.();
              }}
            />
          </EdgeLabelRenderer>
        )}
      </g>
    );
  },
);

WorkflowFlowEdge.displayName = "WorkflowFlowEdge";

const getReturnEdgePath = ({
  sourceX,
  sourceY,
  targetX,
  targetY,
  gutterY,
}: {
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  gutterY: number;
}): string =>
  `M ${sourceX},${sourceY} L ${sourceX},${gutterY} L ${targetX},${gutterY} L ${targetX},${targetY}`;

const getLocalReturnEdgePath = ({
  sourceX,
  sourceY,
  targetX,
  targetY,
  gutterX,
}: {
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  gutterX: number;
}): string =>
  `M ${sourceX},${sourceY} L ${gutterX},${sourceY} L ${gutterX},${targetY} L ${targetX},${targetY}`;

const getCrossBandEdgePath = ({
  sourceX,
  sourceY,
  targetX,
  targetY,
  gutterX,
  gutterY,
}: {
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  gutterX: number;
  gutterY: number;
}): string =>
  `M ${sourceX},${sourceY} L ${gutterX},${sourceY} L ${gutterX},${gutterY} L ${targetX},${gutterY} L ${targetX},${targetY}`;

export const getWorkflowEdgeLabelPosition = ({
  route,
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  pathLabelX,
  pathLabelY,
  sizeConfig,
}: {
  route: WorkflowFlowEdgeRoute | undefined;
  sourceX: number;
  sourceY: number;
  sourcePosition: Position;
  targetX: number;
  targetY: number;
  pathLabelX: number;
  pathLabelY: number;
  sizeConfig?: WorkflowGraphSizeConfig;
}): [number, number] => {
  if (route?.labelAnchor === "between-nodes") {
    return getForwardBranchEdgeLabelPosition({
      route,
      sourceX,
      sourceY,
      targetX,
      targetY,
      sizeConfig,
    });
  }

  if (route?.labelAnchor === "edge") {
    return getForwardEdgeLabelPosition({
      sourceX,
      sourceY,
      sourcePosition,
      sizeConfig,
    });
  }

  if (route?.labelAnchor === "gutter-lane" && route.kind === "return") {
    return [(sourceX + targetX) / 2, route.gutterY];
  }

  if (route?.labelAnchor === "side-lane" && route.kind === "local-return") {
    return [route.gutterX, (sourceY + targetY) / 2];
  }

  if (route?.labelAnchor === "outer-gutter" && route.kind === "cross-band") {
    return [(route.gutterX + targetX) / 2, route.gutterY];
  }

  return [pathLabelX, pathLabelY];
};

const getForwardBranchEdgeLabelPosition = ({
  route,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sizeConfig = WORKFLOW_GRAPH_SIZE_CONFIGS[DEFAULT_WORKFLOW_GRAPH_SIZE_MODE],
}: {
  route: Extract<WorkflowFlowEdgeRoute, { kind: "forward-branch" }>;
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  sizeConfig?: WorkflowGraphSizeConfig;
}): [number, number] => {
  const horizontalSpan = Math.abs(targetX - sourceX);
  const minimumBetweenNodeSpan =
    sizeConfig.nodeSize + sizeConfig.edgeLabelWidth;
  const centeredLane = route.lane - (route.siblingCount - 1) / 2;
  const laneOffset = centeredLane * Math.min(28, sizeConfig.nodeSize * 0.18);
  if (horizontalSpan < minimumBetweenNodeSpan) {
    const direction = targetX >= sourceX ? 1 : -1;
    return [
      targetX - direction * (sizeConfig.edgeLabelWidth / 2 + 12),
      targetY + laneOffset * 0.2,
    ];
  }

  const sourceToTargetProgress = 0.4;
  return [
    sourceX + (targetX - sourceX) * sourceToTargetProgress,
    sourceY + (targetY - sourceY) * sourceToTargetProgress + laneOffset,
  ];
};

const getForwardEdgeLabelPosition = ({
  sourceX,
  sourceY,
  sourcePosition,
  sizeConfig = WORKFLOW_GRAPH_SIZE_CONFIGS[DEFAULT_WORKFLOW_GRAPH_SIZE_MODE],
}: {
  sourceX: number;
  sourceY: number;
  sourcePosition: Position;
  sizeConfig?: WorkflowGraphSizeConfig;
}): [number, number] => {
  const horizontalOffset = sizeConfig.edgeLabelWidth / 2 + 8;

  switch (sourcePosition) {
    case Position.Left:
      return [sourceX - horizontalOffset, sourceY];
    case Position.Right:
      return [sourceX + horizontalOffset, sourceY];
    case Position.Top:
      return [sourceX, sourceY - horizontalOffset];
    case Position.Bottom:
      return [sourceX, sourceY + horizontalOffset];
  }
};

const getSourceHandle = (edge: AgentEdgeResponseDto): string => {
  if (edge.type === AgentEdgeType.Loop) {
    return "loop";
  }

  return edge.direction === AgentEdgeDirection.Backward ? "left" : "right";
};

const getTargetHandle = (edge: AgentEdgeResponseDto): string => {
  if (edge.type === AgentEdgeType.Loop) {
    return "loop";
  }

  return edge.direction === AgentEdgeDirection.Backward ? "right" : "left";
};

const createEmptyHandleState = (): WorkflowStepHandleState => ({
  hasLeftSourceHandle: false,
  hasLeftTargetHandle: false,
  hasRightSourceHandle: false,
  hasRightTargetHandle: false,
  forwardSourceHandleIds: [],
  hasLoopSourceHandle: false,
  hasLoopTargetHandle: false,
  hasCrossBandTargetHandle: false,
  returnSourceHandleIds: [],
  returnTargetHandleIds: [],
});

const isReturnEdge = (
  edge: AgentEdgeResponseDto,
  depthByStepId: Map<string, number>,
): boolean =>
  edge.type === AgentEdgeType.Loop ||
  (depthByStepId.get(edge.sourceNodeId) ?? 0) >
    (depthByStepId.get(edge.targetNodeId) ?? 0);

const markSourceHandle = (
  handleState: WorkflowStepHandleState,
  edge: AgentEdgeResponseDto,
): void => {
  if (edge.type === AgentEdgeType.Loop) {
    handleState.hasLoopSourceHandle = true;
    return;
  }

  if (edge.direction === AgentEdgeDirection.Backward) {
    handleState.hasLeftSourceHandle = true;
    return;
  }

  handleState.hasRightSourceHandle = true;
};

const markTargetHandle = (
  handleState: WorkflowStepHandleState,
  edge: AgentEdgeResponseDto,
): void => {
  if (edge.type === AgentEdgeType.Loop) {
    handleState.hasLoopTargetHandle = true;
    return;
  }

  if (edge.direction === AgentEdgeDirection.Backward) {
    handleState.hasRightTargetHandle = true;
    return;
  }

  handleState.hasLeftTargetHandle = true;
};

const getRequiredHandlesByStepId = (
  steps: WorkflowGraphSurfaceData["steps"],
  flowEdges: AgentEdgeResponseDto[],
): Map<string, WorkflowStepHandleState> => {
  const handlesByStepId = new Map(
    steps.map((step) => [step.id, createEmptyHandleState()]),
  );

  flowEdges.forEach((edge) => {
    const sourceHandles = handlesByStepId.get(edge.sourceNodeId);
    const targetHandles = handlesByStepId.get(edge.targetNodeId);
    if (!sourceHandles || !targetHandles) {
      return;
    }

    markSourceHandle(sourceHandles, edge);
    markTargetHandle(targetHandles, edge);
  });

  return handlesByStepId;
};

interface WorkflowForwardSourceHandleAssignment {
  handleIdByEdgeId: Map<string, string>;
  siblingCountByEdgeId: Map<string, number>;
  handleIdsByStepId: Map<string, string[]>;
}

interface WorkflowReturnHandleAssignment {
  laneByEdgeId: Map<string, number>;
  sourceHandleIdByEdgeId: Map<string, string>;
  targetHandleIdByEdgeId: Map<string, string>;
  laneCount: number;
}

interface WorkflowCrossBandRouteAssignment {
  gutterXByEdgeId: Map<string, number>;
  gutterYByEdgeId: Map<string, number>;
  laneByEdgeId: Map<string, number>;
  targetStepIds: Set<string>;
}

type WorkflowLocalReturnRoute = Extract<
  WorkflowFlowEdgeRoute,
  { kind: "local-return" }
>;

interface WorkflowLocalReturnRouteAssignment {
  routeByEdgeId: Map<string, WorkflowLocalReturnRoute>;
}

interface WorkflowGraphPosition {
  x: number;
  y: number;
}

interface WorkflowGraphRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

interface WorkflowGraphSegment {
  start: WorkflowGraphPosition;
  end: WorkflowGraphPosition;
}

interface WorkflowLocalReturnCandidate {
  route: WorkflowLocalReturnRoute;
  segments: WorkflowGraphSegment[];
  labelRect?: WorkflowGraphRect;
  length: number;
}

const getCrossBandGutterWidth = (sizeConfig: WorkflowGraphSizeConfig): number =>
  Math.max(
    sizeConfig.nodeSize * WORKFLOW_GRAPH_RETURN_EDGE_GUTTER_RATIO,
    sizeConfig.edgeLabelWidth + WORKFLOW_GRAPH_CROSS_BAND_LANE_GAP * 6,
  );

const getReturnEdges = (
  flowEdges: AgentEdgeResponseDto[],
  depthByStepId: Map<string, number>,
  stepById: Map<string, WorkflowGraphSurfaceData["steps"][number]>,
): AgentEdgeResponseDto[] =>
  flowEdges
    .filter(
      (edge) =>
        edge.type !== AgentEdgeType.Loop && isReturnEdge(edge, depthByStepId),
    )
    .sort(compareLayoutEdges(stepById));

const getExpandedNodeRect = (
  position: WorkflowGraphPosition,
  nodeSize: number,
  clearance: number,
): WorkflowGraphRect => ({
  left: position.x - clearance,
  right: position.x + nodeSize + clearance,
  top: position.y - clearance,
  bottom: position.y + nodeSize + clearance,
});

const segmentIntersectsRect = (
  segment: WorkflowGraphSegment,
  rect: WorkflowGraphRect,
): boolean => {
  if (segment.start.x === segment.end.x) {
    const minY = Math.min(segment.start.y, segment.end.y);
    const maxY = Math.max(segment.start.y, segment.end.y);
    return (
      segment.start.x >= rect.left &&
      segment.start.x <= rect.right &&
      maxY >= rect.top &&
      minY <= rect.bottom
    );
  }

  const minX = Math.min(segment.start.x, segment.end.x);
  const maxX = Math.max(segment.start.x, segment.end.x);
  return (
    segment.start.y >= rect.top &&
    segment.start.y <= rect.bottom &&
    maxX >= rect.left &&
    minX <= rect.right
  );
};

const rectsIntersect = (
  left: WorkflowGraphRect,
  right: WorkflowGraphRect,
): boolean =>
  left.left <= right.right &&
  left.right >= right.left &&
  left.top <= right.bottom &&
  left.bottom >= right.top;

const candidateIntersectsNode = (
  candidate: WorkflowLocalReturnCandidate,
  rect: WorkflowGraphRect,
): boolean =>
  candidate.segments.some((segment) => segmentIntersectsRect(segment, rect)) ||
  (candidate.labelRect !== undefined &&
    rectsIntersect(candidate.labelRect, rect));

const getLocalReturnCandidate = ({
  edge,
  lane,
  side,
  sizeConfig,
  sourcePosition,
  targetPosition,
}: {
  edge: AgentEdgeResponseDto;
  lane: number;
  side: WorkflowLocalReturnRoute["side"];
  sizeConfig: WorkflowGraphSizeConfig;
  sourcePosition: WorkflowGraphPosition;
  targetPosition: WorkflowGraphPosition;
}): WorkflowLocalReturnCandidate | null => {
  const sourceY = sourcePosition.y + sizeConfig.nodeSize / 2;
  const targetY = targetPosition.y + sizeConfig.nodeSize / 2;
  const verticalDistance = Math.abs(sourceY - targetY);
  if (
    verticalDistance <
    sizeConfig.nodeSize + WORKFLOW_GRAPH_LOCAL_RETURN_CLEARANCE
  ) {
    return null;
  }

  const label = getEdgeLabel(edge);
  const labelHalfWidth = label ? sizeConfig.edgeLabelWidth / 2 : 0;
  const laneOffset = lane * WORKFLOW_GRAPH_CROSS_BAND_LANE_GAP;
  const gutterOffset =
    WORKFLOW_GRAPH_LOCAL_RETURN_CLEARANCE + labelHalfWidth + laneOffset;
  const sourceX =
    side === "left" ? sourcePosition.x : sourcePosition.x + sizeConfig.nodeSize;
  const targetX =
    side === "left" ? targetPosition.x : targetPosition.x + sizeConfig.nodeSize;
  const gutterX =
    side === "left"
      ? Math.min(sourceX, targetX) - gutterOffset
      : Math.max(sourceX, targetX) + gutterOffset;
  if (side === "left" && gutterX - labelHalfWidth < 0) {
    return null;
  }

  const labelY = (sourceY + targetY) / 2;
  const route: WorkflowLocalReturnRoute = {
    kind: "local-return",
    side,
    lane,
    gutterX,
    labelAnchor: "side-lane",
  };
  return {
    route,
    segments: [
      { start: { x: sourceX, y: sourceY }, end: { x: gutterX, y: sourceY } },
      { start: { x: gutterX, y: sourceY }, end: { x: gutterX, y: targetY } },
      { start: { x: gutterX, y: targetY }, end: { x: targetX, y: targetY } },
    ],
    labelRect: label
      ? {
          left: gutterX - labelHalfWidth,
          right: gutterX + labelHalfWidth,
          top: labelY + sizeConfig.edgeLabelYOffset,
          bottom:
            labelY +
            sizeConfig.edgeLabelYOffset +
            WORKFLOW_GRAPH_LOCAL_RETURN_LABEL_HEIGHT,
        }
      : undefined,
    length:
      Math.abs(sourceX - gutterX) +
      verticalDistance +
      Math.abs(targetX - gutterX),
  };
};

const getLocalReturnObstacleRects = (
  positionByStepId: Map<string, WorkflowGraphPosition>,
  edge: AgentEdgeResponseDto,
  sizeConfig: WorkflowGraphSizeConfig,
): WorkflowGraphRect[] =>
  Array.from(positionByStepId.entries())
    .filter(
      ([stepId]) =>
        stepId !== edge.sourceNodeId && stepId !== edge.targetNodeId,
    )
    .map(([, position]) =>
      getExpandedNodeRect(
        position,
        sizeConfig.nodeSize,
        Math.max(6, sizeConfig.padding / 4),
      ),
    );

const getClearLocalReturnCandidates = ({
  edge,
  nextLaneBySide,
  obstacleRects,
  sizeConfig,
  sourcePosition,
  targetPosition,
}: {
  edge: AgentEdgeResponseDto;
  nextLaneBySide: Record<WorkflowLocalReturnRoute["side"], number>;
  obstacleRects: WorkflowGraphRect[];
  sizeConfig: WorkflowGraphSizeConfig;
  sourcePosition: WorkflowGraphPosition;
  targetPosition: WorkflowGraphPosition;
}): WorkflowLocalReturnCandidate[] =>
  (["left", "right"] as const)
    .map((side) =>
      getLocalReturnCandidate({
        edge,
        lane: nextLaneBySide[side],
        side,
        sizeConfig,
        sourcePosition,
        targetPosition,
      }),
    )
    .filter(
      (candidate): candidate is WorkflowLocalReturnCandidate =>
        candidate !== null &&
        obstacleRects.every(
          (rect) => !candidateIntersectsNode(candidate, rect),
        ),
    )
    .sort(
      (left, right) =>
        left.length - right.length ||
        left.route.side.localeCompare(right.route.side),
    );

const getLocalReturnRouteAssignments = ({
  positionByStepId,
  returnEdges,
  sizeConfig,
}: {
  positionByStepId: Map<string, WorkflowGraphPosition>;
  returnEdges: AgentEdgeResponseDto[];
  sizeConfig: WorkflowGraphSizeConfig;
}): WorkflowLocalReturnRouteAssignment => {
  const routeByEdgeId = new Map<string, WorkflowLocalReturnRoute>();
  const nextLaneBySide: Record<WorkflowLocalReturnRoute["side"], number> = {
    left: 0,
    right: 0,
  };

  returnEdges.forEach((edge) => {
    const sourcePosition = positionByStepId.get(edge.sourceNodeId);
    const targetPosition = positionByStepId.get(edge.targetNodeId);
    if (!sourcePosition || !targetPosition) {
      return;
    }

    const obstacleRects = getLocalReturnObstacleRects(
      positionByStepId,
      edge,
      sizeConfig,
    );
    const candidates = getClearLocalReturnCandidates({
      edge,
      nextLaneBySide,
      obstacleRects,
      sizeConfig,
      sourcePosition,
      targetPosition,
    });
    const selectedCandidate = candidates[0];
    if (!selectedCandidate) {
      return;
    }

    routeByEdgeId.set(edge.id, selectedCandidate.route);
    nextLaneBySide[selectedCandidate.route.side] += 1;
  });

  return { routeByEdgeId };
};

const getReturnHandleAssignments = (
  flowEdges: AgentEdgeResponseDto[],
  depthByStepId: Map<string, number>,
  stepById: Map<string, WorkflowGraphSurfaceData["steps"][number]>,
  localReturnRouteAssignments: WorkflowLocalReturnRouteAssignment,
): WorkflowReturnHandleAssignment => {
  const returnEdges = getReturnEdges(flowEdges, depthByStepId, stepById).filter(
    (edge) => !localReturnRouteAssignments.routeByEdgeId.has(edge.id),
  );
  const laneByEdgeId = new Map<string, number>();
  const sourceHandleIdByEdgeId = new Map<string, string>();
  const targetHandleIdByEdgeId = new Map<string, string>();

  returnEdges.forEach((edge, lane) => {
    laneByEdgeId.set(edge.id, lane);
    sourceHandleIdByEdgeId.set(edge.id, `return-source-${lane}`);
    targetHandleIdByEdgeId.set(edge.id, `return-target-${lane}`);
  });

  return {
    laneByEdgeId,
    sourceHandleIdByEdgeId,
    targetHandleIdByEdgeId,
    laneCount: returnEdges.length,
  };
};

const applyReturnHandleAssignments = (
  handlesByStepId: Map<string, WorkflowStepHandleState>,
  flowEdges: AgentEdgeResponseDto[],
  assignments: WorkflowReturnHandleAssignment,
): void => {
  flowEdges
    .filter((edge) => assignments.laneByEdgeId.has(edge.id))
    .sort(
      (left, right) =>
        (assignments.laneByEdgeId.get(left.id) ?? 0) -
        (assignments.laneByEdgeId.get(right.id) ?? 0),
    )
    .forEach((edge) => {
      const sourceHandleId = assignments.sourceHandleIdByEdgeId.get(edge.id);
      const targetHandleId = assignments.targetHandleIdByEdgeId.get(edge.id);
      if (!sourceHandleId || !targetHandleId) {
        return;
      }
      const sourceHandles = handlesByStepId.get(edge.sourceNodeId);
      const targetHandles = handlesByStepId.get(edge.targetNodeId);
      if (sourceHandles)
        sourceHandles.returnSourceHandleIds.push(sourceHandleId);
      if (targetHandles)
        targetHandles.returnTargetHandleIds.push(targetHandleId);
    });
};

const applyLocalReturnHandleAssignments = (
  handlesByStepId: Map<string, WorkflowStepHandleState>,
  returnEdges: AgentEdgeResponseDto[],
  assignments: WorkflowLocalReturnRouteAssignment,
): void => {
  returnEdges.forEach((edge) => {
    const route = assignments.routeByEdgeId.get(edge.id);
    if (!route) {
      return;
    }

    const sourceHandles = handlesByStepId.get(edge.sourceNodeId);
    const targetHandles = handlesByStepId.get(edge.targetNodeId);
    if (route.side === "left") {
      if (sourceHandles) {
        sourceHandles.hasLeftSourceHandle = true;
      }
      if (targetHandles) {
        targetHandles.hasLeftTargetHandle = true;
      }
      return;
    }

    if (sourceHandles) {
      sourceHandles.hasRightSourceHandle = true;
    }
    if (targetHandles) {
      targetHandles.hasRightTargetHandle = true;
    }
  });
};

const isForwardNonReturnEdge = (
  edge: AgentEdgeResponseDto,
  depthByStepId: Map<string, number>,
): edge is WorkflowLayoutEdge =>
  (edge.type === AgentEdgeType.Standard ||
    edge.type === AgentEdgeType.Conditional) &&
  edge.direction === AgentEdgeDirection.Forward &&
  !isReturnEdge(edge, depthByStepId);

const getForwardSourceHandleAssignments = (
  flowEdges: AgentEdgeResponseDto[],
  depthByStepId: Map<string, number>,
  stepById: Map<string, WorkflowGraphSurfaceData["steps"][number]>,
): WorkflowForwardSourceHandleAssignment => {
  const handleIdByEdgeId = new Map<string, string>();
  const siblingCountByEdgeId = new Map<string, number>();
  const handleIdsByStepId = new Map<string, string[]>();
  const forwardEdgesBySourceId = new Map<string, WorkflowLayoutEdge[]>();

  flowEdges.forEach((edge) => {
    if (!isForwardNonReturnEdge(edge, depthByStepId)) {
      return;
    }

    forwardEdgesBySourceId.set(edge.sourceNodeId, [
      ...(forwardEdgesBySourceId.get(edge.sourceNodeId) ?? []),
      edge,
    ]);
  });

  forwardEdgesBySourceId.forEach((edges, sourceNodeId) => {
    edges.forEach((edge) => {
      siblingCountByEdgeId.set(edge.id, edges.length);
    });

    if (edges.length < 2) {
      return;
    }

    const handleIds = [...edges]
      .sort(compareLayoutEdges(stepById))
      .map((edge, index) => {
        const handleId = `forward-${index}`;
        handleIdByEdgeId.set(edge.id, handleId);
        return handleId;
      });
    handleIdsByStepId.set(sourceNodeId, handleIds);
  });

  return { handleIdByEdgeId, siblingCountByEdgeId, handleIdsByStepId };
};

const getCrossBandRouteAssignments = ({
  bandByStepId,
  layoutEdges,
  routingYBeforeBand,
  returnEdgeIds,
  sizeConfig,
  stepById,
  positionByStepId,
}: {
  bandByStepId: Map<string, number> | undefined;
  layoutEdges: WorkflowLayoutEdge[];
  routingYBeforeBand: Map<number, number> | undefined;
  returnEdgeIds: Set<string>;
  sizeConfig: WorkflowGraphSizeConfig;
  stepById: Map<string, WorkflowGraphSurfaceData["steps"][number]>;
  positionByStepId: Map<string, WorkflowGraphPosition>;
}): WorkflowCrossBandRouteAssignment => {
  const gutterXByEdgeId = new Map<string, number>();
  const gutterYByEdgeId = new Map<string, number>();
  const laneByEdgeId = new Map<string, number>();
  const targetStepIds = new Set<string>();
  if (!bandByStepId || !routingYBeforeBand) {
    return { gutterXByEdgeId, gutterYByEdgeId, laneByEdgeId, targetStepIds };
  }

  const edgesByBandTransition = new Map<string, WorkflowLayoutEdge[]>();
  layoutEdges.forEach((edge) => {
    const sourceBand = bandByStepId.get(edge.sourceNodeId);
    const targetBand = bandByStepId.get(edge.targetNodeId);
    const sourcePosition = positionByStepId.get(edge.sourceNodeId);
    const targetPosition = positionByStepId.get(edge.targetNodeId);
    if (
      !sourcePosition ||
      !targetPosition ||
      targetPosition.y < sourcePosition.y + sizeConfig.nodeSize ||
      targetPosition.x >= sourcePosition.x + sizeConfig.nodeSize ||
      sourceBand === undefined ||
      targetBand === undefined ||
      sourceBand === targetBand ||
      returnEdgeIds.has(edge.id)
    ) {
      return;
    }
    const transitionKey = String(targetBand);
    edgesByBandTransition.set(transitionKey, [
      ...(edgesByBandTransition.get(transitionKey) ?? []),
      edge,
    ]);
  });

  edgesByBandTransition.forEach((transitionEdges) => {
    const spannedBands = new Set(
      transitionEdges.flatMap((edge) => [
        bandByStepId.get(edge.sourceNodeId),
        bandByStepId.get(edge.targetNodeId),
      ]),
    );
    const contentRight = Math.max(
      ...Array.from(positionByStepId.entries()).flatMap(([stepId, position]) =>
        spannedBands.has(bandByStepId.get(stepId))
          ? [position.x + sizeConfig.nodeSize]
          : [],
      ),
    );
    const gutterCenterX =
      contentRight + getCrossBandGutterWidth(sizeConfig) / 2;
    transitionEdges.sort(compareLayoutEdges(stepById)).forEach((edge, lane) => {
      const centeredLane = lane - (transitionEdges.length - 1) / 2;
      laneByEdgeId.set(edge.id, lane);
      targetStepIds.add(edge.targetNodeId);
      gutterXByEdgeId.set(
        edge.id,
        gutterCenterX + centeredLane * WORKFLOW_GRAPH_CROSS_BAND_LANE_GAP,
      );
      const targetBand = bandByStepId.get(edge.targetNodeId);
      const gutterY =
        targetBand === undefined
          ? undefined
          : routingYBeforeBand.get(targetBand);
      if (gutterY !== undefined) {
        gutterYByEdgeId.set(
          edge.id,
          gutterY + centeredLane * WORKFLOW_GRAPH_CROSS_BAND_LANE_GAP,
        );
      }
    });
  });

  return { gutterXByEdgeId, gutterYByEdgeId, laneByEdgeId, targetStepIds };
};

const applyCrossBandTargetHandles = (
  handlesByStepId: Map<string, WorkflowStepHandleState>,
  assignments: WorkflowCrossBandRouteAssignment,
): void => {
  assignments.targetStepIds.forEach((stepId) => {
    const handleState = handlesByStepId.get(stepId);
    if (handleState) {
      handleState.hasCrossBandTargetHandle = true;
    }
  });
};

const applyForwardSourceHandleAssignments = (
  handlesByStepId: Map<string, WorkflowStepHandleState>,
  assignments: WorkflowForwardSourceHandleAssignment,
): void => {
  assignments.handleIdsByStepId.forEach((handleIds, stepId) => {
    const handleState = handlesByStepId.get(stepId);
    if (handleState) {
      handleState.forwardSourceHandleIds = handleIds;
    }
  });
};

const getWorkflowEdgeRoute = ({
  crossBandRouteAssignments,
  edge,
  forwardSourceHandleAssignments,
  localReturnRouteAssignments,
  returnHandleAssignments,
  returnGutterStartY,
  returnLaneSpacing,
}: {
  crossBandRouteAssignments: WorkflowCrossBandRouteAssignment;
  edge: AgentEdgeResponseDto;
  forwardSourceHandleAssignments: WorkflowForwardSourceHandleAssignment;
  localReturnRouteAssignments: WorkflowLocalReturnRouteAssignment;
  returnHandleAssignments: WorkflowReturnHandleAssignment;
  returnGutterStartY: number;
  returnLaneSpacing: number;
}): WorkflowFlowEdgeRoute => {
  if (edge.type === AgentEdgeType.Loop) {
    return { kind: "loop", lane: null, labelAnchor: "edge" };
  }

  const localReturnRoute = localReturnRouteAssignments.routeByEdgeId.get(
    edge.id,
  );
  if (localReturnRoute) {
    return localReturnRoute;
  }

  const returnLane = returnHandleAssignments.laneByEdgeId.get(edge.id);
  if (returnLane !== undefined) {
    return {
      kind: "return",
      lane: returnLane,
      gutterY: returnGutterStartY + (returnLane + 0.5) * returnLaneSpacing,
      labelAnchor: "gutter-lane",
    };
  }

  const crossBandLane = crossBandRouteAssignments.laneByEdgeId.get(edge.id);
  const crossBandGutterX = crossBandRouteAssignments.gutterXByEdgeId.get(
    edge.id,
  );
  const crossBandGutterY = crossBandRouteAssignments.gutterYByEdgeId.get(
    edge.id,
  );
  if (
    crossBandLane !== undefined &&
    crossBandGutterX !== undefined &&
    crossBandGutterY !== undefined
  ) {
    return {
      kind: "cross-band",
      lane: crossBandLane,
      gutterX: crossBandGutterX,
      gutterY: crossBandGutterY,
      labelAnchor: "outer-gutter",
    };
  }

  const forwardHandleId = forwardSourceHandleAssignments.handleIdByEdgeId.get(
    edge.id,
  );
  if (edge.type === AgentEdgeType.Conditional || forwardHandleId) {
    const lane = forwardHandleId
      ? Number.parseInt(forwardHandleId.replace("forward-", ""), 10)
      : 0;
    return {
      kind: "forward-branch",
      lane,
      siblingCount:
        forwardSourceHandleAssignments.siblingCountByEdgeId.get(edge.id) ?? 1,
      labelAnchor: "between-nodes",
    };
  }

  return { kind: "mainline", lane: null, labelAnchor: "edge" };
};

const shouldUseEdgeForLayout = (
  edge: AgentEdgeResponseDto,
  stepIds: Set<string>,
): edge is WorkflowLayoutEdge =>
  (edge.type === AgentEdgeType.Standard ||
    edge.type === AgentEdgeType.Conditional) &&
  edge.direction === AgentEdgeDirection.Forward &&
  stepIds.has(edge.sourceNodeId) &&
  stepIds.has(edge.targetNodeId);

const normalizeLayoutText = (value: string | null | undefined): string =>
  value?.trim().replace(/\s+/g, " ").toLocaleLowerCase() ?? "";

const getSortedValues = (values: Iterable<string>): string[] =>
  Array.from(values).sort((left, right) => left.localeCompare(right));

const compareStrings = (left: string, right: string): number =>
  left.localeCompare(right);

const compareNumbers = (left: number, right: number): number => left - right;

const compareLayoutValues = (
  comparisons: Array<number | (() => number)>,
): number => {
  for (const comparison of comparisons) {
    const result = typeof comparison === "function" ? comparison() : comparison;
    if (result !== 0) {
      return result;
    }
  }

  return 0;
};

const getWorkflowStepName = (
  stepById: Map<string, WorkflowGraphSurfaceData["steps"][number]>,
  stepId: string,
): string => normalizeLayoutText(stepById.get(stepId)?.name);

const getLayoutEdgePredicate = (edge: AgentEdgeResponseDto): string =>
  normalizeLayoutText(edge.predicate);

const compareLayoutEdges =
  (stepById: Map<string, WorkflowGraphSurfaceData["steps"][number]>) =>
  (left: AgentEdgeResponseDto, right: AgentEdgeResponseDto): number =>
    compareLayoutValues([
      () =>
        compareStrings(
          getWorkflowStepName(stepById, left.sourceNodeId),
          getWorkflowStepName(stepById, right.sourceNodeId),
        ),
      () =>
        compareStrings(
          getLayoutEdgePredicate(left),
          getLayoutEdgePredicate(right),
        ),
      () =>
        compareStrings(
          getWorkflowStepName(stepById, left.targetNodeId),
          getWorkflowStepName(stepById, right.targetNodeId),
        ),
      () => compareStrings(left.type, right.type),
      () => compareStrings(left.sourceNodeId, right.sourceNodeId),
      () => compareStrings(left.targetNodeId, right.targetNodeId),
      () => compareStrings(left.id, right.id),
    ]);

const getLayoutEdges = (
  flowEdges: AgentEdgeResponseDto[],
  stepIds: Set<string>,
  stepById: Map<string, WorkflowGraphSurfaceData["steps"][number]>,
): WorkflowLayoutEdge[] =>
  flowEdges
    .filter((edge): edge is WorkflowLayoutEdge =>
      shouldUseEdgeForLayout(edge, stepIds),
    )
    .sort(compareLayoutEdges(stepById));

const buildIncomingPredicateSignatures = (
  layoutEdges: WorkflowLayoutEdge[],
): Map<string, string> => {
  const predicatesByStepId = new Map<string, Set<string>>();
  layoutEdges.forEach((edge) => {
    const predicate = getLayoutEdgePredicate(edge);
    if (!predicate) {
      return;
    }

    const predicates = predicatesByStepId.get(edge.targetNodeId) ?? new Set();
    predicates.add(predicate);
    predicatesByStepId.set(edge.targetNodeId, predicates);
  });

  return new Map(
    Array.from(predicatesByStepId.entries()).map(([stepId, predicates]) => [
      stepId,
      getSortedValues(predicates).join("|"),
    ]),
  );
};

const buildOutgoingEdgeSignatures = (
  layoutEdges: WorkflowLayoutEdge[],
  stepById: Map<string, WorkflowGraphSurfaceData["steps"][number]>,
): Map<string, string> => {
  const signaturesByStepId = new Map<string, Set<string>>();
  layoutEdges.forEach((edge) => {
    const signature = [
      edge.type,
      getLayoutEdgePredicate(edge),
      getWorkflowStepName(stepById, edge.targetNodeId),
    ].join(":");
    const signatures = signaturesByStepId.get(edge.sourceNodeId) ?? new Set();
    signatures.add(signature);
    signaturesByStepId.set(edge.sourceNodeId, signatures);
  });

  return new Map(
    Array.from(signaturesByStepId.entries()).map(([stepId, signatures]) => [
      stepId,
      getSortedValues(signatures).join("|"),
    ]),
  );
};

const compareStepIdsBySemanticSignature =
  ({
    incomingPredicateSignatureByStepId,
    outgoingEdgeSignatureByStepId,
    stepById,
  }: {
    incomingPredicateSignatureByStepId: Map<string, string>;
    outgoingEdgeSignatureByStepId: Map<string, string>;
    stepById: Map<string, WorkflowGraphSurfaceData["steps"][number]>;
  }) =>
  (leftStepId: string, rightStepId: string): number =>
    compareLayoutValues([
      () =>
        compareStrings(
          incomingPredicateSignatureByStepId.get(leftStepId) ?? "",
          incomingPredicateSignatureByStepId.get(rightStepId) ?? "",
        ),
      () =>
        compareStrings(
          getWorkflowStepName(stepById, leftStepId),
          getWorkflowStepName(stepById, rightStepId),
        ),
      () =>
        compareStrings(
          outgoingEdgeSignatureByStepId.get(leftStepId) ?? "",
          outgoingEdgeSignatureByStepId.get(rightStepId) ?? "",
        ),
      () => compareStrings(leftStepId, rightStepId),
    ]);

const getStepIdSemanticComparator = (
  stepById: Map<string, WorkflowGraphSurfaceData["steps"][number]>,
  layoutEdges: WorkflowLayoutEdge[],
) =>
  compareStepIdsBySemanticSignature({
    incomingPredicateSignatureByStepId:
      buildIncomingPredicateSignatures(layoutEdges),
    outgoingEdgeSignatureByStepId: buildOutgoingEdgeSignatures(
      layoutEdges,
      stepById,
    ),
    stepById,
  });

interface WorkflowLayoutComponent {
  stepIds: string[];
  depth: number;
  width: number;
}

interface WorkflowCycleAwareLayout {
  components: WorkflowLayoutComponent[];
  depthByStepId: Map<string, number>;
  layoutEdgesForLanes: WorkflowLayoutEdge[];
}

const getStronglyConnectedComponents = (
  orderedStepIds: string[],
  layoutEdges: WorkflowLayoutEdge[],
  compareStepIds: (leftStepId: string, rightStepId: string) => number,
): string[][] => {
  const outgoing = buildNeighborStepIds(
    layoutEdges,
    "sourceNodeId",
    "targetNodeId",
  );
  const indexByStepId = new Map<string, number>();
  const lowLinkByStepId = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const components: string[][] = [];
  let nextIndex = 0;

  const visit = (stepId: string): void => {
    const index = nextIndex;
    nextIndex += 1;
    indexByStepId.set(stepId, index);
    lowLinkByStepId.set(stepId, index);
    stack.push(stepId);
    onStack.add(stepId);

    [...(outgoing.get(stepId) ?? [])]
      .sort(compareStepIds)
      .forEach((targetId) => {
        if (!indexByStepId.has(targetId)) {
          visit(targetId);
          lowLinkByStepId.set(
            stepId,
            Math.min(
              lowLinkByStepId.get(stepId) ?? index,
              lowLinkByStepId.get(targetId) ?? index,
            ),
          );
        } else if (onStack.has(targetId)) {
          lowLinkByStepId.set(
            stepId,
            Math.min(
              lowLinkByStepId.get(stepId) ?? index,
              indexByStepId.get(targetId) ?? index,
            ),
          );
        }
      });

    if (lowLinkByStepId.get(stepId) !== indexByStepId.get(stepId)) {
      return;
    }

    const component: string[] = [];
    let member: string | undefined;
    do {
      member = stack.pop();
      if (member) {
        onStack.delete(member);
        component.push(member);
      }
    } while (member !== stepId);
    components.push(component.sort(compareStepIds));
  };

  orderedStepIds.forEach((stepId) => {
    if (!indexByStepId.has(stepId)) {
      visit(stepId);
    }
  });

  return components;
};

const getCycleAwareStepDepths = (
  orderedStepIds: string[],
  layoutEdges: WorkflowLayoutEdge[],
  compareStepIds: (leftStepId: string, rightStepId: string) => number,
): WorkflowCycleAwareLayout => {
  const components: WorkflowLayoutComponent[] = getStronglyConnectedComponents(
    orderedStepIds,
    layoutEdges,
    compareStepIds,
  ).map((stepIds) => ({
    stepIds,
    depth: 0,
    width: Math.ceil(stepIds.length / 2),
  }));
  const componentIndexByStepId = new Map(
    components.flatMap((component, componentIndex) =>
      component.stepIds.map((stepId) => [stepId, componentIndex] as const),
    ),
  );
  const componentEdges = new Set<string>();
  layoutEdges.forEach((edge) => {
    const sourceComponent = componentIndexByStepId.get(edge.sourceNodeId);
    const targetComponent = componentIndexByStepId.get(edge.targetNodeId);
    if (
      sourceComponent !== undefined &&
      targetComponent !== undefined &&
      sourceComponent !== targetComponent
    ) {
      componentEdges.add(`${sourceComponent}:${targetComponent}`);
    }
  });
  const componentStepIds = components.map((_, index) => String(index));
  const normalizedEdges = Array.from(componentEdges).map((key) => {
    const [sourceNodeId, targetNodeId] = key.split(":");
    return { sourceNodeId, targetNodeId };
  });
  const incomingCount = new Map(componentStepIds.map((id) => [id, 0]));
  const outgoing = new Map<string, string[]>();
  normalizedEdges.forEach(({ sourceNodeId, targetNodeId }) => {
    outgoing.set(sourceNodeId, [
      ...(outgoing.get(sourceNodeId) ?? []),
      targetNodeId,
    ]);
    incomingCount.set(targetNodeId, (incomingCount.get(targetNodeId) ?? 0) + 1);
  });
  const componentDepth = new Map(componentStepIds.map((id) => [id, 0]));
  const queue = componentStepIds.filter((id) => incomingCount.get(id) === 0);
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const sourceId = queue[cursor];
    const sourceIndex = Number(sourceId);
    const nextDepth =
      (componentDepth.get(sourceId) ?? 0) + components[sourceIndex].width;
    [...(outgoing.get(sourceId) ?? [])]
      .sort(compareStrings)
      .forEach((targetId) => {
        componentDepth.set(
          targetId,
          Math.max(componentDepth.get(targetId) ?? 0, nextDepth),
        );
        const nextIncomingCount = (incomingCount.get(targetId) ?? 0) - 1;
        incomingCount.set(targetId, nextIncomingCount);
        if (nextIncomingCount === 0) queue.push(targetId);
      });
  }

  const depthByStepId = new Map<string, number>();
  components.forEach((component, componentIndex) => {
    const baseDepth = componentDepth.get(String(componentIndex)) ?? 0;
    component.depth = baseDepth;
    component.stepIds.forEach((stepId, memberIndex) => {
      depthByStepId.set(stepId, baseDepth + Math.floor(memberIndex / 2));
    });
  });

  const layoutEdgesForLanes = layoutEdges.filter(
    (edge) =>
      componentIndexByStepId.get(edge.sourceNodeId) !==
      componentIndexByStepId.get(edge.targetNodeId),
  );
  return { components, depthByStepId, layoutEdgesForLanes };
};

interface WorkflowLayoutGroup {
  stepIds: string[];
  minDepth: number;
  maxDepth: number;
}

interface WorkflowWrappedLayout {
  bandByStepId: Map<string, number>;
  positionByStepId: Map<string, { x: number; y: number }>;
  routingYBeforeBand: Map<number, number>;
}

const getAtomicLayoutGroups = (
  components: WorkflowLayoutComponent[],
  compareStepIds: (leftStepId: string, rightStepId: string) => number,
): WorkflowLayoutGroup[] => {
  const orderedComponents = [...components].sort((left, right) =>
    compareLayoutValues([
      left.depth - right.depth,
      left.depth + left.width - (right.depth + right.width),
      () => compareStepIds(left.stepIds[0], right.stepIds[0]),
    ]),
  );
  const groups: WorkflowLayoutGroup[] = [];

  orderedComponents.forEach((component) => {
    const componentMaxDepth = component.depth + component.width - 1;
    const currentGroup = groups.at(-1);
    if (currentGroup && component.depth <= currentGroup.maxDepth) {
      currentGroup.stepIds.push(...component.stepIds);
      currentGroup.maxDepth = Math.max(
        currentGroup.maxDepth,
        componentMaxDepth,
      );
      return;
    }

    groups.push({
      stepIds: [...component.stepIds],
      minDepth: component.depth,
      maxDepth: componentMaxDepth,
    });
  });

  return groups.map((group) => ({
    ...group,
    stepIds: group.stepIds.sort(compareStepIds),
  }));
};

const getLayoutGroupWidth = (
  group: WorkflowLayoutGroup,
  sizeConfig: WorkflowGraphSizeConfig,
): number =>
  sizeConfig.nodeSize + (group.maxDepth - group.minDepth) * sizeConfig.xGap;

const packLayoutGroupsIntoBands = (
  groups: WorkflowLayoutGroup[],
  availableBandWidth: number,
  sizeConfig: WorkflowGraphSizeConfig,
): WorkflowLayoutGroup[][] | null => {
  const interGroupGap = sizeConfig.xGap - sizeConfig.nodeSize;
  const bands: WorkflowLayoutGroup[][] = [];
  let currentBand: WorkflowLayoutGroup[] = [];
  let currentBandWidth = 0;

  groups.forEach((group) => {
    const groupWidth = getLayoutGroupWidth(group, sizeConfig);
    const nextBandWidth =
      currentBandWidth +
      (currentBand.length > 0 ? interGroupGap : 0) +
      groupWidth;
    if (currentBand.length > 0 && nextBandWidth > availableBandWidth) {
      bands.push(currentBand);
      currentBand = [group];
      currentBandWidth = groupWidth;
      return;
    }

    currentBand.push(group);
    currentBandWidth = nextBandWidth;
  });
  if (currentBand.length > 0) {
    bands.push(currentBand);
  }

  const firstBandGroupCount = bands[0]?.length ?? 0;
  return firstBandGroupCount >= WORKFLOW_GRAPH_MIN_GROUPS_PER_BAND &&
    bands.length <= WORKFLOW_GRAPH_MAX_BANDS
    ? bands
    : null;
};

const getWrappedLayout = ({
  components,
  depthByStepId,
  groups,
  laneByStepId,
  sizeConfig,
  viewportWidth,
}: {
  components: WorkflowLayoutComponent[];
  depthByStepId: Map<string, number>;
  groups: WorkflowLayoutGroup[];
  laneByStepId: Map<string, number>;
  sizeConfig: WorkflowGraphSizeConfig;
  viewportWidth: number | undefined;
}): WorkflowWrappedLayout | null => {
  if (!viewportWidth || groups.length < WORKFLOW_GRAPH_MIN_GROUPS_PER_BAND) {
    return null;
  }

  const canonicalMaxDepth = components.reduce(
    (maxDepth, component) =>
      Math.max(maxDepth, component.depth + component.width - 1),
    0,
  );
  const canonicalWidth =
    sizeConfig.padding * 2 +
    sizeConfig.nodeSize +
    canonicalMaxDepth * sizeConfig.xGap;
  if (canonicalWidth <= viewportWidth) {
    return null;
  }

  const outerGutterWidth = getCrossBandGutterWidth(sizeConfig);
  const availableBandWidth =
    viewportWidth - sizeConfig.padding * 2 - outerGutterWidth;
  const bands = packLayoutGroupsIntoBands(
    groups,
    availableBandWidth,
    sizeConfig,
  );
  if (!bands || bands.length < 2) {
    return null;
  }

  const interGroupGap = sizeConfig.xGap - sizeConfig.nodeSize;
  const bandByStepId = new Map<string, number>();
  const positionByStepId = new Map<string, { x: number; y: number }>();
  const routingYBeforeBand = new Map<number, number>();
  let bandTop = 0;

  bands.forEach((band, bandIndex) => {
    let groupLeft = 0;
    let maxBandLane = 0;
    band.forEach((group) => {
      group.stepIds.forEach((stepId) => {
        const depth = depthByStepId.get(stepId) ?? group.minDepth;
        const lane = laneByStepId.get(stepId) ?? 0;
        maxBandLane = Math.max(maxBandLane, lane);
        bandByStepId.set(stepId, bandIndex);
        positionByStepId.set(stepId, {
          x:
            sizeConfig.padding +
            groupLeft +
            (depth - group.minDepth) * sizeConfig.xGap,
          y: sizeConfig.padding + bandTop + lane * sizeConfig.yGap,
        });
      });
      groupLeft += getLayoutGroupWidth(group, sizeConfig) + interGroupGap;
    });
    const bandBottom =
      sizeConfig.padding +
      bandTop +
      maxBandLane * sizeConfig.yGap +
      sizeConfig.nodeSize;
    const nextBandTop =
      sizeConfig.padding +
      bandTop +
      sizeConfig.nodeSize +
      (maxBandLane + 1) * sizeConfig.yGap;
    if (bandIndex < bands.length - 1) {
      routingYBeforeBand.set(bandIndex + 1, (bandBottom + nextBandTop) / 2);
    }
    bandTop += sizeConfig.nodeSize + (maxBandLane + 1) * sizeConfig.yGap;
  });

  return {
    bandByStepId,
    positionByStepId,
    routingYBeforeBand,
  };
};

interface PreferredWorkflowLayout {
  layout: WorkflowWrappedLayout;
  actual: PreferredWorkItemGraphShape;
  departures: readonly PreferredLayoutDeparture[];
}

interface WorkflowGroupPartitionPlan {
  cost: number;
  cuts: number[];
}

const getLayoutGroupColumnSpan = (group: WorkflowLayoutGroup): number =>
  group.maxDepth - group.minDepth + 1;

const compareNumberArrays = (
  left: readonly number[],
  right: readonly number[],
): number => {
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return left.length - right.length;
};

const getPreferredGroupPartition = (
  groups: WorkflowLayoutGroup[],
  bandCount: number,
  targetColumns: number,
): WorkflowLayoutGroup[][] | null => {
  if (groups.length === 0) return [];

  const requestedBandCount = Math.max(
    1,
    Math.min(groups.length, Math.trunc(bandCount)),
  );
  const prefixWidths = [0];
  groups.forEach((group, index) => {
    prefixWidths.push(
      (prefixWidths[index] ?? 0) + getLayoutGroupColumnSpan(group),
    );
  });
  const planCache = new Map<string, WorkflowGroupPartitionPlan | null>();

  const getSegmentWidth = (start: number, end: number): number =>
    (prefixWidths[end] ?? 0) - (prefixWidths[start] ?? 0);

  const getSegmentCost = (width: number): number => {
    const delta = width - targetColumns;
    return delta * delta + (delta > 0 ? delta * 4 : 0);
  };

  const findPlan = (
    start: number,
    remainingBands: number,
  ): WorkflowGroupPartitionPlan | null => {
    const cacheKey = `${start}:${remainingBands}`;
    const cached = planCache.get(cacheKey);
    if (cached !== undefined) return cached;

    if (remainingBands === 1) {
      const plan = {
        cost: getSegmentCost(getSegmentWidth(start, groups.length)),
        cuts: [groups.length],
      } satisfies WorkflowGroupPartitionPlan;
      planCache.set(cacheKey, plan);
      return plan;
    }

    const latestEnd = groups.length - (remainingBands - 1);
    let best: WorkflowGroupPartitionPlan | null = null;
    for (let end = start + 1; end <= latestEnd; end += 1) {
      const next = findPlan(end, remainingBands - 1);
      if (!next) continue;
      const candidate: WorkflowGroupPartitionPlan = {
        cost: getSegmentCost(getSegmentWidth(start, end)) + next.cost,
        cuts: [end, ...next.cuts],
      };
      if (
        !best ||
        candidate.cost < best.cost ||
        (candidate.cost === best.cost &&
          compareNumberArrays(candidate.cuts, best.cuts) < 0)
      ) {
        best = candidate;
      }
    }
    planCache.set(cacheKey, best);
    return best;
  };

  const plan = findPlan(0, requestedBandCount);
  if (!plan) return null;
  return plan.cuts.map((end, index) =>
    groups.slice(index === 0 ? 0 : plan.cuts[index - 1], end),
  );
};

const createPreferredWorkflowLayout = ({
  bands,
  depthByStepId,
  laneByStepId,
  sizeConfig,
}: {
  bands: WorkflowLayoutGroup[][];
  depthByStepId: Map<string, number>;
  laneByStepId: Map<string, number>;
  sizeConfig: WorkflowGraphSizeConfig;
}): {
  layout: WorkflowWrappedLayout;
  actual: PreferredWorkItemGraphShape;
} => {
  const bandByStepId = new Map<string, number>();
  const positionByStepId = new Map<string, { x: number; y: number }>();
  const routingYBeforeBand = new Map<number, number>();
  let bandTop = 0;
  let maxColumns = 0;

  bands.forEach((band, bandIndex) => {
    let groupLeft = 0;
    const bandLanes = band.flatMap((group) =>
      group.stepIds.map((stepId) => laneByStepId.get(stepId) ?? 0),
    );
    const firstLane = Math.min(...bandLanes, 0);
    const normalizedLanes = bandLanes.map((lane) => lane - firstLane);
    const maxBandLane = Math.max(...normalizedLanes, 0);

    band.forEach((group) => {
      group.stepIds.forEach((stepId) => {
        const depth = depthByStepId.get(stepId) ?? group.minDepth;
        const lane = (laneByStepId.get(stepId) ?? 0) - firstLane;
        bandByStepId.set(stepId, bandIndex);
        positionByStepId.set(stepId, {
          x:
            sizeConfig.padding +
            groupLeft +
            (depth - group.minDepth) * sizeConfig.xGap,
          y: sizeConfig.padding + bandTop + lane * sizeConfig.yGap,
        });
      });
      groupLeft +=
        getLayoutGroupWidth(group, sizeConfig) +
        (sizeConfig.xGap - sizeConfig.nodeSize);
    });

    maxColumns = Math.max(
      maxColumns,
      band.reduce((total, group) => total + getLayoutGroupColumnSpan(group), 0),
    );
    const bandBottom =
      sizeConfig.padding +
      bandTop +
      maxBandLane * sizeConfig.yGap +
      sizeConfig.nodeSize;
    const nextBandTop =
      sizeConfig.padding +
      bandTop +
      sizeConfig.nodeSize +
      (maxBandLane + 1) * sizeConfig.yGap;
    if (bandIndex < bands.length - 1) {
      routingYBeforeBand.set(bandIndex + 1, (bandBottom + nextBandTop) / 2);
    }
    bandTop += sizeConfig.nodeSize + (maxBandLane + 1) * sizeConfig.yGap;
  });

  return {
    layout: { bandByStepId, positionByStepId, routingYBeforeBand },
    actual: { rows: bands.length, columns: maxColumns },
  };
};

const getAuthoredPlacementLayout = ({
  groups,
  positionByStepId,
  sizeConfig,
}: {
  groups: WorkflowLayoutGroup[];
  positionByStepId: Map<string, WorkflowGraphPosition>;
  sizeConfig: WorkflowGraphSizeConfig;
}): WorkflowWrappedLayout | null => {
  const groupsWithPosition = groups.flatMap((group) => {
    const positions = group.stepIds.flatMap((stepId) => {
      const position = positionByStepId.get(stepId);
      return position ? [position] : [];
    });
    if (positions.length === 0) return [];
    return [
      {
        group,
        representative: {
          x: Math.min(...positions.map((position) => position.x)),
          y: Math.min(...positions.map((position) => position.y)),
        },
      },
    ];
  });
  if (groupsWithPosition.length !== groups.length) return null;

  const ordered = [...groupsWithPosition].sort(
    (left, right) =>
      left.representative.y - right.representative.y ||
      left.representative.x - right.representative.x ||
      left.group.stepIds[0].localeCompare(right.group.stepIds[0]),
  );
  const bands: Array<typeof ordered> = [];
  ordered.forEach((entry) => {
    const currentBand = bands.at(-1);
    const previous = currentBand?.[0];
    if (
      currentBand &&
      previous &&
      entry.representative.y - previous.representative.y <= sizeConfig.yGap
    ) {
      currentBand.push(entry);
      return;
    }
    bands.push([entry]);
  });

  const bandByStepId = new Map<string, number>();
  bands.forEach((band, bandIndex) => {
    band.forEach(({ group }) =>
      group.stepIds.forEach((stepId) => bandByStepId.set(stepId, bandIndex)),
    );
  });
  const routingYBeforeBand = new Map<number, number>();
  bands.slice(0, -1).forEach((band, bandIndex) => {
    const currentBottom = Math.max(
      ...band.flatMap(({ group }) =>
        group.stepIds.flatMap((stepId) => {
          const position = positionByStepId.get(stepId);
          return position ? [position.y + sizeConfig.nodeSize] : [];
        }),
      ),
    );
    const nextTop = Math.min(
      ...bands[bandIndex + 1].flatMap(({ group }) =>
        group.stepIds.flatMap((stepId) => {
          const position = positionByStepId.get(stepId);
          return position ? [position.y] : [];
        }),
      ),
    );
    routingYBeforeBand.set(bandIndex + 1, (currentBottom + nextTop) / 2);
  });

  return {
    bandByStepId,
    positionByStepId,
    routingYBeforeBand,
  };
};

interface PreferredWorkflowLayoutCandidate {
  layout: WorkflowWrappedLayout;
  actual: PreferredWorkItemGraphShape;
  bandCount: number;
}

const getLayoutGroupIndexByStepId = (
  groups: WorkflowLayoutGroup[],
): Map<string, number> =>
  new Map(
    groups.flatMap((group, groupIndex) =>
      group.stepIds.map((stepId) => [stepId, groupIndex] as const),
    ),
  );

const hasSameBandReversal = (
  layout: WorkflowWrappedLayout,
  layoutEdges: WorkflowLayoutEdge[],
  groupIndexByStepId: ReadonlyMap<string, number>,
): boolean =>
  layoutEdges.some((edge) => {
    const sourceGroup = groupIndexByStepId.get(edge.sourceNodeId);
    const targetGroup = groupIndexByStepId.get(edge.targetNodeId);
    const sourceBand = layout.bandByStepId.get(edge.sourceNodeId);
    const targetBand = layout.bandByStepId.get(edge.targetNodeId);
    const sourcePosition = layout.positionByStepId.get(edge.sourceNodeId);
    const targetPosition = layout.positionByStepId.get(edge.targetNodeId);
    return (
      sourceGroup !== undefined &&
      targetGroup !== undefined &&
      sourceGroup !== targetGroup &&
      sourceBand === targetBand &&
      sourcePosition !== undefined &&
      targetPosition !== undefined &&
      targetPosition.x < sourcePosition.x
    );
  });

const getPreferredWorkflowLayoutCandidates = ({
  depthByStepId,
  groups,
  laneByStepId,
  layoutEdges,
  preference,
  sizeConfig,
}: {
  depthByStepId: Map<string, number>;
  groups: WorkflowLayoutGroup[];
  laneByStepId: Map<string, number>;
  layoutEdges: WorkflowLayoutEdge[];
  preference: PreferredWorkItemGraphShape;
  sizeConfig: WorkflowGraphSizeConfig;
}): PreferredWorkflowLayoutCandidate[] => {
  const groupIndexByStepId = getLayoutGroupIndexByStepId(groups);
  return Array.from({ length: groups.length }, (_, index) => index + 1).flatMap(
    (bandCount) => {
      const bands = getPreferredGroupPartition(
        groups,
        bandCount,
        preference.columns,
      );
      if (!bands) return [];
      const built = createPreferredWorkflowLayout({
        bands,
        depthByStepId,
        laneByStepId,
        sizeConfig,
      });
      if (
        hasGraphSpanningBandTransition(built.layout, layoutEdges) ||
        hasSameBandReversal(built.layout, layoutEdges, groupIndexByStepId)
      ) {
        return [];
      }
      return [{ ...built, bandCount }];
    },
  );
};

const selectPreferredWorkflowLayout = ({
  candidates,
  depthByStepId,
  groups,
  laneByStepId,
  preference,
  sizeConfig,
}: {
  candidates: PreferredWorkflowLayoutCandidate[];
  depthByStepId: Map<string, number>;
  groups: WorkflowLayoutGroup[];
  laneByStepId: Map<string, number>;
  preference: PreferredWorkItemGraphShape;
  sizeConfig: WorkflowGraphSizeConfig;
}): PreferredWorkflowLayoutCandidate | null => {
  const fallbackBands = getPreferredGroupPartition(
    groups,
    1,
    preference.columns,
  );
  const fallback = fallbackBands
    ? {
        ...createPreferredWorkflowLayout({
          bands: fallbackBands,
          depthByStepId,
          laneByStepId,
          sizeConfig,
        }),
        bandCount: 1,
      }
    : null;
  const readableCandidates =
    candidates.length > 0 ? candidates : fallback ? [fallback] : [];
  return (
    [...readableCandidates].sort((left, right) => {
      const leftRowDistance = Math.abs(left.actual.rows - preference.rows);
      const rightRowDistance = Math.abs(right.actual.rows - preference.rows);
      const leftColumnDistance = Math.abs(
        left.actual.columns - preference.columns,
      );
      const rightColumnDistance = Math.abs(
        right.actual.columns - preference.columns,
      );
      return (
        leftRowDistance +
          leftColumnDistance -
          rightRowDistance -
          rightColumnDistance ||
        leftRowDistance - rightRowDistance ||
        leftColumnDistance - rightColumnDistance ||
        left.actual.rows - right.actual.rows ||
        left.actual.columns - right.actual.columns ||
        left.bandCount - right.bandCount
      );
    })[0] ?? null
  );
};

const getPreferredLayoutDepartures = ({
  components,
  flowEdges,
  groups,
  laneByStepId,
  preference,
  selected,
}: {
  components: WorkflowLayoutComponent[];
  flowEdges: AgentEdgeResponseDto[];
  groups: WorkflowLayoutGroup[];
  laneByStepId: Map<string, number>;
  preference: PreferredWorkItemGraphShape;
  selected: PreferredWorkflowLayoutCandidate;
}): PreferredLayoutDeparture[] => {
  const shapeDiffers =
    selected.actual.rows !== preference.rows ||
    selected.actual.columns !== preference.columns;
  if (!shapeDiffers) return [];

  const componentIndexByStepId = new Map(
    components.flatMap((component, componentIndex) =>
      component.stepIds.map((stepId) => [stepId, componentIndex] as const),
    ),
  );
  const hasBranchGroup = groups.some((group) => {
    const componentIndexes = new Set(
      group.stepIds.flatMap((stepId) => {
        const componentIndex = componentIndexByStepId.get(stepId);
        return componentIndex === undefined ? [] : [componentIndex];
      }),
    );
    const lanes = new Set(
      group.stepIds.map((stepId) => laneByStepId.get(stepId) ?? 0),
    );
    return componentIndexes.size > 1 && lanes.size > 1;
  });
  const hasCycle =
    components.some((component) => component.stepIds.length > 1) ||
    flowEdges.some(
      (edge) =>
        edge.type === AgentEdgeType.Loop &&
        edge.sourceNodeId === edge.targetNodeId,
    );
  const departures: PreferredLayoutDeparture[] = [];
  if (
    groups.some((group) => getLayoutGroupColumnSpan(group) > preference.columns)
  ) {
    departures.push("atomic-group-preserved");
  }
  if (hasBranchGroup) departures.push("branch-lanes-preserved");
  if (hasCycle) departures.push("cycle-routing-preserved");
  departures.push("requested-shape-unattainable");
  return departures;
};

const getPreferredWorkflowLayout = ({
  components,
  depthByStepId,
  flowEdges,
  groups,
  laneByStepId,
  layoutEdges,
  preference,
  sizeConfig,
}: {
  components: WorkflowLayoutComponent[];
  depthByStepId: Map<string, number>;
  flowEdges: AgentEdgeResponseDto[];
  groups: WorkflowLayoutGroup[];
  laneByStepId: Map<string, number>;
  layoutEdges: WorkflowLayoutEdge[];
  preference: PreferredWorkItemGraphShape;
  sizeConfig: WorkflowGraphSizeConfig;
}): PreferredWorkflowLayout | null => {
  if (
    !Number.isInteger(preference.rows) ||
    preference.rows < 1 ||
    !Number.isInteger(preference.columns) ||
    preference.columns < 1
  ) {
    return null;
  }

  if (groups.length === 0) {
    return {
      layout: {
        bandByStepId: new Map(),
        positionByStepId: new Map(),
        routingYBeforeBand: new Map(),
      },
      actual: { rows: 0, columns: 0 },
      departures: ["requested-shape-unattainable"],
    };
  }

  const selected = selectPreferredWorkflowLayout({
    candidates: getPreferredWorkflowLayoutCandidates({
      depthByStepId,
      groups,
      laneByStepId,
      layoutEdges,
      preference,
      sizeConfig,
    }),
    depthByStepId,
    groups,
    laneByStepId,
    preference,
    sizeConfig,
  });
  if (!selected) return null;

  const departures = getPreferredLayoutDepartures({
    components,
    flowEdges,
    groups,
    laneByStepId,
    preference,
    selected,
  });

  return {
    layout: selected.layout,
    actual: selected.actual,
    departures,
  };
};

const hasGraphSpanningBandTransition = (
  layout: WorkflowWrappedLayout,
  layoutEdges: WorkflowLayoutEdge[],
): boolean =>
  layoutEdges.some((edge) => {
    const sourceBand = layout.bandByStepId.get(edge.sourceNodeId);
    const targetBand = layout.bandByStepId.get(edge.targetNodeId);
    return (
      sourceBand !== undefined &&
      targetBand !== undefined &&
      Math.abs(targetBand - sourceBand) > 1
    );
  });

const groupStepIdsByDepth = (
  orderedStepIds: string[],
  depthByStepId: Map<string, number>,
): Map<number, string[]> => {
  const stepIdsByDepth = new Map<number, string[]>();
  orderedStepIds.forEach((stepId) => {
    const depth = depthByStepId.get(stepId) ?? 0;
    stepIdsByDepth.set(depth, [...(stepIdsByDepth.get(depth) ?? []), stepId]);
  });

  return stepIdsByDepth;
};

const getMedian = (values: number[]): number | null => {
  if (values.length === 0) {
    return null;
  }

  const sortedValues = [...values].sort(compareNumbers);
  const middleIndex = Math.floor(sortedValues.length / 2);
  if (sortedValues.length % 2 === 1) {
    return sortedValues[middleIndex];
  }

  return (sortedValues[middleIndex - 1] + sortedValues[middleIndex]) / 2;
};

const getDepthOrderByStepId = (
  stepIdsByDepth: Map<number, string[]>,
): Map<string, number> =>
  new Map(
    Array.from(stepIdsByDepth.values()).flatMap((stepIds) =>
      stepIds.map((stepId, index) => [stepId, index] as const),
    ),
  );

const buildNeighborStepIds = (
  layoutEdges: WorkflowLayoutEdge[],
  key: "sourceNodeId" | "targetNodeId",
  neighborKey: "sourceNodeId" | "targetNodeId",
): Map<string, string[]> => {
  const neighborsByStepId = new Map<string, Set<string>>();
  layoutEdges.forEach((edge) => {
    const neighbors = neighborsByStepId.get(edge[key]) ?? new Set<string>();
    neighbors.add(edge[neighborKey]);
    neighborsByStepId.set(edge[key], neighbors);
  });

  return new Map(
    Array.from(neighborsByStepId.entries()).map(([stepId, neighbors]) => [
      stepId,
      Array.from(neighbors),
    ]),
  );
};

const sortDepthByNeighborMedian = ({
  compareStepIds,
  neighborIdsByStepId,
  neighborOrderByStepId,
  stepIds,
}: {
  compareStepIds: (leftStepId: string, rightStepId: string) => number;
  neighborIdsByStepId: Map<string, string[]>;
  neighborOrderByStepId: Map<string, number>;
  stepIds: string[];
}): string[] =>
  [...stepIds].sort((leftStepId, rightStepId) => {
    const leftMedian = getMedian(
      (neighborIdsByStepId.get(leftStepId) ?? []).flatMap((neighborId) => {
        const order = neighborOrderByStepId.get(neighborId);
        return order === undefined ? [] : [order];
      }),
    );
    const rightMedian = getMedian(
      (neighborIdsByStepId.get(rightStepId) ?? []).flatMap((neighborId) => {
        const order = neighborOrderByStepId.get(neighborId);
        return order === undefined ? [] : [order];
      }),
    );

    return compareLayoutValues([
      leftMedian === null && rightMedian === null
        ? 0
        : leftMedian === null
          ? 1
          : rightMedian === null
            ? -1
            : leftMedian - rightMedian,
      () => compareStepIds(leftStepId, rightStepId),
    ]);
  });

const getStepLanes = (
  orderedStepIds: string[],
  depthByStepId: Map<string, number>,
  layoutEdges: WorkflowLayoutEdge[],
  compareStepIds: (leftStepId: string, rightStepId: string) => number,
): Map<string, number> => {
  const stepIdsByDepth = groupStepIdsByDepth(orderedStepIds, depthByStepId);
  const depths = Array.from(stepIdsByDepth.keys()).sort(compareNumbers);
  const parentIdsByStepId = buildNeighborStepIds(
    layoutEdges,
    "targetNodeId",
    "sourceNodeId",
  );
  const childIdsByStepId = buildNeighborStepIds(
    layoutEdges,
    "sourceNodeId",
    "targetNodeId",
  );

  depths.forEach((depth) => {
    stepIdsByDepth.set(
      depth,
      [...(stepIdsByDepth.get(depth) ?? [])].sort(compareStepIds),
    );
  });

  const sweepCount = Math.max(2, depths.length * 2);
  for (let sweep = 0; sweep < sweepCount; sweep += 1) {
    let orderByStepId = getDepthOrderByStepId(stepIdsByDepth);
    depths.slice(1).forEach((depth) => {
      stepIdsByDepth.set(
        depth,
        sortDepthByNeighborMedian({
          compareStepIds,
          neighborIdsByStepId: parentIdsByStepId,
          neighborOrderByStepId: orderByStepId,
          stepIds: stepIdsByDepth.get(depth) ?? [],
        }),
      );
    });

    orderByStepId = getDepthOrderByStepId(stepIdsByDepth);
    depths
      .slice(0, -1)
      .reverse()
      .forEach((depth) => {
        stepIdsByDepth.set(
          depth,
          sortDepthByNeighborMedian({
            compareStepIds,
            neighborIdsByStepId: childIdsByStepId,
            neighborOrderByStepId: orderByStepId,
            stepIds: stepIdsByDepth.get(depth) ?? [],
          }),
        );
      });
  }

  return getDepthOrderByStepId(stepIdsByDepth);
};

export const buildWorkflowGraphModel = (
  {
    workflow,
    steps,
    edges,
    workflowTypeDefinition,
    nodeTypeDefinition,
  }: WorkflowGraphSurfaceData,
  options: WorkflowGraphModelOptions = DEFAULT_WORKFLOW_GRAPH_MODEL_OPTIONS,
): WorkflowGraphModel => {
  const sizeMode = options.sizeMode ?? DEFAULT_WORKFLOW_GRAPH_SIZE_MODE;
  const presentationState =
    options.presentationState ?? DEFAULT_WORKFLOW_GRAPH_PRESENTATION_STATE;
  const sizeConfig = WORKFLOW_GRAPH_SIZE_CONFIGS[sizeMode];
  const diagramRoleByKey = new Map(
    getDiagramRoleDefinitions(nodeTypeDefinition).map((role) => [
      role.key,
      role,
    ]),
  );
  const isDiagram = workflow.type.toUpperCase() === "DIAGRAM";
  const flowEdges = edges.filter(isFlowEdge);
  const stepById = new Map(steps.map((step) => [step.id, step]));
  const stepIds = new Set(stepById.keys());
  const directEntityLinksByStepId = isDiagram
    ? getDirectEntityLinksByNodeId(
        steps,
        edges,
        options.directEntityLinks ?? [],
        workflow.projectId,
      )
    : new Map<string, WorkflowGraphRenderedEntityLink[]>();
  const highlightedEndpointIds = new Set<string>();
  const highlightedFlowEdge = flowEdges.find(
    (edge) => edge.id === options.highlightedEdgeId,
  );
  if (highlightedFlowEdge) {
    if (stepIds.has(highlightedFlowEdge.sourceNodeId)) {
      highlightedEndpointIds.add(highlightedFlowEdge.sourceNodeId);
    }
    if (stepIds.has(highlightedFlowEdge.targetNodeId)) {
      highlightedEndpointIds.add(highlightedFlowEdge.targetNodeId);
    }
  }
  const layoutEdges = getLayoutEdges(flowEdges, stepIds, stepById);
  const compareStepIds = getStepIdSemanticComparator(stepById, layoutEdges);
  const orderedStepIds = Array.from(stepIds).sort(compareStepIds);
  const fulfilledByTargetsByStepId = getFulfilledByTargetsByStepId({
    steps,
    edges,
  });
  const { components, depthByStepId, layoutEdgesForLanes } =
    getCycleAwareStepDepths(orderedStepIds, layoutEdges, compareStepIds);
  const laneByStepId = getStepLanes(
    orderedStepIds,
    depthByStepId,
    layoutEdgesForLanes,
    compareStepIds,
  );
  const layoutGroups = getAtomicLayoutGroups(components, compareStepIds);
  const preferredLayout = options.preferredLayout
    ? getPreferredWorkflowLayout({
        components,
        depthByStepId,
        flowEdges,
        groups: layoutGroups,
        laneByStepId,
        layoutEdges,
        preference: options.preferredLayout,
        sizeConfig,
      })
    : null;
  const wrappedLayoutCandidate = getWrappedLayout({
    components,
    depthByStepId,
    groups: layoutGroups,
    laneByStepId,
    sizeConfig,
    viewportWidth: options.viewportWidth,
  });
  const wrappedLayout =
    preferredLayout?.layout ??
    (wrappedLayoutCandidate &&
    !hasGraphSpanningBandTransition(wrappedLayoutCandidate, layoutEdges)
      ? wrappedLayoutCandidate
      : null);
  const positionByStepId = new Map<string, WorkflowGraphPosition>(
    orderedStepIds.map((stepId) => {
      const depth = depthByStepId.get(stepId) ?? 0;
      const lane = laneByStepId.get(stepId) ?? 0;
      const canonicalPosition = wrappedLayout?.positionByStepId.get(stepId) ?? {
        x: sizeConfig.padding + depth * sizeConfig.xGap,
        y: sizeConfig.padding + lane * sizeConfig.yGap,
      };
      return [
        stepId,
        options.authoredPositions?.get(stepId) ?? canonicalPosition,
      ];
    }),
  );
  const selectedPlacementLayout = options.authoredPositions
    ? (getAuthoredPlacementLayout({
        groups: layoutGroups,
        positionByStepId,
        sizeConfig,
      }) ?? wrappedLayout)
    : wrappedLayout;
  const returnEdges = getReturnEdges(flowEdges, depthByStepId, stepById);
  const returnEdgeIds = new Set(returnEdges.map((edge) => edge.id));
  const localReturnRouteAssignments = getLocalReturnRouteAssignments({
    positionByStepId,
    returnEdges,
    sizeConfig,
  });
  const requiredHandlesByStepId = getRequiredHandlesByStepId(steps, flowEdges);
  const forwardSourceHandleAssignments = getForwardSourceHandleAssignments(
    flowEdges,
    depthByStepId,
    stepById,
  );
  applyForwardSourceHandleAssignments(
    requiredHandlesByStepId,
    forwardSourceHandleAssignments,
  );
  const returnHandleAssignments = getReturnHandleAssignments(
    flowEdges,
    depthByStepId,
    stepById,
    localReturnRouteAssignments,
  );
  applyReturnHandleAssignments(
    requiredHandlesByStepId,
    flowEdges,
    returnHandleAssignments,
  );
  applyLocalReturnHandleAssignments(
    requiredHandlesByStepId,
    returnEdges,
    localReturnRouteAssignments,
  );
  const crossBandRouteAssignments = getCrossBandRouteAssignments({
    bandByStepId: selectedPlacementLayout?.bandByStepId,
    layoutEdges,
    routingYBeforeBand: selectedPlacementLayout?.routingYBeforeBand,
    returnEdgeIds,
    sizeConfig,
    stepById,
    positionByStepId,
  });
  applyCrossBandTargetHandles(
    requiredHandlesByStepId,
    crossBandRouteAssignments,
  );

  const nodes: WorkflowGraphModel["nodes"] = orderedStepIds
    .map((stepId) => ({
      position: positionByStepId.get(stepId),
      step: stepById.get(stepId),
    }))
    .filter(
      (
        entry,
      ): entry is {
        position: WorkflowGraphPosition;
        step: WorkflowGraphSurfaceData["steps"][number];
      } => Boolean(entry.position) && Boolean(entry.step),
    )
    .map(({ position, step }) => {
      const diffStatus = options.diffStatusByNodeId?.get(step.id);
      const diagramElementMetadata = getDiagramElementMetadata(step);
      const explorationTargetId = resolveDiagramExplorationTarget(
        diagramElementMetadata,
        step.id,
        options.disableLinks,
      );
      const diagramRole = diagramElementMetadata
        ? diagramRoleByKey.get(diagramElementMetadata.role)
        : undefined;
      return {
        id: step.id,
        type: WORKFLOW_STEP_NODE_TYPE,
        position,
        initialWidth: sizeConfig.nodeSize,
        initialHeight: sizeConfig.nodeSize,
        data: {
          entityId: step.id,
          entityType: TargetEntityType.Task,
          entitySubtype: step.type,
          entityTitle: step.name,
          organizationId: step.organizationId,
          projectId: step.projectId,
          href: buildWorkflowStepHref(step),
          referenceIcon:
            workflowTypeDefinition?.key === "DIAGRAM"
              ? resolveWorkItemIcon(
                  workflowTypeDefinition.key,
                  workflowTypeDefinition,
                )
              : undefined,
          canonicalReference: diagramElementMetadata?.canonicalReference,
          onExpandReference:
            explorationTargetId && options.onExpandReference
              ? () => options.onExpandReference?.(explorationTargetId)
              : undefined,
          disableLinks:
            options.disableLinks ||
            Boolean(options.editable) ||
            step.id.startsWith("temporary:"),
          isEditable: Boolean(options.editable),
          canStartConnection: false,
          title: step.name,
          summary: getStepSummary(step),
          description: getStepDescription(step),
          handles:
            requiredHandlesByStepId.get(step.id) ?? createEmptyHandleState(),
          isDropTarget: false,
          isHighlighted:
            options.highlightedStepId === step.id ||
            options.hoveredNodeId === step.id ||
            highlightedEndpointIds.has(step.id),
          isCreated:
            diffStatus === "added" ||
            (options.createdNodeIds?.has(step.id) ?? false),
          presentationState,
          diffStatus,
          authoredColor: getAuthoredWorkflowStepColor(step.sections),
          isDiagram,
          diagramRole:
            diagramRole?.label ??
            (diagramElementMetadata
              ? formatDiagramSemanticLabel(diagramElementMetadata.role)
              : undefined),
          diagramRoleKey: diagramRole?.key ?? diagramElementMetadata?.role,
          diagramRoleIcon: diagramElementMetadata
            ? getDiagramRoleIcon(
                diagramElementMetadata.role,
                diagramRole?.notation,
              )
            : undefined,
          diagramNotation: diagramRole?.notation,
          directEntityLinks: directEntityLinksByStepId.get(step.id) ?? [],
          fulfilledByTargets: isDiagram
            ? []
            : (fulfilledByTargetsByStepId.get(step.id) ?? []),
          sizeConfig,
          sizeMode,
        },
        zIndex:
          options.highlightedStepId === step.id ||
          options.hoveredNodeId === step.id ||
          highlightedEndpointIds.has(step.id)
            ? 2
            : 1,
        draggable: options.editable ?? false,
        selectable: options.editable ?? false,
      };
    });

  const maxNodeX = nodes.reduce(
    (currentMax, node) => Math.max(currentMax, node.position.x),
    sizeConfig.padding,
  );
  const maxNodeY = nodes.reduce(
    (currentMax, node) => Math.max(currentMax, node.position.y),
    sizeConfig.padding,
  );
  const baseWidth = wrappedLayout
    ? (options.viewportWidth ??
      maxNodeX + sizeConfig.nodeSize + sizeConfig.padding)
    : maxNodeX + sizeConfig.nodeSize + sizeConfig.padding;
  const baseCanvasHeight = maxNodeY + sizeConfig.nodeSize + sizeConfig.padding;
  const returnLaneSpacing =
    sizeConfig.nodeSize * WORKFLOW_GRAPH_RETURN_EDGE_GUTTER_RATIO;
  const loopEdgeGutter = flowEdges.some(
    (edge) =>
      edge.type === AgentEdgeType.Loop &&
      stepIds.has(edge.sourceNodeId) &&
      stepIds.has(edge.targetNodeId),
  )
    ? returnLaneSpacing
    : 0;
  const flowEdgeGutterHeight =
    returnHandleAssignments.laneCount * returnLaneSpacing + loopEdgeGutter;
  const localReturnRight = Array.from(
    localReturnRouteAssignments.routeByEdgeId.values(),
  ).reduce(
    (currentMax, route) =>
      Math.max(
        currentMax,
        route.gutterX + sizeConfig.edgeLabelWidth / 2 + sizeConfig.padding,
      ),
    0,
  );
  const width = Math.max(baseWidth, localReturnRight);
  const canvasHeight = baseCanvasHeight + flowEdgeGutterHeight;
  const viewportHeight = Math.min(
    WORKFLOW_GRAPH_MAX_HEIGHT,
    canvasHeight + WORKFLOW_GRAPH_SCROLLBAR_ALLOWANCE,
  );

  const nodeIds = new Set(nodes.map((node) => node.id));
  const graphEdges: WorkflowGraphModel["edges"] = flowEdges
    .filter(
      (edge) =>
        nodeIds.has(edge.sourceNodeId) && nodeIds.has(edge.targetNodeId),
    )
    .sort(compareLayoutEdges(stepById))
    .map((edge) => {
      const diffStatus = options.diffStatusByEdgeId?.get(edge.id);
      const isCreated =
        diffStatus === "added" ||
        (options.createdEdgeIds?.has(edge.id) ?? false);
      const diffColor =
        diffStatus &&
        isWorkflowGraphDiffPresentation(diffStatus, presentationState)
          ? options.diffEdgeColors?.[diffStatus]
          : undefined;
      const isAddedPresentation = isWorkflowGraphAddedPresentation({
        isCreated,
        diffStatus,
        presentationState,
      });
      const route = getWorkflowEdgeRoute({
        crossBandRouteAssignments,
        edge,
        forwardSourceHandleAssignments,
        localReturnRouteAssignments,
        returnHandleAssignments,
        returnGutterStartY: baseCanvasHeight,
        returnLaneSpacing,
      });
      return {
        id: edge.id,
        source: edge.sourceNodeId,
        target: edge.targetNodeId,
        sourceHandle:
          edge.type === AgentEdgeType.Loop
            ? "loop-source"
            : route.kind === "local-return"
              ? route.side
              : route.kind === "return"
                ? returnHandleAssignments.sourceHandleIdByEdgeId.get(edge.id)
                : (forwardSourceHandleAssignments.handleIdByEdgeId.get(
                    edge.id,
                  ) ?? getSourceHandle(edge)),
        targetHandle:
          edge.type === AgentEdgeType.Loop
            ? "loop-target"
            : route.kind === "local-return"
              ? route.side
              : route.kind === "return"
                ? returnHandleAssignments.targetHandleIdByEdgeId.get(edge.id)
                : route.kind === "cross-band"
                  ? "cross-band-target"
                  : getTargetHandle(edge),
        type: WORKFLOW_FLOW_EDGE_TYPE,
        data: {
          edgeType: edge.type,
          label: getEdgeLabel(edge),
          route,
          isHighlighted:
            edge.id === options.highlightedEdgeId ||
            (options.hoveredNodeId !== undefined &&
              (edge.sourceNodeId === options.hoveredNodeId ||
                edge.targetNodeId === options.hoveredNodeId)),
          isTooltipOpen: edge.id === options.highlightedEdgeId,
          isCreated,
          presentationState,
          diffStatus,
          sizeConfig,
          sizeMode,
        },
        animated: false,
        selectable: options.editable ?? false,
        reconnectable:
          options.editable &&
          (options.reconnectableEdgeIds?.has(edge.id) ?? false),
        markerEnd:
          edge.type === AgentEdgeType.Conditional
            ? undefined
            : {
                type: MarkerType.ArrowClosed,
                width: 16,
                height: 16,
                ...(diffColor
                  ? { color: diffColor }
                  : isAddedPresentation && options.createdEdgeColor
                    ? { color: options.createdEdgeColor }
                    : {}),
              },
        style: {
          ...getEdgeStyle(edge),
          ...(diffColor ? { stroke: diffColor, opacity: 1 } : {}),
          ...(diffStatus === "deleted" ? { strokeDasharray: "6 4" } : {}),
        },
      };
    });

  return {
    nodes,
    edges: graphEdges,
    width,
    height: viewportHeight,
    canvasHeight,
    layoutMode: wrappedLayout ? "wrapped" : "horizontal",
    ...(preferredLayout && options.preferredLayout
      ? {
          preferredLayout: {
            requested: options.preferredLayout,
            actual: preferredLayout.actual,
            departures: preferredLayout.departures,
          },
        }
      : {}),
  };
};

export const buildCanonicalProjectedGraphPositions = (
  children: readonly ProjectedWorkItem[],
  relationships: readonly ProjectedWorkItemRelationship[],
): ReadonlyMap<string, WorkItemChangeSetPosition> => {
  const seed = children[0] ?? ({} as ProjectedWorkItem);
  const root = {
    ...seed,
    identity: { refType: "temporary", tempId: "__graph_root__" },
    name: "Graph",
    type: "graph",
    sections: [],
    deleted: false,
  } as ProjectedWorkItem;
  // Layout-only: positions never need scope.
  const graphData = projectWorkItemGraph(
    { projectedRoot: root, children, incidentRelationships: relationships },
    null,
  );
  const positionBySurfaceId = new Map(
    buildWorkflowGraphModel(graphData, {
      disableLinks: true,
      sizeMode: DEFAULT_WORKFLOW_GRAPH_SIZE_MODE,
    }).nodes.map((node) => [node.id, node.position]),
  );
  return new Map(
    children.flatMap((child) => {
      const position = positionBySurfaceId.get(
        workItemIdentityKey(child.identity),
      );
      return position ? [[draftIdentityKey(child.identity), position]] : [];
    }),
  );
};

export interface PreferredProjectedGraphPositionResult {
  positions: ReadonlyMap<string, WorkItemChangeSetPosition>;
  actual: PreferredWorkItemGraphShape;
  departures: readonly PreferredLayoutDeparture[];
}

export const buildPreferredProjectedGraphPositionResult = (
  children: readonly ProjectedWorkItem[],
  relationships: readonly ProjectedWorkItemRelationship[],
  preference: PreferredWorkItemGraphShape,
): PreferredProjectedGraphPositionResult => {
  const seed = children[0] ?? ({} as ProjectedWorkItem);
  const root = {
    ...seed,
    identity: { refType: "temporary", tempId: "__graph_root__" },
    name: "Graph",
    type: "graph",
    sections: [],
    deleted: false,
  } as ProjectedWorkItem;
  // Layout-only: positions never need scope.
  const graphData = projectWorkItemGraph(
    { projectedRoot: root, children, incidentRelationships: relationships },
    null,
  );
  const model = buildWorkflowGraphModel(graphData, {
    disableLinks: true,
    sizeMode: DEFAULT_WORKFLOW_GRAPH_SIZE_MODE,
    preferredLayout: preference,
  });
  const positionBySurfaceId = new Map(
    model.nodes
      .filter((node) => node.type === WORKFLOW_STEP_NODE_TYPE)
      .map((node) => [node.id, node.position]),
  );
  const positions = new Map(
    children.flatMap((child) => {
      const position = positionBySurfaceId.get(
        workItemIdentityKey(child.identity),
      );
      return position
        ? [[draftIdentityKey(child.identity), position] as const]
        : [];
    }),
  );
  return {
    positions,
    actual: model.preferredLayout?.actual ?? { rows: 0, columns: 0 },
    departures:
      model.preferredLayout?.departures ??
      (["requested-shape-unattainable"] as const),
  };
};

const WorkflowMentionSkeleton: React.FC<{ mention: EntityMention }> = ({
  mention,
}) => (
  <Box
    data-testid="workflow-inline-diagram-loading"
    data-workflow-id={mention.entityId}
    sx={{
      display: "block",
      border: (theme) => `1px solid ${theme.palette.divider}`,
      borderRadius: 1,
      p: 1.5,
      my: 1,
      bgcolor: "background.paper",
    }}
  >
    <Stack
      direction="row"
      spacing={1}
      alignItems="center"
      sx={{ mb: 1, display: "flex" }}
    >
      <Skeleton variant="circular" width={22} height={22} />
      <Skeleton variant="text" width={180} />
    </Stack>
    <Stack spacing={1} sx={{ display: "flex" }}>
      <Skeleton variant="rounded" height={56} />
      <Skeleton variant="rounded" height={56} width="82%" />
    </Stack>
  </Box>
);

const WorkflowMentionPlaceholder: React.FC<{ mention: EntityMention }> = ({
  mention,
}) => (
  <Box
    data-testid="workflow-inline-diagram-placeholder"
    data-workflow-id={mention.entityId}
    aria-hidden="true"
    sx={{
      display: "block",
      width: "100%",
      height: WORKFLOW_GRAPH_MIN_VIEWPORT_HEIGHT,
      minHeight: WORKFLOW_GRAPH_MIN_VIEWPORT_HEIGHT,
      maxHeight: WORKFLOW_GRAPH_MIN_VIEWPORT_HEIGHT,
      border: (theme) => `1px solid ${theme.palette.divider}`,
      borderRadius: 1,
      my: 1,
      bgcolor: "background.paper",
    }}
  />
);

const WorkflowMentionUnavailable: React.FC<{ mention: EntityMention }> = ({
  mention,
}) => (
  <Box
    data-testid="workflow-inline-diagram-unavailable"
    data-workflow-id={mention.entityId}
    sx={{
      display: "block",
      border: (theme) => `1px solid ${theme.palette.divider}`,
      borderRadius: 1,
      p: 1.5,
      my: 1,
      bgcolor: "background.paper",
    }}
  >
    <Stack
      direction="row"
      spacing={1}
      alignItems="center"
      sx={{ display: "flex" }}
    >
      <AccountTreeIcon color="disabled" sx={{ fontSize: 20 }} />
      <Stack spacing={0.25}>
        <Typography component="span" variant="subtitle2" fontWeight={700}>
          {mention.entityName}
        </Typography>
        <Typography component="span" variant="body2" color="text.secondary">
          Workflow graph unavailable
        </Typography>
      </Stack>
    </Stack>
  </Box>
);

const WorkflowGraphUnavailable: React.FC = () => (
  <Box
    data-testid="workflow-inline-diagram-unavailable"
    sx={{
      display: "block",
      border: (theme) => `1px solid ${theme.palette.divider}`,
      borderRadius: 1,
      p: 1.5,
      my: 1,
      bgcolor: "background.paper",
    }}
  >
    <Stack direction="row" spacing={1} alignItems="center">
      <AccountTreeIcon color="disabled" sx={{ fontSize: 20 }} />
      <Typography variant="body2" color="text.secondary">
        Workflow graph unavailable
      </Typography>
    </Stack>
  </Box>
);

const WorkflowFulfillmentTargetRow: React.FC<{
  target: WorkflowFulfillmentTargetData;
  disableLinks: boolean;
}> = ({ target, disableLinks }) => (
  <Box
    data-testid="workflow-inline-fulfilled-target"
    data-target-id={target.id}
    sx={{ minWidth: 0 }}
  >
    {disableLinks ? (
      <Typography variant="body2" sx={{ overflowWrap: "anywhere" }}>
        {target.title}
      </Typography>
    ) : (
      <MentionBadgeInner
        mention={{
          entityType: "task",
          entityId: target.id,
          entityName: target.title,
        }}
      />
    )}
  </Box>
);

const WorkflowFulfillmentTooltipContent: React.FC<{
  disableLinks: boolean;
  description: string;
  sizeConfig: WorkflowGraphSizeConfig;
  sizeMode: WorkflowGraphSizeMode;
  title: string;
  targets: WorkflowFulfillmentTargetData[];
}> = ({ description, disableLinks, sizeConfig, sizeMode, title, targets }) => (
  <Stack
    data-testid="workflow-inline-fulfilled-details"
    data-workflow-graph-size={sizeMode}
    spacing={1}
    sx={{
      minWidth: sizeConfig.tooltipMinWidth,
      maxWidth: sizeConfig.tooltipMaxWidth,
      py: 0.5,
    }}
  >
    <Typography variant="body2" sx={{ fontWeight: 700, lineHeight: 1.35 }}>
      {title}
    </Typography>
    {description ? (
      <Typography
        variant="body2"
        sx={{
          fontSize: sizeMode === "small" ? "0.8125rem" : "0.875rem",
          lineHeight: 1.45,
          overflowWrap: "anywhere",
          whiteSpace: "pre-wrap",
        }}
      >
        {renderInlineMentions(description, "minimal", { disableLinks })}
      </Typography>
    ) : null}
    {targets.length > 0 ? (
      <>
        <Typography variant="caption" sx={{ fontWeight: 700 }}>
          Fulfilled by
        </Typography>
        {targets.map((target) => (
          <WorkflowFulfillmentTargetRow
            key={target.id}
            target={target}
            disableLinks={disableLinks}
          />
        ))}
      </>
    ) : null}
  </Stack>
);

const getWorkflowStepCardSx = (
  disableLinks: boolean,
  isDropTarget: boolean,
  isHighlighted: boolean,
  isCreated: boolean,
  diffStatus: WorkflowGraphDiffStatus | undefined,
  presentationState: WorkflowGraphPresentationState,
  authoredColor: string | undefined,
  sizeConfig: WorkflowGraphSizeConfig,
  notation?: DiagramElementRoleDefinition["notation"],
): SxProps<Theme> => {
  const hasCreatedPresentation = isWorkflowGraphAddedPresentation({
    isCreated,
    diffStatus,
    presentationState,
  });
  const hasDiffPresentation = isWorkflowGraphDiffPresentation(
    diffStatus,
    presentationState,
  );
  const hasSuccessPresentation =
    hasCreatedPresentation || (hasDiffPresentation && diffStatus !== "deleted");
  return {
    display: "block",
    position: "relative",
    zIndex: isHighlighted ? 1 : 0,
    width: "100%",
    height: "100%",
    boxSizing: "border-box",
    border: (theme) =>
      `${
        isHighlighted ||
        isDropTarget ||
        hasCreatedPresentation ||
        hasDiffPresentation
          ? 2
          : 1
      }px solid ${
        isHighlighted || isDropTarget
          ? theme.palette.primary.main
          : diffStatus === "deleted"
            ? theme.palette.error.main
            : hasSuccessPresentation
              ? theme.palette.success.main
              : authoredColor
                ? authoredColor
                : theme.palette.mode === "dark"
                  ? theme.palette.grey[700]
                  : theme.palette.grey[300]
      }`,
    borderRadius: notation === "cylinder" ? "45% / 12%" : 1,
    borderStyle: notation === "frame" ? "double" : "solid",
    bgcolor: (theme) =>
      isHighlighted
        ? theme.palette.background.paper
        : isDropTarget
          ? alpha(
              theme.palette.primary.main,
              theme.palette.mode === "dark" ? 0.22 : 0.1,
            )
          : diffStatus === "deleted"
            ? alpha(
                theme.palette.error.main,
                theme.palette.mode === "dark" ? 0.22 : 0.1,
              )
            : hasSuccessPresentation
              ? alpha(
                  theme.palette.success.main,
                  theme.palette.mode === "dark" ? 0.22 : 0.1,
                )
              : authoredColor
                ? alpha(
                    authoredColor,
                    theme.palette.mode === "dark" ? 0.22 : 0.1,
                  )
                : theme.palette.mode === "dark"
                  ? theme.palette.grey[800]
                  : theme.palette.common.white,
    boxShadow: (theme) =>
      isHighlighted || isDropTarget
        ? `0 0 0 2px ${alpha(theme.palette.primary.main, 0.24)}, ${
            theme.shadows[1]
          }`
        : diffStatus === "deleted"
          ? `0 0 0 2px ${alpha(theme.palette.error.main, 0.2)}, ${
              theme.shadows[1]
            }`
          : hasSuccessPresentation
            ? `0 0 0 2px ${alpha(theme.palette.success.main, 0.2)}, ${
                theme.shadows[1]
              }`
            : "none",
    color: "text.primary",
    p: sizeConfig.cardPadding,
    overflow: "hidden",
    cursor: disableLinks ? "default" : "pointer",
    pointerEvents: "all",
    textDecoration: "none",
    ...(disableLinks
      ? {}
      : {
          transition:
            "border-color 120ms ease, box-shadow 120ms ease, background-color 120ms ease",
          "&:hover": {
            borderColor: isHighlighted ? "primary.dark" : "primary.main",
            boxShadow: (theme) =>
              isHighlighted
                ? `0 0 0 2px ${alpha(theme.palette.primary.main, 0.32)}, ${
                    theme.shadows[2]
                  }`
                : theme.shadows[1],
            textDecoration: "none",
          },
          "&:focus-visible": {
            outline: "none",
            borderColor: isHighlighted ? "primary.dark" : "primary.main",
            boxShadow: (theme) => `0 0 0 2px ${theme.palette.primary.main}`,
          },
          "[data-interaction-state='hovering'] &": {
            borderColor: isHighlighted ? "primary.dark" : "primary.main",
            boxShadow: (theme) =>
              isHighlighted
                ? `0 0 0 2px ${alpha(theme.palette.primary.main, 0.32)}, ${
                    theme.shadows[2]
                  }`
                : theme.shadows[1],
          },
          "[data-interaction-state='menuOpen'] &": {
            borderColor: "primary.dark",
            boxShadow: (theme) => `0 0 0 2px ${theme.palette.primary.main}`,
          },
        }),
  };
};

const WorkflowStepCardContent: React.FC<{
  data: WorkflowStepNodeData;
}> = ({ data }) => {
  const theme = useTheme();
  const {
    hasLeftSourceHandle,
    hasLeftTargetHandle,
    hasRightSourceHandle,
    hasRightTargetHandle,
    forwardSourceHandleIds,
    hasLoopSourceHandle,
    hasLoopTargetHandle,
    hasCrossBandTargetHandle,
    returnSourceHandleIds,
    returnTargetHandleIds,
  } = data.handles;
  const fulfilledByCount = data.fulfilledByTargets.length;
  const { sizeConfig } = data;
  const DiagramRoleIcon = data.diagramRoleIcon;
  const diagramRoleIconTestId =
    data.diagramRoleKey === "PERSON"
      ? "diagram-element-person-icon"
      : data.diagramRoleKey === "AGENT"
        ? "diagram-element-agent-icon"
        : data.diagramRoleKey === "START"
          ? "diagram-element-start-icon"
          : data.diagramRoleKey === "END"
            ? "diagram-element-end-icon"
            : undefined;
  const highlightTextColor = getWorkflowGraphHighlightTextColor(theme);
  const forwardSourceHandleStyle = {
    right: -7,
    width: 14,
    height: 2,
    border: 0,
    borderRadius: 0,
    background: theme.palette.divider,
  };

  return (
    <>
      {data.canStartConnection && (
        <Box
          role="button"
          aria-label={`Start connection from ${data.title}`}
          tabIndex={0}
          data-testid="workflow-step-start-connection"
          sx={{
            position: "absolute",
            right: -12,
            top: "50%",
            transform: "translateY(-50%)",
            width: 24,
            height: 24,
            zIndex: 1,
          }}
        >
          <Handle
            id="new-connection"
            type="source"
            position={Position.Right}
            isConnectable
            style={{
              inset: 0,
              transform: "none",
              width: 24,
              height: 24,
              borderRadius: "25%",
              border: `2px solid ${theme.palette.background.paper}`,
              background: theme.palette.primary.main,
            }}
          />
        </Box>
      )}
      {hasLeftSourceHandle && (
        <Handle
          id="left"
          type="source"
          position={Position.Left}
          isConnectable={false}
        />
      )}
      {hasLeftTargetHandle && (
        <Handle
          id="left"
          type="target"
          position={Position.Left}
          isConnectable={false}
        />
      )}
      {forwardSourceHandleIds.length > 0
        ? forwardSourceHandleIds.map((handleId, index) => (
            <Handle
              key={handleId}
              id={handleId}
              type="source"
              position={Position.Right}
              isConnectable={false}
              style={{
                top: `${
                  ((index + 1) / (forwardSourceHandleIds.length + 1)) * 100
                }%`,
                ...forwardSourceHandleStyle,
              }}
            />
          ))
        : hasRightSourceHandle && (
            <Handle
              id="right"
              type="source"
              position={Position.Right}
              isConnectable={false}
              style={forwardSourceHandleStyle}
            />
          )}
      {hasRightTargetHandle && (
        <Handle
          id="right"
          type="target"
          position={Position.Right}
          isConnectable={false}
        />
      )}
      {hasLoopSourceHandle && (
        <Handle
          id="loop-source"
          type="source"
          position={Position.Bottom}
          isConnectable={false}
          style={{ left: "35%" }}
        />
      )}
      {hasLoopTargetHandle && (
        <Handle
          id="loop-target"
          type="target"
          position={Position.Bottom}
          isConnectable={false}
          style={{ left: "65%" }}
        />
      )}
      {hasCrossBandTargetHandle && (
        <Handle
          id="cross-band-target"
          type="target"
          position={Position.Top}
          isConnectable={false}
        />
      )}
      {returnSourceHandleIds.map((handleId, index) => (
        <Handle
          key={handleId}
          id={handleId}
          type="source"
          position={Position.Bottom}
          isConnectable={false}
          style={{
            left: `${
              ((index + 1) / (returnSourceHandleIds.length + 1)) * 100
            }%`,
          }}
        />
      ))}
      {returnTargetHandleIds.map((handleId, index) => (
        <Handle
          key={handleId}
          id={handleId}
          type="target"
          position={Position.Bottom}
          isConnectable={false}
          style={{
            left: `${
              ((index + 1) / (returnTargetHandleIds.length + 1)) * 100
            }%`,
          }}
        />
      ))}
      {data.isDiagram && DiagramRoleIcon ? (
        <Tooltip title={data.diagramRole ?? "Diagram element"} arrow>
          <Box
            component="span"
            role="img"
            aria-label={`${data.diagramRole ?? "Generic"} role`}
            data-testid="diagram-element-role-icon"
            sx={{
              position: "absolute",
              top: 6,
              left: 6,
              display: "inline-flex",
              color: data.isHighlighted ? highlightTextColor : "text.secondary",
              lineHeight: 0,
              zIndex: 1,
            }}
          >
            <DiagramRoleIcon
              aria-hidden
              data-testid={diagramRoleIconTestId}
              sx={{ fontSize: "1rem" }}
            />
          </Box>
        </Tooltip>
      ) : null}
      <Stack
        spacing={0.5}
        sx={{
          height: "100%",
          minHeight: 0,
          boxSizing: "border-box",
          // The link strip (24px icons, 4px inset from the frame) overlays
          // the card bottom, so reserve its full height regardless of the
          // card's own padding.
          pb:
            data.directEntityLinks.length > 0
              ? "28px"
              : fulfilledByCount > 0
                ? 3
                : 0,
          pt: data.isDiagram ? 3 : 0,
        }}
      >
        {(!data.isDiagram || data.diagramRoleKey === "DIAGRAM_REFERENCE") &&
        data.diagramRole ? (
          <Typography
            variant="caption"
            data-testid="diagram-element-role"
            sx={{
              color: "text.secondary",
              fontSize: "0.625rem",
              lineHeight: 1,
            }}
          >
            {data.diagramRole}
          </Typography>
        ) : null}
        <Typography
          data-testid="workflow-inline-step-title"
          variant="body2"
          fontWeight={700}
          sx={{
            color: data.isHighlighted ? highlightTextColor : "text.primary",
            fontSize: sizeConfig.titleFontSize,
            lineHeight: 1.25,
            minHeight: sizeConfig.titleMinHeight,
            flexShrink: 0,
            overflow: "hidden",
            whiteSpace: "normal",
            display: "-webkit-box",
            overflowWrap: "anywhere",
            WebkitLineClamp: sizeConfig.titleLineClamp,
            WebkitBoxOrient: "vertical",
          }}
        >
          {data.title}
        </Typography>
        {data.summary && (
          <Typography
            data-testid="workflow-inline-step-summary"
            variant="body2"
            color={data.isHighlighted ? highlightTextColor : "text.secondary"}
            sx={{
              fontSize: sizeConfig.summaryFontSize,
              lineHeight: 1.35,
              minHeight: 0,
              overflow: "hidden",
              whiteSpace: "normal",
              display: "-webkit-box",
              overflowWrap: "anywhere",
              WebkitLineClamp: sizeConfig.summaryLineClamp,
              WebkitBoxOrient: "vertical",
            }}
          >
            {renderInlineMentions(data.summary, "minimal", {
              disableLinks: data.disableLinks,
            })}
          </Typography>
        )}
      </Stack>
      {fulfilledByCount > 0 ? (
        <Box
          data-testid="workflow-inline-fulfilled-count"
          data-fulfilled-count={fulfilledByCount}
          sx={{
            position: "absolute",
            left: 8,
            bottom: 8,
            width: WORKFLOW_FULFILLED_COUNT_SIZE,
            height: WORKFLOW_FULFILLED_COUNT_SIZE,
            borderRadius: "50%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            border: (theme) => `1px solid ${theme.palette.info.dark}`,
            bgcolor: (theme) => theme.palette.info.main,
            color: (theme) => theme.palette.info.contrastText,
            boxShadow: (theme) => theme.shadows[1],
            fontSize: 12,
            fontWeight: 700,
            lineHeight: 1,
          }}
        >
          {fulfilledByCount}
        </Box>
      ) : null}
    </>
  );
};

const DIRECT_ENTITY_PREVIEW_OPEN_DELAY_MS = 300;
const DIRECT_ENTITY_PREVIEW_CLOSE_DELAY_MS = 150;

const WorkflowGraphDirectEntityLinkButton: React.FC<{
  link: WorkflowGraphRenderedEntityLink;
  expanded: boolean;
  organizationId: string;
  projectId: string;
  onMouseEnter: (
    event: React.MouseEvent<HTMLElement>,
    link: WorkflowGraphRenderedEntityLink,
  ) => void;
  onMouseLeave: () => void;
  onActivate: (
    event: React.MouseEvent<HTMLButtonElement>,
    link: WorkflowGraphRenderedEntityLink,
  ) => void;
}> = ({
  link,
  expanded,
  organizationId,
  projectId,
  onMouseEnter,
  onMouseLeave,
  onActivate,
}) => {
  const isTaskTarget = link.targetEntityType === "TASK";
  const taskQuery = useWorkItem(organizationId, "task", link.targetEntityId, {
    projectId,
    enabled: isTaskTarget && link.targetWorkItemType === undefined,
  });
  const taskType = link.targetWorkItemType ?? taskQuery.workItem?.type;
  const taskTypeQuery = useWorkItemTypeByKey(
    isTaskTarget ? organizationId : undefined,
    isTaskTarget ? projectId : undefined,
    taskType,
  );
  const taskPresentation =
    isTaskTarget && taskType && taskTypeQuery.isReady
      ? resolveWorkItemIconPresentation(
          taskType,
          taskTypeQuery.workItemTypeDefinition,
          taskTypeQuery.workItemTypeSummary?.effectiveSource,
        )
      : undefined;
  const Icon = taskPresentation?.Icon ?? link.Icon;
  const relationship = formatDiagramSemanticLabel(link.relationshipType);
  const accessibleName = `Preview ${link.targetTitle}; ${relationship}`;

  // Icons only open the preview; its title carries navigation. They never
  // navigate, so they stay enabled on editable surfaces.
  return (
    <IconButton
      size="small"
      aria-haspopup="dialog"
      aria-expanded={expanded}
      onClick={(event) => {
        event.stopPropagation();
        onActivate(event, link);
      }}
      onMouseEnter={(event) => onMouseEnter(event, link)}
      onMouseLeave={onMouseLeave}
      aria-label={accessibleName}
      data-testid="diagram-element-direct-link"
      data-target-entity-id={link.targetEntityId}
      data-target-entity-type={link.targetEntityType}
      data-target-work-item-type={taskType}
      data-relationship-type={link.relationshipType}
      sx={{
        width: 24,
        height: 24,
        p: 0.25,
        border: (theme) => `1px solid ${theme.palette.divider}`,
        bgcolor: "background.paper",
        "&:hover": { bgcolor: "action.hover" },
      }}
    >
      <Icon
        aria-hidden
        fontSize="small"
        data-testid="diagram-element-direct-link-icon"
        data-work-item-type={taskType}
      />
    </IconButton>
  );
};

const WorkflowGraphDirectEntityLinkStrip: React.FC<{
  links: readonly WorkflowGraphRenderedEntityLink[];
  organizationId: string;
  projectId: string;
}> = ({ links, organizationId, projectId }) => {
  const hasScope = Boolean(organizationId && projectId);
  const [hoveredTarget, setHoveredTarget] = useState<{
    anchorEl: HTMLElement;
    link: WorkflowGraphRenderedEntityLink;
    /** Opened by activation; hover-out does not close it. */
    pinned: boolean;
    focusOnOpen: boolean;
  } | null>(null);
  const openTimeoutRef = useRef<number | null>(null);
  const closeTimeoutRef = useRef<number | null>(null);

  const clearOpenTimeout = useCallback(() => {
    if (openTimeoutRef.current !== null) {
      window.clearTimeout(openTimeoutRef.current);
      openTimeoutRef.current = null;
    }
  }, []);

  const clearCloseTimeout = useCallback(() => {
    if (closeTimeoutRef.current !== null) {
      window.clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
  }, []);

  const handleLinkMouseEnter = useCallback(
    (
      event: React.MouseEvent<HTMLElement>,
      link: WorkflowGraphRenderedEntityLink,
    ) => {
      clearCloseTimeout();
      clearOpenTimeout();
      // Unscoped projections must not fetch previews.
      if (!hasScope) return;
      const anchorEl = event.currentTarget;
      openTimeoutRef.current = window.setTimeout(() => {
        setHoveredTarget((current) =>
          current?.pinned
            ? current
            : { anchorEl, link, pinned: false, focusOnOpen: false },
        );
        openTimeoutRef.current = null;
      }, DIRECT_ENTITY_PREVIEW_OPEN_DELAY_MS);
    },
    [clearCloseTimeout, clearOpenTimeout, hasScope],
  );

  const handleLinkMouseLeave = useCallback(() => {
    clearOpenTimeout();
    if (!hoveredTarget || hoveredTarget.pinned) return;
    clearCloseTimeout();
    closeTimeoutRef.current = window.setTimeout(() => {
      setHoveredTarget(null);
      closeTimeoutRef.current = null;
    }, DIRECT_ENTITY_PREVIEW_CLOSE_DELAY_MS);
  }, [clearCloseTimeout, clearOpenTimeout, hoveredTarget]);

  const handlePreviewMouseEnter = useCallback(() => {
    clearCloseTimeout();
  }, [clearCloseTimeout]);

  const handlePreviewMouseLeave = useCallback(() => {
    clearOpenTimeout();
    clearCloseTimeout();
    setHoveredTarget((current) => (current?.pinned ? current : null));
  }, [clearCloseTimeout, clearOpenTimeout]);

  const handleLinkActivate = useCallback(
    (
      event: React.MouseEvent<HTMLButtonElement>,
      link: WorkflowGraphRenderedEntityLink,
    ) => {
      clearOpenTimeout();
      clearCloseTimeout();
      if (!hasScope) return;
      const anchorEl = event.currentTarget;
      // Enter/Space synthesize a click with detail 0.
      const fromKeyboard = event.detail === 0;
      setHoveredTarget((current) =>
        current?.pinned && current.anchorEl === anchorEl
          ? null
          : { anchorEl, link, pinned: true, focusOnOpen: fromKeyboard },
      );
    },
    [clearCloseTimeout, clearOpenTimeout, hasScope],
  );

  const handlePreviewClose = useCallback(() => {
    clearOpenTimeout();
    clearCloseTimeout();
    if (hoveredTarget?.focusOnOpen) hoveredTarget.anchorEl.focus();
    setHoveredTarget(null);
  }, [clearCloseTimeout, clearOpenTimeout, hoveredTarget]);

  useEffect(
    () => () => {
      clearOpenTimeout();
      clearCloseTimeout();
    },
    [clearCloseTimeout, clearOpenTimeout],
  );

  if (links.length === 0) return null;

  return (
    <>
      <Stack
        direction="row"
        spacing={0.25}
        className="nodrag nopan"
        role="group"
        aria-label="Directly linked entities"
        data-testid="diagram-element-link-strip"
        sx={{
          position: "absolute",
          left: 4,
          bottom: 4,
          alignItems: "center",
          zIndex: 3,
          pointerEvents: "all",
        }}
      >
        {links.map((link) => (
          <WorkflowGraphDirectEntityLinkButton
            key={`${link.targetEntityId}:${link.relationshipType}`}
            link={link}
            expanded={
              hoveredTarget?.link.targetEntityId === link.targetEntityId &&
              hoveredTarget.link.relationshipType === link.relationshipType
            }
            organizationId={organizationId}
            projectId={projectId}
            onMouseEnter={handleLinkMouseEnter}
            onMouseLeave={handleLinkMouseLeave}
            onActivate={handleLinkActivate}
          />
        ))}
      </Stack>
      {hasScope ? (
        <EntityHoverCard
          entityId={hoveredTarget?.link.targetEntityId ?? ""}
          entityType={hoveredTarget?.link.targetEntityType ?? "task"}
          organizationId={organizationId}
          projectId={projectId}
          anchorEl={hoveredTarget?.anchorEl ?? null}
          onPopoverMouseEnter={handlePreviewMouseEnter}
          onPopoverMouseLeave={handlePreviewMouseLeave}
          titleHref={hoveredTarget?.link.href}
          onClose={handlePreviewClose}
          focusOnOpen={hoveredTarget?.focusOnOpen ?? false}
        />
      ) : null}
    </>
  );
};

const WorkflowStepNode = memo(
  ({
    id,
    data,
  }: NodeProps<Node<WorkflowStepNodeData, typeof WORKFLOW_STEP_NODE_TYPE>>) => {
    const hasTooltipContent =
      Boolean(data.description) || data.fulfilledByTargets.length > 0;
    // React Flow measures handles only on mount; edges attached to handles
    // added later (layout or routing changes) are otherwise silently dropped.
    const updateNodeInternals = useUpdateNodeInternals();
    const handleSignature = JSON.stringify(data.handles);
    useEffect(() => {
      updateNodeInternals(id);
    }, [handleSignature, id, updateNodeInternals]);

    return (
      <Tooltip
        title={
          <WorkflowFulfillmentTooltipContent
            disableLinks={data.disableLinks}
            sizeConfig={data.sizeConfig}
            sizeMode={data.sizeMode}
            title={data.title}
            description={data.description}
            targets={data.fulfilledByTargets}
          />
        }
        arrow
        placement="top"
        disableHoverListener={!hasTooltipContent}
        slotProps={{
          tooltip: {
            sx: {
              maxWidth: data.sizeConfig.tooltipMaxWidth,
              p: 1.25,
            },
          },
        }}
      >
        <Box
          className={data.isEditable ? undefined : "nodrag nopan"}
          tabIndex={data.disableLinks && data.onExpandReference ? 0 : undefined}
          onFocus={data.onSelectReference}
          onContextMenuCapture={
            data.onExpandReference
              ? (event) => {
                  event.preventDefault();
                  data.onSelectReference?.();
                }
              : undefined
          }
          onKeyDown={(event) => {
            if (
              event.key === "ContextMenu" ||
              (event.shiftKey && event.key === "F10")
            ) {
              event.preventDefault();
              data.onSelectReference?.();
            }
          }}
          onMouseEnter={() => data.onNodeHover?.(id)}
          onMouseLeave={() => data.onNodeHover?.(undefined)}
          data-testid="workflow-inline-step-frame"
          data-workflow-graph-size={data.sizeMode}
          data-diagram-role={data.diagramRole}
          data-diagram-notation={data.diagramNotation}
          sx={{
            width: data.sizeConfig.nodeSize,
            height: data.sizeConfig.nodeSize,
            pointerEvents: "all",
            "& > [data-testid='interaction-component']": {
              display: "block",
              width: "100%",
              height: "100%",
            },
            position: "relative",
          }}
        >
          {data.disableLinks ? (
            <Box
              className={data.isEditable ? undefined : "nodrag nopan"}
              data-testid="workflow-inline-step"
              data-step-id={data.entityId}
              data-step-drop-target={String(data.isDropTarget)}
              data-step-highlighted={String(data.isHighlighted)}
              data-step-created={String(data.isCreated)}
              data-step-diff={data.diffStatus ?? "unchanged"}
              data-step-presentation={data.presentationState}
              data-links-disabled="true"
              data-diagram-role={data.diagramRole}
              data-diagram-notation={data.diagramNotation}
              sx={getWorkflowStepCardSx(
                true,
                data.isDropTarget,
                data.isHighlighted,
                data.isCreated,
                data.diffStatus,
                data.presentationState,
                data.authoredColor,
                data.sizeConfig,
                data.diagramNotation,
              )}
            >
              <WorkflowStepCardContent data={data} />
            </Box>
          ) : (
            <InteractionComponent
              entityId={data.entityId}
              entityType={data.entityType}
              entitySubtype={data.entitySubtype}
              entityTitle={data.entityTitle}
              organizationId={data.organizationId}
              projectId={data.projectId}
              hasProposalSupport
              draggable={false}
              showIndicator={false}
              idScope={WORKFLOW_GRAPH_INTERACTION_SCOPE}
            >
              <Box
                className="nodrag nopan"
                component={RouterLink}
                to={data.href}
                data-testid="workflow-inline-step"
                data-step-id={data.entityId}
                data-step-drop-target={String(data.isDropTarget)}
                data-step-highlighted={String(data.isHighlighted)}
                data-step-created={String(data.isCreated)}
                data-step-diff={data.diffStatus ?? "unchanged"}
                data-step-presentation={data.presentationState}
                data-links-disabled="false"
                data-diagram-role={data.diagramRole}
                data-diagram-notation={data.diagramNotation}
                sx={getWorkflowStepCardSx(
                  false,
                  data.isDropTarget,
                  data.isHighlighted,
                  data.isCreated,
                  data.diffStatus,
                  data.presentationState,
                  data.authoredColor,
                  data.sizeConfig,
                  data.diagramNotation,
                )}
              >
                <WorkflowStepCardContent data={data} />
              </Box>
            </InteractionComponent>
          )}
          <WorkflowGraphDirectEntityLinkStrip
            links={data.directEntityLinks}
            organizationId={data.organizationId}
            projectId={data.projectId}
          />
          {data.diagramRoleKey === "DIAGRAM_REFERENCE" && data.referenceIcon ? (
            <DiagramReferenceActions
              Icon={data.referenceIcon}
              href={
                !data.disableLinks &&
                data.canonicalReference?.entityType === TargetEntityType.Task &&
                !data.canonicalReference.entityId.startsWith("temporary:")
                  ? getPathService().task({
                      projectId: data.projectId,
                      taskId: data.canonicalReference.entityId,
                    })
                  : undefined
              }
              selected={Boolean(data.referenceSelected)}
              onExplore={data.onExpandReference}
            />
          ) : null}
          {data.diagramRoleKey !== "DIAGRAM_REFERENCE" &&
          data.canonicalReference &&
          !data.disableLinks ? (
            <Stack
              direction="row"
              className="nodrag nopan"
              sx={{
                position: "absolute",
                bottom: 0,
                left: 0,
                right: 0,
                justifyContent: "center",
                bgcolor: "background.paper",
              }}
            >
              <Tooltip title="Open reference">
                <IconButton
                  size="small"
                  component={RouterLink}
                  to={
                    data.canonicalReference.entityType === TargetEntityType.Task
                      ? getPathService().task({
                          projectId: data.projectId,
                          taskId: data.canonicalReference.entityId,
                        })
                      : getPathService().service({
                          projectId: data.projectId,
                          serviceId: data.canonicalReference.entityId,
                        })
                  }
                  aria-label="Open reference"
                  data-testid="diagram-reference-open"
                >
                  <OpenInNewIcon sx={{ fontSize: "1rem" }} />
                </IconButton>
              </Tooltip>
              {data.onExpandReference ? (
                <Button
                  size="small"
                  onClick={data.onExpandReference}
                  data-testid="diagram-reference-expand"
                >
                  Expand
                </Button>
              ) : null}
            </Stack>
          ) : null}
        </Box>
      </Tooltip>
    );
  },
);

WorkflowStepNode.displayName = "WorkflowStepNode";

const workflowNodeTypes = {
  [WORKFLOW_STEP_NODE_TYPE]: WorkflowStepNode,
} as const;

const workflowEdgeTypes = {
  [WORKFLOW_FLOW_EDGE_TYPE]: WorkflowFlowEdge,
} as const;

const getGraphTestIdPrefix = (
  variant: WorkflowGraphSurfaceVariant,
): "workflow-inline-diagram" | "workflow-fullscreen-diagram" =>
  variant === "fullscreen"
    ? "workflow-fullscreen-diagram"
    : "workflow-inline-diagram";

const WorkflowGraphTitle: React.FC<WorkflowGraphTitleProps> = ({
  graphData,
  testId,
  workflowHref,
}) => (
  <Typography
    variant="subtitle2"
    fontWeight={700}
    component={workflowHref ? RouterLink : "span"}
    to={workflowHref}
    data-testid={testId}
    data-entity-id={graphData.workflow.id}
    data-entity-type="workflow"
    data-entity-subtype={graphData.workflow.type}
    className="nodrag nopan"
    sx={{
      minWidth: 0,
      color: workflowHref ? "primary.main" : "text.primary",
      textDecoration: "none",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
      ...(workflowHref
        ? {
            "&:hover": { textDecoration: "underline" },
            "&:focus-visible": {
              outline: (theme) => `2px solid ${theme.palette.primary.main}`,
              outlineOffset: 2,
            },
          }
        : {}),
    }}
  >
    {graphData.workflow.name}
  </Typography>
);

const WorkflowGraphControls: React.FC<{
  disabled: boolean;
  graphSizeMode: WorkflowGraphSizeMode;
  showFullscreenToggle: boolean;
  testIdPrefix: "workflow-inline-diagram" | "workflow-fullscreen-diagram";
  onFitToView: () => void;
  onSizeModeChange: (sizeMode: WorkflowGraphSizeMode) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onOpenFullscreen?: () => void;
}> = ({
  disabled,
  graphSizeMode,
  showFullscreenToggle,
  testIdPrefix,
  onFitToView,
  onSizeModeChange,
  onZoomIn,
  onZoomOut,
  onOpenFullscreen,
}) => (
  <Stack
    direction="row"
    spacing={0.5}
    alignItems="center"
    sx={{ display: "flex" }}
  >
    <ToggleButtonGroup
      exclusive
      size="small"
      value={graphSizeMode}
      onChange={(_event, nextMode: WorkflowGraphSizeMode | null) => {
        if (nextMode) {
          onSizeModeChange(nextMode);
        }
      }}
      aria-label="Workflow graph display size"
      data-testid={`${testIdPrefix}-size-controls`}
      sx={{
        mr: 0.5,
        "& .MuiToggleButton-root": {
          minWidth: 30,
          px: 0.75,
          py: 0.25,
          typography: "caption",
          fontWeight: 700,
        },
      }}
    >
      {WORKFLOW_GRAPH_SIZE_MODES.map((sizeMode) => (
        <ToggleButton
          key={sizeMode}
          value={sizeMode}
          disabled={disabled}
          aria-label={`${sizeMode} workflow graph display size`}
          data-testid={`${testIdPrefix}-size-${sizeMode}`}
        >
          {WORKFLOW_GRAPH_SIZE_LABELS[sizeMode]}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
    <Tooltip title="Zoom out">
      <span>
        <IconButton
          size="small"
          onClick={onZoomOut}
          disabled={disabled}
          data-testid={`${testIdPrefix}-zoom-out`}
        >
          <ZoomOutIcon fontSize="small" />
        </IconButton>
      </span>
    </Tooltip>
    <Tooltip title="Zoom in">
      <span>
        <IconButton
          size="small"
          onClick={onZoomIn}
          disabled={disabled}
          data-testid={`${testIdPrefix}-zoom-in`}
        >
          <ZoomInIcon fontSize="small" />
        </IconButton>
      </span>
    </Tooltip>
    <Tooltip title="Fit to view">
      <span>
        <IconButton
          size="small"
          onClick={onFitToView}
          disabled={disabled}
          data-testid={`${testIdPrefix}-fit-to-view`}
          aria-label="Fit to view"
        >
          <FitScreenIcon fontSize="small" />
        </IconButton>
      </span>
    </Tooltip>
    {showFullscreenToggle && onOpenFullscreen ? (
      <Tooltip title="Open fullscreen">
        <span>
          <IconButton
            size="small"
            onClick={onOpenFullscreen}
            disabled={disabled}
            data-testid={`${testIdPrefix}-open-fullscreen`}
          >
            <OpenInFullIcon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>
    ) : null}
  </Stack>
);

const WorkflowGraphViewportController: React.FC<
  WorkflowGraphViewportControllerProps
> = ({ enableInitialFit, hasGraphNodes, onReady, open }) => {
  const reactFlow = useReactFlow<WorkflowGraphNode, WorkflowGraphEdge>();
  const nodesInitialized = useNodesInitialized({
    includeHiddenNodes: false,
  });
  const viewportInitialized = reactFlow.viewportInitialized;
  const readyInstanceRef = useRef<WorkflowGraphFlowInstance | null>(null);

  useEffect(() => {
    if (readyInstanceRef.current === reactFlow) {
      return;
    }
    readyInstanceRef.current = reactFlow;
    onReady(reactFlow);
  }, [onReady, reactFlow]);

  useEffect(() => {
    if (
      !enableInitialFit ||
      !open ||
      !hasGraphNodes ||
      !nodesInitialized ||
      !viewportInitialized
    ) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      void reactFlow.fitView({
        duration: 0,
        padding: WORKFLOW_GRAPH_FIT_VIEW_PADDING,
      });
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [
    enableInitialFit,
    hasGraphNodes,
    nodesInitialized,
    open,
    reactFlow,
    viewportInitialized,
  ]);

  return null;
};

interface DiagramExplorationTarget {
  diagramId: string;
  displayedAnchorId: string;
}

const WorkflowGraphViewportSurface: React.FC<
  WorkflowGraphViewportSurfaceProps
> = ({
  layoutComparisonControls,
  graphData,
  projection,
  graphSizeMode,
  disableLinks,
  highlightedStepId,
  highlightedEdgeId,
  hoveredNodeId,
  onNodeHover,
  onEdgeMouseEnter,
  onEdgeMouseLeave,
  onViewportPointerLeave,
  createdElements,
  diffElements,
  presentationState = DEFAULT_WORKFLOW_GRAPH_PRESENTATION_STATE,
  workflowHref,
  variant,
  allowFullscreen = false,
  onOpenFullscreen,
  onSizeModeChange,
  open = true,
  onExpandReference,
  interaction,
  directEntityLinks,
}) => {
  const reactFlowId = `workflow-graph-${useId().replace(/:/g, "")}`;
  const theme = useTheme();
  const [reactFlowInstance, setReactFlowInstance] =
    useState<WorkflowGraphFlowInstance | null>(null);
  const viewportElementRef = useRef<HTMLDivElement | null>(null);
  const [viewportWidth, setViewportWidth] = useState<number>();
  const canEdit = interaction?.mode === "edit";
  const [selectedReferenceId, setSelectedReferenceId] = useState<string>();
  const authoredPositions = useMemo(() => {
    if (projection) {
      if (projection.layoutSource === "canonical") return undefined;
      return new Map(
        projection.effectiveLayout.nodes.map(({ node, position }) => [
          workItemIdentityKey(node),
          position,
        ]),
      );
    }
    if (!graphData.layout) {
      return undefined;
    }
    return new Map(
      graphData.layout.nodes.flatMap(({ node, position }) =>
        node.kind === "persistedWorkItem"
          ? [[node.workItemId, position] as const]
          : [],
      ),
    );
  }, [graphData.layout, projection]);
  const reconnectableEdgeIds = useMemo(
    () =>
      new Set(
        (interaction?.reconnectableRelationships ?? []).map(
          relationshipIdentityKey,
        ),
      ),
    [interaction?.reconnectableRelationships],
  );
  const createdNodeIds = useMemo(
    () =>
      new Set(
        (createdElements?.children ?? []).map((identity) =>
          workItemIdentityKey(identity),
        ),
      ),
    [createdElements?.children],
  );
  const createdEdgeIds = useMemo(
    () =>
      new Set(
        (createdElements?.relationships ?? []).map((identity) =>
          relationshipIdentityKey(identity),
        ),
      ),
    [createdElements?.relationships],
  );
  const diffStatusByNodeId = useMemo(() => {
    const statuses = new Map<string, WorkflowGraphDiffStatus>();
    (["changed", "added", "deleted"] as const).forEach((status) => {
      diffElements?.[status].children.forEach((identity) => {
        statuses.set(workItemIdentityKey(identity), status);
      });
    });
    return statuses;
  }, [diffElements]);
  const diffStatusByEdgeId = useMemo(() => {
    const statuses = new Map<string, WorkflowGraphDiffStatus>();
    (["changed", "added", "deleted"] as const).forEach((status) => {
      diffElements?.[status].relationships.forEach((identity) => {
        statuses.set(relationshipIdentityKey(identity), status);
      });
    });
    return statuses;
  }, [diffElements]);
  const buildModel = useCallback(
    (
      positions: WorkflowGraphModelOptions["authoredPositions"],
      editable: boolean,
    ) =>
      buildWorkflowGraphModel(graphData, {
        authoredPositions: positions,
        disableLinks,
        editable,
        highlightedStepId,
        highlightedEdgeId,
        hoveredNodeId,
        sizeMode: graphSizeMode,
        viewportWidth,
        reconnectableEdgeIds,
        createdNodeIds,
        createdEdgeIds,
        createdEdgeColor: theme.palette.success.main,
        presentationState,
        diffStatusByNodeId,
        diffStatusByEdgeId,
        diffEdgeColors: {
          added: theme.palette.success.main,
          changed: theme.palette.success.main,
          deleted: theme.palette.error.main,
        },
        onExpandReference,
        directEntityLinks,
      }),
    [
      disableLinks,
      graphData,
      graphSizeMode,
      highlightedEdgeId,
      hoveredNodeId,
      highlightedStepId,
      reconnectableEdgeIds,
      createdNodeIds,
      createdEdgeIds,
      presentationState,
      diffStatusByEdgeId,
      diffStatusByNodeId,
      directEntityLinks,
      theme.palette.success.main,
      theme.palette.error.main,
      viewportWidth,
      onExpandReference,
    ],
  );
  const baseGraphModel = useMemo(
    () => buildModel(authoredPositions, canEdit),
    [authoredPositions, buildModel, canEdit],
  );
  const preserveAuthoredLayout =
    Boolean(authoredPositions?.size) &&
    !layoutComparisonControls.previewRequested;
  const diagramGroups = useMemo(() => getDiagramGroups(graphData), [graphData]);
  const comparison = useDiagramLayoutComparison(
    {
      ...diagramLayoutGroupsFor(
        diagramGroups,
        baseGraphModel.nodes.flatMap((node) =>
          node.type === WORKFLOW_STEP_NODE_TYPE ? [node.id] : [],
        ),
      ),
      nodes: baseGraphModel.nodes.flatMap((node) =>
        node.type === WORKFLOW_STEP_NODE_TYPE
          ? [
              {
                id: node.id,
                title: node.data.title,
                width: node.data.sizeConfig.nodeSize,
                height: node.data.sizeConfig.nodeSize,
              },
            ]
          : [],
      ),
      edges: baseGraphModel.edges.map((edge) => ({
        source: edge.source,
        target: edge.target,
        label:
          edge.type === WORKFLOW_FLOW_EDGE_TYPE ? (edge.data?.label ?? "") : "",
      })),
    },
    preserveAuthoredLayout
      ? undefined
      : layoutComparisonControls.previewRequested
        ? layoutComparisonControls.candidate
        : layoutComparisonControls.automaticCandidate,
    layoutComparisonControls.previewRequested
      ? layoutComparisonControls.direction
      : layoutComparisonControls.automaticDirection,
  );
  const isPreview =
    comparison.active && layoutComparisonControls.previewRequested;
  const isEditing = canEdit && !isPreview;
  const onLayoutPreviewChange = interaction?.onLayoutPreviewChange;
  useEffect(() => {
    onLayoutPreviewChange?.(isPreview);
  }, [isPreview, onLayoutPreviewChange]);
  // Only saved positions or the selected engine's arrangement are displayed.
  // Without saved positions, nothing renders until the engine is ready.
  const isArranging =
    comparison.active && !comparison.positions && !authoredPositions?.size;
  const graphModel = useMemo(
    () =>
      comparison.positions
        ? buildModel(comparison.positions, isEditing)
        : isArranging
          ? { ...baseGraphModel, nodes: [], edges: [] }
          : comparison.active
            ? buildModel(authoredPositions, isEditing)
            : baseGraphModel,
    [
      authoredPositions,
      baseGraphModel,
      buildModel,
      comparison.active,
      comparison.positions,
      isArranging,
      isEditing,
    ],
  );
  const testIdPrefix = getGraphTestIdPrefix(variant);
  const hasGraphNodes = graphModel.nodes.length > 0;
  const isFullscreen = variant === "fullscreen";
  const canCreateEmptyCanvas =
    isEditing && Boolean(interaction?.onEmptyCanvasContextMenu);
  const startsFitToView = isFullscreen;
  const [dragTargetStepId, setDragTargetStepId] = useState<
    string | undefined
  >();
  const [blockingConnectionGesture, setBlockingConnectionGesture] = useState<
    "movement" | "reconnection" | undefined
  >();
  const allowConnections = Boolean(interaction?.allowConnections);
  const connectingSourceIdRef = useRef<string | null>(null);
  const reconnectingRef = useRef(false);
  const reconnectSucceededRef = useRef(false);
  const draggingNodeRef = useRef(false);
  const [surfaceNodes, setSurfaceNodes] = useState(graphModel.nodes);
  // Nodes first appear once the engine arranges them; adopt them in the same
  // render so the canvas never commits an empty frame.
  if (surfaceNodes.length === 0 && graphModel.nodes.length > 0) {
    setSurfaceNodes(graphModel.nodes);
  }
  useEffect(() => {
    if (!draggingNodeRef.current) {
      setSurfaceNodes((currentNodes) => {
        const currentById = new Map(
          currentNodes.map((node) => [node.id, node]),
        );
        return graphModel.nodes.map((node) => {
          const current = currentById.get(node.id);
          if (
            !current ||
            current.type !== node.type ||
            current.data.sizeMode !== node.data.sizeMode
          ) {
            return node;
          }
          // Presentation updates must retain React Flow's measured dimensions.
          // Dropping them removes the edge paths until nodes are remeasured,
          // exposing the pane beneath the pointer and ending edge hover.
          return { ...node, measured: current.measured };
        });
      });
    }
  }, [graphModel.nodes]);
  const identitiesByNodeId = useMemo(
    () =>
      new Map(
        (projection?.children ?? []).map((child) => [
          workItemIdentityKey(child.identity),
          child.identity,
        ]),
      ),
    [projection],
  );
  const relationshipIdentitiesByEdgeId = useMemo(
    () =>
      new Map(
        (projection?.incidentRelationships ?? []).map((relationship) => [
          relationshipIdentityKey(relationship.identity),
          relationship.identity,
        ]),
      ),
    [projection],
  );
  const interactiveEdges = useMemo(
    () =>
      graphModel.edges.map((edge) => ({
        ...edge,
        ...(edge.type !== WORKFLOW_FLOW_EDGE_TYPE
          ? {}
          : {
              data: {
                ...edge.data,
                onHoverStart: () => onEdgeMouseEnter?.(edge.id),
                onHoverEnd: () => onEdgeMouseLeave?.(edge.id),
              },
            }),
      })),
    [graphModel.edges, onEdgeMouseEnter, onEdgeMouseLeave],
  );
  const boundaryNodeRects = useMemo(
    () =>
      new Map(
        surfaceNodes.flatMap((node) =>
          node.type === WORKFLOW_STEP_NODE_TYPE && !node.hidden
            ? [
                [
                  node.id,
                  {
                    x: node.position.x,
                    y: node.position.y,
                    width:
                      node.measured?.width ??
                      node.width ??
                      node.data.sizeConfig.nodeSize,
                    height:
                      node.measured?.height ??
                      node.height ??
                      node.data.sizeConfig.nodeSize,
                  },
                ] as const,
              ]
            : [],
        ),
      ),
    [surfaceNodes],
  );
  const boundaryBoxes = useMemo(
    () =>
      diagramGroups.length === 0
        ? []
        : computeBoundaryBoxes(
            diagramGroups,
            [...boundaryNodeRects].map(([id, rect]) => ({ id, ...rect })),
          ),
    [boundaryNodeRects, diagramGroups],
  );
  const interactiveNodes = useMemo(
    () =>
      surfaceNodes.map((node) => {
        if (node.type !== WORKFLOW_STEP_NODE_TYPE) {
          return node;
        }
        const isDropTarget = node.id === dragTargetStepId;
        const canStartConnection =
          allowConnections && blockingConnectionGesture === undefined;
        return {
          ...node,
          data: {
            ...node.data,
            isDropTarget,
            onNodeHover,
            canStartConnection,
            referenceSelected:
              node.id === selectedReferenceId || Boolean(node.selected),
            onSelectReference: () => setSelectedReferenceId(node.id),
          },
        };
      }),
    [
      allowConnections,
      blockingConnectionGesture,
      dragTargetStepId,
      surfaceNodes,
      onNodeHover,
      selectedReferenceId,
    ],
  );

  useEffect(() => {
    const viewportElement = viewportElementRef.current;
    if (!viewportElement) {
      return;
    }

    const updateViewportWidth = (width: number): void => {
      if (width > 0) {
        setViewportWidth((currentWidth) =>
          currentWidth === width ? currentWidth : width,
        );
      }
    };
    updateViewportWidth(viewportElement.clientWidth);

    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const resizeObserver = new ResizeObserver(([entry]) => {
      if (entry) {
        updateViewportWidth(entry.contentRect.width);
      }
    });
    resizeObserver.observe(viewportElement);
    return () => {
      resizeObserver.disconnect();
    };
  }, [open]);

  const onVisibleCanvasPositionChange =
    interaction?.onVisibleCanvasPositionChange;
  const publishVisibleCanvasPosition = useCallback(() => {
    const viewportElement = viewportElementRef.current;
    if (!viewportElement || !reactFlowInstance) {
      return;
    }
    const position = getVisibleCanvasCenter(
      viewportElement,
      reactFlowInstance.screenToFlowPosition,
    );
    if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) {
      return;
    }
    onVisibleCanvasPositionChange?.(position);
  }, [onVisibleCanvasPositionChange, reactFlowInstance]);

  useEffect(() => {
    publishVisibleCanvasPosition();
  }, [open, publishVisibleCanvasPosition, viewportWidth]);

  const resolveGestureTarget = useCallback(
    (point: { x: number; y: number }): WorkflowGraphNode | undefined => {
      if (!reactFlowInstance) {
        return undefined;
      }
      const position = reactFlowInstance.screenToFlowPosition(point);
      return reactFlowInstance.getIntersectingNodes({
        x: position.x,
        y: position.y,
        width: 1,
        height: 1,
      })[0];
    },
    [reactFlowInstance],
  );

  const handleNodeContextMenu = useCallback(
    (event: React.MouseEvent, node: WorkflowGraphNode) => {
      if (
        node.type === WORKFLOW_STEP_NODE_TYPE &&
        node.data.onExpandReference
      ) {
        event.preventDefault();
        setSelectedReferenceId(node.id);
      }
      const onNodeContextMenu = interaction?.onNodeContextMenu;
      if (
        !isEditing ||
        !reactFlowInstance ||
        !onNodeContextMenu ||
        node.type !== WORKFLOW_STEP_NODE_TYPE
      ) {
        return;
      }
      const child = identitiesByNodeId.get(node.id);
      if (!child) {
        return;
      }
      const menu = resolveNodeContextMenu({
        child,
        position: reactFlowInstance.screenToFlowPosition({
          x: event.clientX,
          y: event.clientY,
        }),
        menuPosition: { x: event.clientX, y: event.clientY },
        allowContextMenu: true,
      });
      if (!menu) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      onNodeContextMenu(menu);
    },
    [identitiesByNodeId, interaction, isEditing, reactFlowInstance],
  );

  const handlePaneContextMenu = useCallback(
    (event: MouseEvent | React.MouseEvent) => {
      const onEmptyCanvasContextMenu = interaction?.onEmptyCanvasContextMenu;
      if (!isEditing || !reactFlowInstance || !onEmptyCanvasContextMenu) {
        return;
      }
      const menu = resolveEmptyCanvasContextMenu({
        position: reactFlowInstance.screenToFlowPosition({
          x: event.clientX,
          y: event.clientY,
        }),
        menuPosition: { x: event.clientX, y: event.clientY },
        allowContextMenu: true,
      });
      if (!menu) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      onEmptyCanvasContextMenu(menu);
    },
    [interaction, isEditing, reactFlowInstance],
  );

  const updateGestureTarget = useCallback(
    (point: { x: number; y: number }) => {
      if (!reconnectingRef.current && connectingSourceIdRef.current === null) {
        return;
      }
      const targetId = resolveGestureTarget(point)?.id;
      setDragTargetStepId((current) =>
        current === targetId ? current : targetId,
      );
    },
    [resolveGestureTarget],
  );

  const fitGraphToViewport = useCallback(() => {
    if (!reactFlowInstance || !hasGraphNodes) {
      return;
    }

    if (!isFullscreen) {
      const viewportElement = viewportElementRef.current;
      const width = viewportElement?.clientWidth ?? 0;
      const height = viewportElement?.clientHeight ?? 0;

      if (width > 0 && height > 0) {
        const bounds = getNodesBounds(graphModel.nodes);
        const nextViewport = getViewportForBounds(
          bounds,
          width,
          height,
          WORKFLOW_GRAPH_MIN_ZOOM,
          WORKFLOW_GRAPH_MAX_ZOOM,
          WORKFLOW_GRAPH_FIT_VIEW_PADDING,
        );

        void reactFlowInstance.setViewport(nextViewport, {
          duration: 0,
        });
        return;
      }
    }

    void reactFlowInstance.fitView({
      duration: 0,
      padding: WORKFLOW_GRAPH_FIT_VIEW_PADDING,
    });
  }, [graphModel.nodes, hasGraphNodes, isFullscreen, reactFlowInstance]);

  const zoomIn = useCallback(() => {
    if (!reactFlowInstance) {
      return;
    }

    void reactFlowInstance.zoomIn({ duration: 150 });
  }, [reactFlowInstance]);

  const zoomOut = useCallback(() => {
    if (!reactFlowInstance) {
      return;
    }

    void reactFlowInstance.zoomOut({ duration: 150 });
  }, [reactFlowInstance]);

  return (
    <Box
      data-testid={testIdPrefix}
      data-workflow-id={graphData.workflow.id}
      data-workflow-graph-size={graphSizeMode}
      data-workflow-layout={graphModel.layoutMode}
      data-layout-candidate={comparison.candidate}
      data-workflow-view-mode={
        isArranging
          ? "arranging"
          : hasGraphNodes
            ? startsFitToView
              ? "fit-to-view"
              : "natural-size"
            : "empty"
      }
      sx={{
        display: "flex",
        flexDirection: "column",
        border: (theme) => `1px solid ${theme.palette.divider}`,
        borderRadius: 1,
        my: isFullscreen ? 0 : 1,
        bgcolor: "background.default",
        overflow: "hidden",
        width: "100%",
        height: isFullscreen ? "100%" : "auto",
        maxWidth: "none",
      }}
    >
      <Stack
        direction="row"
        spacing={1}
        alignItems="center"
        sx={{
          display: "flex",
          px: 1.5,
          py: 1,
          borderBottom: (theme) => `1px solid ${theme.palette.divider}`,
          bgcolor: "background.paper",
        }}
      >
        <AccountTreeIcon color="primary" sx={{ fontSize: 20 }} />
        <WorkflowGraphTitle
          graphData={graphData}
          testId={`${testIdPrefix}-title-link`}
          workflowHref={workflowHref}
        />
        <Stack
          direction="row"
          spacing={0.5}
          alignItems="center"
          sx={{ display: "flex", ml: "auto" }}
        >
          <WorkflowGraphControls
            disabled={!hasGraphNodes}
            graphSizeMode={graphSizeMode}
            showFullscreenToggle={allowFullscreen && !isFullscreen}
            testIdPrefix={testIdPrefix}
            onFitToView={fitGraphToViewport}
            onSizeModeChange={onSizeModeChange}
            onZoomIn={zoomIn}
            onZoomOut={zoomOut}
            onOpenFullscreen={onOpenFullscreen}
          />
        </Stack>
      </Stack>
      <Stack
        direction="row"
        spacing={1}
        alignItems="center"
        sx={{ px: 1.5, py: 1, flexWrap: "wrap", gap: 1 }}
        data-testid="diagram-layout-comparison"
      >
        <Typography variant="caption">Layout</Typography>
        <ToggleButtonGroup
          exclusive
          size="small"
          value={layoutComparisonControls.candidate}
          aria-label="Layout style"
        >
          {DIAGRAM_LAYOUT_CANDIDATES.map((candidate) => (
            <ToggleButton
              key={candidate.key}
              value={candidate.key}
              data-testid={candidate.testId}
              onClick={() =>
                layoutComparisonControls.onCandidateChange(candidate.key)
              }
            >
              {candidate.label}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
        <ToggleButtonGroup
          exclusive
          size="small"
          value={layoutComparisonControls.direction}
          aria-label="Layout direction"
          disabled={layoutComparisonControls.candidate === "elk-stress"}
        >
          <ToggleButton
            value="RIGHT"
            data-testid="diagram-layout-horizontal"
            onClick={() => layoutComparisonControls.onDirectionChange("RIGHT")}
          >
            Horizontal
          </ToggleButton>
          <ToggleButton
            value="DOWN"
            data-testid="diagram-layout-vertical"
            onClick={() => layoutComparisonControls.onDirectionChange("DOWN")}
          >
            Vertical
          </ToggleButton>
        </ToggleButtonGroup>
        {comparison.pending ? (
          <Typography role="status" variant="caption">
            Arranging…
          </Typography>
        ) : null}
        {isPreview ? (
          <Button
            size="small"
            data-testid="diagram-layout-cancel-preview"
            onClick={layoutComparisonControls.onPreviewCancel}
          >
            Cancel preview
          </Button>
        ) : null}
        {preserveAuthoredLayout ? (
          <Typography variant="caption">
            Saved positions · select a layout to preview
          </Typography>
        ) : null}
      </Stack>
      {graphModel.nodes.some(
        (node) =>
          node.data.diagramRoleKey === "START" ||
          node.data.diagramRoleKey === "END",
      ) ? (
        <Stack
          direction="row"
          spacing={2}
          sx={{ px: 1.5, py: 1 }}
          data-testid="diagram-legend"
        >
          <Stack direction="row" spacing={0.5} alignItems="center">
            <PlayCircleOutlineIcon fontSize="small" />
            <Typography variant="caption">
              Start: trigger entering the depicted process
            </Typography>
          </Stack>
          <Stack direction="row" spacing={0.5} alignItems="center">
            <StopCircleOutlinedIcon fontSize="small" />
            <Typography variant="caption">
              End: outcome of one path; parallel paths may continue
            </Typography>
          </Stack>
        </Stack>
      ) : null}
      {comparison.error ? (
        <Alert severity="error" data-testid="diagram-layout-error">
          {comparison.error}{" "}
          {isPreview
            ? "Cancel the preview to resume editing."
            : "Select another layout to retry."}
        </Alert>
      ) : null}
      <Box
        ref={viewportElementRef}
        data-testid={`${testIdPrefix}-viewport`}
        onPointerLeave={onViewportPointerLeave}
        onPointerCancel={onViewportPointerLeave}
        onPointerMoveCapture={(event) => {
          // Labels live outside the SVG. Reconcile their current hit target as
          // well as paths, even if the previous edge's leave event was missed.
          const target = event.target;
          const edgeId =
            target instanceof Element
              ? target
                  .closest("[data-workflow-hover-edge-id]")
                  ?.getAttribute("data-workflow-hover-edge-id")
              : undefined;
          const hoveredEdge = graphModel.edges.find(
            (edge) =>
              edge.id === edgeId && edge.type === WORKFLOW_FLOW_EDGE_TYPE,
          );
          if (hoveredEdge) {
            onEdgeMouseEnter?.(hoveredEdge.id);
          } else {
            onEdgeMouseLeave?.(highlightedEdgeId ?? "");
          }
          const nodeId =
            target instanceof Element
              ? target.closest(".react-flow__node")?.getAttribute("data-id")
              : undefined;
          onNodeHover?.(nodeId ?? undefined);
        }}
        onScroll={publishVisibleCanvasPosition}
        onPointerMove={(event) => {
          updateGestureTarget({ x: event.clientX, y: event.clientY });
        }}
        sx={{
          display: "block",
          flex: 1,
          height: isFullscreen ? "100%" : graphModel.height,
          minHeight: isFullscreen ? 0 : WORKFLOW_GRAPH_MIN_VIEWPORT_HEIGHT,
          bgcolor: (theme) =>
            theme.palette.mode === "dark"
              ? theme.palette.grey[900]
              : theme.palette.grey[100],
          overflowX: isFullscreen ? "hidden" : "auto",
          overflowY: isFullscreen
            ? "hidden"
            : graphModel.canvasHeight + WORKFLOW_GRAPH_SCROLLBAR_ALLOWANCE >
                graphModel.height
              ? "auto"
              : "hidden",
          cursor: hasGraphNodes ? "grab" : "default",
          "&:active": {
            cursor: hasGraphNodes ? "grabbing" : "default",
          },
        }}
      >
        {!isArranging && (hasGraphNodes || canCreateEmptyCanvas) ? (
          <Box
            sx={{
              position: "relative",
              width: "100%",
              minWidth: isFullscreen ? "100%" : graphModel.width,
              height: isFullscreen ? "100%" : graphModel.canvasHeight,
            }}
          >
            <ReactFlowProvider>
              <ReactFlow
                id={reactFlowId}
                key={`${variant}-${graphSizeMode}`}
                nodes={interactiveNodes}
                edges={interactiveEdges}
                nodeTypes={workflowNodeTypes}
                edgeTypes={workflowEdgeTypes}
                defaultViewport={
                  isFullscreen ? undefined : { x: 0, y: 0, zoom: 1 }
                }
                minZoom={WORKFLOW_GRAPH_MIN_ZOOM}
                maxZoom={WORKFLOW_GRAPH_MAX_ZOOM}
                nodesDraggable={
                  isEditing && Boolean(interaction?.allowNodeDragging)
                }
                nodesConnectable={isEditing && allowConnections}
                edgesReconnectable={
                  isEditing && Boolean(interaction?.allowReconnection)
                }
                elementsSelectable={isEditing}
                deleteKeyCode={null}
                onNodesChange={(changes) => {
                  setSurfaceNodes((nodes) => applyNodeChanges(changes, nodes));
                }}
                onNodeDragStart={() => {
                  draggingNodeRef.current = true;
                  setBlockingConnectionGesture("movement");
                }}
                onNodeDragStop={(_event, node) => {
                  const completion = resolveNodeDragCompletion({
                    child: identitiesByNodeId.get(node.id),
                    position: node.position,
                    allowNodeDragging: Boolean(interaction?.allowNodeDragging),
                    isConnecting: connectingSourceIdRef.current !== null,
                    isReconnecting: reconnectingRef.current,
                  });
                  if (completion) {
                    interaction?.onNodeDragStop?.(
                      completion.child,
                      completion.position,
                      surfaceNodes.flatMap(({ id, position }) => {
                        const identity = identitiesByNodeId.get(id);
                        return identity ? [{ node: identity, position }] : [];
                      }),
                    );
                  } else {
                    setSurfaceNodes(graphModel.nodes);
                  }
                  draggingNodeRef.current = false;
                  setBlockingConnectionGesture(undefined);
                }}
                onConnect={(connection: Connection) => {
                  const source = connection.source
                    ? identitiesByNodeId.get(connection.source)
                    : undefined;
                  const target = connection.target
                    ? identitiesByNodeId.get(connection.target)
                    : undefined;
                  if (source && target) {
                    interaction?.onConnect?.({ source, target });
                  }
                }}
                onReconnect={(edge, connection: Connection) => {
                  reconnectSucceededRef.current = true;
                  const relationship = relationshipIdentitiesByEdgeId.get(
                    edge.id,
                  );
                  const source = connection.source
                    ? identitiesByNodeId.get(connection.source)
                    : undefined;
                  const target = connection.target
                    ? identitiesByNodeId.get(connection.target)
                    : undefined;
                  if (relationship && source && target) {
                    interaction?.onReconnect?.({
                      relationship,
                      source,
                      target,
                    });
                  }
                }}
                onReconnectStart={() => {
                  reconnectingRef.current = true;
                  reconnectSucceededRef.current = false;
                  setBlockingConnectionGesture("reconnection");
                  setDragTargetStepId(undefined);
                }}
                onReconnectEnd={(
                  event,
                  edge,
                  stationaryEndpoint: HandleType,
                ) => {
                  const dropTargetNode = resolveGestureTarget(
                    pointerEventPoint(event),
                  );
                  reconnectingRef.current = false;
                  setBlockingConnectionGesture(undefined);
                  setDragTargetStepId(undefined);
                  if (reconnectSucceededRef.current) {
                    reconnectSucceededRef.current = false;
                    return;
                  }
                  const completion = resolveReconnectCompletion({
                    relationship: relationshipIdentitiesByEdgeId.get(edge.id),
                    currentSource: identitiesByNodeId.get(edge.source),
                    currentTarget: identitiesByNodeId.get(edge.target),
                    stationaryEndpoint,
                    dropTarget: dropTargetNode
                      ? identitiesByNodeId.get(dropTargetNode.id)
                      : undefined,
                  });
                  if (completion.kind === "reconnect") {
                    interaction?.onReconnect?.(completion.gesture);
                  }
                }}
                onSelectionChange={({ nodes, edges }) => {
                  interaction?.onSelectionChange?.({
                    children: nodes.flatMap((node) => {
                      const identity = identitiesByNodeId.get(node.id);
                      return identity ? [identity] : [];
                    }),
                    relationships: edges.flatMap((edge) => {
                      const identity = relationshipIdentitiesByEdgeId.get(
                        edge.id,
                      );
                      return identity ? [identity] : [];
                    }),
                  });
                }}
                onConnectStart={(_event, params) => {
                  connectingSourceIdRef.current = reconnectingRef.current
                    ? null
                    : params.nodeId;
                  setDragTargetStepId(undefined);
                }}
                onConnectEnd={(event, connectionState) => {
                  const sourceId = connectingSourceIdRef.current;
                  connectingSourceIdRef.current = null;
                  const dropTargetNode = resolveGestureTarget(
                    pointerEventPoint(event),
                  );
                  setDragTargetStepId(undefined);
                  const source = sourceId
                    ? identitiesByNodeId.get(sourceId)
                    : undefined;
                  const target = dropTargetNode
                    ? identitiesByNodeId.get(dropTargetNode.id)
                    : connectionState.toNode
                      ? identitiesByNodeId.get(connectionState.toNode.id)
                      : undefined;
                  const completion = resolveConnectionCompletion({
                    source,
                    target,
                    isValid: connectionState.isValid === true,
                    isReconnecting: reconnectingRef.current,
                    emptyCanvasPosition:
                      !target && reactFlowInstance
                        ? reactFlowInstance.screenToFlowPosition(
                            pointerEventPoint(event),
                          )
                        : undefined,
                  });
                  if (completion.kind === "connect") {
                    interaction?.onConnect?.(completion.gesture);
                  } else if (completion.kind === "empty-canvas") {
                    interaction?.onEmptyCanvasDrop?.(completion.drop);
                  }
                }}
                onNodeContextMenu={handleNodeContextMenu}
                onPaneContextMenu={handlePaneContextMenu}
                onPaneClick={() => setSelectedReferenceId(undefined)}
                onMoveEnd={publishVisibleCanvasPosition}
                onEdgeClick={enableReadOnlyWorkflowEdgeHover}
                onEdgeMouseEnter={(_event, edge) => {
                  if (edge.type === WORKFLOW_FLOW_EDGE_TYPE) {
                    onEdgeMouseEnter?.(edge.id);
                  }
                }}
                onEdgeMouseLeave={(_event, edge) => {
                  if (edge.type === WORKFLOW_FLOW_EDGE_TYPE) {
                    onEdgeMouseLeave?.(edge.id);
                  }
                }}
                panOnDrag
                zoomOnScroll={false}
                zoomOnPinch={false}
                zoomOnDoubleClick={false}
                preventScrolling={false}
                proOptions={{ hideAttribution: true }}
              >
                {boundaryBoxes.length > 0 && (
                  <DiagramBoundaryLayer
                    boxes={boundaryBoxes}
                    nodeRects={boundaryNodeRects}
                    testIdPrefix={testIdPrefix}
                  />
                )}
                <WorkflowGraphViewportController
                  enableInitialFit={startsFitToView}
                  hasGraphNodes={hasGraphNodes}
                  onReady={setReactFlowInstance}
                  open={open}
                />
              </ReactFlow>
            </ReactFlowProvider>
            {!hasGraphNodes && (
              <Stack
                alignItems="center"
                justifyContent="center"
                sx={{
                  position: "absolute",
                  inset: 0,
                  color: "text.secondary",
                  pointerEvents: "none",
                }}
              >
                <Typography component="span" variant="body2">
                  No workflow steps
                </Typography>
              </Stack>
            )}
          </Box>
        ) : (
          <Stack
            alignItems="center"
            justifyContent="center"
            sx={{
              display: "flex",
              height: "100%",
              color: "text.secondary",
            }}
          >
            <Typography
              component="span"
              variant="body2"
              data-testid={
                isArranging ? `${testIdPrefix}-arranging` : undefined
              }
            >
              {!isArranging
                ? "No workflow steps"
                : comparison.error
                  ? "Layout unavailable"
                  : "Arranging…"}
            </Typography>
          </Stack>
        )}
      </Box>
    </Box>
  );
};

interface WorkflowGraphFullscreenDialogProps {
  layoutComparisonControls: WorkflowGraphViewportSurfaceProps["layoutComparisonControls"];
  graphData: WorkflowGraphSurfaceData;
  projection?: WorkItemGraphProjectionData;
  graphSizeMode: WorkflowGraphSizeMode;
  disableLinks: boolean;
  highlightedStepId?: string;
  highlightedEdgeId?: string;
  hoveredNodeId?: string;
  onNodeHover?: (nodeId: string | undefined) => void;
  onEdgeMouseEnter?: (edgeId: string) => void;
  onEdgeMouseLeave?: (edgeId: string) => void;
  onViewportPointerLeave?: () => void;
  createdElements?: WorkflowGraphCreatedElements;
  diffElements?: WorkflowGraphDiffElements;
  presentationState?: WorkflowGraphPresentationState;
  workflowHref?: string;
  onSizeModeChange: (sizeMode: WorkflowGraphSizeMode) => void;
  open: boolean;
  onClose: () => void;
  onExpandReference: (entityId: string) => void;
  directEntityLinks?: readonly WorkflowGraphDirectEntityLink[];
  interaction?: WorkflowGraphViewportSurfaceProps["interaction"];
}

const WorkflowGraphFullscreenDialog: React.FC<
  WorkflowGraphFullscreenDialogProps
> = ({
  layoutComparisonControls,
  graphData,
  projection,
  graphSizeMode,
  disableLinks,
  highlightedStepId,
  highlightedEdgeId,
  hoveredNodeId,
  onNodeHover,
  onEdgeMouseEnter,
  onEdgeMouseLeave,
  onViewportPointerLeave,
  createdElements,
  diffElements,
  presentationState = DEFAULT_WORKFLOW_GRAPH_PRESENTATION_STATE,
  workflowHref,
  onSizeModeChange,
  open,
  onClose,
  onExpandReference,
  directEntityLinks,
  interaction,
}) => (
  <Dialog
    open={open}
    onClose={onClose}
    fullScreen
    slotProps={{
      paper: {
        sx: {
          m: 1,
          height: WORKFLOW_GRAPH_DIALOG_HEIGHT,
          maxHeight: WORKFLOW_GRAPH_DIALOG_HEIGHT,
          display: "flex",
          flexDirection: "column",
        },
      },
    }}
    closeControl={
      <IconButton
        size="small"
        onClick={onClose}
        aria-label="Close workflow viewer"
        data-testid="workflow-fullscreen-dialog-close"
      >
        <CloseIcon fontSize="small" />
      </IconButton>
    }
  >
    <DialogTitle
      data-testid="workflow-fullscreen-dialog-title"
      sx={{
        py: 1,
        px: 2,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 1,
      }}
    >
      <WorkflowGraphTitle
        graphData={graphData}
        testId="workflow-fullscreen-dialog-title-link"
        workflowHref={workflowHref}
      />
    </DialogTitle>
    <DialogContent
      dividers
      sx={{
        p: 1,
        overflow: "hidden",
        flex: 1,
        minHeight: 0,
      }}
    >
      <WorkflowGraphViewportSurface
        layoutComparisonControls={layoutComparisonControls}
        graphData={graphData}
        projection={projection}
        graphSizeMode={graphSizeMode}
        disableLinks={disableLinks}
        highlightedStepId={highlightedStepId}
        highlightedEdgeId={highlightedEdgeId}
        hoveredNodeId={hoveredNodeId}
        onNodeHover={onNodeHover}
        onEdgeMouseEnter={onEdgeMouseEnter}
        onEdgeMouseLeave={onEdgeMouseLeave}
        onViewportPointerLeave={onViewportPointerLeave}
        createdElements={createdElements}
        diffElements={diffElements}
        presentationState={presentationState}
        workflowHref={workflowHref}
        variant="fullscreen"
        interaction={interaction}
        onSizeModeChange={onSizeModeChange}
        open={open}
        onExpandReference={onExpandReference}
        directEntityLinks={directEntityLinks}
      />
    </DialogContent>
  </Dialog>
);

const DiagramExplorationDialog: React.FC<{
  organizationId: string;
  projectId: string;
  target: DiagramExplorationTarget | null;
  ancestors: readonly string[];
  onClose: () => void;
}> = ({ organizationId, projectId, target, ancestors, onClose }) => {
  const diagramId = target?.diagramId ?? null;
  const repeated = diagramId !== null && ancestors.includes(diagramId);
  const graph = useWorkItemGraph(
    organizationId,
    projectId,
    diagramId ?? undefined,
    {
      enabled: diagramId !== null && !repeated,
      incidentRelationshipTypes: ["GUARANTEES", "IMPLEMENTS", "CONSUMES"],
    },
  );
  const workflowType = useWorkItemTypeByKey(
    organizationId,
    projectId,
    graph.data?.root.type,
  );
  const elementType = useWorkItemTypeByKey(
    organizationId,
    projectId,
    workflowType.workItemTypeDefinition?.capabilities?.graph?.nodeChildType,
  );
  const aggregate = graph.data;
  const graphData = aggregate
    ? {
        workflow: aggregate.root,
        steps: aggregate.children.filter(
          (child) => child.type.toUpperCase() === "DIAGRAM_ELEMENT",
        ),
        edges: aggregate.relationships,
        participation: aggregate.participation,
        layout: aggregate.layout,
        workflowTypeDefinition: workflowType.workItemTypeDefinition,
        nodeTypeDefinition: elementType.workItemTypeDefinition,
      }
    : null;
  return (
    <Dialog open={diagramId !== null} onClose={onClose} fullScreen>
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <Button onClick={onClose} data-testid="diagram-exploration-return">
          Return
        </Button>
        <Typography component="span" variant="h6">
          Explore Diagram
        </Typography>
      </DialogTitle>
      <DialogContent dividers>
        {repeated ? (
          <Alert severity="warning" data-testid="diagram-exploration-cycle">
            This Diagram is already in the exploration path and cannot be
            expanded again.
          </Alert>
        ) : graph.error ||
          workflowType.error ||
          elementType.error ||
          (graph.isFetched &&
            !graph.isFetching &&
            (!graphData ||
              graphData.workflow.type.toUpperCase() !== "DIAGRAM")) ? (
          <Alert severity="error" data-testid="diagram-exploration-unavailable">
            The referenced Diagram is unavailable.
          </Alert>
        ) : !graph.isFetched ||
          graph.isFetching ||
          (graph.data &&
            (!workflowType.isFetched || !elementType.isFetched)) ? (
          <Skeleton height={240} data-testid="diagram-exploration-loading" />
        ) : graph.error ||
          workflowType.error ||
          elementType.error ||
          !graphData ||
          graphData.workflow.type.toUpperCase() !== "DIAGRAM" ? (
          <Alert severity="error" data-testid="diagram-exploration-unavailable">
            The referenced Diagram is unavailable.
          </Alert>
        ) : (
          <WorkflowGraphSurface
            graphData={graphData}
            allowFullscreen
            highlightedStepId={target?.displayedAnchorId}
            explorationAncestors={[...ancestors, graphData.workflow.id]}
          />
        )}
      </DialogContent>
    </Dialog>
  );
};

export const WorkflowGraphSurface: React.FC<WorkflowGraphSurfaceProps> = ({
  graphData,
  projection,
  allowFullscreen = false,
  disableLinks = false,
  highlightedStepId,
  createdElements,
  diffElements,
  presentationState = DEFAULT_WORKFLOW_GRAPH_PRESENTATION_STATE,
  organizationId,
  projectId,
  mode = "view",
  explorationAncestors,
  participation,
  directEntityLinks,
  ...interaction
}) => {
  const hasRouter = useInRouterContext();
  const [isFullscreenOpen, setIsFullscreenOpen, isFullscreenOpenOwnerKey] =
    useModalState(false);
  const [graphSizeMode, setGraphSizeMode] = useState<WorkflowGraphSizeMode>(
    DEFAULT_WORKFLOW_GRAPH_SIZE_MODE,
  );
  const [highlightedEdgeId, setHighlightedEdgeId] = useState<string>();
  const [hoveredNodeId, setHoveredNodeId] = useState<string>();
  const explorationReturnFocus = useRef<HTMLElement | null>(null);
  const openExploration = useCallback((diagramId: string) => {
    explorationReturnFocus.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setExplorationTarget({ diagramId, displayedAnchorId: diagramId });
  }, []);
  const [explorationTarget, setExplorationTarget] =
    useState<DiagramExplorationTarget | null>(null);
  useEffect(() => {
    if (explorationTarget) return;
    explorationReturnFocus.current?.focus();
    explorationReturnFocus.current = null;
  }, [explorationTarget]);
  const handleEdgeMouseEnter = useCallback((edgeId: string) => {
    setHighlightedEdgeId(edgeId);
    setHoveredNodeId(undefined);
  }, []);
  const handleEdgeMouseLeave = useCallback((edgeId: string) => {
    setHighlightedEdgeId((current) =>
      current === edgeId ? undefined : current,
    );
  }, []);
  const handleViewportPointerLeave = useCallback(() => {
    setHighlightedEdgeId(undefined);
    setHoveredNodeId(undefined);
  }, []);
  const resolvedGraphData = useMemo(
    () =>
      graphData ??
      (projection
        ? projectWorkItemGraph(
            projection,
            organizationId && projectId ? { organizationId, projectId } : null,
            {
              includeDeleted: Boolean(diffElements),
            },
          )
        : undefined),
    [diffElements, graphData, organizationId, projectId, projection],
  );

  const needsDiagramDefinitions =
    resolvedGraphData?.workflow.type.toUpperCase() === "DIAGRAM";
  const rootDefinition = useWorkItemTypeByKey(
    needsDiagramDefinitions
      ? resolvedGraphData?.workflow.organizationId
      : undefined,
    needsDiagramDefinitions ? resolvedGraphData?.workflow.projectId : undefined,
    needsDiagramDefinitions && !resolvedGraphData?.workflowTypeDefinition
      ? resolvedGraphData?.workflow.type
      : undefined,
  );
  const elementDefinition = useWorkItemTypeByKey(
    needsDiagramDefinitions
      ? resolvedGraphData?.workflow.organizationId
      : undefined,
    needsDiagramDefinitions ? resolvedGraphData?.workflow.projectId : undefined,
    needsDiagramDefinitions && !resolvedGraphData?.nodeTypeDefinition
      ? ((
          resolvedGraphData?.workflowTypeDefinition ??
          rootDefinition.workItemTypeDefinition
        )?.capabilities?.graph?.nodeChildType ??
          resolvedGraphData?.steps[0]?.type)
      : undefined,
  );
  const graphDataWithParticipation = useMemo(
    () =>
      resolvedGraphData
        ? {
            ...resolvedGraphData,
            workflowTypeDefinition:
              resolvedGraphData.workflowTypeDefinition ??
              rootDefinition.workItemTypeDefinition,
            nodeTypeDefinition:
              resolvedGraphData.nodeTypeDefinition ??
              elementDefinition.workItemTypeDefinition,
            ...(participation !== undefined ? { participation } : {}),
          }
        : undefined,
    [
      participation,
      resolvedGraphData,
      rootDefinition.workItemTypeDefinition,
      elementDefinition.workItemTypeDefinition,
    ],
  );

  const hydratedGraphData = useMemo(
    () =>
      graphDataWithParticipation
        ? hydrateWorkflowGraphEdges(graphDataWithParticipation)
        : undefined,
    [graphDataWithParticipation],
  );
  const layoutComparisonControls = useDiagramLayoutPreference(
    hydratedGraphData
      ? {
          organizationId: hydratedGraphData.workflow.organizationId,
          projectId: hydratedGraphData.workflow.projectId,
          diagramId: hydratedGraphData.workflow.id,
        }
      : undefined,
  );
  if (
    !hydratedGraphData ||
    !(projection
      ? hasProjectedWorkflowIdentity(hydratedGraphData.workflow)
      : hasWorkflowIdentity(hydratedGraphData.workflow))
  ) {
    return <WorkflowGraphUnavailable />;
  }
  const workflowHref = projection
    ? undefined
    : buildWorkflowHref(hydratedGraphData.workflow);
  const resolvedDisableLinks =
    disableLinks || (Boolean(projection) && (!organizationId || !projectId));

  const content = (
    <>
      <WorkflowGraphViewportSurface
        layoutComparisonControls={layoutComparisonControls}
        graphData={hydratedGraphData}
        projection={projection}
        graphSizeMode={graphSizeMode}
        disableLinks={resolvedDisableLinks}
        highlightedStepId={highlightedStepId}
        highlightedEdgeId={highlightedEdgeId}
        hoveredNodeId={hoveredNodeId}
        onNodeHover={setHoveredNodeId}
        onEdgeMouseEnter={handleEdgeMouseEnter}
        onEdgeMouseLeave={handleEdgeMouseLeave}
        onViewportPointerLeave={handleViewportPointerLeave}
        createdElements={createdElements}
        diffElements={diffElements}
        presentationState={presentationState}
        workflowHref={resolvedDisableLinks ? undefined : workflowHref}
        variant="inline"
        allowFullscreen={allowFullscreen}
        interaction={{ mode, ...interaction }}
        directEntityLinks={directEntityLinks}
        onSizeModeChange={setGraphSizeMode}
        onOpenFullscreen={() => {
          setHighlightedEdgeId(undefined);
          setHoveredNodeId(undefined);
          setIsFullscreenOpen(true);
        }}
        onExpandReference={openExploration}
      />
      <ModalWorkOwner.Provider value={isFullscreenOpenOwnerKey}>
        <WorkflowGraphFullscreenDialog
          layoutComparisonControls={layoutComparisonControls}
          graphData={hydratedGraphData}
          projection={projection}
          graphSizeMode={graphSizeMode}
          disableLinks={resolvedDisableLinks}
          highlightedStepId={highlightedStepId}
          highlightedEdgeId={highlightedEdgeId}
          hoveredNodeId={hoveredNodeId}
          onNodeHover={setHoveredNodeId}
          onEdgeMouseEnter={handleEdgeMouseEnter}
          onEdgeMouseLeave={handleEdgeMouseLeave}
          onViewportPointerLeave={handleViewportPointerLeave}
          createdElements={createdElements}
          diffElements={diffElements}
          presentationState={presentationState}
          workflowHref={resolvedDisableLinks ? undefined : workflowHref}
          interaction={{ mode, ...interaction }}
          directEntityLinks={directEntityLinks}
          onSizeModeChange={setGraphSizeMode}
          onExpandReference={openExploration}
          open={isFullscreenOpen}
          onClose={() => {
            setIsFullscreenOpen(false);
            setHighlightedEdgeId(undefined);
            setHoveredNodeId(undefined);
          }}
        />
      </ModalWorkOwner.Provider>
      {explorationTarget ? (
        <DiagramExplorationDialog
          organizationId={hydratedGraphData.workflow.organizationId}
          projectId={hydratedGraphData.workflow.projectId}
          target={explorationTarget}
          ancestors={explorationAncestors ?? [hydratedGraphData.workflow.id]}
          onClose={() => setExplorationTarget(null)}
        />
      ) : null}
    </>
  );

  return hasRouter ? content : <MemoryRouter>{content}</MemoryRouter>;
};

export const WorkflowMentionInlineRenderer: React.FC<
  WorkflowMentionInlineRendererProps
> = (props) => {
  const { presentation } = useMentionExpansion();
  // Badge-only hosts skip the graph surface and its hydration reads.
  if (presentation === "badge") {
    return <MentionBadgeInner mention={props.mention} mode={props.mode} />;
  }
  // The shared card draws Diagram graphs only; legacy workflow tokens keep the
  // inline graph surface.
  if (presentation === "card" && isDiagramMention(props.mention)) {
    return <DiagramMentionCard {...props} />;
  }
  return <ExpandedWorkflowMention {...props} />;
};

const DiagramMentionCard: React.FC<WorkflowMentionInlineRendererProps> = ({
  mention,
  mode,
}) => {
  const editorContext = useContext(MentionEditorContext);
  const projectContext = useProjectContext();
  const context = editorContext ?? projectContext;
  return context ? (
    <MentionArtifactCard
      mention={mention}
      typeKey={DIAGRAM_TASK_TYPE}
      organizationId={context.organizationId}
      projectId={context.projectId}
    />
  ) : (
    <MentionBadgeInner mention={mention} mode={mode} />
  );
};

const ExpandedWorkflowMention: React.FC<WorkflowMentionInlineRendererProps> = ({
  mention,
  mode,
}) => {
  const editorContext = useContext(MentionEditorContext);
  const projectContext = useProjectContext();
  const context = editorContext ?? projectContext;
  const organizationId = context?.organizationId ?? "";
  const projectId = context?.projectId ?? "";
  const isDiagram = isDiagramMention(mention);
  const canLoadWorkflow =
    (isWorkflowMention(mention) || isDiagram) && !!context;
  const workflowMentionRef = useRef<HTMLDivElement | null>(null);
  const scrollPolicy = useOptionalConversationScrollPolicy();
  const scrollOwnerRef =
    scrollPolicy?.mode === "owned" ? scrollPolicy.ownerRef : null;
  const [isHydrationEligible, setIsHydrationEligible] = useState(
    () => typeof IntersectionObserver === "undefined",
  );

  useEffect(() => {
    if (!canLoadWorkflow || isHydrationEligible) {
      return;
    }

    const element = workflowMentionRef.current;
    if (!element) {
      return;
    }

    if (typeof IntersectionObserver === "undefined") {
      setIsHydrationEligible(true);
      return;
    }

    let observer: IntersectionObserver | null = null;
    const owner = scrollOwnerRef?.current;
    try {
      observer = new IntersectionObserver(
        (entries) => {
          if (
            entries.some(
              (entry) => entry.target === element && entry.isIntersecting,
            )
          ) {
            setIsHydrationEligible(true);
            observer?.disconnect();
          }
        },
        {
          root: owner?.contains(element) ? owner : null,
          rootMargin: WORKFLOW_MENTION_PRELOAD_ROOT_MARGIN,
        },
      );
      observer.observe(element);
    } catch {
      setIsHydrationEligible(true);
    }

    return () => {
      observer?.disconnect();
    };
  }, [canLoadWorkflow, isHydrationEligible, scrollOwnerRef]);

  const graphQuery = useWorkItemGraph(
    organizationId,
    projectId,
    mention.entityId,
    {
      enabled: canLoadWorkflow && isHydrationEligible,
      incidentRelationshipTypes: isDiagram
        ? ["GUARANTEES", "IMPLEMENTS", "CONSUMES"]
        : undefined,
    },
  );
  const nodeTypeQuery = useWorkItemTypeByKey(
    canLoadWorkflow && isHydrationEligible ? organizationId : undefined,
    canLoadWorkflow && isHydrationEligible ? projectId : undefined,
    canLoadWorkflow && isHydrationEligible && isDiagram
      ? "DIAGRAM_ELEMENT"
      : undefined,
  );
  const workflowTypeQuery = useWorkItemTypeByKey(
    canLoadWorkflow && isHydrationEligible ? organizationId : undefined,
    canLoadWorkflow && isHydrationEligible ? projectId : undefined,
    canLoadWorkflow && isHydrationEligible
      ? isDiagram
        ? "DIAGRAM"
        : "workflow"
      : undefined,
  );
  const graphAggregate = graphQuery.data;
  const workflow = graphAggregate?.root ?? null;

  if (!canLoadWorkflow) {
    return <MentionBadgeInner mention={mention} mode={mode} />;
  }

  const content = !isHydrationEligible ? (
    <WorkflowMentionPlaceholder mention={mention} />
  ) : !graphQuery.isFetched ||
    !workflowTypeQuery.isFetched ||
    (isDiagram && !nodeTypeQuery.isFetched) ? (
    <WorkflowMentionSkeleton mention={mention} />
  ) : graphQuery.error ||
    workflowTypeQuery.error ||
    (isDiagram && nodeTypeQuery.error) ||
    !graphAggregate ||
    !(isWorkflow(workflow) || workflow?.type.toUpperCase() === "DIAGRAM") ||
    !workflowTypeQuery.workItemTypeDefinition ? (
    <WorkflowMentionUnavailable mention={mention} />
  ) : (
    <WorkflowGraphSurface
      graphData={{
        workflow,
        steps: graphAggregate.children.filter((step) =>
          isDiagram
            ? step.type.toUpperCase() === "DIAGRAM_ELEMENT"
            : isWorkflowStep(step),
        ),
        edges: graphAggregate.relationships,
        participation: graphAggregate.participation,
        workflowTypeDefinition: workflowTypeQuery.workItemTypeDefinition,
        nodeTypeDefinition: nodeTypeQuery.workItemTypeDefinition,
        layout: graphAggregate.layout,
      }}
      allowFullscreen
    />
  );

  return (
    <Box
      ref={workflowMentionRef}
      data-testid="workflow-inline-mention"
      data-workflow-id={mention.entityId}
      data-workflow-hydration-state={
        isHydrationEligible ? "eligible" : "deferred"
      }
      sx={{ display: "block", width: "100%" }}
    >
      {content}
    </Box>
  );
};

export const renderMentionNode = (
  mention: EntityMention,
  mode?: MentionMode,
): React.ReactNode =>
  isWorkflowMention(mention) || isDiagramMention(mention) ? (
    <WorkflowMentionInlineRenderer mention={mention} mode={mode} />
  ) : isReportMention(mention) ? (
    <ReportMentionInlineRenderer mention={mention} mode={mode} />
  ) : isWorkItemMention(mention) ? (
    <WorkItemMentionInlineRenderer
      mention={mention}
      mode={mode}
      renderDiagram={renderMentionNode}
    />
  ) : (
    <MentionBadgeInner mention={mention} mode={mode} />
  );

const WORKFLOW_GRAPH_THUMBNAIL_PADDING = 24;
const WORKFLOW_GRAPH_THUMBNAIL_FALLBACK_NODE_SIZE = 104;

const getThumbnailNodeSize = (
  node: WorkflowGraphNode,
): { width: number; height: number } => {
  const dataSize = (node.data as { sizeConfig?: { nodeSize?: number } })
    .sizeConfig?.nodeSize;
  const fallback = dataSize ?? WORKFLOW_GRAPH_THUMBNAIL_FALLBACK_NODE_SIZE;
  return {
    width: node.width ?? node.measured?.width ?? fallback,
    height: node.height ?? node.measured?.height ?? fallback,
  };
};

export interface WorkflowGraphThumbnailProps {
  graphData: WorkflowGraphSurfaceData;
  height: number;
}

/**
 * Read-only miniature of a whole Diagram or workflow graph. Saved authored
 * positions win; otherwise the remembered layout engine arranges the graph.
 * Every node and connection is drawn as a plain, text-free shape scaled so
 * the whole graph fits the box at any aspect ratio, with no interaction.
 */
export const WorkflowGraphThumbnail: React.FC<WorkflowGraphThumbnailProps> = ({
  graphData,
  height,
}) => {
  const hydratedGraphData = useMemo(
    () => hydrateWorkflowGraphEdges(graphData),
    [graphData],
  );
  const layoutPreference = useDiagramLayoutPreference({
    organizationId: hydratedGraphData.workflow.organizationId,
    projectId: hydratedGraphData.workflow.projectId,
    diagramId: hydratedGraphData.workflow.id,
  });
  const authoredPositions = useMemo(
    () =>
      hydratedGraphData.layout
        ? new Map(
            hydratedGraphData.layout.nodes.flatMap(({ node, position }) =>
              node.kind === "persistedWorkItem"
                ? [[node.workItemId, position] as const]
                : [],
            ),
          )
        : undefined,
    [hydratedGraphData.layout],
  );
  const baseModel = useMemo(
    () =>
      buildWorkflowGraphModel(hydratedGraphData, {
        disableLinks: true,
        authoredPositions,
      }),
    [authoredPositions, hydratedGraphData],
  );
  const hasAuthoredLayout = Boolean(authoredPositions?.size);
  const thumbnailGroups = useMemo(
    () => getDiagramGroups(hydratedGraphData),
    [hydratedGraphData],
  );
  const comparison = useDiagramLayoutComparison(
    {
      ...diagramLayoutGroupsFor(
        thumbnailGroups,
        baseModel.nodes.flatMap((node) =>
          node.type === WORKFLOW_STEP_NODE_TYPE ? [node.id] : [],
        ),
      ),
      nodes: baseModel.nodes.flatMap((node) =>
        node.type === WORKFLOW_STEP_NODE_TYPE
          ? [
              {
                id: node.id,
                title: node.data.title,
                width: node.data.sizeConfig.nodeSize,
                height: node.data.sizeConfig.nodeSize,
              },
            ]
          : [],
      ),
      edges: baseModel.edges.map((edge) => ({
        source: edge.source,
        target: edge.target,
        label:
          edge.type === WORKFLOW_FLOW_EDGE_TYPE ? (edge.data?.label ?? "") : "",
      })),
    },
    hasAuthoredLayout ? undefined : layoutPreference.automaticCandidate,
    layoutPreference.automaticDirection,
  );
  const isArranging =
    comparison.active && !comparison.positions && !hasAuthoredLayout;
  const graphModel = useMemo(
    () =>
      comparison.positions
        ? buildWorkflowGraphModel(hydratedGraphData, {
            disableLinks: true,
            authoredPositions: comparison.positions,
          })
        : baseModel,
    [baseModel, comparison.positions, hydratedGraphData],
  );
  const theme = useTheme();
  // Plain shapes with no text: the miniature conveys structure only, and the
  // viewBox always contains every node whatever the graph's aspect ratio.
  const shapes = useMemo(() => {
    const boxes = new Map(
      graphModel.nodes.map((node) => {
        const size = getThumbnailNodeSize(node);
        return [
          node.id,
          {
            x: node.position.x,
            y: node.position.y,
            ...size,
            round: node.type === WORKFLOW_STEP_NODE_TYPE,
          },
        ] as const;
      }),
    );
    if (boxes.size === 0) return null;
    const all = Array.from(boxes.values());
    const minX = Math.min(...all.map((box) => box.x));
    const minY = Math.min(...all.map((box) => box.y));
    const maxX = Math.max(...all.map((box) => box.x + box.width));
    const maxY = Math.max(...all.map((box) => box.y + box.height));
    const pad = WORKFLOW_GRAPH_THUMBNAIL_PADDING;
    const lines = graphModel.edges.flatMap((edge) => {
      const source = boxes.get(edge.source);
      const target = boxes.get(edge.target);
      return source && target
        ? [
            {
              id: edge.id,
              x1: source.x + source.width / 2,
              y1: source.y + source.height / 2,
              x2: target.x + target.width / 2,
              y2: target.y + target.height / 2,
            },
          ]
        : [];
    });
    return {
      viewBox: `${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${
        maxY - minY + pad * 2
      }`,
      boxes: Array.from(boxes.entries()),
      lines,
      strokeScale: Math.max(maxX - minX, maxY - minY) / 300,
    };
  }, [graphModel.edges, graphModel.nodes]);

  return (
    <Box
      data-testid="workflow-graph-thumbnail"
      aria-hidden
      sx={{
        position: "relative",
        width: "100%",
        height,
        overflow: "hidden",
        borderRadius: 1,
        pointerEvents: "none",
        bgcolor:
          theme.palette.mode === "dark"
            ? theme.palette.grey[900]
            : theme.palette.grey[100],
      }}
    >
      {isArranging || !shapes ? null : (
        <svg
          width="100%"
          height="100%"
          viewBox={shapes.viewBox}
          preserveAspectRatio="xMidYMid meet"
        >
          {shapes.lines.map((line) => (
            <line
              key={line.id}
              {...{ x1: line.x1, y1: line.y1, x2: line.x2, y2: line.y2 }}
              stroke={theme.palette.text.secondary}
              strokeWidth={Math.max(2, shapes.strokeScale * 1.5)}
            />
          ))}
          {shapes.boxes.map(([id, box]) => (
            <rect
              key={id}
              data-testid="workflow-graph-thumbnail-node"
              x={box.x}
              y={box.y}
              width={box.width}
              height={box.height}
              rx={Math.min(box.width, box.height) / (box.round ? 6 : 10)}
              fill={theme.palette.background.paper}
              stroke={theme.palette.primary.main}
              strokeWidth={Math.max(2, shapes.strokeScale * 2)}
            />
          ))}
        </svg>
      )}
    </Box>
  );
};
