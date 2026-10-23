import type { OpenItemSelectionIdentity } from "../../utils/openItemSelection";
import type React from "react";
import type {
  AvailableMcpToolDto,
  TargetEntityType,
  TrackedEntitySnapshot,
} from "../../api";
import type { EntityTypeConfig } from "./entityTypeRegistry";
import type { IndicatorCorner } from "./useIndicatorCorner";
import type { GuidableSurface } from "../GuidedWalkthrough/types";

/**
 * Context passed to interaction callbacks containing entity lineage info.
 *
 * `entityType` accepts any extended string key (e.g. "PROPOSAL") in addition
 * to generated `TargetEntityType` values, matching the registry's ability
 * to register configs for entity kinds outside that enum.
 */
export interface LineageContext {
  entityId: string;
  entityType: TargetEntityType | (string & {});
  /**
   * Display name for the entity, when known. Threaded through so downstream
   * launchers can seed meaningful titles (e.g. agent session titles) without
   * waiting for the backend to derive one from the entity id.
   */
  entityTitle?: string;
  /** Work-item type key used to distinguish task subtypes such as FEATURE. */
  entitySubtype?: string;
  /**
   * Goal-task scoping fields, populated only when the calling surface already
   * holds the loaded goal DTO (goal detail page, right-column conversation
   * panel, discuss-from-goal capsule). When present and the entity is a TASK,
   * the entity-conversation launcher includes `taskType: 'GOAL'`, description,
   * `dueDate`, and `trackedEntities` on the launch payload so the agent prompt
   * can branch on goal context without a server-side task refetch. Callers that
   * do not already have the goal DTO loaded must not synthesize this snapshot —
   * leave it absent and the launcher omits the goal-specific fields.
   */
  goalSnapshot?: GoalSnapshot;
}

export interface GoalSnapshot {
  description: string;
  dueDate?: string;
  trackedEntities?: TrackedEntitySnapshot[];
}

/**
 * Interaction state machine states.
 *
 * - idle: No user interaction in progress
 * - hovering: Mouse is over a component with at least one available action
 * - menuOpen: Contextual menu is visible
 */
export type InteractionState = "idle" | "hovering" | "menuOpen";

/** Viewport coordinates for positioning the context menu at the click location. */
export interface MenuPosition {
  x: number;
  y: number;
}

/**
 * Built-in menu actions handled internally by the interaction component.
 */
export type BuiltInMenuAction =
  | "discuss"
  | "attach_to_goal"
  | "preview"
  | "show_in_open_items"
  | "pin_open_item"
  | "unpin_open_item"
  | "sort_open_items_newest"
  | "sort_open_items_oldest"
  | "remove_from_open"
  | "remove_open_others"
  | "remove_open_above"
  | "remove_open_below"
  | "remove_all_open"
  | "add_why_open"
  | "edit_why_open";

/**
 * Menu action identifier. Built-in actions (like "discuss") are handled
 * internally; MCP tool names (like "edit_task") are dispatched to their
 * registered handler. Unknown tool names log a warning and no-op.
 */
export type MenuAction = BuiltInMenuAction | (string & {});

export type MenuContributionSection =
  | "primary"
  | "shared"
  | "secondary"
  | "removal"
  | "async"
  | "provenance";

export type MenuContributionController = "discuss" | "star";

export interface MenuContributionItem {
  action: MenuAction;
  label: string;
  /** Optional icon component shown beside the label in the context menu. */
  icon?: React.ElementType;
  toolName?: string;
  testId?: string;
  dataGroupId?: string;
  /** Whether this action is checked when rendered as a menu item checkbox. */
  checked?: boolean;
  /** Optional shortcuts shown beside an independently actionable parent item. */
  submenu?: readonly MenuContributionItem[];
}

export interface MenuContribution {
  id: string;
  section: MenuContributionSection;
  order: number;
  items?: readonly MenuContributionItem[];
  controller?: MenuContributionController;
}

export interface MenuContributionContext extends LineageContext {
  organizationId?: string;
  projectId?: string;
}

