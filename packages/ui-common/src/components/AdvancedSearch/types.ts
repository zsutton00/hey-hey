import type { SearchEntity } from "../SmarterTextAreaCard/types";
import { EntityType } from "../../api";

export type AdvancedSearchScopeEntityType =
  | typeof EntityType.Initiative
  | typeof EntityType.Task;

export interface AdvancedSearchEntityScope {
  entityId: string;
  entityType: AdvancedSearchScopeEntityType;
}

/**
 * Props for the AdvancedSearch component
 */
interface AdvancedSearchCommonProps {
  /**
   * Organization ID for scoping the search
   */
  organizationId: string;

  /**
   * Callback when entities are selected
   */
  onSelect: (entities: SearchEntity[]) => void;

  /**
   * Enable multi-selection mode with checkboxes
   */
  allowMultiSelect?: boolean;

  /**
   * Callback when the search modal is closed
   */
  onClose?: () => void;

  /**
   * Optional project ID to filter results
   */
  projectId: string;

  /**
   * Optional immutable entity scope for callers that need a type-restricted search
   */
  defaultEntityTypes?: string[];

  /**
   * Default statuses to filter by
   */
  defaultStatuses?: string[];

  /**
   * Maximum number of results to return
   */
  maxResults?: number;

  /**
   * Initial query text to seed the search input with on mount
   */
  defaultQuery?: string;

  /**
   * Hide the advanced status filter
   */
  hideFilters?: boolean;

  /**
   * Called whenever the "has content" state changes (results present, agent
   * session active, or agent session being created). Used by the host dialog
   * to expand/collapse its size.
   */
  onHasContent?: (hasContent: boolean) => void;
}

type AdvancedSearchScopedProps = {
  entityId: string;
  entityType: AdvancedSearchScopeEntityType;
};

type AdvancedSearchUnscopedProps = {
  entityId?: undefined;
  entityType?: undefined;
};

export type AdvancedSearchProps = AdvancedSearchCommonProps &
  (AdvancedSearchScopedProps | AdvancedSearchUnscopedProps);

/**
 * Search filter state
 */
export interface SearchFilterState {
  /**
   * Optional entity types used by callers that need an immutable search scope.
   * The AdvancedSearch toolbar does not expose a mutable type filter.
   */
  entityTypes?: string[];

  /**
   * Status values to filter by
   */
  statuses: string[];

  /**
   * Filter by parent initiative ID
   */
  initiativeId?: string;

  /**
   * Filter by parent task ID
   */
  parentTaskId?: string;

  /**
   * Similarity threshold (0.0-1.0)
   */
  threshold?: number;

  /**
   * Boost more recent results
   */
  boostRecent?: boolean;

  /**
   * Opaque project work-item type keys
   */
  taskTypes?: string[];
}

/**
 * Re-export SearchEntity for convenience
 */
export type { SearchEntity } from "../SmarterTextAreaCard/types";
