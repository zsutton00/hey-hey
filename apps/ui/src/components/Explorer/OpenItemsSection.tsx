import { useModalState } from "@hey-hey/ui-common/components/Modals";
import { FunctionalDialog as Dialog } from "@hey-hey/ui-common/components/Modals";
import { useOpenItemsSelection } from "../../openItemsSelection";
import { OpenItemsTriageAction } from "./OpenItemsTriageAction";
import { OpenItemsSyncStatus } from "./OpenItemsSyncStatus";
import { OpenItemsPromotionDialog } from "./OpenItemsPromotionDialog";
import { OpenItemGoalWork } from "./OpenItemGoalWork";
import {
  resolveOpenItemDragContent,
  resolveOpenItemTargets,
  type OpenItemSelectionIdentity,
} from "@hey-hey/ui-common/utils";
import { EntityHoverCard } from "@hey-hey/ui-common/components/shared";
import { EntityIcon } from "@hey-hey/ui-common/components/Entity";
import {
  OpenItemInteractionComponent,
  type OpenItemActiveOnlyAction,
  useEntityDragSource,
  type OpenItemGroupActions,
} from "@hey-hey/ui-common/components/InteractionComponent";
import {
  AgentSessionCurrentState,
  AgentSessionOutputAttentionState,
  AgentSessionType,
  ConversationPhase,
  EntityType,
  OpenItemGoalTrackedWorkFilter,
  TargetEntityType,
  type WorkItemTypeDefinitionDto,
  type WorkItemTypeEffectiveSource,
} from "@hey-hey/ui-common/api";
import {
  ConversationPhaseIndicator,
  AgentSessionCurrentStateIndicator,
  AgentSessionOutputAttentionIndicator,
  getAgentSessionRowSignalPresentation,
  type AgentSessionRowLifecycleSignal,
  type AgentSessionRowSignalPresentation,
} from "@hey-hey/ui-common/components";
import {
  useCurrentCanonicalPage,
  useDndContextSafe,
  usePreviewHost,
  useTheme,
} from "@hey-hey/ui-common/context";
import {
  useConversationPhases,
  useAgentSessionCurrentStates,
  useAgentSessionOutputAttentions,
  useWorkItemTypes,
  useEntityStars,
} from "@hey-hey/ui-common/data";
import { useCanHover } from "@hey-hey/ui-common/hooks";
import { WebPathService } from "@hey-hey/ui-common/services";
import {
  resolveWorkItemIcon,
  resolveWorkItemIconPresentation,
  type EntityColors,
} from "@hey-hey/ui-common/utils";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import PushPinOutlinedIcon from "@mui/icons-material/PushPinOutlined";
import StarIcon from "@mui/icons-material/Star";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import {
  Box,
  Button,
  Collapse,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Menu,
  MenuItem,
  Paper,
  Popper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link } from "react-router-dom";
import { useDroppable } from "@dnd-kit/core";
import {
  BULK_REMOVAL_CONFIRM_THRESHOLD,
  matchesOpenItemIdentity,
  openItemKey,
  openItemTitle,
  type OpenItem,
  type OpenItemGroup,
  type OpenItemIdentity,
  lineageEntityId,
  selectBulkRemovalTargets,
  type BulkRemovalScope,
} from "../../contexts/openItemsModel";
import { useOpenItems } from "../../contexts/OpenItemsContext";
import { buildEntityConversationPath } from "../../pages/AgentSession/entityConversationRoute";
import {
  buildPlanAgentSessionPath,
  buildPlanStepPath,
} from "../../pages/Plan/planSessionRoutes";
import { buildTaskAgentSessionPath } from "../../pages/Task/taskSessionRoutes";
import {
  getBuiltInWorkItemIconKey,
  indexWorkItemTypeDefinitions,
} from "../../types/workItemTypes";
import {
  collapseProjectedOpenItems,
  expandableProjectedOpenItemKeys,
  filterProjectedOpenItems,
  filterProjectedOpenItemsByActivity,
  projectOpenItems,
} from "./openItemsProjection";

type OpenItemActionsWithPinning = React.ComponentProps<
  typeof OpenItemInteractionComponent
>["openItemActions"];

const OPEN_ITEM_PREVIEW_DELAY_MS = 400;
const OPEN_ITEMS_ROW_TREE_ID = "open-items-row-tree";

export const isActiveAgentSessionForOpenItems = (
  currentState: AgentSessionCurrentState | undefined,
  outputAttentionState: AgentSessionOutputAttentionState | undefined,
  conversationPhase: ConversationPhase | undefined,
): boolean => {
  const hasActiveLifecycle =
    currentState !== undefined &&
    currentState !== AgentSessionCurrentState.Idle;
  const hasOutputAttention =
    outputAttentionState === AgentSessionOutputAttentionState.MessageReady;
  const hasReviewingFallback =
    currentState === AgentSessionCurrentState.Idle &&
    conversationPhase === ConversationPhase.Reviewing;

  return hasActiveLifecycle || hasOutputAttention || hasReviewingFallback;
};

const pathFor = (item: OpenItem, projectId: string): string | null => {
  const planId = lineageEntityId(item.lineage, "plan");
  const stageId = lineageEntityId(item.lineage, "plan_stage");
  const stepId = lineageEntityId(item.lineage, "plan_step");
  const taskId = lineageEntityId(item.lineage, "task");
  const agentSessionPresentation =
    item.presentation?.kind === "agent_session" ? item.presentation : undefined;

  switch (item.entityType) {
    case "agent_session":
      if (
        agentSessionPresentation?.sessionType ===
        AgentSessionType.EntityConversation
      ) {
        const route = {
          agentSessionId: item.entityId,
          ...agentSessionPresentation.entityConversationRoute,
        };
        const entityConversationPath = buildEntityConversationPath(projectId, {
          ...route,
        });
        if (entityConversationPath) return entityConversationPath;
      }
      if (planId) {
        return buildPlanAgentSessionPath(
          projectId,
          planId,
          item.entityId,
          stageId,
          stepId,
        );
      }
      if (taskId) {
        return buildTaskAgentSessionPath(projectId, "", taskId, item.entityId);
      }
      return WebPathService.agentSession({
        projectId,
        agentSessionId: item.entityId,
      });
    case "initiative":
      return WebPathService.initiativeDetail({
        projectId,
        initiativeId: item.entityId,
      });
    case "task":
      if (planId && stageId && stepId) {
        return buildPlanStepPath(projectId, planId, stageId, stepId);
      }
      return WebPathService.task({ projectId, taskId: item.entityId });
    case "goal":
      return WebPathService.goal({ projectId, taskId: item.entityId });
    case "conversation":
      return WebPathService.conversation({
        projectId,
        conversationId: item.entityId,
      });
    case "design_doc":
      return WebPathService.designDoc({
        projectId,
        designDocId: item.entityId,
      });
    case "plan":
      return WebPathService.plan({ projectId, planId: item.entityId });
    case "proposal":
      return WebPathService.proposal({ projectId, proposalId: item.entityId });
  }
};