/**
 * A visible action rendered inside an interaction surface rather than its
 * context menu. Discuss uses the component's canonical entity-scoped handler;
 * creation actions can provide a caller-owned form opener.
 */
export type InlineInteractionActionName =
  | "discuss"
  | "create_task"
  | "create_bug";

export interface InlineInteractionAction {
  action: InlineInteractionActionName;
  label: string;
  /** Optional icon for compact action-capsule-style presentation. */
  icon?: React.ElementType;
  /** Optional icon-chip colors, matching the shared Action Capsule API. */
  iconStyle?: React.CSSProperties;
  /** Optional caller-owned action, used for product-specific creation forms. */
  onSelect?: () => void;
  testId?: string;
}

/**
 * A caller-owned menu action whose applicability is determined by the surface
 * that already holds its contextual data. This keeps domain state, such as an
 * active goal, out of the generic interaction shell.
 */
export interface ContextualMenuAction {
  action: string;
  label: string;
  onSelect: (context: LineageContext) => void;
  testId?: string;
}

/**
 * Controls how prominent the interaction indicator is.
 * - small: 18px icon, suited to compact list items (default)
 * - medium: 24px icon, suited to card-sized components
 * - large: 32px icon, suited to full-width or hero components
 */
export type InteractionSize = "small" | "medium" | "large";

/** Semantic layout used by the interaction wrapper at its composition site. */
export type InteractionSurfaceLayout = "block" | "inline";

export type WhyOpenAction =
  | {
      kind: "add";
      onSelect: (context: LineageContext) => void;
    }
  | {
      kind: "edit";
      onSelect: (context: LineageContext) => void;
    };

export interface OpenItemBulkAction {
  hasTargets: boolean;
  onSelect: (context: LineageContext) => void;
}

export interface OpenItemSortAction {
  direction: "oldest" | "newest";
  onSelect: (context: LineageContext) => void;
}

export interface OpenItemActiveOnlyAction {
  enabled: boolean;
  onSelect: () => void;
}

export interface OpenItemGroupOption {
  id: string;
  name: string;
}

export interface OpenItemGroupActions {
  groups: readonly OpenItemGroupOption[];
  currentGroupId?: string;
  onAssign: (
    groupId: string,
    identities: readonly OpenItemSelectionIdentity[],
    context: LineageContext,
  ) => Promise<boolean>;
  onCreate: (
    name: string,
    identities: readonly OpenItemSelectionIdentity[],
    context: LineageContext,
  ) => Promise<boolean>;
  onUngroup: (
    identities: readonly OpenItemSelectionIdentity[],
    context: LineageContext,
  ) => Promise<boolean>;
}

export interface OpenItemActions {
  pin: OpenItemBulkAction;
  unpin: OpenItemBulkAction;
  sort: OpenItemSortAction;
  activeOnly: OpenItemActiveOnlyAction;
  onRemoveFromOpen: (context: LineageContext) => void;
  removeOthers: OpenItemBulkAction;
  removeAllAbove: OpenItemBulkAction;
  removeAllBelow: OpenItemBulkAction;
  removeAll: OpenItemBulkAction;
  whyOpen: WhyOpenAction;
}

/**
 * Props for the unified interaction component.
 *
 * Accepts task DTOs (and future entity types) via explicit required fields
 * rather than DTO introspection. Callers must declare whether the entity
 * supports proposals; Preview availability is independently and exhaustively
 * owned by the entity registry.
 *
 * The context menu is built-in — callers do not provide menu UI.
 */
