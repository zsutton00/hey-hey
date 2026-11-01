/**
 * TypeScript definitions for the Unified Debug Component
 * Combines WorkflowStatusDebug and WebSocketDebug into a single tabbed interface
 */

import type { ComponentType } from "react";
import type { SvgIconProps } from "@mui/material/SvgIcon";
import type {
  WebSocketEventFilter,
  WebSocketDebugExport,
} from "../debug.types";
import type {
  CollectionDebugState,
  WebSocketEventFilter as BaseWebSocketEventFilter,
  EnhancedWebSocketEventFilter,
} from "../../../data/websockets/debug";

// ========================
// Core Tab and Position Types
// ========================

export type DebugTab =
  | "workflow"
  | "websocket-events"
  | "websocket-stats"
  | "chat-messages"
  | "advanced-analytics";
export type PanelPosition =
  | "bottom-left"
  | "bottom-right"
  | "top-left"
  | "top-right";

// ========================
// Workflow Domain Types
// ========================

export interface WorkflowStatusData {
  workflowId: string;
  status: "running" | "completed" | "failed" | "pending" | "paused";
  currentStep?: string;
  progress?: number;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  metadata?: Record<string, unknown>;
  stepDetails?: {
    step: string;
    phase: string;
    currentNodeId: string;
    pathTaken: string[];
    isComplete: boolean;
    iterations: number;
    hasOpener: boolean;
    lastActivity: string;
  };
}

export interface WorkflowDomainState {
  status: WorkflowStatusData | null;
  isLoading: boolean;
  error: string | null;
  isPaused: boolean;
  lastUpdate: Date | null;
  isPolling: boolean;
}

// ========================
// WebSocket Domain Types
// ========================

export interface WebSocketEvent {
  id?: string;
  timestamp: string;
  type: string;
  data: unknown;
  source: string;
  metadata?: {
    success?: boolean;
    duration?: number;
    error?: string;
    [key: string]: unknown;
  };
}

export interface WebSocketConnectionState {
  isConnected: boolean;
  isAuthenticated: boolean;
  connectionError: string | null;
  lastConnectionAttempt: Date | null;
  reconnectionAttempts: number;
}

// CollectionDebugState is imported from data/websockets/debug

export interface WebSocketStatistics {
  totalEvents: number;
  eventsInLastHour: number;
  errorsInLastHour: number;
  avgEventProcessingTime: number;
  connectionUptime: number;
  memoryUsage: number;
}

export interface WebSocketDomainState {
  events: WebSocketEvent[];
  connectionState: WebSocketConnectionState;
  collections: CollectionDebugState[];
  statistics: WebSocketStatistics;
  filter: WebSocketEventFilter;
}

// ========================
// Cross-Domain Types
// ========================

export interface AggregatedErrorState {
  hasErrors: boolean;
  errorCount: number;
  sources: ("workflow" | "websocket")[];
  details: {
    workflow?: string;
    websocket?: string[];
  };
}

export interface ModalState {
  workflowLogs: boolean;
  fullscreen: boolean;
}

// ========================
// Tab Configuration
// ========================

export interface TabConfig {
  id: DebugTab;
  label: string;
  icon: ComponentType<SvgIconProps>;
  enabled: boolean;
  visible: boolean;
}

// ========================
// Main Component Interfaces
// ========================

export interface UnifiedDebugPanelProps {
  // Workflow monitoring configuration
  workflowId?: string;
  organizationId?: string;

  // Display and behavior
  visible?: boolean;
  onClose?: () => void;
  position?: PanelPosition;

  // Data configuration
  updateInterval?: number; // Default: 1000ms (workflow polling)
  maxEvents?: number; // Default: 1000 (WebSocket events)

  // Tab configuration
  initialTab?: DebugTab;
  enabledTabs?: DebugTab[];

  // Advanced features
  exportEnabled?: boolean;
  clearEnabled?: boolean;
  keyboardShortcuts?: boolean;

  // Callbacks
  onOpenModal?: () => void;
}

export interface UnifiedDebugState {
  // UI State
  isExpanded: boolean;
  selectedTab: DebugTab;

  // Domain States
  workflow: WorkflowDomainState;
  websocket: WebSocketDomainState;

  // Cross-Domain State
  aggregatedErrors: AggregatedErrorState;
  modals: ModalState;

  // Configuration
  enabledTabs: DebugTab[];
  tabConfigs: TabConfig[];
}

