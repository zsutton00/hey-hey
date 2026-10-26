import { useModalState } from "../Modals/useModalState";
import { useModal } from "../../contexts/ModalContext";
import { FunctionalDialog as Dialog } from "../Modals/FunctionalDialog";
import { draggedEntities } from "../../types/dragAndDrop";
import ClearIcon from "@mui/icons-material/Clear";
import DeleteSweepOutlinedIcon from "@mui/icons-material/DeleteSweepOutlined";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import FolderOutlinedIcon from "@mui/icons-material/FolderOutlined";
import MyLocationOutlinedIcon from "@mui/icons-material/MyLocationOutlined";
import PushPinOutlinedIcon from "@mui/icons-material/PushPinOutlined";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import React, {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { keyframes } from "@emotion/react";
import {
  Box,
  Button,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  MenuItem,
  TextField,
  Tooltip,
} from "@mui/material";
import { useNavigate } from "react-router-dom";
import { useDroppable } from "@dnd-kit/core";
import {
  DesignDocParentEntityType,
  EntityType,
  TargetEntityType,
} from "../../api";
import { navigateToEntity } from "../WebUtils/navigateToEntity";
import type { DropEvent } from "../../types/dragAndDrop";
import { useEntityDragSource } from "./useEntityDragSource";
import type { UseEntityDragSourceResult } from "./useEntityDragSource";
import { useEntityContext } from "../../data/hooks/useEntityContext";
import { useWorkItem } from "../../data/hooks/useWorkItem";
import type { SearchEntity } from "../SmarterTextAreaCard";
import { normalizeEntityType } from "../entityTypeUtils";
import { useWorkItemUpdateMethods } from "../../data/hooks/useWorkItemUpdateMethods";
import { useReparentDesignDoc } from "../../data/hooks/useReparentDesignDoc";
import { useAttachToGoal } from "../../data/hooks/useAttachToGoal";
import { useWorkItemTypeTrackingEligibility } from "../../data/hooks/useWorkItemTypes";
import { useCanonicalPlanMutations } from "../../data/hooks/useCanonicalPlanMutations";
import { useDndContextSafe } from "../../contexts/DndContext";
import { usePathService } from "../../contexts/PathServiceContext";
import { usePreviewHost } from "../../contexts/PreviewHostContext";
import { useOpenItemLocator } from "../../contexts/OpenItemLocatorContext";
import { createOpenItemEntity } from "../../types/openItems";
import type {
  InteractionComponentProps,
  InlineInteractionAction,
  InlineInteractionActionName,
  InteractionSurfaceMenuProps,
  InteractionSurfaceProps,
  LineageContext,
  MenuAction,
  MenuContribution,
  MenuContributionContext,
  OpenItemActions,
  OpenItemGroupActions,
  OpenItemInteractionComponentProps,
  WhyOpenAction,
} from "./types";
import { useInteractionState } from "./useInteractionState";
import { ContextMenu } from "./ContextMenu";
import { GoalPickerModal } from "./GoalPickerModal";
import { ViewHistoryModal } from "./ViewHistoryModal";
import {
  resolveEntityTypeConfig,
  buildDefaultMenuContributions,
  composeMenuContributions,
  mcpToolsToMenuItems,
  type EntityMenuItem,
  type PreviewCapability,
} from "./entityTypeRegistry";
import {
  useIndicatorCorner,
  CORNER_POSITIONS,
  CORNER_PRIORITY,
  type IndicatorCorner,
} from "./useIndicatorCorner";
import {
  toGuidableEntityFromExplorer,
  type GuidableTargetAddress,
} from "../GuidedWalkthrough/types";
import { useGuidableTarget } from "../GuidedWalkthrough/useGuidableTarget";
import {
  buttonColors,
  discussColor,
} from "../ActionsCapsule/capsuleActionButtonColors";

const twinkleAnimation = keyframes`
  0%   { transform: scale(1) rotate(0deg); }
  30%  { transform: scale(1.35) rotate(20deg); }
  60%  { transform: scale(0.85) rotate(-10deg); }
  80%  { transform: scale(1.15) rotate(8deg); }
  100% { transform: scale(1) rotate(0deg); }
`;

const colorPulseAnimation = keyframes`
  0%   { filter: brightness(1); }
  50%  { filter: brightness(1.5); }
  100% { filter: brightness(1); }
`;

const inlineActionIconStyles: Record<
  InlineInteractionActionName,
  React.CSSProperties
> = {
  discuss: { backgroundColor: discussColor, color: "#fff" },
  create_task: { backgroundColor: buttonColors[0], color: "#fff" },
  create_bug: { backgroundColor: buttonColors[1], color: "#fff" },
};

const DROP_TARGET_ID_PREFIXES = {
  task: "interaction-drop",
  designDoc: "interaction-designdoc-drop",
  goal: "interaction-goal-drop",
  plan: "interaction-plan-drop",
} as const;

const toGeneratedEntityType = (value: string): EntityType | undefined => {
  const entityType = value.toUpperCase();
  return (Object.values(EntityType) as string[]).includes(entityType)
    ? (entityType as EntityType)
    : undefined;
};

type DropTargetIdPrefix =
  (typeof DROP_TARGET_ID_PREFIXES)[keyof typeof DROP_TARGET_ID_PREFIXES];

function useDropTargetId(
  prefix: DropTargetIdPrefix,
  entityId: string,
  idScope?: string,
): string {
  const mountedInstanceId = useId();
  const instanceScope = idScope
    ? `${idScope}-${mountedInstanceId}`
    : mountedInstanceId;

  return `${prefix}-${entityId}-${instanceScope}`;
}

// Isolated sub-component so that dnd-kit hooks and work-item update methods
// are only instantiated for task entities, not every InteractionComponent.
const TaskDropTarget: React.FC<{
  entityId: string;
  organizationId: string;
  projectId: string;
  idScope?: string;
}> = ({ entityId, organizationId, projectId, idScope }) => {
  const { updateTask } = useWorkItemUpdateMethods(
    organizationId,
    "task",
    projectId,
  );
  const dndState = useDndContextSafe();
  const accepts = (content: DropEvent["content"] | null | undefined) => {
    const entities = draggedEntities(content);
    return (
      entities.length > 0 &&
      entities.every(
        (entity) =>
          entity.entityType === TargetEntityType.Task &&
          entity.entityId !== entityId &&
          (content?.type !== "entities" || entity.entitySubtype !== "PLAN"),
      )
    );
  };
  const activeDragAccepted = accepts(dndState?.activeContent);
  const handleDrop = (event: DropEvent) => {
    if (!accepts(event.content)) return;
    for (const entity of draggedEntities(event.content)) {
      updateTask(entity.entityId, { parentTaskId: entityId });
    }
  };

  // Disable when this entity is the one being dragged to prevent self-drop.
  // Also disable when no task drag is active to avoid spurious isOver events.
  const dropId = useDropTargetId(
    DROP_TARGET_ID_PREFIXES.task,
    entityId,
    idScope,
  );
  const { setNodeRef, isOver } = useDroppable({
    id: dropId,
    disabled: !activeDragAccepted,
    data: { onDrop: handleDrop },
  });

  return (
    <Box
      ref={setNodeRef}
      aria-hidden
      sx={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        backgroundColor: "primary.main",
        opacity: isOver ? 0.15 : 0,
        transition: "opacity 0.1s ease",
        zIndex: 1,
      }}
    />
  );
};

