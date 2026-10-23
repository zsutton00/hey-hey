/**
 * User Action Tracking TypeScript Interfaces
 *
 * Provides type-safe definitions for tracking user interactions with human-readable descriptions
 */

// Branded types for type safety
export type TrackingEventId = string & { readonly __brand: "TrackingEventId" };
export type SessionId = string & { readonly __brand: "SessionId" };
export type UserId = string & { readonly __brand: "UserId" };
export type AgentSessionId = string & { readonly __brand: "AgentSessionId" };
export type HintId = string & { readonly __brand: "HintId" };
export type RecommendationId = string & {
  readonly __brand: "RecommendationId";
};
export type InvocationId = string & { readonly __brand: "InvocationId" };

export const NAVIGATION_LINEAGE_ENTITY_TYPES = [
  "task",
  "plan",
  "plan_stage",
  "plan_step",
] as const;

export type NavigationLineageEntityType =
  (typeof NAVIGATION_LINEAGE_ENTITY_TYPES)[number];

export type NavigationLineageEntityId<
  T extends NavigationLineageEntityType = NavigationLineageEntityType
> = string & {
  readonly __brand: "NavigationLineageEntityId";
  readonly __entityType: T;
};

interface NavigationLineageEntryFor<T extends NavigationLineageEntityType> {
  entityType: T;
  entityId: NavigationLineageEntityId<T>;
}

export type NavigationLineageEntry = {
  [T in NavigationLineageEntityType]: NavigationLineageEntryFor<T>;
}[NavigationLineageEntityType];

export type NavigationLineage = readonly NavigationLineageEntry[];

export function navigationLineagesEqual(
  left: NavigationLineage | null,
  right: NavigationLineage | null
): boolean {
  if (left === right) {
    return true;
  }

  if (left === null || right === null || left.length !== right.length) {
    return false;
  }

  return left.every(
    (entry, index) =>
      entry.entityType === right[index]?.entityType &&
      entry.entityId === right[index]?.entityId
  );
}

export function createNavigationLineageEntry<
  T extends NavigationLineageEntityType
>(entityType: T, entityId: string): NavigationLineageEntryFor<T> {
  return {
    entityType,
    entityId: entityId as NavigationLineageEntityId<T>,
  };
}

export type AttentionEntityType =
  | "initiative"
  | "task"
  | "project"
  | "conversation"
  | "design_doc"
  | "agent_session"
  | "plan"
  | "proposal";

// Core event metadata
export interface TrackingEventMetadata {
  eventId: TrackingEventId;
  sessionId: SessionId;
  userId?: UserId;
  timestamp: number;
  url: string;
  userAgent: string;
  viewport: {
    width: number;
    height: number;
  };
  context: TrackingContext;
}

// Hierarchical context for semantic understanding
export interface TrackingContext {
  organization?: {
    id: string;
    name: string;
  };
  project?: {
    id: string;
    name: string;
  };
  initiative?: {
    id: string;
    name: string;
    status: string;
    priority: string;
  };
  task?: {
    id: string;
    name: string;
    status: string;
    priority: string;
  };
  workflow?: {
    id: string;
    name: string;
    currentStep?: string;
  };
  agentSession?: {
    id: string;
    name: string;
    projectId?: string;
  };
  designDoc?: {
    id: string;
    name: string;
    projectId?: string;
  };
  page: {
    name: string;
    path: string;
    section?: string;
  };
  component?: {
    name: string;
    props?: Record<string, unknown>;
  };
  attentionEntity?: {
    type: AttentionEntityType;
    id: string;
    lineage?: NavigationLineage | null;
    tab?: string;
    name?: string;
    status?: string;
    projectId?: string;
    originatingProjectId?: string;
    linkedProjectIds?: string[];
  };
}

// Event categories for organization
export type EventCategory =
  | "navigation"
  | "initiative"
  | "workflow"
  | "project"
  | "authentication"
  | "form"
  | "ui_interaction"
  | "integration"
  | "error"
  | "performance"
  | "cli_telemetry";

// Initiative-specific action types
export type InitiativeAction =
  | "create"
  | "update"
  | "delete"
  | "view"
  | "refine"
  | "review"
  | "approve"
  | "reject"
  | "link_project"
  | "unlink_project"
  | "add_requirement"
  | "update_requirement"
  | "remove_requirement"
  | "change_status"
  | "change_priority"
  | "add_tag"
  | "remove_tag"
  | "set_due_date"
  | "start_conversation"
  | "export";