const targetTypeFor = (item: OpenItem): TargetEntityType | (string & {}) => {
  switch (item.entityType) {
    case "initiative":
      return EntityType.Initiative;
    case "task":
      return TargetEntityType.Task;
    case "goal":
      return "GOAL";
    case "conversation":
      return EntityType.Conversation;
    case "design_doc":
      return EntityType.DesignDoc;
    case "agent_session":
      return EntityType.AgentSession;
    case "plan":
      return EntityType.Task;
    case "proposal":
      return EntityType.Proposal;
  }
};

const dragEntityFor = (item: OpenItem) => ({
  entityId: item.entityId,
  entityType: targetTypeFor(item),
  entityName: openItemTitle(item),
  entitySubtype:
    item.entityType === "goal"
      ? "GOAL"
      : item.entityType === "plan"
        ? "PLAN"
        : item.presentation?.kind === "task"
          ? item.presentation.taskType
          : undefined,
});

interface GroupDragEntity {
  entityId: string;
  entityType: string;
  entitySubtype?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isGroupDragEntity = (value: unknown): value is GroupDragEntity =>
  isRecord(value) &&
  typeof value["entityId"] === "string" &&
  typeof value["entityType"] === "string" &&
  (value["entitySubtype"] === undefined ||
    typeof value["entitySubtype"] === "string");

const groupDragEntities = (content: unknown): GroupDragEntity[] => {
  if (!isRecord(content)) return [];
  const candidate = content;
  if (candidate.type === "entity") {
    const data = candidate.data;
    return isGroupDragEntity(data) ? [data] : [];
  }
  if (candidate.type === "entities" && Array.isArray(candidate.data)) {
    const data: unknown[] = candidate.data;
    return data.length > 0 && data.every(isGroupDragEntity) ? data : [];
  }
  return [];
};

const resolveGroupDropIdentities = (
  items: readonly OpenItem[],
  content: unknown,
): OpenItemIdentity[] => {
  const entities = groupDragEntities(content);
  const resolved: OpenItemIdentity[] = [];
  for (const entity of entities) {
    const item = items.find((candidate) => {
      const dragEntity = dragEntityFor(candidate);
      return (
        dragEntity.entityId === entity.entityId &&
        dragEntity.entityType === entity.entityType &&
        dragEntity.entitySubtype === entity.entitySubtype
      );
    });
    if (!item) return [];
    if (resolved.some((identity) => matchesOpenItemIdentity(item, identity))) {
      return [];
    }
    resolved.push({ entityId: item.entityId, entityType: item.entityType });
  }
  return resolved.length === entities.length ? resolved : [];
};

const OpenItemsGroupDropTarget: React.FC<{
  groupId: string;
  items: readonly OpenItem[];
  onAssign: (groupId: string, identities: readonly OpenItemIdentity[]) => void;
  children: React.ReactNode;
}> = ({ groupId, items, onAssign, children }) => {
  const dndState = useDndContextSafe();
  const activeIdentities = resolveGroupDropIdentities(
    items,
    dndState?.activeContent,
  );
  const handleDrop = useCallback(
    (event: { content: unknown }) => {
      const identities = resolveGroupDropIdentities(items, event.content);
      if (identities.length > 0) onAssign(groupId, identities);
    },
    [groupId, items, onAssign],
  );
  const { setNodeRef, isOver } = useDroppable({
    id: `open-items-group-${groupId}`,
    disabled: activeIdentities.length === 0,
    data: { onDrop: handleDrop },
  });

  return (
    <Box
      ref={setNodeRef}
      data-testid="open-items-group-drop-target"
      data-group-id={groupId}
      sx={{
        borderRadius: 1,
        bgcolor: isOver ? "action.selected" : "transparent",
        outline: isOver ? "1px solid" : "none",
        outlineColor: "primary.main",
        mb: 1.25,
      }}
    >
      {children}
    </Box>
  );
};

const OpenItemsGroupHeader: React.FC<{
  group: OpenItemGroup;
  totalCount: number;
  activeCount: number | null;
  activeSessionSignals: readonly AgentSessionRowSignalPresentation[];
  onToggle: (groupId: string, expanded: boolean) => void;
  onRename: (group: OpenItemGroup) => void;
  onPromote: (groupId: string) => void;
  onDelete: (groupId: string) => void;
}> = ({
  group,
  totalCount,
  activeCount,
  activeSessionSignals,
  onToggle,
  onRename,
  onPromote,
  onDelete,
}) => {
  const [groupMenuPosition, setGroupMenuPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const title = `${group.name} (${
    activeCount === null ? totalCount : `${activeCount}/${totalCount}`
  })`;
  return (
    <Box
      data-testid="open-items-group-header"
      data-group-id={group.id}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setGroupMenuPosition({ top: event.clientY, left: event.clientX });
      }}
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 0.25,
        px: 0.5,
        py: 0.25,
        borderRadius: 1,
        bgcolor: "action.hover",
      }}
    >
      <IconButton
        size="small"
        aria-label={`${group.collapsed ? "Expand" : "Collapse"} ${title}`}
        aria-expanded={!group.collapsed}
        aria-controls={`open-items-group-tree-${group.id}`}
        data-testid="open-items-group-toggle"
        data-group-id={group.id}
        onClick={() => onToggle(group.id, group.collapsed)}
      >
        {group.collapsed ? (
          <ChevronRightIcon fontSize="small" />
        ) : (
          <ExpandMoreIcon fontSize="small" />
        )}
      </IconButton>
      <Typography variant="body2" sx={{ fontWeight: 600 }}>
        {title}
      </Typography>
      {group.collapsed && activeSessionSignals.length > 0 ? (
        <Box
          data-testid="open-items-group-active-indicators"
          sx={{ display: "flex", alignItems: "center", ml: 0.5 }}
        >
          {activeSessionSignals.map((signal, index) => (
            <Box
              key={index}
              sx={{
                display: "inline-flex",
                ml: index === 0 ? 0 : -0.75,
                zIndex: activeSessionSignals.length - index,
              }}
            >
              {renderAgentSessionRowSignals(signal)}
            </Box>
          ))}
        </Box>
      ) : null}
      <Box sx={{ flex: 1 }} />
      <Menu
        open={groupMenuPosition !== null}
        onClose={() => setGroupMenuPosition(null)}
        anchorReference="anchorPosition"
        anchorPosition={groupMenuPosition ?? undefined}
        MenuListProps={{ "aria-label": `${group.name} actions` }}
      >
        <MenuItem
          data-testid="open-items-group-context-promote"
          onClick={() => {
            setGroupMenuPosition(null);
            onPromote(group.id);
          }}
        >
          Promote to Goal
        </MenuItem>
        <MenuItem
          data-testid="open-items-group-context-rename"
          onClick={() => {
            setGroupMenuPosition(null);
            onRename(group);
          }}
        >
          Rename
        </MenuItem>
        <MenuItem
          data-testid="open-items-group-context-remove"
          onClick={() => {
            setGroupMenuPosition(null);
            onDelete(group.id);
          }}
        >
          Remove Group
        </MenuItem>
      </Menu>
    </Box>
  );
};