// Isolated sub-component so the design-doc reparent hook is only instantiated
// for entities that can host a design doc (Task or DesignDoc). Mounted in
// parallel with TaskDropTarget so a Task entity accepts both task→task and
// designDoc→task drags without one swallowing the other's drop event.
const DesignDocDropTarget: React.FC<{
  entityId: string;
  entityType: TargetEntityType;
  organizationId: string;
  idScope?: string;
}> = ({ entityId, entityType, organizationId, idScope }) => {
  const { reparent } = useReparentDesignDoc(organizationId);
  const dndState = useDndContextSafe();
  const accepts = (content: DropEvent["content"] | null | undefined) => {
    const entities = draggedEntities(content);
    return (
      entities.length > 0 &&
      entities.every(
        (entity) =>
          entity.entityType === TargetEntityType.DesignDoc &&
          entity.entityId !== entityId,
      )
    );
  };
  const activeDragAccepted = accepts(dndState?.activeContent);
  const isDragging = dndState?.isDragging ?? false;

  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // A new drag clears any lingering error from the previous attempt.
  useEffect(() => {
    if (isDragging && errorMessage) {
      setErrorMessage(null);
    }
  }, [isDragging, errorMessage]);

  const targetParentType =
    entityType === TargetEntityType.Task
      ? DesignDocParentEntityType.Task
      : DesignDocParentEntityType.DesignDoc;

  const handleDrop = (event: DropEvent) => {
    if (!accepts(event.content)) return;
    for (const entity of draggedEntities(event.content)) {
      void reparent(entity.entityId, entityId, targetParentType).catch(
        (err: unknown) => {
          setErrorMessage(
            err instanceof Error ? err.message : "Failed to move design doc",
          );
        },
      );
    }
  };

  const dropId = useDropTargetId(
    DROP_TARGET_ID_PREFIXES.designDoc,
    entityId,
    idScope,
  );
  const { setNodeRef, isOver } = useDroppable({
    id: dropId,
    disabled: !activeDragAccepted,
    data: { onDrop: handleDrop },
  });

  const handleDismissError = useCallback(() => {
    setErrorMessage(null);
  }, []);

  const overlay = (
    <Box
      ref={setNodeRef}
      aria-hidden
      onClick={errorMessage ? handleDismissError : undefined}
      sx={{
        position: "absolute",
        inset: 0,
        pointerEvents: errorMessage ? "auto" : "none",
        backgroundColor: errorMessage ? "error.main" : "primary.main",
        opacity: errorMessage ? 0.15 : isOver ? 0.15 : 0,
        outline: errorMessage ? "2px solid" : "none",
        outlineColor: "error.main",
        outlineOffset: -2,
        transition: "opacity 0.1s ease",
        zIndex: 1,
      }}
    />
  );

  if (errorMessage) {
    return (
      <Tooltip
        title={errorMessage}
        open
        arrow
        placement="top"
        slotProps={{
          tooltip: { sx: { bgcolor: "error.main" } },
          arrow: { sx: { color: "error.main" } },
        }}
      >
        {overlay}
      </Tooltip>
    );
  }

  return overlay;
};

// Isolated sub-component mounted only when the host is a Goal task. Treats
// the host's entityId as the goal id and uses the dragged entity as the
// target. Accepts Task drags (non-GOAL subtype) and Plan drags; other
// types do not light up the overlay nor invoke the attach call. Re-drops of
// an already-tracked entity resolve silently because the backend returns
// `created:false` on idempotent re-attach.
const GoalDropTarget: React.FC<{
  entityId: string;
  organizationId: string;
  projectId: string;
  idScope?: string;
}> = ({ entityId, organizationId, projectId, idScope }) => {
  const { attach } = useAttachToGoal({ organizationId, projectId });
  const dndState = useDndContextSafe();

  const accepts = (content: DropEvent["content"] | null | undefined) => {
    const entities = draggedEntities(content);
    return (
      entities.length > 0 &&
      entities.every(
        (entity) =>
          entity.entityId !== entityId &&
          entity.entityType === TargetEntityType.Task &&
          entity.entitySubtype !== "GOAL",
      )
    );
  };
  const isAcceptableActiveDrag = accepts(dndState?.activeContent);
  const isDragging = dndState?.isDragging ?? false;

  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (isDragging && errorMessage) {
      setErrorMessage(null);
    }
  }, [isDragging, errorMessage]);

  const handleDrop = (event: DropEvent) => {
    if (!accepts(event.content)) return;
    for (const entity of draggedEntities(event.content)) {
      void attach({
        goalId: entityId,
        targetEntityId: entity.entityId,
        targetEntityType: EntityType.Task,
      }).catch((err: unknown) => {
        setErrorMessage(
          err instanceof Error ? err.message : "Failed to attach to goal",
        );
      });
    }
  };

  const dropId = useDropTargetId(
    DROP_TARGET_ID_PREFIXES.goal,
    entityId,
    idScope,
  );
  const { setNodeRef, isOver } = useDroppable({
    id: dropId,
    disabled: !isAcceptableActiveDrag,
    data: { onDrop: handleDrop },
  });

  const handleDismissError = useCallback(() => {
    setErrorMessage(null);
  }, []);

  const overlay = (
    <Box
      ref={setNodeRef}
      aria-hidden
      onClick={errorMessage ? handleDismissError : undefined}
      sx={{
        position: "absolute",
        inset: 0,
        pointerEvents: errorMessage ? "auto" : "none",
        backgroundColor: errorMessage ? "error.main" : "primary.main",
        opacity: errorMessage ? 0.15 : isOver ? 0.15 : 0,
        outline: errorMessage ? "2px solid" : "none",
        outlineColor: "error.main",
        outlineOffset: -2,
        transition: "opacity 0.1s ease",
        zIndex: 1,
      }}
    />
  );

  if (errorMessage) {
    return (
      <Tooltip
        title={errorMessage}
        open
        arrow
        placement="top"
        slotProps={{
          tooltip: { sx: { bgcolor: "error.main" } },
          arrow: { sx: { color: "error.main" } },
        }}
      >
        {overlay}
      </Tooltip>
    );
  }

  return overlay;
};

// Isolated sub-component mounted only when the host is a Feature task.
// Batch drops are deliberately rejected: this target resolves one plan parent
// for its no-op guard. It must never move just the source of a batch.
// Accepts Plan drags and reparents the dragged plan beneath the host
// feature through the generic Work Item mutation. The current-parent no-op
// guard resolves the dragged Plan's parentTaskId from the Work Item cache,
// how DesignDocDropTarget/useReparentDesignDoc look up the dragged doc.
const PlanDropTarget: React.FC<{
  entityId: string;
  organizationId: string;
  projectId: string;
  idScope?: string;
}> = ({ entityId, organizationId, projectId, idScope }) => {
  const { updatePlan } = useCanonicalPlanMutations(organizationId, projectId);
  const dndState = useDndContextSafe();
  const activeDragEntityId =
    dndState?.activeContent?.type === "entity" &&
    dndState.activeContent.data.entityType === TargetEntityType.Task &&
    dndState.activeContent.data.entitySubtype === "PLAN"
      ? dndState.activeContent.data.entityId
      : null;
  const isDragging = dndState?.isDragging ?? false;
  const draggedPlanQuery = useWorkItem(
    organizationId,
    "task",
    activeDragEntityId ?? "",
    {
      projectId,
      enabled: activeDragEntityId !== null,
    },
  );

  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // A new drag clears any lingering error from the previous attempt.
  useEffect(() => {
    if (isDragging && errorMessage) {
      setErrorMessage(null);
    }
  }, [isDragging, errorMessage]);

  const handleDrop = useCallback(
    (event: DropEvent) => {
      if (
        event.content.type !== "entity" ||
        event.content.data.entityType !== TargetEntityType.Task ||
        event.content.data.entitySubtype !== "PLAN" ||
        event.content.data.entityId === entityId
      ) {
        return;
      }
      const planId = event.content.data.entityId;
      // Skip the update when the plan already sits under this feature.
      const cachedPlan =
        draggedPlanQuery.workItem?.id === planId
          ? draggedPlanQuery.workItem
          : null;
      if (cachedPlan && (cachedPlan.parentTaskId ?? null) === entityId) {
        return;
      }
      void updatePlan(planId, { parentTaskId: entityId }).catch(
        (err: unknown) => {
          const message =
            err instanceof Error ? err.message : "Failed to move plan";
          setErrorMessage(message);
        },
      );
    },
    [draggedPlanQuery.workItem, entityId, updatePlan],
  );

  const dropId = useDropTargetId(
    DROP_TARGET_ID_PREFIXES.plan,
    entityId,
    idScope,
  );
  const { setNodeRef, isOver } = useDroppable({
    id: dropId,
    disabled: !activeDragEntityId || activeDragEntityId === entityId,
    data: { onDrop: handleDrop },
  });

  const handleDismissError = useCallback(() => {
    setErrorMessage(null);
  }, []);

  const overlay = (
    <Box
      ref={setNodeRef}
      aria-hidden
      onClick={errorMessage ? handleDismissError : undefined}
      sx={{
        position: "absolute",
        inset: 0,
        pointerEvents: errorMessage ? "auto" : "none",
        backgroundColor: errorMessage ? "error.main" : "primary.main",
        opacity: errorMessage ? 0.15 : isOver ? 0.15 : 0,
        outline: errorMessage ? "2px solid" : "none",
        outlineColor: "error.main",
        outlineOffset: -2,
        transition: "opacity 0.1s ease",
        zIndex: 1,
      }}
    />
  );

  if (errorMessage) {
    return (
      <Tooltip
        title={errorMessage}
        open
        arrow
        placement="top"
        slotProps={{
          tooltip: { sx: { bgcolor: "error.main" } },
          arrow: { sx: { color: "error.main" } },
        }}
      >
        {overlay}
      </Tooltip>
    );
  }

  return overlay;
};

