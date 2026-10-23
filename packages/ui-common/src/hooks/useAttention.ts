import { useUserAction } from "../contexts/TrackingContext";
import type { AttentionEntityType } from "../types/userTracking";
import { useNavigationAttention } from "./useNavigationAttention";
import { useAttentionHeartbeat } from "./useAttentionHeartbeat";

export interface UseAttentionOptions {
  entityType?: AttentionEntityType;
  entityId?: string;
  tab?: string;
  enabled?: boolean;
}

/**
 * Composite hook that handles both navigation and continuous attention tracking.
 * Automatically uses the TrackingContext to emit attention events.
 *
 * Emits a navigation event (with 3s debounce) when entity changes,
 * then emits heartbeat events every 30s while the tab remains visible.
 *
 * @param options - Configuration options
 * @param options.entityType - Type of entity being focused on
 * @param options.entityId - ID of the entity
 * @param options.tab - Optional sub-view identifier (e.g., "editor", "comments")
 * @param options.enabled - Whether tracking is enabled (default: true if entityType and entityId are provided)
 *
 * @example
 * ```tsx
 * // Automatically tracks when initiative is defined
 * useAttention({
 *   entityType: 'initiative',
 *   entityId: initiative?.id,
 *   tab: 'editor'
 * });
 *
 * // Conditionally enable tracking
 * useAttention({
 *   entityType: 'task',
 *   entityId: task?.id,
 *   enabled: !!task && isActive
 * });
 * ```
 */
export const useAttention = (options: UseAttentionOptions): void => {
  const { entityType, entityId, tab, enabled } = options;
  const { trackAttention } = useUserAction();

  // Determine if tracking should be active
  const isEnabled =
    enabled !== undefined ? enabled : !!(entityType && entityId);

  // Prepare entity values for tracking (empty string if disabled)
  const trackingEntityType = (isEnabled && entityType) || "initiative";
  const trackingEntityId = (isEnabled && entityId) || "";

  // Track navigation (fires once with 5s debounce when entity changes)
  // The underlying hook will skip if entityId is empty
  useNavigationAttention(
    trackingEntityType,
    trackingEntityId,
    trackAttention,
    tab,
  );

  // Track continuous attention (fires every 30s while visible)
  // The underlying hook will skip if entityId is empty
  useAttentionHeartbeat(
    trackingEntityType,
    trackingEntityId,
    trackAttention,
    tab,
  );
};