const iconTypeFor = (item: OpenItem): string => item.entityType;

type OpenItemRowActions = Pick<
  ReturnType<typeof useOpenItems>,
  | "remove"
  | "removeOthers"
  | "removeAllAbove"
  | "removeAllBelow"
  | "removeAll"
  | "setWhyOpen"
  | "pin"
  | "unpin"
  | "sortDirection"
  | "setSortDirection"
>;

type OpenItemRowProps = {
  starred: boolean;
  selectedItems: readonly OpenItem[];
  selectionMode: boolean;
  onEnterSelection: (item: OpenItemIdentity) => void;
  onToggleSelection: (item: OpenItemIdentity, range?: boolean) => void;
  onRemoveSelected: (identities: readonly OpenItemSelectionIdentity[]) => void;
  index: number;
  itemCount: number;
  item: OpenItem;
  depth: number;
  active: boolean;
  hasChildren: boolean;
  isExpanded: boolean;
  actions: OpenItemRowActions;
  groupActions: OpenItemGroupActions;
  activeOnlyAction: OpenItemActiveOnlyAction;
  organizationId: string;
  projectId: string;
  currentState?: AgentSessionCurrentState;
  outputAttentionState?: AgentSessionOutputAttentionState;
  conversationPhase?: Parameters<typeof ConversationPhaseIndicator>[0]["phase"];
  workItemTypeDefinitions: ReadonlyMap<string, WorkItemTypeDefinitionDto>;
  workItemTypeSources: ReadonlyMap<string, WorkItemTypeEffectiveSource>;
  onToggleChildren: (itemKey: string) => void;
};

const renderAgentSessionLifecycleSignal = (
  signal: AgentSessionRowLifecycleSignal,
): React.ReactNode => {
  switch (signal.kind) {
    case "currentState":
      return (
        <AgentSessionCurrentStateIndicator
          currentState={signal.currentState}
          presentation="icon"
          sx={{ flexShrink: 0 }}
        />
      );
    case "conversationPhase":
      return <ConversationPhaseIndicator phase={signal.phase} />;
    case "none":
      return null;
  }
};

const renderAgentSessionRowSignals = (
  signals: AgentSessionRowSignalPresentation,
): React.ReactNode => (
  <>
    {renderAgentSessionLifecycleSignal(signals.lifecycle)}
    {signals.showMessageReadyIcon ? (
      <AgentSessionOutputAttentionIndicator
        state={AgentSessionOutputAttentionState.MessageReady}
        sx={{ flexShrink: 0 }}
      />
    ) : null}
  </>
);

const ResolvedWorkItemIcon: React.FC<{
  IconComponent: NonNullable<ReturnType<typeof resolveWorkItemIcon>>;
  taskType: string;
  colors: EntityColors;
}> = ({ IconComponent, taskType, colors }) => {
  return (
    <Tooltip title={taskType}>
      <Box
        data-testid={`open-item-registry-icon-${taskType}`}
        data-entity-type={taskType}
        sx={{
          width: 24,
          height: 24,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          bgcolor: colors.background,
          borderRadius: "2px",
          color: colors.color,
          flex: "0 0 24px",
        }}
      >
        <IconComponent sx={{ fontSize: 16 }} />
      </Box>
    </Tooltip>
  );
};