const SIZE_CONFIG = {
  small: { iconSize: 18, offset: 6 },
  medium: { iconSize: 24, offset: 8 },
  large: { iconSize: 32, offset: 10 },
} as const;

const PREVIEW_MENU_ITEM: EntityMenuItem = {
  action: "preview",
  label: "Preview",
  icon: VisibilityOutlinedIcon,
  testId: "interaction-menu-preview",
};

const SHOW_IN_OPEN_ITEMS_MENU_ITEM: EntityMenuItem = {
  action: "show_in_open_items",
  label: "Show in open items",
  icon: MyLocationOutlinedIcon,
  testId: "interaction-menu-show-in-open-items",
};

const OPEN_ITEM_PIN_MENU_ITEMS = {
  pin: {
    action: "pin_open_item",
    label: "Pin",
    icon: PushPinOutlinedIcon,
    testId: "interaction-menu-pin",
  },
  unpin: {
    action: "unpin_open_item",
    label: "Unpin",
    icon: PushPinOutlinedIcon,
    testId: "interaction-menu-unpin",
  },
} as const satisfies Record<string, EntityMenuItem>;

const OPEN_ITEM_SORT_MENU_ITEMS = {
  newest: {
    action: "sort_open_items_newest",
    label: "Sort by newest",
    testId: "interaction-menu-sort-open-items",
  },
  oldest: {
    action: "sort_open_items_oldest",
    label: "Sort by oldest",
    testId: "interaction-menu-sort-open-items",
  },
} as const satisfies Record<string, EntityMenuItem>;

const REMOVE_FROM_OPEN_MENU_ITEM: EntityMenuItem = {
  action: "remove_from_open",
  label: "Remove from Open",
  icon: ClearIcon,
  testId: "interaction-menu-remove-from-open",
};
const SELECT_OPEN_ITEMS_MENU_ITEM: EntityMenuItem = {
  action: "select_open_items",
  label: "Select items",
  testId: "interaction-menu-select-open-items",
};
const SHOW_ACTIVE_ONLY_MENU_ITEM_ACTION = "toggle_open_items_active_only";

const OPEN_ITEM_BULK_MENU_ITEMS = {
  removeOthers: {
    action: "remove_open_others",
    label: "Remove Others",
    icon: DeleteSweepOutlinedIcon,
    testId: "interaction-menu-remove-open-others",
  },
  removeAllAbove: {
    action: "remove_open_above",
    label: "Remove All Above",
    icon: DeleteSweepOutlinedIcon,
    testId: "interaction-menu-remove-open-above",
  },
  removeAllBelow: {
    action: "remove_open_below",
    label: "Remove All Below",
    icon: DeleteSweepOutlinedIcon,
    testId: "interaction-menu-remove-open-below",
  },
  removeAll: {
    action: "remove_all_open",
    label: "Remove All",
    icon: DeleteSweepOutlinedIcon,
    testId: "interaction-menu-remove-all-open",
  },
} as const satisfies Record<string, EntityMenuItem>;

const ADD_TO_OPEN_ITEM_GROUP_ACTION = "add_to_open_item_group";
const REMOVE_FROM_OPEN_ITEM_GROUP_ACTION = "remove_from_open_item_group";
const NEW_OPEN_ITEM_GROUP_OPTION = "__new_open_item_group__";
const NEW_OPEN_ITEM_GROUP_ACTION = "new_open_item_group";
const ASSIGN_OPEN_ITEM_GROUP_PREFIX = "assign_open_item_group:";

const buildOpenItemGroupPrimaryMenuItems = (
  groupActions: OpenItemGroupActions | undefined,
  multipleSelected: boolean,
): EntityMenuItem[] => {
  if (!groupActions) return [];
  const { currentGroupId } = groupActions;
  const targetGroups = groupActions.groups.filter(
    (group) => group.id !== currentGroupId,
  );
  const assignItem: EntityMenuItem = {
    action: ADD_TO_OPEN_ITEM_GROUP_ACTION,
    label: currentGroupId
      ? multipleSelected
        ? "Move items to group"
        : "Move to group"
      : multipleSelected
        ? "Add items to group"
        : "Add to group",
    icon: FolderOutlinedIcon,
    testId: "interaction-menu-add-to-group",
    ...(targetGroups.length > 0
      ? {
          submenu: [
            ...targetGroups.map((group) => ({
              action: `${ASSIGN_OPEN_ITEM_GROUP_PREFIX}${group.id}`,
              label: group.name,
              testId: `interaction-menu-group-${group.id}`,
              dataGroupId: group.id,
            })),
            {
              action: NEW_OPEN_ITEM_GROUP_ACTION,
              label: "Add New",
              testId: "interaction-menu-group-add-new",
            },
          ],
        }
      : {}),
  };
  return currentGroupId
    ? [
        assignItem,
        {
          action: REMOVE_FROM_OPEN_ITEM_GROUP_ACTION,
          label: multipleSelected
            ? "Remove items from group"
            : "Remove from group",
          icon: FolderOutlinedIcon,
          testId: "interaction-menu-remove-from-group",
        },
      ]
    : [assignItem];
};

function buildLineageContext(
  entityId: string,
  entityType: InteractionComponentProps["entityType"],
  entityTitle?: string,
  entitySubtype?: string,
): LineageContext {
  return {
    entityId,
    entityType,
    ...(entityTitle !== undefined ? { entityTitle } : {}),
    ...(entitySubtype !== undefined ? { entitySubtype } : {}),
  };
}

function buildOpenItemPrimaryMenuItems(
  openItemActions: OpenItemActions,
  groupItems: readonly EntityMenuItem[],
  hasPreview: boolean,
): EntityMenuItem[] {
  const removesFromGroup = groupItems.some(
    (item) => item.action === REMOVE_FROM_OPEN_ITEM_GROUP_ACTION,
  );
  return [
    ...(!removesFromGroup ? groupItems : []),
    ...(hasPreview ? [PREVIEW_MENU_ITEM] : []),
    ...(removesFromGroup ? groupItems : []),
    ...(openItemActions.pin.hasTargets ? [OPEN_ITEM_PIN_MENU_ITEMS.pin] : []),
    ...(openItemActions.unpin.hasTargets
      ? [OPEN_ITEM_PIN_MENU_ITEMS.unpin]
      : []),
    buildWhyOpenMenuItem(openItemActions.whyOpen),
  ];
}

function buildOpenItemMenuItems(
  openItemActions: OpenItemActions,
  selectionMode: boolean,
): EntityMenuItem[] {
  return [
    // Dont' move this again!
    ...(!selectionMode ? [SELECT_OPEN_ITEMS_MENU_ITEM] : []),
    {
      action: SHOW_ACTIVE_ONLY_MENU_ITEM_ACTION,
      label: openItemActions.activeOnly.enabled
        ? "Show all items"
        : "Show active only",
      checked: openItemActions.activeOnly.enabled,
      testId: "interaction-menu-show-active-only",
    },
    OPEN_ITEM_SORT_MENU_ITEMS[openItemActions.sort.direction],
  ];
}

