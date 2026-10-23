import type { WorkItemIconIdentity } from "@hey-hey/ui-common/utils";
import type { Priority } from "@hey-hey/ui-common/api";

/**
 * Entity types supported in the explorer
 */
export type ExplorerEntityType =
  "feature" | "goal" | "work-item" | "plan" | "service";

/**
 * Represents a single node in the explorer tree
 */
export interface ExplorerNode {
  /** Unique identifier for the node */
  id: string;

  /** Type of entity this node represents */
  type: ExplorerEntityType;

  /** Display name of the entity */
  name: string;

  /** Current status of the entity (if applicable) */
  status?: string;

  /** Priority level (for tasks and initiatives) */
  priority?: Priority;

  /** Whether this node has children that can be expanded */
  hasChildren: boolean;

  /** Number of children (for display badge) */
  childCount?: number;

  /** Nesting depth in the tree (0 for root nodes) */
  depth: number;

  /** ID of the parent node (if this is a child node) */
  parentId?: string;

  /** Navigation path override for this node */
  path?: string;

  /** Registry key for a generic work-item node */
  workItemTypeKey?: string;

  /** Icon key resolved from the work-item type definition */
  iconType?: string;
  workItemIcon?: WorkItemIconIdentity;

  /** Section key that owns this node */
  sectionKey?: string;

  /** Tags associated with the entity */
  tags?: string[];

  /** When the entity was last modified */
  updatedAt?: Date;

  /** When the entity was created */
  createdAt?: Date;
}

/**
 * Props for ExplorerSidebar component
 */
export interface ExplorerSidebarProps {
  /** Current project ID, when viewing a project */
  projectId?: string;

  /** Current organization ID */
  organizationId: string;

  /** Current drawer width */
  width: number;

  /** Whether drawer is in minimal icon-only mode */
  isMinimal: boolean;

  /** Whether the sidebar is rendered inside the temporary mobile drawer */
  isMobileDrawer?: boolean;

  /** Close the temporary mobile drawer after an account navigation */
  onMobileNavigate?: () => void;
}

/**
 * Props for ExplorerSearch component
 */
export interface ExplorerSearchProps {
  /** Current search term */
  searchTerm: string;

  /** Callback when search term changes */
  onSearchChange: (term: string) => void;

  /** Number of search results (for display) */
  resultCount?: number;
}

/**
 * Props for ExplorerTree component
 */
export interface ExplorerTreeProps {
  /** Nodes to display in the tree */
  nodes: ExplorerNode[];

  /** Set of expanded node IDs */
  expandedNodes: Set<string>;

  /** Currently selected node ID */
  selectedNodeId?: string;

  /** Callback when a node is toggled (expanded/collapsed) */
  onToggleNode: (nodeId: string) => void;

  /** Callback when a node is selected/clicked */
  onSelectNode: (node: ExplorerNode) => void;

  /** Whether we're currently searching (affects grouping) */
  isSearching?: boolean;

  /** Set of expanded entity type groups */
  expandedEntityGroups: Set<string>;

  /** Callback when an entity type group is toggled */
  onToggleEntityGroup: (groupKey: string) => void;

  /** Ordered section descriptors rendered by the explorer */
  sections: ExplorerSection[];

  /** Organization ID for InteractionComponent */
  organizationId?: string;

  /** Project ID for InteractionComponent */
  projectId?: string;
}

/**
 * One ordered explorer section. Work-item sections are derived from the
 * resolved registry; Plans and Services are the remaining legacy sections.
 */
export interface ExplorerSection {
  /** Stable key used for expansion persistence */
  key: string;

  /** Display label sourced from the section's owner */
  label: string;

  /** List route used by the section header, when one exists */
  path?: string;

  /** Canonical project collection available through Preview */
  previewCollection?: import("@hey-hey/ui-common/context").ProjectCollectionKind;

  /** Nodes displayed by the section */
  nodes: ExplorerNode[];

  /** Loaded count, when available */
  count?: number;

  /** Whether this section's collection is still loading */
  isLoading?: boolean;
}

/**
 * Props for ExplorerTreeNode component
 */
export interface ExplorerTreeNodeProps {
  /** The node to render */
  node: ExplorerNode;

  /** Whether this node is expanded */
  isExpanded: boolean;

  /** Whether this node is selected */
  isSelected: boolean;

  /** Callback when the node is toggled */
  onToggle: () => void;

  /** Callback when the node is clicked/selected */
  onSelect: () => void;

  /** Child nodes (if expanded and loaded) */
  children?: ExplorerNode[];

  /** Whether children are currently loading */
  isLoadingChildren?: boolean;

  /** Recursive callback for rendering child nodes */
  onRenderChildren?: (nodes: ExplorerNode[]) => React.ReactNode;

  /** Whether to disable depth-based indentation (e.g., in search mode) */
  disableDepthIndent?: boolean;

  /** Organization ID for InteractionComponent */
  organizationId?: string;

  /** Project ID for InteractionComponent */
  projectId?: string;

  /** Override interaction indicator size */
  interactionSize?: "small" | "medium" | "large";
}
