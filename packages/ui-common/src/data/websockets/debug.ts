/**
 * WebSocket Debug System for New Jotai Collection Architecture
 *
 * Provides comprehensive debugging utilities for WebSocket events,
 * collection state changes, and real-time data flow. Adapted from
 * the old system to work with the new Jotai collection system.
 */

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { type WebSocketEvent as RealWebSocketEvent } from "../../api";
import {
  useOptionalWebSocketService,
  useWebSocketService,
} from "../../contexts/WebSocketContext";
import {
  getDefaultWebSocketService,
  type WebSocketService,
} from "../../services/webSocketService";
import { logger } from "../../utils/logger";
import { initiativeKeys } from "../collections/initiatives";

// Enhanced WebSocket event interface for new system
export interface WebSocketEvent {
  type: RealWebSocketEvent["type"];
  source: string;
  timestamp: string;
  data: unknown;
  id?: string; // Optional ID for compatibility with UI components
  metadata?: {
    success: boolean;
    duration?: number;
    error?: string;
    collectionName?: string;
    queryKey?: string;
    actionType?: string;
    subscriptionId?: string;
  };
}

// Collection state debugging information
export interface CollectionDebugState {
  name: string;
  totalItems: number;
  activeQueries: {
    listQueries: number;
    singleQueries: number;
  };
  staleQueries: string[];
  loadingQueries: string[];
  errors: Array<{ queryKey: string; error: string }>;
  optimisticUpdates: number;
  lastActivity: string | null;
}

// Overall debug state
export interface WebSocketDebugState {
  events: WebSocketEvent[];
  connectionState: {
    isConnected: boolean;
    isAuthenticated: boolean;
    connectionError: string | null;
  };
  collections: CollectionDebugState[];
  statistics: {
    totalEvents: number;
    eventsByType: Record<string, number>;
    averageEventProcessingTime: number;
    errorsInLastHour: number;
    lastReconnectTime: string | null;
  };
}

// Event filter interface
export interface WebSocketEventFilter {
  type?: WebSocketEvent["type"];
  source?: string;
  timeRange?: {
    start?: Date;
    end?: Date;
  };
  search?: string;
  collectionName?: string;
  showErrorsOnly?: boolean;
}

// Enhanced WebSocket event filter with advanced filtering options
export interface EnhancedWebSocketEventFilter extends WebSocketEventFilter {
  subscriptionId?: string;
  messageType?: string;
  errorCategory?: string;
  performanceThreshold?: number; // Show only events slower than X ms
  userFilter?: string; // Filter by user ID
  roomType?: "project" | "conversation" | "initiative";
  roomId?: string;
  connectionStatus?: "connected" | "disconnected" | "error";
  showSuccessOnly?: boolean;
  eventCategories?: string[]; // Multiple event categories
}

const isEventDataRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const getStringProperty = (value: unknown, key: string): string | undefined => {
  if (!isEventDataRecord(value)) {
    return undefined;
  }

  const property = value[key];
  return typeof property === "string" ? property : undefined;
};

/**
 * Global event store for debug system
 */
class DebugEventStore {
  private events: WebSocketEvent[] = [];
  private maxEvents = 1000;
  private listeners = new Set<(event: WebSocketEvent) => void>();