function buildOpenItemRemovalMenuItems(
  openItemActions: OpenItemActions,
  multipleSelected: boolean,
): EntityMenuItem[] {
  return [
    multipleSelected
      ? {
          ...REMOVE_FROM_OPEN_MENU_ITEM,
          action: "remove_selected_open",
          label: "Remove items from Open",
        }
      : REMOVE_FROM_OPEN_MENU_ITEM,
    ...(openItemActions.removeOthers.hasTargets
      ? [OPEN_ITEM_BULK_MENU_ITEMS.removeOthers]
      : []),
    ...(openItemActions.removeAllAbove.hasTargets
      ? [OPEN_ITEM_BULK_MENU_ITEMS.removeAllAbove]
      : []),
    ...(openItemActions.removeAllBelow.hasTargets
      ? [OPEN_ITEM_BULK_MENU_ITEMS.removeAllBelow]
      : []),
    ...(openItemActions.removeAll.hasTargets
      ? [OPEN_ITEM_BULK_MENU_ITEMS.removeAll]
      : []),
  ];
}

function buildWhyOpenMenuItem(whyOpen: WhyOpenAction): EntityMenuItem {
  switch (whyOpen.kind) {
    case "add":
      return {
        action: "add_why_open",
        label: "Add note",
        icon: EditOutlinedIcon,
        testId: "interaction-menu-why-open",
      };
    case "edit":
      return {
        action: "edit_why_open",
        label: "Edit note",
        icon: EditOutlinedIcon,
        testId: "interaction-menu-why-open",
      };
    default:
      return assertNever(whyOpen);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unsupported Open Item action: ${JSON.stringify(value)}`);
}

/**
 * Maps a resolved corner + size offset to absolute-position sx values.
 * CORNER_POSITIONS provides the edge keys (top/bottom, left/right);
 * the size offset replaces the hardcoded probe value of 6.
 */
function cornerSx(
  corner: IndicatorCorner,
  offsetX: number,
  offsetY: number,
): Record<string, number> {
  return Object.fromEntries(
    Object.keys(CORNER_POSITIONS[corner]).map((k) => [
      k,
      k === "left" || k === "right" ? offsetX : offsetY,
    ]),
  );
}

function isContextMenuFromPortaledDescendant(event: React.MouseEvent): boolean {
  return (
    event.target instanceof Node && !event.currentTarget.contains(event.target)
  );
}

/**
 * Unified interaction component that wraps entity content and renders a
 * built-in context menu whenever the registry or proposal system contributes
 * an action.
 *
 * The context menu is rendered internally — callers do not provide menu UI.
 * Right-click opens the menu. Clicking outside or pressing Escape closes it.
 *
 * The "Discuss..." action is handled entirely within this component:
 * it opens a modal, collects a prompt, creates a coding session + run,
 * and navigates to the conversation viewer.
 */
const InteractionComponentCore: React.FC<InteractionComponentProps> = ({
  entityId,
  entityType,
  entitySubtype,
  hasProposalSupport,
  children,
  entityTitle,
  organizationId,
  projectId,
  entityTypeConfig,
  disablePreview = false,
  availableTools,
  size = "small",
  indicatorOffsetX,
  indicatorOffsetY,
  indicatorPlacement,
  draggable = true,
  showIndicator = true,
  surfaceLayout = "block",
  idScope,
  onContextMenuOpen,
  contextualActions = [],
  inlineActions = [],
  guidableSurface,
  // onMenuAction kept on the props type as an out-of-band observer slot.
  // The in-component dispatch map is now the single routing path for
  // known MCP tool names; unknown names log a warning and no-op.
}) => {
  const resolvedConfig = resolveEntityTypeConfig(entityType, entityTypeConfig);
  const canonicalEntityType =
    resolvedConfig?.lineageFieldMapping.entityType.toUpperCase() ?? entityType;
  const starEntityType = toGeneratedEntityType(canonicalEntityType);
  const previewHost = usePreviewHost();
  const openItemLocator = useOpenItemLocator();
  const lineageContext = useMemo(
    () => buildLineageContext(entityId, entityType, entityTitle, entitySubtype),
    [entityId, entitySubtype, entityTitle, entityType],
  );
  const previewCapability = resolvedConfig?.previewCapability;
  const hasPreviewCapability = previewCapability?.kind === "supported";
  const canShowInOpenItems = hasPreviewCapability && openItemLocator !== null;
  const contributionContext = useMemo<MenuContributionContext>(
    () => ({
      ...lineageContext,
      organizationId,
      projectId,
    }),
    [lineageContext, organizationId, projectId],
  );
  const {
    state,
    menuPosition,
    handleMouseEnter,
    handleMouseLeave,
    openMenu,
    closeMenu,
  } = useInteractionState();
  const containerRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const guidableAddress = useMemo<GuidableTargetAddress | null>(() => {
    if (guidableSurface === undefined) return null;
    const entity = toGuidableEntityFromExplorer(lineageContext);
    return entity ? { surface: guidableSurface, entity } : null;
  }, [guidableSurface, lineageContext]);
  useGuidableTarget(guidableAddress, () => containerRef.current);

  const {
    attributes: dragAttributes,
    listeners: dragListeners,
    setNodeRef: setDragRef,
  } = useEntityDragSource({
    entityRef: {
      entityId,
      entityType,
      entityTitle: entityTitle ?? resolvedConfig?.displayLabel ?? entityType,
      entitySubtype,
    },
    idScope,
    disabled: !hasProposalSupport || !draggable,
  });

  const isGoalHost =
    canonicalEntityType === TargetEntityType.Task &&
    entitySubtype === "GOAL" &&
    !!(organizationId && projectId);
  const isTaskEntity =
    canonicalEntityType === TargetEntityType.Task &&
    entitySubtype !== "GOAL" &&
    !!(organizationId && projectId);
  const isFeatureHost =
    canonicalEntityType === TargetEntityType.Task &&
    entitySubtype === "FEATURE" &&
    !!(organizationId && projectId);
  const designDocHostType: TargetEntityType | null =
    canonicalEntityType === TargetEntityType.Task
      ? TargetEntityType.Task
      : canonicalEntityType === TargetEntityType.DesignDoc
        ? TargetEntityType.DesignDoc
        : null;
  const canHostDesignDoc = designDocHostType !== null && !!organizationId;

  const modal = useModal();
  const [viewHistoryOpen, setViewHistoryOpen] = useState(false);
  const [goalPickerOpen, setGoalPickerOpen] = useState(false);

  const navigate = useNavigate();
  const pathService = usePathService();

  const handleNavigateToEntity = useCallback(
    (influenceEntityId: string, influenceEntityType: EntityType) => {
      const TYPE_MAP: Partial<Record<EntityType, SearchEntity["type"]>> = {
        [EntityType.Task]: "task",
        [EntityType.DesignDoc]: "design_doc",
        [EntityType.Initiative]: "initiative",
        [EntityType.AgentSession]: "agent_session",
      };
      const searchType = TYPE_MAP[influenceEntityType];
      if (!searchType || !projectId) return;
      void navigateToEntity({
        entity: {
          id: influenceEntityId,
          type: searchType,
          name: influenceEntityId,
        },
        navigate,
        projectId,
      });
    },
    [navigate, projectId],
  );

  const handleNavigateToConversation = useCallback(
    (conversationId: string) => {
      if (!projectId) return;
      navigate(pathService.conversation({ projectId, conversationId }));
    },
    [navigate, pathService, projectId],
  );

  const entityContext = useEntityContext({
    organizationId: organizationId ?? "",
    projectId: projectId ?? "",
    entityType: canonicalEntityType as EntityType,
    entityId,
  });
  const goalTrackingEligibility = useWorkItemTypeTrackingEligibility(
    organizationId,
    projectId,
    canonicalEntityType === TargetEntityType.Task ? entitySubtype : undefined,
    EntityType.Task,
    "GOAL",
  );

  const fetchedTools = entityContext.data?.availableMcpTools;
  const mcpMenuItems = useMemo(() => {
    if (!hasProposalSupport) return undefined;
    const tools = fetchedTools ?? availableTools;
    if (!tools?.length) return undefined;
    const eligibleTools = tools.flatMap((tool) => {
      if (tool.toolName !== "attach_to_goal") return [tool];
      if (goalTrackingEligibility.isAllowed !== true) return [];
      return [{ ...tool, validTaskTypes: undefined }];
    });
    if (eligibleTools.length === 0) return undefined;
    return mcpToolsToMenuItems(eligibleTools, entitySubtype);
  }, [
    fetchedTools,
    availableTools,
    entitySubtype,
    goalTrackingEligibility.isAllowed,
    hasProposalSupport,
  ]);
  const menuContributions = useMemo(() => {
    const primary: MenuContribution[] = [
      ...(hasPreviewCapability && !disablePreview
        ? [
            {
              id: "entity-preview",
              section: "primary" as const,
              order: 0,
              items: [PREVIEW_MENU_ITEM],
            },
          ]
        : []),
      ...(contextualActions.length
        ? [
            {
              id: "entity-contextual-actions",
              section: "primary" as const,
              order: 10,
              items: contextualActions.map(({ action, label, testId }) => ({
                action,
                label,
                testId,
              })),
            },
          ]
        : []),
    ];
    const secondary: MenuContribution[] = canShowInOpenItems
      ? [
          {
            id: "entity-show-in-open-items",
            section: "secondary",
            order: 0,
            items: [SHOW_IN_OPEN_ITEMS_MENU_ITEM],
          },
        ]
      : [];
    const asynchronous: MenuContribution[] = mcpMenuItems?.length
      ? [
          {
            id: "entity-mcp-tools",
            section: "async",
            order: 0,
            items: mcpMenuItems,
          },
        ]
      : [];
    return composeMenuContributions(
      primary,
      buildDefaultMenuContributions(
        entityType,
        contributionContext,
        entityTypeConfig,
      ),
      secondary,
      asynchronous,
    );
  }, [
    canShowInOpenItems,
    contributionContext,
    contextualActions,
    entityType,
    entityTypeConfig,
    disablePreview,
    hasPreviewCapability,
    mcpMenuItems,
  ]);
  const hasContextMenu = hasProposalSupport || menuContributions.length > 0;

  const fetchEntityContext = entityContext.fetch;

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      if (isContextMenuFromPortaledDescendant(e)) {
        e.stopPropagation();
        return;
      }
      if (!hasContextMenu) return;

      e.preventDefault();
      e.stopPropagation();
      openMenu({ x: e.clientX, y: e.clientY });
      if (hasProposalSupport) {
        fetchEntityContext();
      }
      onContextMenuOpen?.(lineageContext);
    },
    [
      hasContextMenu,
      hasProposalSupport,
      openMenu,
      fetchEntityContext,
      onContextMenuOpen,
      lineageContext,
    ],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!hasContextMenu) return;

      if (e.key === "Escape" && state === "menuOpen") {
        e.preventDefault();
        closeMenu();
        containerRef.current?.focus();
        return;
      }

      if (e.key === "Enter") {
        if (e.target !== e.currentTarget) return;
        e.preventDefault();
        const rect = containerRef.current?.getBoundingClientRect();
        const pos = rect
          ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
          : { x: 0, y: 0 };
        openMenu(pos);
        if (hasProposalSupport) {
          fetchEntityContext();
        }
        onContextMenuOpen?.(lineageContext);
      }
    },
    [
      hasContextMenu,
      hasProposalSupport,
      state,
      openMenu,
      closeMenu,
      fetchEntityContext,
      onContextMenuOpen,
      lineageContext,
    ],
  );

  const handleRootKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      dragListeners?.onKeyDown?.(event);
      handleKeyDown(event);
    },
    [dragListeners, handleKeyDown],
  );

  // Launches a seeded entity-conversation that opens with the tool name as
  // starting context, matching the predecessor task's rendering contract.
  // Used as the default handler for MCP tools whose UX has not yet been
  // designed; the dispatch table is the single source of truth for tool
  // routing, so swapping in a bespoke handler is a one-line change.
  const launchSeededConversation = useCallback(
    (toolName: string) => {
      if (!organizationId || !projectId) return;
      const type = normalizeEntityType(entityType);
      if (type)
        modal?.openModal({
          type: "discuss",
          organizationId,
          projectId,
          entityId,
          entityType: type,
          entityTitle,
          initialValue: toolName,
        });
    },
    [
      organizationId,
      projectId,
      entityType,
      entityId,
      entityTitle,
      modal?.openModal,
    ],
  );

  const actionHandlers = useMemo<Record<string, () => void>>(() => {
    const handlers: Record<string, () => void> = {};
    if (previewCapability?.kind === "supported") {
      handlers.preview = () => {
        previewHost.openPreview(
          createOpenItemEntity(previewCapability.entityType, entityId),
        );
      };
      if (openItemLocator) {
        handlers.show_in_open_items = () => {
          openItemLocator.showInOpenItems({
            entity: createOpenItemEntity(
              previewCapability.entityType,
              entityId,
            ),
            label: entityTitle ?? resolvedConfig?.displayLabel ?? entityType,
            ...(entitySubtype !== undefined ? { taskType: entitySubtype } : {}),
          });
        };
      }
    }
    if (organizationId && projectId) {
      handlers.discuss = () => {
        if (entityType === EntityType.Proposal) {
          navigate(
            pathService.proposal({
              projectId,
              proposalId: entityId,
              editing: true,
            }),
          );
          return;
        }
        const type = normalizeEntityType(entityType);
        if (type)
          modal?.openModal({
            type: "discuss",
            organizationId,
            projectId,
            entityId,
            entityType: type,
            entityTitle,
          });
      };
      handlers.attach_to_goal = () => setGoalPickerOpen(true);
      handlers.create_task = () => launchSeededConversation("create_task");
      handlers.create_bug = () => launchSeededConversation("create_bug");
      handlers.get_plan_stage = () =>
        launchSeededConversation("get_plan_stage");
    }
    for (const contextualAction of contextualActions) {
      handlers[contextualAction.action] = () =>
        contextualAction.onSelect(lineageContext);
    }
    return handlers;
  }, [
    organizationId,
    projectId,
    launchSeededConversation,
    modal?.openModal,
    entityType,
    entityId,
    navigate,
    pathService,
    previewCapability,
    previewHost,
    openItemLocator,
    entityTitle,
    entitySubtype,
    resolvedConfig?.displayLabel,
    contextualActions,
    lineageContext,
  ]);

  const handleInlineAction = useCallback(
    (action: InlineInteractionAction): void => {
      if (action.onSelect) {
        action.onSelect();
        return;
      }

      // Discuss is the only inline action with a generic built-in behavior.
      // Creation actions must be wired to a caller-owned work-item form so
      // they cannot accidentally become agent conversations.
      if (action.action === "discuss") {
        actionHandlers.discuss?.();
      }
    },
    [actionHandlers],
  );

  const inlineActionRow =
    inlineActions.length > 0 ? (
      <Box
        data-testid="interaction-inline-actions"
        role="group"
        aria-label="Inline actions"
        sx={{
          display: "flex",
          flexWrap: "wrap",
          gap: 1,
          mt: 2,
          width: "100%",
        }}
      >
        {inlineActions.map((action: InlineInteractionAction) => {
          const { icon, iconStyle, label, testId } = action;
          const ActionIcon = icon;
          const testIdValue =
            testId ?? `interaction-inline-action-${action.action}`;

          if (!ActionIcon) {
            return (
              <Button
                key={action.action}
                type="button"
                variant="outlined"
                size="small"
                onClick={() => handleInlineAction(action)}
                data-testid={testIdValue}
              >
                {label}
              </Button>
            );
          }

          return (
            <Tooltip key={action.action} title={label}>
              <IconButton
                type="button"
                size="small"
                aria-label={label}
                onClick={() => handleInlineAction(action)}
                data-testid={testIdValue}
                sx={{
                  ...iconStyle,
                  width: 48,
                  height: 48,
                  border: "none",
                  borderRadius: "50%",
                  backgroundColor:
                    iconStyle?.backgroundColor ??
                    inlineActionIconStyles[action.action].backgroundColor,
                  color:
                    iconStyle?.color ??
                    inlineActionIconStyles[action.action].color,
                  "&:hover": {
                    backgroundColor:
                      iconStyle?.backgroundColor ??
                      inlineActionIconStyles[action.action].backgroundColor,
                    filter: "brightness(0.92)",
                  },
                  "& .MuiSvgIcon-root": {
                    color:
                      iconStyle?.color ??
                      inlineActionIconStyles[action.action].color,
                  },
                }}
              >
                <ActionIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          );
        })}
      </Box>
    ) : null;

  const handleAction = useCallback(
    (action: MenuAction) => {
      closeMenu();
      const handler = actionHandlers[action];
      if (handler) {
        handler();
        return;
      }
      console.warn(`Unhandled MCP tool: ${action}`);
    },
    [closeMenu, actionHandlers],
  );

  const { activeCorner: detectedCorner, probeRefs } = useIndicatorCorner(
    hasProposalSupport && showIndicator && !indicatorPlacement,
  );
  const activeCorner = indicatorPlacement ?? detectedCorner;

  // Close menu on any click outside the menu itself (including clicks
  // elsewhere within the InteractionComponent wrapper).
  useEffect(() => {
    if (state !== "menuOpen") return;

    const handleOutsideClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        closeMenu();
      }
    };

    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [state, closeMenu]);

  if (!hasContextMenu) {
    return (
      <Box
        component={surfaceLayout === "inline" ? "span" : "div"}
        ref={containerRef}
        data-testid="interaction-component"
        data-entity-id={entityId}
        data-entity-type={entityType}
        data-entity-subtype={entitySubtype}
        data-id-scope={idScope}
        data-interaction-state="idle"
        sx={{
          position: "relative",
          display: surfaceLayout === "inline" ? "inline-block" : undefined,
        }}
      >
        {isTaskEntity && organizationId && projectId && (
          <TaskDropTarget
            entityId={entityId}
            organizationId={organizationId}
            projectId={projectId}
            idScope={idScope}
          />
        )}
        {isGoalHost && organizationId && projectId && (
          <GoalDropTarget
            entityId={entityId}
            organizationId={organizationId}
            projectId={projectId}
            idScope={idScope}
          />
        )}
        {canHostDesignDoc && designDocHostType && organizationId && (
          <DesignDocDropTarget
            entityId={entityId}
            entityType={designDocHostType}
            organizationId={organizationId}
            idScope={idScope}
          />
        )}
        {isFeatureHost && organizationId && projectId && (
          <PlanDropTarget
            entityId={entityId}
            organizationId={organizationId}
            projectId={projectId}
            idScope={idScope}
          />
        )}
        {children}
        {inlineActionRow}
      </Box>
    );
  }

  const isHovering = state === "hovering" || state === "menuOpen";
  const { iconSize, offset: defaultOffset } = SIZE_CONFIG[size];
  const offsetX = indicatorOffsetX ?? defaultOffset;
  const offsetY = indicatorOffsetY ?? defaultOffset;

  const ContextProvider = resolvedConfig?.contextProvider;
  const Renderer = resolvedConfig?.renderer;

  const content = Renderer ? (
    <Renderer context={lineageContext} />
  ) : ContextProvider ? (
    <ContextProvider context={lineageContext}>{children}</ContextProvider>
  ) : (
    children
  );

  return (
    <Box
      component={surfaceLayout === "inline" ? "span" : "div"}
      ref={(node: HTMLElement | null) => {
        containerRef.current = node;
        setDragRef(node);
      }}
      {...dragAttributes}
      {...dragListeners}
      // Dragging can be disabled while review controls inside remain usable.
      aria-disabled={undefined}
      role="group"
      aria-roledescription="interactive entity"
      tabIndex={0}
      aria-label={`Actions for ${entityType} ${entityId}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onContextMenu={handleContextMenu}
      onKeyDown={handleRootKeyDown}
      sx={{
        position: "relative",
        display: surfaceLayout === "inline" ? "inline-block" : undefined,
        cursor: "context-menu",
        outline: "none",
        "&:focus-visible": {
          boxShadow: (theme) => `0 0 0 2px ${theme.palette.primary.main}`,
        },
      }}
      data-testid="interaction-component"
      data-entity-id={entityId}
      data-entity-type={entityType}
      data-entity-subtype={entitySubtype}
      data-id-scope={idScope}
      data-interaction-state={state}
    >
      {isTaskEntity && organizationId && projectId && (
        <TaskDropTarget
          entityId={entityId}
          organizationId={organizationId}
          projectId={projectId}
          idScope={idScope}
        />
      )}
      {isGoalHost && organizationId && projectId && (
        <GoalDropTarget
          entityId={entityId}
          organizationId={organizationId}
          projectId={projectId}
          idScope={idScope}
        />
      )}
      {canHostDesignDoc && designDocHostType && organizationId && (
        <DesignDocDropTarget
          entityId={entityId}
          entityType={designDocHostType}
          organizationId={organizationId}
          idScope={idScope}
        />
      )}
      {isFeatureHost && organizationId && projectId && (
        <PlanDropTarget
          entityId={entityId}
          organizationId={organizationId}
          projectId={projectId}
          idScope={idScope}
        />
      )}
      {content}
      {inlineActionRow}
      {showIndicator &&
        !indicatorPlacement &&
        CORNER_PRIORITY.map((corner) => (
          <Box
            key={corner}
            ref={probeRefs[corner]}
            component="span"
            aria-hidden="true"
            sx={{
              position: "absolute",
              ...CORNER_POSITIONS[corner],
              width: `${iconSize}px`,
              height: `${iconSize}px`,
              pointerEvents: "none",
            }}
          />
        ))}
      {showIndicator && activeCorner !== null && (
        <Tooltip title="Right-click for AI actions" enterDelay={400} arrow>
          <Box
            component="span"
            data-testid="interaction-indicator"
            sx={{
              position: "absolute",
              ...cornerSx(activeCorner, offsetX, offsetY),
              lineHeight: 0,
              color: isHovering ? "warning.main" : "text.secondary",
              transition: "color 0.15s ease, opacity 0.15s ease",
              transformOrigin: "center",
              animation:
                state === "hovering"
                  ? `${twinkleAnimation} 0.6s ease-in-out, ${colorPulseAnimation} 1.5s ease-in-out 0.6s infinite`
                  : "none",
            }}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width={iconSize}
              height={iconSize}
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                fill="none"
                stroke="currentColor"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="m10 7l-.516 1.394c-.676 1.828-1.014 2.742-1.681 3.409s-1.581 1.005-3.409 1.681L3 14l1.394.516c1.828.676 2.742 1.015 3.409 1.681s1.005 1.581 1.681 3.409L10 21l.516-1.394c.676-1.828 1.015-2.742 1.681-3.409s1.581-1.005 3.409-1.681L17 14l-1.394-.516c-1.828-.676-2.742-1.014-3.409-1.681s-1.005-1.581-1.681-3.409zm8-4l-.221.597c-.29.784-.435 1.176-.72 1.461c-.286.286-.678.431-1.462.72L15 6l.598.221c.783.29 1.175.435 1.46.72c.286.286.431.678.72 1.462L18 9l.221-.597c.29-.784.435-1.176.72-1.461c.286-.286.678-.431 1.462-.72L21 6l-.598-.221c-.783-.29-1.175-.435-1.46-.72c-.286-.286-.431-.678-.72-1.462z"
              />
            </svg>
          </Box>
        </Tooltip>
      )}
      {state === "menuOpen" && menuPosition && (
        <ContextMenu
          menuRef={menuRef}
          position={menuPosition}
          contributions={menuContributions}
          proposals={entityContext.data?.proposals}
          isLoadingContext={hasProposalSupport && entityContext.isLoading}
          onAction={handleAction}
          onViewHistory={() => setViewHistoryOpen(true)}
          onNavigateToEntity={handleNavigateToEntity}
          onNavigateToConversation={handleNavigateToConversation}
          onClose={closeMenu}
          star={
            organizationId && projectId && starEntityType
              ? {
                  organizationId,
                  entityType: starEntityType,
                  entityId,
                }
              : undefined
          }
        />
      )}

      {goalPickerOpen && organizationId && projectId && (
        <GoalPickerModal
          open
          onClose={() => setGoalPickerOpen(false)}
          organizationId={organizationId}
          projectId={projectId}
          targetEntityId={entityId}
          targetEntityType={canonicalEntityType as EntityType}
          targetTaskType={entitySubtype}
          entityTitle={entityTitle ?? resolvedConfig?.displayLabel}
        />
      )}
      {viewHistoryOpen && entityContext.data?.proposals && (
        <ViewHistoryModal
          open
          onClose={() => setViewHistoryOpen(false)}
          proposals={entityContext.data.proposals}
          entityTitle={entityTitle ?? resolvedConfig?.displayLabel}
          organizationId={organizationId}
          projectId={projectId}
          onNavigateToEntity={handleNavigateToEntity}
        />
      )}
    </Box>
  );
};

