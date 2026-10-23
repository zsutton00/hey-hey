/**
 * Shared TypeScript types for WebSocket Debug UI Components
 */

export interface WebSocketDebugUIState {
  isExpanded: boolean;
  selectedTab: "events" | "subscriptions" | "connection" | "statistics";
  maxEvents: number;
  updateInterval: number;
  autoScroll: boolean;
  showTimestamps: boolean;
}

export interface WebSocketEventFilter {
  type?:
    | "subscription_created"
    | "subscription_removed"
    | "subscription_updated"
    | "websocket_event"
    | "cache_update";
  source?: string;
  timeRange?: {
    start?: Date;
    end?: Date;
  };
  search?: string;
  showErrorsOnly?: boolean;
}

export interface WebSocketDebugPreferences {
  panelPosition: "bottom-left" | "bottom-right" | "top-left" | "top-right";
  autoStart: boolean;
  maxEventHistory: number;
  enableHotkeys: boolean;
  exportFormat: "json" | "csv";
}

export interface WebSocketConnectionHealth {
  isHealthy: boolean;
  lastConnectionAttempt: Date | null;
  reconnectionAttempts: number;
  averageLatency?: number;
  uptime: number;
}

export interface WebSocketSubscriptionHealth {
  totalActive: number;
  healthySubscriptions: number;
  duplicateCount: number;
  errorCount: number;
  avgReferenceCount: number;
}

export interface WebSocketDebugExport {
  timestamp: string;
  version: string;
  sessionInfo: {
    userAgent: string;
    url: string;
    sessionDuration: number;
  };
  connectionHealth: WebSocketConnectionHealth;
  subscriptionHealth: WebSocketSubscriptionHealth;
  events: Array<{
    id: string;
    timestamp: string;
    type: string;
    data: unknown;
    source: string;
    metadata?: Record<string, unknown>;
  }>;
  subscriptions: Array<{
    key: string;
    referenceCount: number;
    config: Record<string, unknown>;
    isHealthy: boolean;
  }>;
  statistics: {
    eventCounts: Record<string, number>;
    errorCounts: Record<string, number>;
    performanceMetrics: {
      avgEventProcessingTime: number;
      peakMemoryUsage: number;
    };
  };
}