const OpenItemRowContent: React.FC<OpenItemRowProps> = ({
  starred,
  selectedItems,
  selectionMode,
  onEnterSelection,
  onToggleSelection,
  onRemoveSelected,
  index,
  itemCount,
  item,
  depth,
  active,
  hasChildren,
  isExpanded,
  actions,
  groupActions,
  activeOnlyAction,
  organizationId,
  projectId,
  currentState,
  outputAttentionState,
  conversationPhase,
  workItemTypeDefinitions,
  workItemTypeSources,
  onToggleChildren,
}) => {
  const selected = selectedItems.some((entry) =>
    matchesOpenItemIdentity(entry, item),
  );
  const canHover = useCanHover();
  const previewHost = usePreviewHost();
  const {
    remove,
    removeOthers,
    removeAllAbove,
    removeAllBelow,
    removeAll,
    setWhyOpen,
    pin,
    unpin,
    sortDirection,
    setSortDirection,
  } = actions;
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [isNoteDialogOpen, setIsNoteDialogOpen, isNoteDialogOpenOwnerKey] =
    useModalState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const closePreviewTimeout = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const openPreviewTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const path = pathFor(item, projectId);
  const label = openItemTitle(item);
  const accessibleLabel = label;
  const iconType = iconTypeFor(item);
  const taskType =
    item.presentation?.kind === "task" ? item.presentation.taskType : undefined;
  const workItemTypeDefinition = taskType
    ? workItemTypeDefinitions.get(taskType)
    : undefined;
  // Shared lifecycle and user-scoped output attention render independently.
  // Canonical-page acknowledgment owns readiness mutation; route-local active
  // identity must not hide an outstanding readiness projection.
  const rowSignals = getAgentSessionRowSignalPresentation(
    currentState,
    outputAttentionState === AgentSessionOutputAttentionState.MessageReady,
    conversationPhase,
  );
  const builtInIconKey = taskType
    ? getBuiltInWorkItemIconKey(taskType, workItemTypeDefinition)
    : undefined;
  const iconDefinition =
    workItemTypeDefinition && builtInIconKey
      ? { ...workItemTypeDefinition, iconKey: builtInIconKey }
      : workItemTypeDefinition;
  const resolvedPresentation = taskType
    ? resolveWorkItemIconPresentation(
        taskType,
        iconDefinition,
        workItemTypeSources.get(taskType),
      )
    : undefined;
  const resolvedWorkItemIcon = resolvedPresentation?.Icon;
  const interactionEntityType = targetTypeFor(item);
  const entitySubtype =
    item.entityType === "goal"
      ? "GOAL"
      : item.entityType === "plan"
        ? "PLAN"
        : item.presentation?.kind === "task"
          ? item.presentation.taskType
          : undefined;
  const {
    attributes: dragAttributes,
    listeners: dragListeners,
    setNodeRef: setDragRef,
  } = useEntityDragSource({
    entityRef: {
      entityId: item.entityId,
      entityType: interactionEntityType,
      entityTitle: label ?? "",
      entitySubtype,
    },
    idScope: `open-items-${item.entityType}`,
    content: resolveOpenItemDragContent(item, selectedItems, dragEntityFor),
  });
  const handleNote = useCallback(() => {
    setNoteDraft(item.whyOpen ?? "");
    setIsNoteDialogOpen(true);
  }, [item.whyOpen]);

  const handleCloseNoteDialog = useCallback(() => {
    setIsNoteDialogOpen(false);
  }, []);

  const handleSaveNote = useCallback(async () => {
    if (await setWhyOpen(item.entityId, item.entityType, noteDraft.trim())) {
      setIsNoteDialogOpen(false);
    }
  }, [item.entityId, item.entityType, noteDraft, setWhyOpen]);

  const handlePreview = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      previewHost.openPreview({
        entityId: item.entityId,
        entityType: item.entityType,
      });
    },
    [item.entityId, item.entityType, previewHost],
  );

  const removeOpenItem = useCallback(() => {
    remove(item.entityId, item.entityType);
  }, [item.entityId, item.entityType, remove]);

  const handleRemoveFromOpen = useCallback(() => {
    removeOpenItem();
  }, [removeOpenItem]);

  const handleToggleChildren = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      onToggleChildren(openItemKey(item));
    },
    [item, onToggleChildren],
  );

  const handlePin = useCallback(() => {
    pin(item.entityId, item.entityType);
  }, [item.entityId, item.entityType, pin]);

  const handleUnpin = useCallback(() => {
    unpin(item.entityId, item.entityType);
  }, [item.entityId, item.entityType, unpin]);

  const nextSortDirection = sortDirection === "oldest" ? "newest" : "oldest";
  const handleSort = useCallback(() => {
    setSortDirection(nextSortDirection);
  }, [nextSortDirection, setSortDirection]);

  const keepPreviewOpen = useCallback(() => {
    if (closePreviewTimeout.current) {
      clearTimeout(closePreviewTimeout.current);
      closePreviewTimeout.current = null;
    }
  }, []);

  const schedulePreviewOpen = useCallback(
    (anchor: HTMLElement) => {
      if (!canHover || menuOpen) return;
      keepPreviewOpen();
      if (openPreviewTimeout.current) {
        clearTimeout(openPreviewTimeout.current);
      }
      openPreviewTimeout.current = setTimeout(() => {
        openPreviewTimeout.current = null;
        setAnchorEl(anchor);
      }, OPEN_ITEM_PREVIEW_DELAY_MS);
    },
    [canHover, keepPreviewOpen, menuOpen],
  );
  const handleMenuOpen = useCallback(() => {
    setMenuOpen(true);
    if (openPreviewTimeout.current) clearTimeout(openPreviewTimeout.current);
    if (closePreviewTimeout.current) clearTimeout(closePreviewTimeout.current);
    openPreviewTimeout.current = null;
    closePreviewTimeout.current = null;
    setAnchorEl(null);
  }, []);
  const handleMenuClose = useCallback(() => {
    setMenuOpen(false);
  }, []);

  const schedulePreviewClose = useCallback(() => {
    if (openPreviewTimeout.current) {
      clearTimeout(openPreviewTimeout.current);
      openPreviewTimeout.current = null;
    }
    closePreviewTimeout.current = setTimeout(() => setAnchorEl(null), 120);
  }, []);

  useEffect(
    () => () => {
      if (closePreviewTimeout.current)
        clearTimeout(closePreviewTimeout.current);
      if (openPreviewTimeout.current) clearTimeout(openPreviewTimeout.current);
    },
    [],
  );

  const note = item.whyOpen?.trim();
  const openItemIdentity = useMemo(
    () => ({
      entityId: item.entityId,
      entityType: item.entityType,
    }),
    [item.entityId, item.entityType],
  );
  const openItemActions = useMemo<OpenItemActionsWithPinning>(
    () => ({
      onRemoveFromOpen: handleRemoveFromOpen,
      removeOthers: {
        hasTargets: itemCount > 1,
        onSelect: () => removeOthers(openItemIdentity),
      },
      removeAllAbove: {
        hasTargets: index > 0,
        onSelect: () => removeAllAbove(openItemIdentity),
      },
      removeAllBelow: {
        hasTargets: index < itemCount - 1,
        onSelect: () => removeAllBelow(openItemIdentity),
      },
      removeAll: {
        hasTargets: itemCount > 0,
        onSelect: removeAll,
      },
      whyOpen: {
        kind: item.whyOpen ? "edit" : "add",
        onSelect: handleNote,
      },
      activeOnly: activeOnlyAction,
      pin: {
        hasTargets: item.pinned !== true,
        onSelect: handlePin,
      },
      unpin: {
        hasTargets: item.pinned === true,
        onSelect: handleUnpin,
      },
      sort: {
        direction: nextSortDirection,
        onSelect: handleSort,
      },
    }),
    [
      handleNote,
      handlePin,
      handleRemoveFromOpen,
      handleUnpin,
      handleSort,
      activeOnlyAction,
      index,
      item.pinned,
      item.whyOpen,
      itemCount,
      nextSortDirection,
      openItemIdentity,
      removeAll,
      removeAllAbove,
      removeAllBelow,
      removeOthers,
    ],
  );
  const openItemGroupActions = useMemo<OpenItemGroupActions>(
    () => ({ ...groupActions, currentGroupId: item.groupId }),
    [groupActions, item.groupId],
  );

  if (!path) return null;

  return (
    <>
      <OpenItemInteractionComponent
        entityId={item.entityId}
        entityType={interactionEntityType}
        entitySubtype={entitySubtype}
        entityTitle={label}
        organizationId={organizationId}
        projectId={projectId}
        draggable={false}
        openItemActions={openItemActions}
        openItemGroupActions={openItemGroupActions}
        onSelectItems={() => onEnterSelection(item)}
        selectionMode={selectionMode}
        onContextMenuOpen={handleMenuOpen}
        onContextMenuClose={handleMenuClose}
        selection={{
          selectedIdentities: resolveOpenItemTargets(item, selectedItems),
          onRemoveSelected,
        }}
      >
        <Box
          data-testid={`open-item-${item.entityType}-${item.entityId}`}
          data-open-item-key={openItemKey(item)}
          data-active={active ? "true" : "false"}
          data-depth={depth}
          data-selected={selected}
          data-selection-mode={selectionMode}
          ref={setDragRef}
          {...dragAttributes}
          {...dragListeners}
          onMouseEnter={(event: React.MouseEvent<HTMLDivElement>) => {
            schedulePreviewOpen(event.currentTarget);
          }}
          onMouseLeave={schedulePreviewClose}
          onClick={(event: React.MouseEvent<HTMLDivElement>) => {
            if (
              !selectionMode ||
              event.metaKey ||
              event.ctrlKey ||
              event.altKey
            )
              return;
            if (
              event.target instanceof Element &&
              event.target.closest("a, button")
            )
              return;
            onToggleSelection(item, event.shiftKey);
          }}
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 0,
            cursor: "grab",
            pl: `${8 + depth * 20}px`,
            borderRadius: 1,
            outline: selected ? "1px solid" : "none",
            outlineColor: "primary.main",
            bgcolor: (theme) =>
              selected
                ? alpha(theme.palette.primary.main, active ? 0.25 : 0.2)
                : active
                  ? alpha(theme.palette.primary.main, 0.11)
                  : "transparent",
            transition: "background-color 0.2s",
            "&:hover": {
              bgcolor: (theme) =>
                selected
                  ? alpha(theme.palette.primary.main, active ? 0.29 : 0.25)
                  : active
                    ? alpha(theme.palette.primary.main, 0.16)
                    : "action.hover",
            },
            "&:active": { cursor: "grabbing" },
          }}
        >
          {hasChildren ? (
            <IconButton
              aria-expanded={isExpanded}
              aria-label={`${isExpanded ? "Collapse" : "Expand"} ${accessibleLabel}`}
              data-testid={`open-item-toggle-${item.entityType}-${item.entityId}`}
              onClick={handleToggleChildren}
              size="small"
              sx={{
                color: "text.secondary",
                flexShrink: 0,
                height: 28,
                width: 28,
              }}
            >
              {isExpanded ? (
                <ExpandMoreIcon fontSize="small" />
              ) : (
                <ChevronRightIcon fontSize="small" />
              )}
            </IconButton>
          ) : (
            <Box sx={{ width: 28, flexShrink: 0 }} />
          )}
          <Box
            component={Link}
            to={path}
            onClick={(event: React.MouseEvent<HTMLAnchorElement>) => {
              if (
                !selectionMode ||
                event.button !== 0 ||
                event.metaKey ||
                event.ctrlKey ||
                event.altKey
              )
                return;
              event.preventDefault();
              onToggleSelection(item, event.shiftKey);
            }}
            aria-current={active ? "page" : undefined}
            sx={{
              minWidth: 0,
              flex: 1,
              px: 1,
              py: 0.75,
              display: "flex",
              alignItems: "center",
              gap: 1,
              color: "inherit",
              textDecoration: "none",
            }}
          >
            <Box
              sx={{
                position: "relative",
                width: 24,
                height: 24,
                flex: "0 0 24px",
              }}
            >
              {item.pinned === true ? (
                <PushPinOutlinedIcon
                  aria-label={`Pinned ${accessibleLabel}`}
                  data-testid={`open-item-pinned-indicator-${item.entityType}-${item.entityId}`}
                  fontSize="small"
                  sx={{
                    position: "absolute",
                    right: "calc(100% + 2px)",
                    top: "50%",
                    color: "primary.main",
                    transform: "translateY(-50%)",
                  }}
                />
              ) : null}
              {item.entityType === "task" && taskType ? (
                resolvedWorkItemIcon ? (
                  <ResolvedWorkItemIcon
                    IconComponent={resolvedWorkItemIcon}
                    taskType={taskType}
                    colors={resolvedPresentation!.colors}
                  />
                ) : null
              ) : (
                <EntityIcon
                  entityType={iconType}
                  agentSessionType={
                    item.presentation?.kind === "agent_session"
                      ? item.presentation.sessionType
                      : undefined
                  }
                  size={24}
                />
              )}
            </Box>
            {renderAgentSessionRowSignals(rowSignals)}
            <Typography
              variant="body2"
              noWrap
              sx={{
                fontWeight: active ? 600 : 400,
                fontSize: "0.875rem",
              }}
            >
              {label}
            </Typography>
            {starred ? (
              <StarIcon
                role="img"
                aria-hidden={false}
                aria-label={`Starred ${accessibleLabel}`}
                fontSize="small"
                sx={{ color: "warning.main", flexShrink: 0 }}
              />
            ) : null}
          </Box>
          <Stack direction="row" spacing={0.25} sx={{ flexShrink: 0, pr: 0.5 }}>
            <IconButton
              aria-label={`Preview ${accessibleLabel}`}
              data-testid={`open-item-preview-${item.entityType}-${item.entityId}`}
              onClick={handlePreview}
              size="small"
              sx={{
                color: "text.secondary",
                height: 28,
                width: 28,
              }}
            >
              <VisibilityOutlinedIcon fontSize="small" />
            </IconButton>
          </Stack>
        </Box>
      </OpenItemInteractionComponent>
      <Dialog
        ownerKey={isNoteDialogOpenOwnerKey}
        open={isNoteDialogOpen}
        onClose={handleCloseNoteDialog}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>
          {label ? `Note for ${label}` : "Open item note"}
        </DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            label="Note"
            margin="dense"
            minRows={4}
            multiline
            onChange={(event) => setNoteDraft(event.target.value)}
            value={noteDraft}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseNoteDialog}>Cancel</Button>
          <Button onClick={handleSaveNote} variant="contained">
            Save
          </Button>
        </DialogActions>
      </Dialog>
      {anchorEl && note ? (
        <Popper
          anchorEl={anchorEl}
          open
          placement="right-start"
          sx={{ zIndex: (theme) => theme.zIndex.tooltip }}
        >
          <Paper
            elevation={6}
            onMouseEnter={keepPreviewOpen}
            onMouseLeave={schedulePreviewClose}
            sx={{
              maxWidth: 320,
              ml: 1,
              p: 1.5,
            }}
          >
            <Typography
              data-testid={`open-item-note-${item.entityType}-${item.entityId}`}
              variant="body2"
              sx={{ whiteSpace: "pre-wrap" }}
            >
              {note}
            </Typography>
          </Paper>
        </Popper>
      ) : anchorEl ? (
        <EntityHoverCard
          entityId={item.entityId}
          entityType={item.entityType}
          organizationId={organizationId}
          projectId={projectId}
          anchorEl={anchorEl}
          placement="right-start"
          onPopoverMouseEnter={keepPreviewOpen}
          onPopoverMouseLeave={schedulePreviewClose}
        />
      ) : null}
    </>
  );
};

