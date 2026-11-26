import AccountTreeIcon from "@mui/icons-material/AccountTree";
import CategoryOutlinedIcon from "@mui/icons-material/CategoryOutlined";
import CloudOutlinedIcon from "@mui/icons-material/CloudOutlined";
import CodeIcon from "@mui/icons-material/Code";
import HubIcon from "@mui/icons-material/Hub";
import Inventory2Icon from "@mui/icons-material/Inventory2";
import LoginIcon from "@mui/icons-material/Login";
import PersonIcon from "@mui/icons-material/Person";
import PlayCircleOutlineIcon from "@mui/icons-material/PlayCircleOutline";
import PsychologyIcon from "@mui/icons-material/Psychology";
import StopCircleOutlinedIcon from "@mui/icons-material/StopCircleOutlined";
import StorageIcon from "@mui/icons-material/Storage";
import WebAssetIcon from "@mui/icons-material/WebAsset";
import WidgetsIcon from "@mui/icons-material/Widgets";
import { IconButton, Stack } from "@mui/material";
import type { SvgIconProps } from "@mui/material";
import React, { useCallback, useEffect, useRef, useState } from "react";
import type { ComponentType } from "react";
import {
  AgentEdgeCategory,
  AgentEdgeType,
  type AgentEdgeResponseDto,
  type AgentEdgeEndpointEntityType,
  type DiagramElementRoleDefinition,
  type TargetEntityType,
} from "../../api";
import type { GraphWorkItem } from "./diagramElementMetadata";
import { useWorkItem } from "../../data/hooks/useWorkItem";
import { useWorkItemTypeByKey } from "../../data/hooks/useWorkItemTypes";
import { getPathService } from "../../services/webPathService";
import {
  getEntityColors,
  getEntityIcon,
  resolveWorkItemIconPresentation,
} from "../../utils/entityIcons";
import { DecisionIcon } from "../../utils/icons/Decision";
import { EntityHoverCard } from "../SmarterTextAreaCard/EntityHoverCard";

/**
 * Diagram Element presentation shared by the Diagram canvas and the report
 * viewer: role icons and the direct-link strip whose icons open an entity
 * preview without navigating.
 */

export interface WorkflowGraphDirectEntityLink {
  sourceNodeId: string;
  targetEntityId: string;
  targetEntityType: AgentEdgeEndpointEntityType | TargetEntityType;
  targetWorkItemType?: string;
  targetTitle: string;
  relationshipType: string;
}

export interface WorkflowGraphRenderedEntityLink extends WorkflowGraphDirectEntityLink {
  href: string;
  Icon: ComponentType<SvgIconProps>;
}

export const DIAGRAM_ROLE_ICONS: Readonly<
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
  UI_START: LoginIcon,
  PRODUCT: Inventory2Icon,
  DECISION: DecisionIcon,
  EXTERNAL_SYSTEM: CloudOutlinedIcon,
  DIAGRAM_REFERENCE: AccountTreeIcon,
};

export const getDiagramRoleIcon = (
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

export const getDirectEntityHref = (
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

export const formatDiagramSemanticLabel = (value: string): string =>
  value
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/^\w/, (character) => character.toUpperCase());

const DEFAULT_LINK_BUTTON_SIZE = 24;
/** Button size less icon size. */
const LINK_ICON_PADDING = 8;
const LINK_BUTTON_GAP = 2;
/** Fades the strip's cut edge so hidden icons are not mistaken for none. */
const LINK_STRIP_OVERFLOW_MASK =
  "linear-gradient(to right, black calc(100% - 20px), transparent)";

const getBoundedStripSx = (
  linkCount: number,
  buttonSize: number,
  maxWidth: number,
) => {
  const contentWidth =
    linkCount * (buttonSize + LINK_BUTTON_GAP) - LINK_BUTTON_GAP;

  return {
    maxWidth,
    overflowX: "auto",
    scrollbarWidth: "none",
    ...(contentWidth > maxWidth ? { maskImage: LINK_STRIP_OVERFLOW_MASK } : {}),
  };
};

const DIRECT_ENTITY_PREVIEW_OPEN_DELAY_MS = 300;
const DIRECT_ENTITY_PREVIEW_CLOSE_DELAY_MS = 150;

const WorkflowGraphDirectEntityLinkButton: React.FC<{
  link: WorkflowGraphRenderedEntityLink;
  size: number;
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
  size,
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
  const colors =
    taskPresentation?.colors ?? getEntityColors(link.targetEntityType);
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
        width: size,
        height: size,
        flexShrink: 0,
        p: 0,
        borderRadius: "2px",
        bgcolor: colors.background,
        color: colors.color,
        "&:hover": { bgcolor: colors.background, opacity: 0.85 },
      }}
    >
      <Icon
        aria-hidden
        sx={{ fontSize: size - LINK_ICON_PADDING }}
        data-testid="diagram-element-direct-link-icon"
        data-work-item-type={taskType}
      />
    </IconButton>
  );
};

export const WorkflowGraphDirectEntityLinkStrip: React.FC<{
  links: readonly WorkflowGraphRenderedEntityLink[];
  organizationId: string;
  projectId: string;
  /** Frame-relative inset of the strip's lower-left corner. */
  inset?: { left: number; bottom: number };
  /** Bounds the overlaid row; icons past it are reached by scrolling. */
  maxWidth?: number;
  buttonSize?: number;
  /** `inline` flows with its container instead of overlaying a canvas node. */
  layout?: "overlay" | "inline";
}> = ({
  links,
  organizationId,
  projectId,
  inset,
  maxWidth,
  buttonSize = DEFAULT_LINK_BUTTON_SIZE,
  layout = "overlay",
}) => {
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
        className={
          maxWidth === undefined ? "nodrag nopan" : "nodrag nopan nowheel"
        }
        role="group"
        aria-label="Directly linked entities"
        data-testid="diagram-element-link-strip"
        sx={
          layout === "inline"
            ? { alignItems: "center", flexWrap: "wrap" }
            : {
                position: "absolute",
                left: inset?.left ?? 4,
                bottom: inset?.bottom ?? 4,
                alignItems: "center",
                zIndex: 3,
                pointerEvents: "all",
                ...(maxWidth === undefined
                  ? {}
                  : getBoundedStripSx(links.length, buttonSize, maxWidth)),
              }
        }
      >
        {links.map((link) => (
          <WorkflowGraphDirectEntityLinkButton
            key={`${link.targetEntityId}:${link.relationshipType}`}
            link={link}
            size={buttonSize}
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

export const FLOW_EDGE_TYPES = [
  AgentEdgeType.Standard,
  AgentEdgeType.Conditional,
  AgentEdgeType.Loop,
] as const;
export type FlowEdgeType = (typeof FLOW_EDGE_TYPES)[number];

export const isFlowEdge = (
  edge: AgentEdgeResponseDto,
): edge is AgentEdgeResponseDto & { type: FlowEdgeType } =>
  edge.category === AgentEdgeCategory.Flow &&
  FLOW_EDGE_TYPES.includes(edge.type as FlowEdgeType);

export const getEdgeNodeName = (
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

export const getDirectEntityLinksByNodeId = (
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