// Workflow action types
export type WorkflowAction =
  | "create"
  | "update"
  | "delete"
  | "execute"
  | "pause"
  | "resume"
  | "cancel"
  | "view"
  | "simulate"
  | "validate"
  | "export"
  | "duplicate"
  | "share";

// Navigation action types
export type NavigationAction =
  | "page_view"
  | "page_leave"
  | "link_click"
  | "back_button"
  | "forward_button"
  | "breadcrumb_click"
  | "tab_switch"
  | "menu_navigate";

// Form action types
export type FormAction =
  | "start_fill"
  | "field_focus"
  | "field_blur"
  | "field_change"
  | "validation_error"
  | "submit_attempt"
  | "submit_success"
  | "submit_error"
  | "reset"
  | "auto_save";

// UI interaction types
export type UIAction =
  | "button_click"
  | "modal_open"
  | "modal_close"
  | "dropdown_open"
  | "dropdown_close"
  | "tooltip_show"
  | "tooltip_hide"
  | "search"
  | "filter"
  | "sort"
  | "pagination"
  | "drag_start"
  | "drag_end"
  | "file_upload"
  | "file_download"
  | "component_mount"
  | "component_unmount"
  | "component_visible"
  | "component_hidden"
  | "component_props_changed"
  | "error_recovery";

export type CliTelemetryCategory = "cli_telemetry";

export type CliTelemetryAction =
  | "agent_session_created"
  | "implementation_hint_written"
  | "final_recommendation_stored"
  | "agent_invocation";

export type CliTelemetryStatus = "success" | "failure";

export type CliTelemetrySuccess = { status: "success" };

export type CliTelemetryFailure = {
  status: "failure";
  errorMessage: string;
  errorCode?: string;
};

export type AgentSessionCreatedData = {
  latencyMs: number;
} & (
  | (CliTelemetrySuccess & {
      sessionId: AgentSessionId;
    })
  | (CliTelemetryFailure & {
      sessionId?: AgentSessionId;
    })
);

export type ImplementationHintWrittenData = {
  sessionId: AgentSessionId;
  latencyMs: number;
  idempotencyCollisionCount: number;
} & (
  | (CliTelemetrySuccess & {
      hintId: HintId;
    })
  | (CliTelemetryFailure & {
      hintId?: HintId;
    })
);

export type FinalRecommendationStoredData = {
  sessionId: AgentSessionId;
  latencyMs: number;
} & (
  | (CliTelemetrySuccess & {
      recommendationId: RecommendationId;
    })
  | (CliTelemetryFailure & {
      recommendationId?: RecommendationId;
    })
);

export type AgentInvocationData = {
  sessionId: AgentSessionId;
  latencyMs: number;
  provider: "claude" | "codex" | "opencode";
} & (
  | (CliTelemetrySuccess & {
      invocationId: InvocationId;
      errorCount: number;
    })
  | (CliTelemetryFailure & {
      invocationId?: InvocationId;
    })
);

export type CliTelemetryEventType =
  | "agent_session.created"
  | "implementation_hint.written"
  | "final_recommendation.stored"
  | "agent.invocation";

export type CliTelemetryEventInput =
  | {
      eventType: "agent_session.created";
      data: AgentSessionCreatedData;
    }
  | {
      eventType: "implementation_hint.written";
      data: ImplementationHintWrittenData;
    }
  | {
      eventType: "final_recommendation.stored";
      data: FinalRecommendationStoredData;
    }
  | {
      eventType: "agent.invocation";
      data: AgentInvocationData;
    };

// Discriminated union for all trackable events
export type UserTrackingEvent =
  | InitiativeEvent
  | WorkflowEvent
  | NavigationEvent
  | FormEvent
  | UIInteractionEvent
  | CliTelemetryEvent
  | AuthenticationEvent
  | IntegrationEvent
  | ErrorEvent
  | PerformanceEvent;

// Initiative events
export interface InitiativeEvent extends TrackingEventMetadata {
  category: "initiative";
  action: InitiativeAction;
  data: {
    initiativeId: string;
    initiativeName: string;
    previousValue?: unknown;
    newValue?: unknown;
    field?: string;
    requirement?: {
      id: string;
      text: string;
    };
    project?: {
      id: string;
      name: string;
    };
    conversation?: {
      id: string;
      messageCount: number;
    };
  };
}