export const InteractionComponent: React.FC<InteractionComponentProps> = (
  props,
) => <InteractionComponentCore {...props} />;

interface InteractionSurfaceCoreProps extends InteractionSurfaceProps {
  dragSource?: Pick<
    UseEntityDragSourceResult,
    "attributes" | "listeners" | "setNodeRef"
  >;
}

function useInteractionSurfaceMenuState(
  lineageContext: LineageContext,
  onContextMenuOpen?: (context: LineageContext) => void,
  onContextMenuClose?: (context: LineageContext) => void,
) {
  const {
    state,
    menuPosition,
    handleMouseEnter,
    handleMouseLeave,
    openMenu,
    closeMenu: closeInteractionMenu,
  } = useInteractionState();
  const closeMenu = useCallback(() => {
    closeInteractionMenu();
    onContextMenuClose?.(lineageContext);
  }, [closeInteractionMenu, lineageContext, onContextMenuClose]);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const notifyMenuOpen = useCallback(() => {
    onContextMenuOpen?.(lineageContext);
  }, [lineageContext, onContextMenuOpen]);

  const handleContextMenu = useCallback(
    (event: React.MouseEvent) => {
      if (isContextMenuFromPortaledDescendant(event)) {
        event.stopPropagation();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      openMenu({ x: event.clientX, y: event.clientY });
      notifyMenuOpen();
    },
    [notifyMenuOpen, openMenu],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === "Escape" && state === "menuOpen") {
        event.preventDefault();
        closeMenu();
        containerRef.current?.focus();
        return;
      }

      if (event.key !== "Enter" || event.target !== event.currentTarget) {
        return;
      }

      event.preventDefault();
      const rect = containerRef.current?.getBoundingClientRect();
      openMenu(
        rect
          ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
          : { x: 0, y: 0 },
      );
      notifyMenuOpen();
    },
    [closeMenu, notifyMenuOpen, openMenu, state],
  );

  useEffect(() => {
    if (state !== "menuOpen") return;

    const handleOutsideClick = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        closeMenu();
      }
    };

    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [closeMenu, state]);

  return {
    state,
    menuPosition,
    handleMouseEnter,
    handleMouseLeave,
    closeMenu,
    containerRef,
    menuRef,
    handleContextMenu,
    handleKeyDown,
  };
}