export interface InteractionComponentProps {
  /** Unique identifier of the target entity */
  entityId: string;
  /** Entity type discriminator — TargetEntityType or an extended registry key (e.g. "PROPOSAL") */
  entityType: TargetEntityType | (string & {});
  /** Optional subtype (e.g. work-item type key) — lets consumers distinguish variants like Feature vs Standard task */
  entitySubtype?: string;
  /** Whether this entity supports MCP proposal tools (e.g. edit_task) */
  hasProposalSupport: boolean;
  /** The wrapped content */
  children: React.ReactNode;
  /** Human-readable name shown in the Discuss modal title */
  entityTitle?: string;
  /** Organization ID — required for the built-in Discuss flow */
  organizationId?: string;
  /** Project ID — required for the built-in Discuss flow */
  projectId?: string;
  /** Override the registry config for this entity type instance */
  entityTypeConfig?: EntityTypeConfig;
  /** Suppress the built-in Preview menu action without affecting other actions. */
  disablePreview?: boolean;
  /** MCP tools available for this entity, from EntityContextDto */
  availableTools?: AvailableMcpToolDto[];
  /** Controls indicator prominence — defaults to "small" */
  size?: InteractionSize;
  /** Override the default horizontal indicator offset (px from corner edge) */
  indicatorOffsetX?: number;
  /** Override the default vertical indicator offset (px from corner edge) */
  indicatorOffsetY?: number;
  /** Force the indicator to a specific corner, bypassing auto-detection */
  indicatorPlacement?: IndicatorCorner;
  /** Whether the entity can be dragged — defaults to true */
  draggable?: boolean;
  /** Whether to show the sparkle indicator — defaults to true */
  showIndicator?: boolean;
  /** Render the interaction boundary as an inline span instead of a block div. */
  surfaceLayout?: InteractionSurfaceLayout;
  /** Optional scope appended to the internal drag/drop ids to disambiguate multiple instances for the same entity (e.g. "breadcrumb") */
  idScope?: string;
  /** Called when the contextual menu opens */
  onContextMenuOpen?: (context: LineageContext) => void;
  /**
   * Optional out-of-band observer for menu actions. The component dispatches
   * every known MCP tool name to its registered in-component handler; this
   * callback is **not** the dispatcher and is no longer invoked for known
   * tools. Use it for telemetry, side-channel logging, or test assertions.
   */
  onMenuAction?: (action: MenuAction, context: LineageContext) => void;
  /** Surface-owned actions rendered alongside built-in menu actions. */
  contextualActions?: readonly ContextualMenuAction[];
  /** Visible actions rendered beneath the wrapped content. */
  inlineActions?: readonly InlineInteractionAction[];
  /**
   * Declares the surface this instance renders the entity on. Only declared
   * surfaces register as walkthrough targets.
   */
  guidableSurface?: GuidableSurface;
}

export interface InteractionSurfaceMenuProps {
  menuRef: React.Ref<HTMLDivElement>;
  position: MenuPosition;
  closeMenu: () => void;
}

/**
 * Entity-data-free interaction shell for consumers that already own actions.
 * The required menu renderer keeps capability selection at the typed adapter
 * boundary instead of growing optional feature flags on the surface itself.
 */
export interface InteractionSurfaceProps {
  entityId: string;
  entityType: TargetEntityType | (string & {});
  entitySubtype?: string;
  entityTitle?: string;
  organizationId?: string;
  children: React.ReactNode;
  idScope?: string;
  onContextMenuOpen?: (context: LineageContext) => void;
  onContextMenuClose?: (context: LineageContext) => void;
  renderMenu: (props: InteractionSurfaceMenuProps) => React.ReactNode;
}

/** Applicable identities resolved by the section for this row's menu. */
export interface OpenItemSelectionContext {
  selectedIdentities: readonly OpenItemSelectionIdentity[];
  onRemoveSelected: (identities: readonly OpenItemSelectionIdentity[]) => void;
}

/**
 * Required contract for an entity rendered as a row in Open Items.
 * Generic interaction surfaces cannot accidentally opt into only part of the
 * Open-row behavior; the dedicated component requires the complete action set.
 */
export interface OpenItemInteractionComponentProps extends Omit<
  InteractionSurfaceProps,
  "renderMenu"
> {
  /** Project scope required by shared Discuss and Star contributions. */
  projectId?: string;
  /** Whether the canonical drag source is composed — defaults to true. */
  draggable?: boolean;
  openItemActions: OpenItemActions;
  openItemGroupActions?: OpenItemGroupActions;
  selection: OpenItemSelectionContext;
  selectionMode?: boolean;
  onSelectItems?: () => void;
}