// Workflow events
export interface WorkflowEvent extends TrackingEventMetadata {
  category: "workflow";
  action: WorkflowAction;
  data: {
    workflowId: string;
    workflowName: string;
    nodeId?: string;
    nodeName?: string;
    executionId?: string;
    simulationStep?: number;
    validationResults?: {
      errors: number;
      warnings: number;
    };
  };
}

// Navigation events
export interface NavigationEvent extends TrackingEventMetadata {
  category: "navigation";
  action: NavigationAction;
  data: {
    fromPage?: string;
    toPage: string;
    referrer?: string;
    timeOnPage?: number;
    scrollDepth?: number;
    exitIntent?: boolean;
    linkText?: string;
    linkHref?: string;
  };
}

// Form events
export interface FormEvent extends TrackingEventMetadata {
  category: "form";
  action: FormAction;
  data: {
    formName: string;
    fieldName?: string;
    fieldType?: string;
    fieldValue?: string;
    validationErrors?: string[];
    completionRate?: number;
    timeToComplete?: number;
    submitAttempts?: number;
    componentName?: string;
  };
}

// UI interaction events
export interface UIInteractionEvent extends TrackingEventMetadata {
  category: "ui_interaction";
  action: UIAction;
  data: {
    elementType: string;
    elementText?: string;
    elementId?: string;
    elementClass?: string;
    componentName?: string;
    searchQuery?: string;
    filterCriteria?: Record<string, unknown>;
    sortField?: string;
    sortDirection?: "asc" | "desc";
    pageNumber?: number;
    fileType?: string;
    fileName?: string;
    fileSize?: number;
    resultCount?: number;
    searchTime?: number;
    timeVisible?: number;
    viewDuration?: number;
    intersectionRatio?: number;
    changes?: Array<{ prop: string; from: unknown; to: unknown }>;
    reason?: string;
    recoveryAction?: string;
    successful?: boolean;
    [key: string]: unknown;
  };
}

export interface AgentSessionCreatedEvent extends TrackingEventMetadata {
  category: "cli_telemetry";
  action: "agent_session_created";
  data: AgentSessionCreatedData;
}

export interface ImplementationHintWrittenEvent extends TrackingEventMetadata {
  category: "cli_telemetry";
  action: "implementation_hint_written";
  data: ImplementationHintWrittenData;
}

export interface FinalRecommendationStoredEvent extends TrackingEventMetadata {
  category: "cli_telemetry";
  action: "final_recommendation_stored";
  data: FinalRecommendationStoredData;
}

export interface AgentInvocationEvent extends TrackingEventMetadata {
  category: "cli_telemetry";
  action: "agent_invocation";
  data: AgentInvocationData;
}

export type CliTelemetryEvent =
  | AgentSessionCreatedEvent
  | ImplementationHintWrittenEvent
  | FinalRecommendationStoredEvent
  | AgentInvocationEvent;

export type CliTelemetryTrackingEventInput =
  | Pick<AgentSessionCreatedEvent, "category" | "action" | "data">
  | Pick<ImplementationHintWrittenEvent, "category" | "action" | "data">
  | Pick<FinalRecommendationStoredEvent, "category" | "action" | "data">
  | Pick<AgentInvocationEvent, "category" | "action" | "data">;

// Authentication events
export interface AuthenticationEvent extends TrackingEventMetadata {
  category: "authentication";
  action: "login" | "logout" | "register" | "password_reset" | "profile_update";
  data: {
    method?: "email" | "oauth" | "sso";
    success: boolean;
    errorCode?: string;
    provider?: string;
  };
}

// Integration events
export interface IntegrationEvent extends TrackingEventMetadata {
  category: "integration";
  action: "connect" | "disconnect" | "sync" | "import" | "export" | "webhook";
  data: {
    integrationName: string;
    integrationType: "github" | "jira" | "slack" | "api";
    success: boolean;
    errorCode?: string;
    dataCount?: number;
  };
}

// Error events
export interface ErrorEvent extends TrackingEventMetadata {
  category: "error";
  action:
    | "javascript_error"
    | "api_error"
    | "validation_error"
    | "network_error"
    | "component_error";
  data: {
    errorMessage: string;
    errorCode?: string;
    stack?: string;
    endpoint?: string;
    statusCode?: number;
    retryCount?: number;
    componentName?: string;
    context?: Record<string, unknown>;
  };
}