const OpenItemRow = React.memo(function OpenItemRow(props: OpenItemRowProps) {
  return <OpenItemRowContent {...props} />;
});

export const OpenItemsSection: React.FC<{
  organizationId: string;
  projectId: string;
  searchTerm?: string;
  onVisibleCountChange?: (count: number) => void;
}> = ({ organizationId, projectId, searchTerm = "", onVisibleCountChange }) => {
  const {
    items,
    groups,
    remove,
    removeItems,
    removeOthers,
    removeAllAbove,
    removeAllBelow,
    removeAll,
    setWhyOpen,
    pin,
    unpin,
    sortDirection,
    setSortDirection,
    disclosure,
    setSectionExpanded,
    setBranchExpanded,
    createGroup,
    assignToGroup,
    ungroup,
    renameGroup,
    deleteGroup,
    setGroupExpanded,
    setGoalExpanded,
  } = useOpenItems();
  const { workItemTypes } = useWorkItemTypes(organizationId, { projectId });
  const { isStarred } = useEntityStars(organizationId);
  const workItemTypeSources = useMemo(
    () =>
      new Map(
        workItemTypes.map((row) => [row.definition.key, row.effectiveSource]),
      ),
    [workItemTypes],
  );
  const workItemTypeDefinitions = useMemo(
    () => indexWorkItemTypeDefinitions(workItemTypes),
    [workItemTypes],
  );
  const [pendingBulkRemoval, setPendingBulkRemoval] = useState<{
    count: number;
    run: () => Promise<boolean>;
  } | null>(null);
  const gateBulkRemoval = useCallback(
    (
      scope: BulkRemovalScope,
      run: () => Promise<boolean>,
      identity?: OpenItemIdentity,
    ): Promise<boolean> => {
      const count = selectBulkRemovalTargets(items, scope, identity).length;
      if (count <= BULK_REMOVAL_CONFIRM_THRESHOLD) return run();
      setPendingBulkRemoval({ count, run });
      return Promise.resolve(false);
    },
    [items],
  );
  const handleConfirmBulkRemoval = useCallback(() => {
    const pending = pendingBulkRemoval;
    setPendingBulkRemoval(null);
    void pending?.run();
  }, [pendingBulkRemoval]);
  const gatedRemoveOthers = useCallback(
    (identity: OpenItemIdentity) =>
      gateBulkRemoval("others", () => removeOthers(identity), identity),
    [gateBulkRemoval, removeOthers],
  );
  const gatedRemoveAllAbove = useCallback(
    (identity: OpenItemIdentity) =>
      gateBulkRemoval("above", () => removeAllAbove(identity), identity),
    [gateBulkRemoval, removeAllAbove],
  );
  const gatedRemoveAllBelow = useCallback(
    (identity: OpenItemIdentity) =>
      gateBulkRemoval("below", () => removeAllBelow(identity), identity),
    [gateBulkRemoval, removeAllBelow],
  );
  const gatedRemoveAll = useCallback(
    () => gateBulkRemoval("all", removeAll),
    [gateBulkRemoval, removeAll],
  );
  const actions = useMemo<OpenItemRowActions>(
    () => ({
      remove,
      removeOthers: gatedRemoveOthers,
      removeAllAbove: gatedRemoveAllAbove,
      removeAllBelow: gatedRemoveAllBelow,
      removeAll: gatedRemoveAll,
      setWhyOpen,
      pin,
      unpin,
      sortDirection,
      setSortDirection,
    }),
    [
      pin,
      remove,
      gatedRemoveAll,
      gatedRemoveAllAbove,
      gatedRemoveAllBelow,
      gatedRemoveOthers,
      setWhyOpen,
      unpin,
      sortDirection,
      setSortDirection,
    ],
  );
  const resolveContextIdentities = useCallback(
    (identities: readonly OpenItemSelectionIdentity[]): OpenItemIdentity[] =>
      identities.flatMap((identity) => {
        const item = items.find(
          (candidate) =>
            candidate.entityId === identity.entityId &&
            candidate.entityType === identity.entityType,
        );
        return item
          ? [{ entityId: item.entityId, entityType: item.entityType }]
          : [];
      }),
    [items],
  );
  const groupActions = useMemo<OpenItemGroupActions>(
    () => ({
      groups: groups.map(({ id, name }) => ({ id, name })),
      onAssign: (groupId, identities) =>
        assignToGroup(groupId, resolveContextIdentities(identities)),
      onCreate: (name, identities) =>
        createGroup(name, resolveContextIdentities(identities)),
      onUngroup: (identities) => ungroup(resolveContextIdentities(identities)),
    }),
    [assignToGroup, createGroup, groups, resolveContextIdentities, ungroup],
  );
  const [renameTarget, setRenameTarget] = useState<OpenItemGroup | null>(null);
  const [promotionGroupId, setPromotionGroupId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [showActiveOnly, setShowActiveOnly] = useState(false);
  const toggleActiveOnly = useCallback(
    () => setShowActiveOnly((current) => !current),
    [],
  );
  const activeOnlyAction = useMemo<OpenItemActiveOnlyAction>(
    () => ({ enabled: showActiveOnly, onSelect: toggleActiveOnly }),
    [showActiveOnly, toggleActiveOnly],
  );
  const canonicalPage = useCurrentCanonicalPage();
  const activeIdentity = useMemo<OpenItemIdentity | null>(
    () =>
      canonicalPage
        ? {
            entityId: canonicalPage.entityId,
            entityType: canonicalPage.entityType,
          }
        : null,
    [canonicalPage],
  );
  const projectedItems = useMemo(
    () => projectOpenItems(items, sortDirection, undefined, groups),
    [groups, items, sortDirection],
  );
  const visibleProjectedItems = useMemo(
    () => filterProjectedOpenItems(projectedItems, searchTerm),
    [projectedItems, searchTerm],
  );
  const disclosureRef = useRef(disclosure);
  disclosureRef.current = disclosure;
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const visibleAgentSessionIds = useMemo<string[]>(
    () =>
      Array.from(
        new Set(
          visibleProjectedItems
            .filter(({ item }) => item.entityType === "agent_session")
            .map(({ item }) => item.entityId),
        ),
      ),
    [visibleProjectedItems],
  );
  const visibleConversationIds = useMemo<string[]>(
    () =>
      Array.from(
        new Set(
          visibleProjectedItems.flatMap(({ item }) => {
            if (item.entityType === "conversation") return [item.entityId];
            if (
              item.entityType === "agent_session" &&
              item.presentation?.kind === "agent_session"
            ) {
              const conversationId =
                item.presentation.entityConversationRoute?.conversationId;
              return conversationId ? [conversationId] : [];
            }
            return [];
          }),
        ),
      ),
    [visibleProjectedItems],
  );
  const conversationPhaseById = useConversationPhases(visibleConversationIds);
  const { currentStateById } = useAgentSessionCurrentStates(
    organizationId,
    projectId,
    visibleAgentSessionIds,
  );
  const outputAttentionById = useAgentSessionOutputAttentions(
    organizationId,
    projectId,
    visibleAgentSessionIds,
  );
  const agentSessionSignalInputs = useCallback(
    (item: OpenItem) => {
      const conversationId =
        item.presentation?.kind === "agent_session"
          ? item.presentation.entityConversationRoute?.conversationId
          : undefined;
      return {
        currentState: currentStateById[item.entityId]?.currentState,
        outputAttentionState: outputAttentionById[item.entityId]?.state,
        conversationPhase: conversationId
          ? conversationPhaseById[conversationId]?.phase
          : undefined,
      };
    },
    [conversationPhaseById, currentStateById, outputAttentionById],
  );
  const { items: activeOnlyProjectedItems, hiddenCount: inactiveHiddenCount } =
    useMemo(
      () =>
        showActiveOnly
          ? filterProjectedOpenItemsByActivity(
              visibleProjectedItems,
              (item) => {
                const {
                  currentState,
                  outputAttentionState,
                  conversationPhase,
                } = agentSessionSignalInputs(item);
                return isActiveAgentSessionForOpenItems(
                  currentState,
                  outputAttentionState,
                  conversationPhase,
                );
              },
            )
          : { items: visibleProjectedItems, hiddenCount: 0 },
      [agentSessionSignalInputs, showActiveOnly, visibleProjectedItems],
    );
  // Counts and indicators are taken before branch collapse so collapsing a
  // nested branch never shrinks a group's totals.
  const groupSummaries = useMemo(() => {
    const summaries = new Map<
      string,
      {
        total: number;
        active: number;
        activeSessionSignals: ReturnType<
          typeof getAgentSessionRowSignalPresentation
        >[];
      }
    >();
    const summaryFor = (groupId: string) => {
      let summary = summaries.get(groupId);
      if (!summary) {
        summary = { total: 0, active: 0, activeSessionSignals: [] };
        summaries.set(groupId, summary);
      }
      return summary;
    };
    for (const { groupId, item } of visibleProjectedItems) {
      if (!groupId) continue;
      const summary = summaryFor(groupId);
      summary.total += 1;
      if (item.entityType !== "agent_session") continue;
      const { currentState, outputAttentionState, conversationPhase } =
        agentSessionSignalInputs(item);
      if (
        !isActiveAgentSessionForOpenItems(
          currentState,
          outputAttentionState,
          conversationPhase,
        )
      ) {
        continue;
      }
      summary.activeSessionSignals.push(
        getAgentSessionRowSignalPresentation(
          currentState,
          outputAttentionState ===
            AgentSessionOutputAttentionState.MessageReady,
          conversationPhase,
        ),
      );
    }
    for (const { groupId } of activeOnlyProjectedItems) {
      if (groupId) summaryFor(groupId).active += 1;
    }
    return summaries;
  }, [
    activeOnlyProjectedItems,
    agentSessionSignalInputs,
    visibleProjectedItems,
  ]);
  const expandableOpenItemKeys = useMemo(
    () => expandableProjectedOpenItemKeys(activeOnlyProjectedItems),
    [activeOnlyProjectedItems],
  );
  const renderedProjectedItems = useMemo(
    () =>
      collapseProjectedOpenItems(
        activeOnlyProjectedItems,
        disclosure.collapsedBranchKeys,
      ),
    [activeOnlyProjectedItems, disclosure.collapsedBranchKeys],
  );
  const selectableItems = useMemo(
    () =>
      disclosure.sectionExpanded
        ? renderedProjectedItems
            .filter(
              ({ groupId }) =>
                !groups.some(
                  (group) => group.id === groupId && group.collapsed,
                ),
            )
            .map(({ item }) => item)
        : [],
    [disclosure.sectionExpanded, groups, renderedProjectedItems],
  );
  const {
    selected,
    mode: selectionMode,
    toggle,
    enter,
    clear,
  } = useOpenItemsSelection(
    JSON.stringify([organizationId, projectId]),
    selectableItems,
  );
  useEffect(() => {
    if (!selectionMode) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        !(event.target instanceof HTMLInputElement) &&
        !(event.target instanceof HTMLTextAreaElement)
      )
        clear();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [clear, selectionMode]);
  const handleRemoveSelected = useCallback(
    (identities: readonly OpenItemSelectionIdentity[]) => {
      return removeItems(resolveContextIdentities(identities), true);
    },
    [removeItems, resolveContextIdentities],
  );
  const handleToggleOpenItemChildren = useCallback(
    (itemKey: string) => {
      const goal = itemsRef.current.find(
        (item) => item.entityType === "goal" && openItemKey(item) === itemKey,
      );
      if (goal) {
        void setGoalExpanded(goal.entityId, goal.goalCollapsed ?? true);
        return;
      }
      setBranchExpanded(
        itemKey,
        disclosureRef.current.collapsedBranchKeys.has(itemKey),
      );
    },
    [setGoalExpanded, setBranchExpanded],
  );
  useEffect(() => {
    onVisibleCountChange?.(activeOnlyProjectedItems.length);
  }, [activeOnlyProjectedItems.length, onVisibleCountChange]);
  const { mode } = useTheme();
  const isExpanded = disclosure.sectionExpanded;
  const headerColor = mode === "light" ? "heyhey.main" : "cadetblue";
  const handleToggleExpanded = useCallback(() => {
    setSectionExpanded(!disclosure.sectionExpanded);
  }, [disclosure.sectionExpanded, setSectionExpanded]);
  const handleRename = useCallback((group: OpenItemGroup) => {
    setRenameTarget(group);
    setRenameDraft(group.name);
  }, []);
  const handleSaveRename = useCallback(async () => {
    if (!renameTarget || !renameDraft.trim()) return;
    if (await renameGroup(renameTarget.id, renameDraft)) setRenameTarget(null);
  }, [renameDraft, renameGroup, renameTarget]);
  const renderRow = (item: OpenItem, depth: number, sourceIndex: number) => (
    <React.Fragment key={`${item.entityType}:${item.entityId}`}>
      <OpenItemRow
        starred={isStarred(
          item.entityType === "goal"
            ? EntityType.Task
            : (targetTypeFor(item) as EntityType),
          item.entityId,
        )}
        selectedItems={selected}
        selectionMode={selectionMode}
        onEnterSelection={enter}
        onToggleSelection={toggle}
        onRemoveSelected={handleRemoveSelected}
        index={sourceIndex}
        itemCount={items.length}
        item={item}
        depth={depth}
        active={matchesOpenItemIdentity(item, activeIdentity)}
        hasChildren={
          item.entityType === "goal" ||
          expandableOpenItemKeys.has(openItemKey(item))
        }
        isExpanded={
          item.entityType === "goal"
            ? !(item.goalCollapsed ?? true)
            : !disclosure.collapsedBranchKeys.has(openItemKey(item))
        }
        actions={actions}
        groupActions={groupActions}
        activeOnlyAction={activeOnlyAction}
        organizationId={organizationId}
        projectId={projectId}
        currentState={
          item.entityType === "agent_session"
            ? currentStateById[item.entityId]?.currentState
            : undefined
        }
        outputAttentionState={
          item.entityType === "agent_session"
            ? outputAttentionById[item.entityId]?.state
            : undefined
        }
        conversationPhase={
          item.entityType === "conversation"
            ? conversationPhaseById[item.entityId]?.phase
            : item.entityType === "agent_session" &&
                item.presentation?.kind === "agent_session"
              ? conversationPhaseById[
                  item.presentation.entityConversationRoute?.conversationId ??
                    ""
                ]?.phase
              : undefined
        }
        workItemTypeDefinitions={workItemTypeDefinitions}
        workItemTypeSources={workItemTypeSources}
        onToggleChildren={handleToggleOpenItemChildren}
      />
      {item.entityType === "goal" && item.goalCollapsed === false && (
        <OpenItemGoalWork
          organizationId={organizationId}
          projectId={projectId}
          goalId={item.entityId}
          filter={
            item.goalTrackedWorkFilter ??
            OpenItemGoalTrackedWorkFilter.ActiveAndBacklog
          }
          depth={depth}
          renderItem={(child, childDepth) =>
            renderRow(child, childDepth, sourceIndex)
          }
        />
      )}
    </React.Fragment>
  );
  const renderRows = (rows: typeof renderedProjectedItems) =>
    rows.map(({ depth, item, sourceIndex }) =>
      renderRow(item, depth, sourceIndex),
    );

  return (
    <>
      <Box data-testid="open-items-section">
        <Box
          sx={{
            position: "relative",
            display: "flex",
            alignItems: "center",
            gap: 0.5,
            mb: 0.5,
          }}
        >
          <OpenItemsSyncStatus />
          <IconButton
            size="small"
            onClick={handleToggleExpanded}
            sx={{ color: headerColor, flexShrink: 0 }}
            aria-label={`${isExpanded ? "Collapse" : "Expand"} open`}
            aria-controls={OPEN_ITEMS_ROW_TREE_ID}
            aria-expanded={isExpanded}
          >
            {isExpanded ? (
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
            }}
          >
            <Typography
              variant="body2"
              sx={{
                fontWeight: 600,
                letterSpacing: 0.5,
                textTransform: "uppercase",
                fontSize: "0.8125rem",
                color: headerColor,
                textAlign: "left",
              }}
            >
              OPEN ({activeOnlyProjectedItems.length})
            </Typography>
            {selectionMode && (
              <Typography
                variant="caption"
                sx={{ ml: "auto", color: "primary.main" }}
              >
                Selecting {selected.length} · Esc to clear
              </Typography>
            )}
          </Box>
          <Stack direction="row" spacing={0.25} sx={{ flexShrink: 0, pr: 0.5 }}>
            <OpenItemsTriageAction
              organizationId={organizationId}
              projectId={projectId}
            />
          </Stack>
        </Box>
        <Collapse in={isExpanded} timeout={200} unmountOnExit>
          <Stack
            id={OPEN_ITEMS_ROW_TREE_ID}
            data-testid={OPEN_ITEMS_ROW_TREE_ID}
            spacing={0.5}
            useFlexGap
          >
            {groups.map((group) => {
              const groupRows = renderedProjectedItems.filter(
                ({ groupId }) => groupId === group.id,
              );
              const summary = groupSummaries.get(group.id);
              return (
                <OpenItemsGroupDropTarget
                  key={group.id}
                  groupId={group.id}
                  items={items}
                  onAssign={assignToGroup}
                >
                  <OpenItemsGroupHeader
                    group={group}
                    totalCount={summary?.total ?? 0}
                    activeCount={showActiveOnly ? (summary?.active ?? 0) : null}
                    activeSessionSignals={summary?.activeSessionSignals ?? []}
                    onToggle={(groupId, expanded) =>
                      setGroupExpanded(groupId, expanded)
                    }
                    onRename={handleRename}
                    onPromote={setPromotionGroupId}
                    onDelete={deleteGroup}
                  />
                  <Collapse
                    in={!group.collapsed}
                    timeout={150}
                    unmountOnExit
                    id={`open-items-group-tree-${group.id}`}
                  >
                    <Stack spacing={0.5}>{renderRows(groupRows)}</Stack>
                  </Collapse>
                  <Box
                    role="separator"
                    aria-orientation="horizontal"
                    data-testid="open-items-group-separator"
                    data-group-id={group.id}
                    sx={{
                      mx: 1,
                      mt: 0.5,
                      borderBottom: 1,
                      borderColor: (theme) =>
                        theme.palette.mode === "light"
                          ? alpha(theme.palette.text.primary, 0.18)
                          : alpha(theme.palette.divider, 0.65),
                    }}
                  />
                </OpenItemsGroupDropTarget>
              );
            })}
            {renderRows(
              renderedProjectedItems.filter(({ groupId }) => !groupId),
            )}
            {inactiveHiddenCount > 0 && (
              <Typography
                variant="caption"
                color="text.secondary"
                data-testid="open-items-inactive-hidden-count"
                sx={{ px: 2, py: 0.5 }}
              >
                {`${inactiveHiddenCount} inactive ${inactiveHiddenCount === 1 ? "item" : "items"} hidden`}
              </Typography>
            )}
          </Stack>
        </Collapse>
      </Box>
      {promotionGroupId && (
        <OpenItemsPromotionDialog
          key={promotionGroupId}
          groupId={promotionGroupId}
          onClose={() => setPromotionGroupId(null)}
        />
      )}
      <Dialog
        open={pendingBulkRemoval !== null}
        onClose={() => setPendingBulkRemoval(null)}
        aria-labelledby="open-items-bulk-remove-dialog-title"
        data-testid="open-items-bulk-remove-dialog"
      >
        <DialogTitle id="open-items-bulk-remove-dialog-title">
          Remove {pendingBulkRemoval?.count} Open Items?
        </DialogTitle>
        <DialogContent>
          <Typography>
            This will remove {pendingBulkRemoval?.count} items from Open.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => setPendingBulkRemoval(null)}
            data-testid="open-items-bulk-remove-cancel"
          >
            Cancel
          </Button>
          <Button
            variant="contained"
            color="error"
            onClick={handleConfirmBulkRemoval}
            data-testid="open-items-bulk-remove-confirm"
          >
            Remove
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog
        open={renameTarget !== null}
        onClose={() => setRenameTarget(null)}
        aria-labelledby="open-item-group-rename-dialog-title"
      >
        <DialogTitle id="open-item-group-rename-dialog-title">
          Rename Open Items group
        </DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            label="Group name"
            value={renameDraft}
            onChange={(event) => setRenameDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                handleSaveRename();
              }
            }}
            inputProps={{ maxLength: 80 }}
            data-testid="open-items-group-rename-input"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRenameTarget(null)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleSaveRename}
            disabled={!renameDraft.trim()}
            data-testid="open-items-group-rename-save"
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};