function useOpenItemActionHandler(
  entityId: string,
  previewCapability: PreviewCapability | undefined,
  previewHost: ReturnType<typeof usePreviewHost>,
  openItemActions: OpenItemActions,
  lineageContext: LineageContext,
) {
  return useCallback(
    (action: MenuAction) => {
      switch (action) {
        case "preview":
          if (previewCapability?.kind === "supported") {
            previewHost.openPreview(
              createOpenItemEntity(previewCapability.entityType, entityId),
            );
          }
          return;
        case "pin_open_item":
          openItemActions.pin.onSelect(lineageContext);
          return;
        case "unpin_open_item":
          openItemActions.unpin.onSelect(lineageContext);
          return;
        case "sort_open_items_newest":
        case "sort_open_items_oldest":
          openItemActions.sort.onSelect(lineageContext);
          return;
        case SHOW_ACTIVE_ONLY_MENU_ITEM_ACTION:
          openItemActions.activeOnly.onSelect();
          return;
        case "remove_from_open":
          openItemActions.onRemoveFromOpen(lineageContext);
          return;
        case "remove_open_others":
          openItemActions.removeOthers.onSelect(lineageContext);
          return;
        case "remove_open_above":
          openItemActions.removeAllAbove.onSelect(lineageContext);
          return;
        case "remove_open_below":
          openItemActions.removeAllBelow.onSelect(lineageContext);
          return;
        case "remove_all_open":
          openItemActions.removeAll.onSelect(lineageContext);
          return;
        case "add_why_open":
        case "edit_why_open":
          openItemActions.whyOpen.onSelect(lineageContext);
          return;
        default:
          console.warn(`Unhandled Open Item action: ${action}`);
      }
    },
    [entityId, lineageContext, openItemActions, previewCapability, previewHost],
  );
}