// Performance events
export interface PerformanceEvent extends TrackingEventMetadata {
  category: "performance";
  action: "page_load" | "api_call" | "component_render" | "user_timing";
  data: {
    duration: number;
    endpoint?: string;
    componentName?: string;
    timingName?: string;
    memoryUsage?: number;
    networkType?: string;
  };
}

// Event configuration for automatic tracking
export interface TrackingConfiguration {
  categories: EventCategory[];
  batchSize: number;
  flushInterval: number;
  enablePerformanceTracking: boolean;
  enableErrorTracking: boolean;
  enableFormTracking: boolean;
  apiEndpoint: string;
  debugMode: boolean;
}

// Human-readable description templates
export interface EventDescriptionTemplate {
  template: string;
  variables: string[];
}

export const EVENT_DESCRIPTION_TEMPLATES: Record<
  string,
  EventDescriptionTemplate
> = {
  // Initiative templates
  "initiative:create": {
    template:
      'User created new initiative "{initiativeName}" in {organizationName}',
    variables: ["initiativeName", "organizationName"],
  },
  "initiative:update": {
    template:
      'User updated initiative "{initiativeName}" {field} from "{previousValue}" to "{newValue}"',
    variables: ["initiativeName", "field", "previousValue", "newValue"],
  },
  "initiative:refine": {
    template:
      'User refined initiative "{initiativeName}" by adding requirement: "{requirementText}"',
    variables: ["initiativeName", "requirementText"],
  },
  "initiative:link_project": {
    template:
      'User linked project "{projectName}" to initiative "{initiativeName}"',
    variables: ["projectName", "initiativeName"],
  },
  "initiative:start_conversation": {
    template: 'User started conversation about initiative "{initiativeName}"',
    variables: ["initiativeName"],
  },

  // Workflow templates
  "workflow:execute": {
    template:
      'User executed workflow "{workflowName}" starting from node "{nodeName}"',
    variables: ["workflowName", "nodeName"],
  },
  "workflow:simulate": {
    template:
      'User simulated workflow "{workflowName}" for {simulationStep} steps',
    variables: ["workflowName", "simulationStep"],
  },

  // Navigation templates
  "navigation:page_view": {
    template: "User navigated to {toPage} from {fromPage}",
    variables: ["toPage", "fromPage"],
  },
  "navigation:link_click": {
    template: 'User clicked link "{linkText}" to navigate to {linkHref}',
    variables: ["linkText", "linkHref"],
  },

  // Form templates
  "form:submit_success": {
    template:
      "User successfully submitted {formName} form with {completionRate}% completion rate",
    variables: ["formName", "completionRate"],
  },
  "form:validation_error": {
    template:
      "User encountered validation errors in {formName} form: {validationErrors}",
    variables: ["formName", "validationErrors"],
  },

  // UI interaction templates
  "ui_interaction:search": {
    template: 'User searched for "{searchQuery}" in {componentName}',
    variables: ["searchQuery", "componentName"],
  },
  "ui_interaction:filter": {
    template: "User applied filters in {componentName}: {filterCriteria}",
    variables: ["componentName", "filterCriteria"],
  },

  // CLI telemetry templates
  "cli_telemetry:agent_session_created": {
    template:
      "CLI created coding session {data.sessionId} with {data.status} status in {data.latencyMs}ms",
    variables: ["data.sessionId", "data.status", "data.latencyMs"],
  },
  "cli_telemetry:implementation_hint_written": {
    template:
      "CLI wrote implementation hint {data.hintId} for session {data.sessionId} with {data.status} status in {data.latencyMs}ms",
    variables: [
      "data.hintId",
      "data.sessionId",
      "data.status",
      "data.latencyMs",
    ],
  },
  "cli_telemetry:final_recommendation_stored": {
    template:
      "CLI stored final recommendation {data.recommendationId} for session {data.sessionId} with {data.status} status in {data.latencyMs}ms",
    variables: [
      "data.recommendationId",
      "data.sessionId",
      "data.status",
      "data.latencyMs",
    ],
  },
  "cli_telemetry:agent_invocation": {
    template:
      "CLI agent invocation {data.invocationId} for session {data.sessionId} completed with {data.status} status in {data.latencyMs}ms",
    variables: [
      "data.invocationId",
      "data.sessionId",
      "data.status",
      "data.latencyMs",
    ],
  },

  // Default template
  default: {
    template: "User performed {action} in {category}",
    variables: ["action", "category"],
  },
};