  addEvent(event: WebSocketEvent) {
    const timestampedEvent = {
      ...event,
      id:
        event.id || `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: event.timestamp || new Date().toISOString(),
    };

    this.events.push(timestampedEvent);

    // Keep only recent events
    if (this.events.length > this.maxEvents) {
      this.events = this.events.slice(-this.maxEvents);
    }

    // Notify listeners
    this.listeners.forEach((listener) => {
      try {
        listener(timestampedEvent);
      } catch (error) {
        logger.error("data_websockets", "[logEvent] Error in event listener", {
          error,
        });
      }
    });
  }

  getEvents(): WebSocketEvent[] {
    return [...this.events];
  }

  clearEvents() {
    this.events = [];
  }

  addEventListener(listener: (event: WebSocketEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getFilteredEvents(
    filter: WebSocketEventFilter | EnhancedWebSocketEventFilter
  ): WebSocketEvent[] {
    let filtered = this.events;

    if (filter.type) {
      filtered = filtered.filter((event) => event.type === filter.type);
    }

    if (filter.source) {
      filtered = filtered.filter((event) =>
        event.source.toLowerCase().includes(filter.source!.toLowerCase())
      );
    }

    if (filter.timeRange) {
      filtered = filtered.filter((event) => {
        const eventTime = new Date(event.timestamp);
        const { start, end } = filter.timeRange ?? {};

        if (start && eventTime < start) {
          return false;
        }

        if (end && eventTime > end) {
          return false;
        }

        return true;
      });
    }

    if (filter.search) {
      const searchLower = filter.search.toLowerCase();
      filtered = filtered.filter(
        (event) =>
          JSON.stringify(event.data).toLowerCase().includes(searchLower) ||
          event.source.toLowerCase().includes(searchLower) ||
          event.type.toLowerCase().includes(searchLower)
      );
    }

    if (filter.collectionName) {
      filtered = filtered.filter(
        (event) => event.metadata?.collectionName === filter.collectionName
      );
    }

    if (filter.showErrorsOnly) {
      filtered = filtered.filter(
        (event) =>
          event.metadata?.success === false ||
          event.metadata?.error ||
          event.type.includes("error")
      );
    }

    // Enhanced filters
    const enhancedFilter = filter as EnhancedWebSocketEventFilter;

    if (enhancedFilter.subscriptionId) {
      filtered = filtered.filter(
        (event) =>
          event.metadata?.subscriptionId === enhancedFilter.subscriptionId
      );
    }

    if (enhancedFilter.messageType) {
      filtered = filtered.filter(
        (event) =>
          getStringProperty(event.data, "eventType") ===
          enhancedFilter.messageType
      );
    }

    if (enhancedFilter.errorCategory) {
      filtered = filtered.filter(
        (event) =>
          getStringProperty(event.data, "category") ===
          enhancedFilter.errorCategory
      );
    }

    const { performanceThreshold } = enhancedFilter;
    if (typeof performanceThreshold === "number") {
      filtered = filtered.filter(
        (event) =>
          typeof event.metadata?.duration === "number" &&
          event.metadata.duration >= performanceThreshold
      );
    }

    if (enhancedFilter.userFilter) {
      filtered = filtered.filter(
        (event) =>
          getStringProperty(event.data, "userId") === enhancedFilter.userFilter
      );
    }

    if (enhancedFilter.roomType) {
      filtered = filtered.filter(
        (event) =>
          getStringProperty(event.data, "roomType") === enhancedFilter.roomType
      );
    }

    if (enhancedFilter.roomId) {
      filtered = filtered.filter(
        (event) =>
          getStringProperty(event.data, "roomId") === enhancedFilter.roomId
      );
    }

    if (enhancedFilter.connectionStatus) {
      const statusMap: Record<string, string[]> = {
        connected: ["connected", "auth_success"],
        disconnected: ["disconnected"],
        error: ["connection_failed", "auth_failed", "error"],
      };
      const targetEvents = statusMap[enhancedFilter.connectionStatus] || [];
      filtered = filtered.filter((event) =>
        targetEvents.includes(getStringProperty(event.data, "event") ?? "")
      );
    }

    if (enhancedFilter.showSuccessOnly) {
      filtered = filtered.filter((event) => event.metadata?.success === true);
    }

    if (enhancedFilter.eventCategories?.length) {
      const categories = enhancedFilter.eventCategories;
      filtered = filtered.filter((event) =>
        categories.some(
          (category) =>
            event.type.includes(category) ||
            (getStringProperty(event.data, "event")?.includes(category) ??
              false)
        )
      );
    }

    return filtered;
  }

  getStatistics(): WebSocketDebugState["statistics"] {
    const events = this.getEvents();
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

    const eventsByType = events.reduce((acc, event) => {
      acc[event.type] = (acc[event.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const errorsInLastHour = events.filter(
      (event) =>
        new Date(event.timestamp) >= oneHourAgo &&
        (event.metadata?.success === false || event.metadata?.error)
    ).length;

    const durations = events
      .map((event) => event.metadata?.duration)
      .filter((duration): duration is number => typeof duration === "number");

    const averageEventProcessingTime =
      durations.length > 0
        ? durations.reduce((sum, duration) => sum + duration, 0) /
          durations.length
        : 0;

    const reconnectEvents = events
      .filter((event) => event.type === "websocket.connected")
      .sort(
        (a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );

    return {
      totalEvents: events.length,
      eventsByType,
      averageEventProcessingTime,
      errorsInLastHour,
      lastReconnectTime:
        reconnectEvents.length > 0 ? reconnectEvents[0].timestamp : null,
    };
  }
}

// Global debug store
export const debugEventStore = new DebugEventStore();

/**
 * React hook for accessing WebSocket debug information.
 * Provides real-time updates on WebSocket state, events, and collection states.
 */
export const useWebSocketDebug = (
  options: {
    updateInterval?: number;
    maxEvents?: number;
    filter?: EnhancedWebSocketEventFilter;
  } = {}
): WebSocketDebugState & {
  clearEventLog: () => void;
  exportDebugData: () => string;
  getFilteredEvents: (
    filter: WebSocketEventFilter | EnhancedWebSocketEventFilter
  ) => WebSocketEvent[];
} => {
  const { updateInterval = 1000, filter } = options;

  // Get collection state
  const queryClient = useQueryClient();

  // Use context-aware WebSocket service when available; maintain a null value
  // for legacy debug entry points that render outside a provider.
  const webSocketService = useOptionalWebSocketService();

  useEffect(() => {
    if (!webSocketService) {
      console.warn(
        "[useWebSocketDebug] WebSocketService not available, debug will show disconnected state"
      );
      logger.warn(
        "data_websockets",
        "[useWebSocketDebug] WebSocketService not available, debug will show disconnected state"
      );
    }
  }, [webSocketService]);

  const [debugState, setDebugState] = useState<WebSocketDebugState>(() => ({
    events: [],
    connectionState: {
      isConnected: false,
      isAuthenticated: false,
      connectionError: null,
    },
    collections: [],
    statistics: {
      totalEvents: 0,
      eventsByType: {},
      averageEventProcessingTime: 0,
      errorsInLastHour: 0,
      lastReconnectTime: null,
    },
  }));

  // Build collection debug state
  const buildCollectionDebugState = useCallback((): CollectionDebugState[] => {
    const queries = queryClient
      .getQueryCache()
      .findAll({ queryKey: initiativeKeys.root() });
    const ids = new Set<string>();
    for (const query of queries) {
      const values = Array.isArray(query.state.data)
        ? query.state.data
        : [query.state.data];
      for (const value of values) {
        if (
          value &&
          typeof value === "object" &&
          "id" in value &&
          typeof value.id === "string"
        )
          ids.add(value.id);
      }
    }
    const lastActivity = Math.max(
      0,
      ...queries.map((query) => query.state.dataUpdatedAt)
    );
    return [
      {
        name: "initiatives",
        totalItems: ids.size,
        activeQueries: {
          listQueries: queries.filter(
            (query) => query.isActive() && query.queryKey[2] === "list"
          ).length,
          singleQueries: queries.filter(
            (query) => query.isActive() && query.queryKey[2] === "detail"
          ).length,
        },
        staleQueries: queries
          .filter((query) => query.isStale())
          .map((query) => query.queryHash),
        loadingQueries: queries
          .filter((query) => query.state.fetchStatus === "fetching")
          .map((query) => query.queryHash),
        errors: queries.flatMap((query) =>
          query.state.error
            ? [{ queryKey: query.queryHash, error: query.state.error.message }]
            : []
        ),
        optimisticUpdates: 0,
        lastActivity: lastActivity
          ? new Date(lastActivity).toISOString()
          : null,
      },
    ];
  }, [queryClient]);

  // Update debug state periodically
  useEffect(() => {
    const updateDebugState = () => {
      const events = debugEventStore.getEvents();
      const connectionState = webSocketService
        ? webSocketService.getState()
        : {
            isConnected: false,
            isAuthenticated: false,
            connectionError: null,
          };
      const collections = buildCollectionDebugState();
      const statistics = debugEventStore.getStatistics();

      setDebugState({
        events: filter ? debugEventStore.getFilteredEvents(filter) : events,
        connectionState,
        collections,
        statistics,
      });
    };

    // Initial update
    updateDebugState();

    // Set up periodic updates
    const interval = setInterval(updateDebugState, updateInterval);

    return () => clearInterval(interval);
  }, [
    updateInterval,
    filter,
    queryClient,
    buildCollectionDebugState,
    webSocketService,
  ]);

  const clearEventLog = () => {
    debugEventStore.clearEvents();
  };

  const getFilteredEvents = (
    eventFilter: WebSocketEventFilter | EnhancedWebSocketEventFilter
  ): WebSocketEvent[] => {
    return debugEventStore.getFilteredEvents(eventFilter);
  };

  const exportDebugData = (): string => {
    const debugData = {
      timestamp: new Date().toISOString(),
      connectionState: debugState.connectionState,
      collections: debugState.collections,
      statistics: debugState.statistics,
      events: debugState.events,
      systemInfo: {
        userAgent: navigator.userAgent,
        url: window.location.href,
        webSocketServiceState: webSocketService
          ? webSocketService.getState()
          : null,
        collectionsSnapshot: {
          initiatives: buildCollectionDebugState()[0],
        },
      },
    };

    return JSON.stringify(debugData, null, 2);
  };

  return {
    ...debugState,
    clearEventLog,
    exportDebugData,
    getFilteredEvents,
  };
};

/**
 * Utility class for programmatic WebSocket debugging.
 * Adapted for the new Jotai collection system.
 */
export class WebSocketDebugger {
  private eventListeners = new Set<(event: WebSocketEvent) => void>();
  private isMonitoring = false;
  private monitoringInterval: NodeJS.Timeout | null = null;
  private webSocketService: WebSocketService | null = null;

  constructor(webSocketService?: WebSocketService) {
    this.webSocketService = webSocketService || null;
  }

  /**
   * Start monitoring WebSocket events and collection changes.
   */
  startMonitoring(_interval = 1000): void {
    if (this.isMonitoring) {
      logger.warn("data_websockets", "[startMonitoring] Already monitoring");
      return;
    }

    this.isMonitoring = true;

    // Listen to debug event store
    const unsubscribe = debugEventStore.addEventListener((event) => {
      this.eventListeners.forEach((listener) => {
        try {
          listener(event);
        } catch (error) {
          logger.error(
            "data_websockets",
            "[startMonitoring] Error in event listener",
            { error }
          );
        }
      });
    });

    logger.info(
      "data_websockets",
      "[startMonitoring] Started monitoring with new collection system"
    );

    // Store unsubscribe for cleanup
    this.monitoringInterval = {
      unref: () => {},
      ref: () => {},
      refresh: () => {},
      hasRef: () => true,
      [Symbol.toPrimitive]: () => 1,
      [Symbol.dispose]: unsubscribe,
    } as NodeJS.Timeout;
  }

  /**
   * Stop monitoring WebSocket events.
   */
  stopMonitoring(): void {
    if (this.monitoringInterval) {
      // Call unsubscribe if it exists
      (this.monitoringInterval as unknown as { [Symbol.dispose]: () => void })[
        Symbol.dispose
      ]?.();
      this.monitoringInterval = null;
    }

    this.isMonitoring = false;
    logger.info("data_websockets", "[stopMonitoring] Stopped monitoring");
  }

  /**
   * Add an event listener for WebSocket events.
   */
  addEventListener(listener: (event: WebSocketEvent) => void): () => void {
    this.eventListeners.add(listener);

    return () => {
      this.eventListeners.delete(listener);
    };
  }

  /**
   * Get current WebSocket and collection statistics.
   */
  getStats(): {
    connectionState: ReturnType<WebSocketService["getState"]>;
    eventCounts: Record<string, number>;
    recentErrors: WebSocketEvent[];
    collectionsHealth: Array<{
      name: string;
      healthy: boolean;
      totalItems: number;
      activeQueries: number;
      errorCount: number;
      staleCount: number;
    }>;
  } {
    const events = debugEventStore.getEvents();

    // Use injected service or fallback to singleton for backward compatibility
    let connectionState;
    if (this.webSocketService) {
      connectionState = this.webSocketService.getState();
    } else {
      // Fallback to singleton service for backward compatibility
      const singletonService = getDefaultWebSocketService();
      connectionState = singletonService.getState();
      logger.warn(
        "data_websockets",
        "[getConnectionState] WebSocketDebugger using singleton service. Consider passing service instance to constructor."
      );
    }

    const statistics = debugEventStore.getStatistics();

    // Find recent errors (events with error metadata)
    const recentErrors = events
      .filter(
        (event) =>
          event.metadata?.success === false ||
          event.metadata?.error ||
          JSON.stringify(event.data).includes("error")
      )
      .slice(-10); // Last 10 errors

    // Mock collections health - in a real implementation, this would check all collections
    const collectionsHealth = [
      {
        name: "initiatives",
        healthy: true, // Would check error rates, response times, etc.
        totalItems: 0, // Would get from actual collection state
        activeQueries: 0,
        errorCount: 0,
        staleCount: 0,
      },
    ];

    return {
      connectionState,
      eventCounts: statistics.eventsByType,
      recentErrors,
      collectionsHealth,
    };
  }

  /**
   * Generate a comprehensive debug report.
   */
  generateReport(): string {
    const stats = this.getStats();
    const statistics = debugEventStore.getStatistics();

    const report = {
      timestamp: new Date().toISOString(),
      summary: {
        connectionHealthy:
          stats.connectionState.isConnected &&
          stats.connectionState.isAuthenticated,
        totalEvents: statistics.totalEvents,
        recentErrorCount: stats.recentErrors.length,
        collectionsHealthy: stats.collectionsHealth.every((c) => c.healthy),
        systemType: "jotai-collections", // Distinguish from old system
      },
      connectionState: stats.connectionState,
      statistics,
      eventCounts: stats.eventCounts,
      recentErrors: stats.recentErrors,
      collectionsHealth: stats.collectionsHealth,
      systemInfo: {
        userAgent: navigator.userAgent,
        url: window.location.href,
        timestamp: new Date().toISOString(),
        architecture: "jotai-collection-system",
      },
    };

    return JSON.stringify(report, null, 2);
  }

  /**
   * Log a WebSocket event to the debug system.
   */
  logEvent(event: Omit<WebSocketEvent, "timestamp">) {
    debugEventStore.addEvent({
      ...event,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Log a collection action for debugging.
   */
  logCollectionAction(
    collectionName: string,
    actionType: string,
    queryKey: string,
    metadata?: Record<string, unknown>
  ) {
    this.logEvent({
      type: "collection.action",
      source: `collection:${collectionName}`,
      data: { actionType, queryKey, metadata },
      metadata: {
        success: true,
        collectionName,
        queryKey,
        actionType,
      },
    });
  }
}

// Export singleton debugger instance (deprecated - use useWebSocketDebugger hook instead)
export const webSocketDebugger = new WebSocketDebugger();

/**
 * React hook for creating a context-aware WebSocket debugger.
 * Preferred over singleton for components that use the new WebSocket context.
 */
export const useWebSocketDebugger = (): WebSocketDebugger => {
  const webSocketService = useWebSocketService();

  return useMemo(() => {
    return new WebSocketDebugger(webSocketService);
  }, [webSocketService]);
};

/**
 * Development helper: Auto-start debugging in development mode.
 */
if (process.env.NODE_ENV === "development") {
  // Auto-start monitoring in development
  webSocketDebugger.startMonitoring();

  // Add global access for debugging in browser console
  (window as unknown as { wsDebug?: WebSocketDebugger }).wsDebug =
    webSocketDebugger;

  logger.info(
    "data_websockets",
    "[initializeWebSocketDebug] Development mode: WebSocket debugging enabled for Jotai collection system. Use window.wsDebug to access debugger."
  );
}