const ignoreViewHistory = () => undefined;
const ignoreEntityNavigation = () => undefined;
const ignoreConversationNavigation = () => undefined;

const InteractionSurfaceCore: React.FC<InteractionSurfaceCoreProps> = ({
  entityId,
  entityType,
  children,
  entityTitle,
  entitySubtype,
  idScope,
  onContextMenuOpen,
  onContextMenuClose,
  renderMenu,
  dragSource,
}) => {
  const lineageContext = useMemo(
    () => buildLineageContext(entityId, entityType, entityTitle, entitySubtype),
    [entityId, entitySubtype, entityTitle, entityType],
  );
  const menuState = useInteractionSurfaceMenuState(
    lineageContext,
    onContextMenuOpen,
    onContextMenuClose,
  );
  const {
    state,
    menuPosition,
    handleMouseEnter,
    handleMouseLeave,
    closeMenu,
    containerRef,
    menuRef,
    handleContextMenu,
    handleKeyDown,
  } = menuState;
  return (
    <Box
      ref={(node: HTMLDivElement | null) => {
        containerRef.current = node;
        dragSource?.setNodeRef(node);
      }}
      {...dragSource?.attributes}
      {...dragSource?.listeners}
      // Drag availability does not disable the entity’s nested controls.
      aria-disabled={undefined}
      role="group"
      aria-roledescription="interactive entity"
      tabIndex={0}
      aria-label={`Actions for ${entityType} ${entityId}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onContextMenu={handleContextMenu}
      onKeyDown={handleKeyDown}
      sx={{
        position: "relative",
        cursor: "context-menu",
        outline: "none",
        "&:focus-visible": {
          boxShadow: (theme) => `0 0 0 2px ${theme.palette.primary.main}`,
        },
      }}
      data-testid="interaction-component"
      data-entity-id={entityId}
      data-entity-type={entityType}
      data-entity-subtype={entitySubtype}
      data-id-scope={idScope}
      data-interaction-state={state}
    >
      {children}
      {state === "menuOpen" && menuPosition && (
        <>{renderMenu({ menuRef, position: menuPosition, closeMenu })}</>
      )}
    </Box>
  );
};

export const InteractionSurface: React.FC<InteractionSurfaceProps> = (
  props,
) => <InteractionSurfaceCore {...props} />;

export const DraggableInteractionSurface: React.FC<InteractionSurfaceProps> = (
  props,
) => {
  const dragSource = useEntityDragSource({
    entityRef: {
      entityId: props.entityId,
      entityType: props.entityType,
      entityTitle: props.entityTitle ?? props.entityType,
      entitySubtype: props.entitySubtype,
    },
    idScope: props.idScope,
  });

  return <InteractionSurfaceCore {...props} dragSource={dragSource} />;
};

export const OpenItemInteractionComponent: React.FC<
  OpenItemInteractionComponentProps
> = ({
  draggable = true,
  openItemActions,
  openItemGroupActions,
  selection,
  selectionMode = false,
  onSelectItems,
  projectId,
  ...surfaceProps
}) => {
  const resolvedConfig = resolveEntityTypeConfig(surfaceProps.entityType);
  const canonicalEntityType =
    resolvedConfig?.lineageFieldMapping.entityType.toUpperCase() ??
    surfaceProps.entityType;
  const starEntityType = toGeneratedEntityType(canonicalEntityType);
  const previewCapability = resolvedConfig?.previewCapability;
  const previewHost = usePreviewHost();
  const navigate = useNavigate();
  const pathService = usePathService();
  const modal = useModal();
  const [groupDialogOpen, setGroupDialogOpen, groupDialogOpenOwnerKey] =
    useModalState(false);
  const [selectedGroupId, setSelectedGroupId] = useState(
    NEW_OPEN_ITEM_GROUP_OPTION,
  );
  const [groupName, setGroupName] = useState("");
  const lineageContext = useMemo(
    () =>
      buildLineageContext(
        surfaceProps.entityId,
        surfaceProps.entityType,
        surfaceProps.entityTitle,
        surfaceProps.entitySubtype,
      ),
    [
      surfaceProps.entityId,
      surfaceProps.entitySubtype,
      surfaceProps.entityTitle,
      surfaceProps.entityType,
    ],
  );
  const contributionContext = useMemo<MenuContributionContext>(
    () => ({
      ...lineageContext,
      organizationId: surfaceProps.organizationId,
      projectId,
    }),
    [lineageContext, projectId, surfaceProps.organizationId],
  );
  const openItemGroupMenuItems = useMemo(
    () =>
      buildOpenItemGroupPrimaryMenuItems(
        openItemGroupActions,
        selection.selectedIdentities.length > 1,
      ),
    [openItemGroupActions, selection.selectedIdentities.length],
  );
  const openItemPrimaryMenuItems = useMemo(
    () =>
      buildOpenItemPrimaryMenuItems(
        openItemActions,
        openItemGroupMenuItems,
        previewCapability?.kind === "supported",
      ),
    [openItemActions, openItemGroupMenuItems, previewCapability?.kind],
  );
  const openItemMenuItems = useMemo(
    () => buildOpenItemMenuItems(openItemActions, selectionMode),
    [openItemActions, selectionMode],
  );
  const openItemRemovalMenuItems = useMemo(
    () =>
      buildOpenItemRemovalMenuItems(
        openItemActions,
        selection.selectedIdentities.length > 1,
      ),
    [openItemActions, selection.selectedIdentities.length],
  );
  const handleOpenItemAction = useOpenItemActionHandler(
    surfaceProps.entityId,
    previewCapability,
    previewHost,
    openItemActions,
    lineageContext,
  );
  const menuContributions = useMemo(
    () =>
      composeMenuContributions(
        [
          {
            id: "open-item-primary",
            section: "primary",
            order: 0,
            items: openItemPrimaryMenuItems,
          },
        ],
        buildDefaultMenuContributions(
          surfaceProps.entityType,
          contributionContext,
        ),
        [
          {
            id: "open-item-secondary",
            section: "secondary",
            order: 0,
            items: openItemMenuItems,
          },
        ],
        [
          {
            id: "open-item-removal",
            section: "removal",
            order: 0,
            items: openItemRemovalMenuItems,
          },
        ],
      ),
    [
      contributionContext,
      openItemMenuItems,
      openItemPrimaryMenuItems,
      openItemRemovalMenuItems,
      surfaceProps.entityType,
    ],
  );
  const handleAction = useCallback(
    (action: MenuAction) => {
      if (action !== "discuss") {
        if (action === "select_open_items") {
          onSelectItems?.();
        } else if (action === "remove_selected_open") {
          selection.onRemoveSelected(selection.selectedIdentities);
        } else if (
          action === ADD_TO_OPEN_ITEM_GROUP_ACTION ||
          action === NEW_OPEN_ITEM_GROUP_ACTION
        ) {
          setSelectedGroupId(NEW_OPEN_ITEM_GROUP_OPTION);
          setGroupName("");
          setGroupDialogOpen(true);
        } else if (action.startsWith(ASSIGN_OPEN_ITEM_GROUP_PREFIX)) {
          const groupId = action.slice(ASSIGN_OPEN_ITEM_GROUP_PREFIX.length);
          const group = openItemGroupActions?.groups.find(
            (candidate) => candidate.id === groupId,
          );
          if (group) {
            openItemGroupActions?.onAssign(
              group.id,
              selection.selectedIdentities,
              lineageContext,
            );
          }
        } else if (action === REMOVE_FROM_OPEN_ITEM_GROUP_ACTION) {
          openItemGroupActions?.onUngroup(
            selection.selectedIdentities,
            lineageContext,
          );
        } else {
          handleOpenItemAction(action);
        }
        return;
      }
      if (!surfaceProps.organizationId || !projectId) return;
      if (surfaceProps.entityType === EntityType.Proposal) {
        navigate(
          pathService.proposal({
            projectId,
            proposalId: surfaceProps.entityId,
            editing: true,
          }),
        );
        return;
      }
      const type = normalizeEntityType(surfaceProps.entityType);
      if (type)
        modal?.openModal({
          type: "discuss",
          organizationId: surfaceProps.organizationId,
          projectId,
          entityId: surfaceProps.entityId,
          entityType: type,
          entityTitle: surfaceProps.entityTitle,
        });
    },
    [
      handleOpenItemAction,
      modal?.openModal,
      surfaceProps.entityTitle,
      onSelectItems,
      selection,
      navigate,
      pathService,
      projectId,
      surfaceProps.entityId,
      surfaceProps.entityType,
      surfaceProps.organizationId,
      openItemGroupActions,
      lineageContext,
    ],
  );
  const [groupSubmitting, setGroupSubmitting] = useState(false);
  const handleGroupSubmit = useCallback(async () => {
    if (!openItemGroupActions) return;
    setGroupSubmitting(true);
    try {
      let succeeded: boolean;
      if (selectedGroupId === NEW_OPEN_ITEM_GROUP_OPTION) {
        const trimmedName = groupName.trim();
        if (!trimmedName) return;
        succeeded = await openItemGroupActions.onCreate(
          trimmedName,
          selection.selectedIdentities,
          lineageContext,
        );
      } else {
        const selectedGroup = openItemGroupActions.groups.find(
          (group) => group.id === selectedGroupId,
        );
        if (!selectedGroup) return;
        succeeded = await openItemGroupActions.onAssign(
          selectedGroup.id,
          selection.selectedIdentities,
          lineageContext,
        );
      }
      if (!succeeded) return;
      setGroupDialogOpen(false);
      setGroupName("");
      setSelectedGroupId(NEW_OPEN_ITEM_GROUP_OPTION);
    } finally {
      setGroupSubmitting(false);
    }
  }, [
    groupName,
    lineageContext,
    openItemGroupActions,
    selectedGroupId,
    selection.selectedIdentities,
  ]);
  const renderMenu = useCallback(
    ({ menuRef, position, closeMenu }: InteractionSurfaceMenuProps) => (
      <ContextMenu
        menuRef={menuRef}
        position={position}
        contributions={menuContributions}
        onAction={handleAction}
        onViewHistory={ignoreViewHistory}
        onNavigateToEntity={ignoreEntityNavigation}
        onNavigateToConversation={ignoreConversationNavigation}
        onClose={closeMenu}
        star={
          surfaceProps.organizationId && projectId && starEntityType
            ? {
                organizationId: surfaceProps.organizationId,
                entityType: starEntityType,
                entityId: surfaceProps.entityId,
              }
            : undefined
        }
      />
    ),
    [
      handleAction,
      menuContributions,
      projectId,
      starEntityType,
      surfaceProps.entityId,
      surfaceProps.organizationId,
    ],
  );
  const Surface = draggable ? DraggableInteractionSurface : InteractionSurface;

  return (
    <>
      <Surface {...surfaceProps} renderMenu={renderMenu} />

      <Dialog
        ownerKey={groupDialogOpenOwnerKey}
        open={groupDialogOpen}
        onClose={() => setGroupDialogOpen(false)}
        aria-labelledby="open-item-group-dialog-title"
      >
        <DialogTitle id="open-item-group-dialog-title">
          Add to Open Items group
        </DialogTitle>
        <DialogContent>
          <TextField
            select
            fullWidth
            label="Group"
            value={selectedGroupId}
            onChange={(event) => setSelectedGroupId(event.target.value)}
            inputProps={{ "data-testid": "open-item-group-picker" }}
          >
            <MenuItem value={NEW_OPEN_ITEM_GROUP_OPTION}>New group</MenuItem>
            {openItemGroupActions?.groups
              .filter(
                (group) => group.id !== openItemGroupActions.currentGroupId,
              )
              .map((group) => (
                <MenuItem
                  key={group.id}
                  value={group.id}
                  data-testid="open-item-group-option"
                  data-group-id={group.id}
                >
                  {group.name}
                </MenuItem>
              ))}
          </TextField>
          {selectedGroupId === NEW_OPEN_ITEM_GROUP_OPTION && (
            <TextField
              autoFocus
              fullWidth
              label="Group name"
              value={groupName}
              onChange={(event) => setGroupName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  handleGroupSubmit();
                }
              }}
              inputProps={{ maxLength: 80 }}
              data-testid="open-item-group-name-input"
              sx={{ mt: 2 }}
            />
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setGroupDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleGroupSubmit}
            disabled={
              groupSubmitting ||
              (selectedGroupId === NEW_OPEN_ITEM_GROUP_OPTION &&
                !groupName.trim())
            }
            data-testid="open-item-group-submit"
          >
            Add to group
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};
