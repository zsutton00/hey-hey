import type { Stable } from "../../types";
import type React from "react";
import type { UnavailableOutcome } from "../AgentSession/codingSessionFeedback";
import type { GuidableTargetAddress } from "../GuidedWalkthrough/types";

export type CapsuleActionGroup = "conceptual" | "page";
export type CapsuleActionTier = "site" | "page" | "tab";
export type CapsuleActionUnavailableFeedback = Extract<
  UnavailableOutcome,
  { presentationScope: "action" }
>;

/**
 * Menu item for a capsule action with sub-options
 */
export interface CapsuleActionMenuItem {
  /** Unique identifier for this menu item */
  id: string;
  /** Display label for the menu item */
  label: string;
  /** Optional icon to display with the label */
  icon?: React.ElementType;
  /** Whether the menu item is disabled */
  disabled?: boolean;
  /** Optional badge to show on the menu item */
  badge?: string | number;
}

/**
 * Shared fields for capsule actions
 */
interface CapsuleActionVisualBase {
  /** Unique identifier for this action */
  id: string;
  /** Display label for the action button */
  label: string;
  /** Optional icon to display with the label */
  icon?: React.ElementType;
  /** Whether the action button is disabled */
  disabled?: boolean;
  /** Optional badge to show on the button (e.g., count, status) */
  badge?: string | number;
  /** When true, an existing action is in progress */
  inProgress?: boolean;
  /** When true, show collapse button instead of close button (action can be resumed) */
  resumable?: boolean;
  /** When true, show an expand button to make the window larger */
  expandable?: boolean;
  /** Optional title to show in a header bar when action is active */
  title?: string;
  /** Optional icon container style override for this action button */
  iconStyle?: React.CSSProperties;
  /** Optional text color override for presentation-only warning states. */
  textColor?: string;
  /** Typed action-local failure shown without disabling the action control. */
  feedback?: CapsuleActionUnavailableFeedback;
  /** Walkthrough address the rendered button registers under. */
  guidableTarget?: GuidableTargetAddress;
}

interface CapsuleActionOrdering {
  /** Tier used for ordering actions in the capsule (site -> page -> tab) */
  tier: CapsuleActionTier;
  /** Relative order within a tier (lower comes first) */
  order: number;
}

/**
 * Registration data for an expandable capsule action
 */
export interface CapsuleActionExpandable
  extends CapsuleActionVisualBase, CapsuleActionOrdering {
  behavior: "expand";
  /** Which action group this belongs to for capsule button ordering */
  actionGroup: CapsuleActionGroup;
  /** Function that returns the component to render when action is expanded */
  renderContent: () => React.ReactNode;
  /** Optional menu items for sub-actions (clicking button shows dropdown instead of expanding directly) */
  menuItems?: CapsuleActionMenuItem[];
  /** Currently active menu item ID when using menu items */
  activeMenuItemId?: string;
}

/**
 * Registration data for a click-only capsule action
 */
export interface CapsuleActionClickable
  extends CapsuleActionVisualBase, CapsuleActionOrdering {
  behavior: "click";
  /** Which action group this belongs to for capsule button ordering */
  actionGroup: CapsuleActionGroup;
  /** Callback invoked when the action button is clicked */
  onClick: () => void;
}

export type CapsuleActionRegistration =
  CapsuleActionExpandable | CapsuleActionClickable;

/**
 * Context value provided by ActionsCapsuleProvider
 */
export interface ActionsCapsuleContextValue {
  capsuleTop: number | null;
  setCapsuleTop: (top: number | null) => void;
  anchor: "bottom-left" | "bottom-right";
  toggleAnchor: () => void;
  /** List of currently registered actions */
  actions: CapsuleActionRegistration[];
  /** ID of the currently active/expanded action, or null if none */
  activeActionId: string | null;
  /** ID of the currently active menu item within the active action, or null if none */
  activeMenuItemId: string | null;
  /** Whether the capsule is in full size mode */
  isFullSize: boolean;
  /** Whether the capsule is minimized */
  isMinimized: boolean;
  /** Register a new action */
  registerAction: (action: CapsuleActionRegistration) => void;
  /** Unregister an action by ID */
  unregisterAction: (id: string) => void;
  /** Expand/activate an action by ID (optionally with a specific menu item) */
  expandAction: (id: string, menuItemId?: string) => void;
  /** Collapse the currently active action */
  collapseAction: () => void;
  /** Set the active menu item for the currently expanded action */
  setActiveMenuItem: (menuItemId: string | null) => void;
  /** Toggle full size mode */
  toggleFullSize: () => void;
  /** Toggle minimized state */
  toggleMinimize: () => void;
  /** Current search query text */
  searchQuery: string;
  /** Update the search query */
  setSearchQuery: (query: string) => void;
}

/**
 * Props for the CapsuleAction registration component
 */
export interface CapsuleActionExpandableProps extends CapsuleActionVisualBase {
  behavior: "expand";
  /** Function that returns the component to render when this action is expanded.
   * Use useCallback to keep the reference stable and avoid unnecessary re-registrations. */
  renderContent: Stable<() => React.ReactNode>;
  /** Optional menu items for sub-actions (clicking button shows dropdown instead of expanding directly) */
  menuItems?: CapsuleActionMenuItem[];
  /** Group for ordering/rendering inside the capsule; defaults to conceptual */
  actionGroup?: CapsuleActionGroup;
  /** Tier precedence bucket. If omitted, inferred from actionGroup. */
  tier?: CapsuleActionTier;
  /** Relative order within tier. Lower values render first. */
  order?: number;
}

export interface CapsuleActionClickableProps extends CapsuleActionVisualBase {
  behavior: "click";
  /** Callback invoked when the action button is clicked.
   * Use useCallback to keep the reference stable and avoid unnecessary re-registrations. */
  onClick: Stable<() => void>;
  /** Group for ordering/rendering inside the capsule; defaults to conceptual */
  actionGroup?: CapsuleActionGroup;
  /** Tier precedence bucket. If omitted, inferred from actionGroup. */
  tier?: CapsuleActionTier;
  /** Relative order within tier. Lower values render first. */
  order?: number;
}

export type CapsuleActionProps =
  CapsuleActionExpandableProps | CapsuleActionClickableProps;