// ========================
// Tab Component Props
// ========================

export interface WorkflowStatusTabProps {
  workflowId?: string;
  organizationId?: string;
  updateInterval?: number;
  visible?: boolean;
  enabledTabs?: DebugTab[];
  onViewLogs: () => void;
}

export interface WebSocketEventsTabProps {
  events: WebSocketEvent[];
  filter: BaseWebSocketEventFilter | EnhancedWebSocketEventFilter;
  onFilterChange: (
    filter: BaseWebSocketEventFilter | EnhancedWebSocketEventFilter
  ) => void;
  onClearEvents: () => void;
  onExportEvents: () => void;
  autoScroll: boolean;
  showTimestamps: boolean;
  maxHeight?: string;
}

export interface WebSocketStatsTabProps {
  connectionState: WebSocketConnectionState;
  statistics: WebSocketStatistics;
  collections: CollectionDebugState[];
  subscriptionStats: {
    totalActiveSubscriptions: number;
    uniqueDataSubscriptions: number;
    subscriptionCountByKey: Record<string, number>;
    duplicateSubscriptions: number;
  };
  activeSubscriptions: Array<{
    subscriptionKey: string;
    webSocketSubscriptionId: string;
    referenceCount: number;
    config: {
      projectIds: string[];
      conversationIds: string[];
      initiativeIds: string[];
      eventTypes: string[];
      subscriptionType: string;
      subscriptionIndex: number;
      eventCount: number;
    };
  }>;
  onRefreshStats?: () => void;
}

export interface ChatMessagesTabProps {
  messages: Array<{
    message: {
      id: string;
      type: string;
      data?: {
        response?: string;
        [key: string]: unknown;
      };
      createdAt: string;
    };
    state: string;
  }>;
  onExportMessages: () => void;
  maxHeight?: string;
}

// ========================
// Hook Interfaces
// ========================

export interface UseUnifiedDebugOptions {
  workflowId?: string;
  organizationId?: string;
  updateInterval?: number;
  maxEvents?: number;
  visible?: boolean;
  initialTab?: DebugTab;
  enabledTabs?: DebugTab[];
}

export interface UseUnifiedDebugReturn extends UnifiedDebugState {
  // Control methods
  refreshWorkflow: () => void;
  pauseWorkflow: () => void;
  resumeWorkflow: () => void;
  clearWebSocketEvents: () => void;
  exportData: () => void;
  fetchWorkflowLogs: () => Promise<unknown>;

  // State update methods
  setSelectedTab: (tab: DebugTab) => void;
  setExpanded: (expanded: boolean) => void;
  setModalOpen: (modal: keyof ModalState, open: boolean) => void;
  setWebSocketFilter: (filter: WebSocketEventFilter) => void;

  // Utility methods
  getFilteredEvents: (filter?: WebSocketEventFilter) => WebSocketEvent[];
  exportDebugData: () => string;
}

// ========================
// Position Utility Type
// ========================

export interface PositionStyles {
  bottom?: number;
  top?: number;
  left?: number;
  right?: number;
}

export const POSITION_STYLES = {
  "bottom-left": { bottom: 16, left: 16 },
  "bottom-right": { bottom: 16, right: 16 },
  "top-left": { top: 16, left: 16 },
  "top-right": { top: 16, right: 16 },
} as const;

// ========================
// Export Data Types
// ========================

export interface UnifiedDebugExport {
  timestamp: string;
  version: string;
  sessionInfo: {
    userAgent: string;
    url: string;
    sessionDuration: number;
  };
  workflow: {
    status: WorkflowStatusData | null;
    error: string | null;
    isPaused: boolean;
    pollingInterval: number;
  };
  websocket: WebSocketDebugExport;
  aggregatedErrors: AggregatedErrorState;
}

// ========================
// Component State Helpers
// ========================

export interface TabContentProps {
  isActive: boolean;
  height?: string | number;
  maxHeight?: string | number;
}

export interface CompactViewProps {
  connectionState: WebSocketConnectionState;
  workflowStatus: WorkflowStatusData | null;
  aggregatedErrors: AggregatedErrorState;
  isPaused: boolean;
}

// ========================
// Validation Types
// ========================

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

export interface WorkflowIdValidation {
  isValidUUID: boolean;
  isMockId: boolean;
  shouldEnableMonitoring: boolean;
}