// Utility types for event processing
export type EventKey = `${EventCategory}:${string}`;
export type EventDescriptionGenerator = (event: UserTrackingEvent) => string;
export type EventValidator = (event: UserTrackingEvent) => boolean;
export type EventProcessor = (event: UserTrackingEvent) => Promise<void>;

// Batch processing types
export interface EventBatch {
  batchId: string;
  events: UserTrackingEvent[];
  timestamp: number;
  deviceInfo: {
    userAgent: string;
    platform: string;
    language: string;
    timezone: string;
  };
}

// Analytics aggregation types
export interface EventAnalytics {
  totalEvents: number;
  eventsByCategory: Record<EventCategory, number>;
  topActions: Array<{ action: string; count: number }>;
  activeUsers: number;
  sessionDuration: number;
  timeRange: {
    start: number;
    end: number;
  };
}

// Type guards for event discrimination
export function isInitiativeEvent(
  event: UserTrackingEvent
): event is InitiativeEvent {
  return event.category === "initiative";
}

export function isWorkflowEvent(
  event: UserTrackingEvent
): event is WorkflowEvent {
  return event.category === "workflow";
}

export function isNavigationEvent(
  event: UserTrackingEvent
): event is NavigationEvent {
  return event.category === "navigation";
}

export function isFormEvent(event: UserTrackingEvent): event is FormEvent {
  return event.category === "form";
}

export function isUIInteractionEvent(
  event: UserTrackingEvent
): event is UIInteractionEvent {
  return event.category === "ui_interaction";
}

export function isCliTelemetryEvent(
  event: UserTrackingEvent
): event is CliTelemetryEvent {
  return event.category === "cli_telemetry";
}

export function isAuthenticationEvent(
  event: UserTrackingEvent
): event is AuthenticationEvent {
  return event.category === "authentication";
}

export function isIntegrationEvent(
  event: UserTrackingEvent
): event is IntegrationEvent {
  return event.category === "integration";
}

export function isErrorEvent(event: UserTrackingEvent): event is ErrorEvent {
  return event.category === "error";
}

export function isPerformanceEvent(
  event: UserTrackingEvent
): event is PerformanceEvent {
  return event.category === "performance";
}

export const CLI_EVENT_TYPE_TO_ACTION: Record<
  CliTelemetryEventType,
  CliTelemetryAction
> = {
  "agent_session.created": "agent_session_created",
  "implementation_hint.written": "implementation_hint_written",
  "final_recommendation.stored": "final_recommendation_stored",
  "agent.invocation": "agent_invocation",
};

export function mapCliTelemetryInputToTrackingEvent(
  event: CliTelemetryEventInput
): CliTelemetryTrackingEventInput {
  switch (event.eventType) {
    case "agent_session.created":
      return {
        category: "cli_telemetry",
        action: "agent_session_created",
        data: event.data,
      };
    case "implementation_hint.written":
      return {
        category: "cli_telemetry",
        action: "implementation_hint_written",
        data: event.data,
      };
    case "final_recommendation.stored":
      return {
        category: "cli_telemetry",
        action: "final_recommendation_stored",
        data: event.data,
      };
    case "agent.invocation":
      return {
        category: "cli_telemetry",
        action: "agent_invocation",
        data: event.data,
      };
  }
}

export function getCliTelemetryEventType(
  event: CliTelemetryEvent
): CliTelemetryEventType {
  switch (event.action) {
    case "agent_session_created":
      return "agent_session.created";
    case "implementation_hint_written":
      return "implementation_hint.written";
    case "final_recommendation_stored":
      return "final_recommendation.stored";
    case "agent_invocation":
      return "agent.invocation";
  }
}

/**
 * Attention event - tracks user focus on entities (separate from main tracking event stream)
 * Used to understand what users spend time on, without granular interaction tracking
 * Emitted on navigation (with 3s debounce) and every 30s while visible
 */
export interface AttentionEvent {
  eventType: "attention";
  entity: {
    type: AttentionEntityType;
    id: string;
  };
  tab?: string; // optional sub-view identifier (e.g., "editor", "comments", "details")
  timestamp: number;
  kind?: "navigation" | "heartbeat";
}
