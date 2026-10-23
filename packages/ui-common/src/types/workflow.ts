/**
 * Workflow Management TypeScript Interfaces
 *
 * Based on the API responses from the workflow management backend
 */

// Branded types for type safety
export type WorkflowTemplateId = string & {
  readonly __brand: "WorkflowTemplateId";
};
export type WorkflowNodeId = string & { readonly __brand: "WorkflowNodeId" };
type WorkflowEdgeId = string & { readonly __brand: "WorkflowEdgeId" };

// Core workflow types
type WorkflowNodeType =
  "gather" | "analyze" | "generate" | "confirm" | "action";
export type WorkflowTemplateStatus = "active" | "inactive" | "draft";

// Position and styling interfaces
interface WorkflowPosition {
  x: number;
  y: number;
}

interface WorkflowNodeStyling {
  backgroundColor: string;
  borderColor: string;
  textColor: string;
  shape: string;
  width: number;
  height: number;
}

interface WorkflowEdgeStyling {
  strokeColor: string;
  strokeWidth: number;
  strokeStyle: string;
  arrowType: string;
}

// Node metadata interface
interface WorkflowNodeMetadata {
  hasPromptConfig: boolean;
  transitionCount: number;
  isStartNode: boolean;
}

// Workflow node interface
interface WorkflowNode {
  id: WorkflowNodeId;
  type: WorkflowNodeType;
  title: string;
  description?: string;
  position: WorkflowPosition;
  styling: WorkflowNodeStyling;
  conditions: string[];
  metadata: WorkflowNodeMetadata;
}

// Workflow edge interface
interface WorkflowEdge {
  id: WorkflowEdgeId;
  sourceNodeId: WorkflowNodeId;
  targetNodeId: WorkflowNodeId;
  condition?: string;
  label?: string;
  styling: WorkflowEdgeStyling;
  isDefaultPath: boolean;
}

// Template summary interface (for list view)
export interface WorkflowTemplateSummary {
  id: WorkflowTemplateId;
  name: string;
  description: string;
  version: number;
  status: WorkflowTemplateStatus;
  nodeCount: number;
  executionCount: number;
  lastExecuted: string | null;
  createdAt: string;
  updatedAt: string;
}

// Full template interface (for detail view)
export interface WorkflowTemplate extends WorkflowTemplateSummary {
  startNode: WorkflowNodeId;
  nodes: Record<string, WorkflowNodeDetail>;
  contextTransforms: Record<string, unknown>;
}

// Node detail interface (contains prompt config)
interface WorkflowNodeDetail {
  id: WorkflowNodeId;
  type: WorkflowNodeType;
  title: string;
  promptConfig?: WorkflowPromptConfig;
  transitions: Record<string, string>;
}

// Prompt configuration interface
interface WorkflowPromptConfig {
  systemPromptTemplate: string;
  includeHistory: boolean;
  contextFields: string[];
  temperature: number;
  responseSchema: Record<string, unknown>;
}

// Enhanced node detail interface (from node detail API)
export interface WorkflowNodeDetailResponse {
  id: WorkflowNodeId;
  title: string;
  type: WorkflowNodeType;
  promptConfig?: {
    systemPromptTemplate: string;
    contextFields: string[];
    temperature: number;
    responseSchema: Record<string, unknown>;
    includeHistory: boolean;
  };
  uiElements: unknown[];
  transitions: Record<string, string>;
  examplePayload: {
    context: Record<string, unknown>;
    userInput: Record<string, unknown>;
    expectedOutput: Record<string, unknown>;
  };
}

// Node testing interfaces
export interface WorkflowNodeTestRequest {
  context?: Record<string, unknown>;
  userInput?: Record<string, unknown>;
}

export interface WorkflowNodeTestResponse {
  generatedPrompt: string;
  mockResponse: Record<string, unknown>;
  nextPossibleNodes: Array<{
    condition: string;
    targetNode: WorkflowNodeId;
    likelihood: "high" | "medium" | "low";
  }>;
  contextAfterExecution: Record<string, unknown>;
}

// Template structure interface (for visualization) - Enhanced
export interface WorkflowTemplateStructure {
  templateId: WorkflowTemplateId;
  templateName: string;
  startNode: WorkflowNodeId;
  endNodes: WorkflowNodeId[]; // NEW: Array of terminal node IDs
  levels: {
    // NEW: Hierarchical layout data
    [level: string]: {
      nodes: WorkflowNodeId[];
    };
  };
  nodes: WorkflowNode[];
  edges: WorkflowEdge[]; // Regular edges (excludes self-loops)
  selfLoops: Array<{
    // NEW: Self-referencing transitions
    nodeId: WorkflowNodeId;
    condition: string;
    label?: string;
  }>;
  layout: {
    // NEW: Layout configuration
    algorithm: "hierarchical";
    direction: "top-to-bottom";
    spacing: {
      nodeSpacing: number;
      levelSpacing: number;
    };
    bounds: {
      width: number;
      height: number;
    };
  };
}

// API response interfaces
export interface WorkflowApiResponse<T> {
  success: boolean;
  message: string;
  data: T;
  timestamp: string;
  statusCode: number;
  path?: string;
}

export interface WorkflowTemplatesListResponse {
  success: boolean;
  message: string;
  timestamp: string;
  statusCode: number;
  data: {
    templates: WorkflowTemplateSummary[];
    totalCount: number;
    hasMore: boolean;
  };
}

export interface WorkflowTemplateDetailResponse {
  success: boolean;
  message: string;
  timestamp: string;
  statusCode: number;
  data: WorkflowTemplate;
}

export interface WorkflowTemplateStructureResponse {
  success: boolean;
  message: string;
  timestamp: string;
  statusCode: number;
  data: WorkflowTemplateStructure;
}

// Metrics and analytics interfaces
export interface WorkflowMetrics {
  executionCount: number;
  successRate: number;
  avgExecutionTime: number;
  minExecutionTime: number;
  maxExecutionTime: number;
  recentExecutions: WorkflowExecution[];
}

export interface WorkflowExecution {
  id: string;
  templateId: WorkflowTemplateId;
  status: "running" | "completed" | "failed" | "cancelled";
  startTime: string;
  endTime?: string;
  currentNodeId?: WorkflowNodeId;
  executionPath: WorkflowNodeId[];
  context: Record<string, unknown>;
}

export interface WorkflowAnalytics {
  totalTemplates: number;
  totalExecutions: number;
  avgSuccessRate: number;
  popularTemplates: WorkflowTemplateSummary[];
  recentActivity: WorkflowExecution[];
  trendsOverTime: WorkflowTrendData[];
}

interface WorkflowTrendData {
  period: string;
  executions: number;
  successRate: number;
  avgDuration: number;
}

// Simulation interfaces
export interface WorkflowSimulationRequest {
  templateId: WorkflowTemplateId;
  initialContext: Record<string, unknown>;
  startFromNode?: WorkflowNodeId;
}

interface WorkflowSimulationStep {
  nodeId: WorkflowNodeId;
  nodeTitle: string;
  nodeType: WorkflowNodeType;
  generatedPrompt: string;
  llmResponse?: string;
  nextNodeId?: WorkflowNodeId;
  context: Record<string, unknown>;
  executionTime: number;
}

export interface WorkflowSimulationResult {
  steps: WorkflowSimulationStep[];
  finalContext: Record<string, unknown>;
  totalExecutionTime: number;
  successful: boolean;
  error?: string;
}

// Validation interfaces
export interface WorkflowValidationResult {
  isValid: boolean;
  errors: WorkflowValidationError[];
  warnings: WorkflowValidationWarning[];
}

interface WorkflowValidationError {
  type: "structure" | "transition" | "reachability" | "configuration";
  nodeId?: WorkflowNodeId;
  message: string;
  severity: "error" | "warning";
}

interface WorkflowValidationWarning {
  type: "performance" | "usability" | "best-practice";
  nodeId?: WorkflowNodeId;
  message: string;
  suggestion?: string;
}

// Filter and query interfaces
interface WorkflowTemplateFilters {
  status?: WorkflowTemplateStatus[];
  nodeType?: WorkflowNodeType[];
  searchTerm?: string;
  hasExecutions?: boolean;
  minNodeCount?: number;
  maxNodeCount?: number;
  createdAfter?: string;
  createdBefore?: string;
}

export interface WorkflowTemplateQuery {
  filters?: WorkflowTemplateFilters;
  sortBy?: "name" | "createdAt" | "updatedAt" | "executionCount";
  sortOrder?: "asc" | "desc";
  page?: number;
  limit?: number;
}

// Admin UI Types - Monitoring, Context Management, Agent Coordination

// Branded types for admin functionality
type ContextVersionId = string & {
  readonly __brand: "ContextVersionId";
};
type SharedContextId = string & { readonly __brand: "SharedContextId" };
type AgentId = string & { readonly __brand: "AgentId" };
type CoordinationEventId = string & {
  readonly __brand: "CoordinationEventId";
};
type WorkflowAlertId = string & { readonly __brand: "WorkflowAlertId" };

// Monitoring Types
type WorkflowStatus =
  "running" | "completed" | "failed" | "paused" | "cancelled";
export type SystemHealthStatus = "healthy" | "degraded" | "unhealthy";
export type AlertSeverity = "info" | "warning" | "error" | "critical";

export interface WorkflowMetrics {
  workflowId: string;
  status: WorkflowStatus;
  duration?: number;
  averageStepDuration: number;
  agentExecutions: number;
  agentFailures: number;
  startTime: string;
  endTime?: string;
  currentStep?: string;
}

export interface WorkflowHealthMetrics {
  systemStatus: SystemHealthStatus;
  memoryUtilization: number;
  cpuUtilization: number;
  activeWorkflows: number;
  queuedWorkflows: number;
  timestamp: string;
}

export interface WorkflowAlert {
  id: WorkflowAlertId;
  workflowId?: string;
  severity: AlertSeverity;
  title: string;
  description: string;
  timestamp: string;
  acknowledged: boolean;
  resolvedAt?: string;
}

// Context Management Types
export interface ContextVersion {
  id: ContextVersionId;
  workflowId: string;
  version: number;
  timestamp: string;
  context: Record<string, unknown>;
  metadata: {
    reason: string;
    createdBy: string;
    tags: string[];
  };
}

export interface SharedContext {
  id: SharedContextId;
  name: string;
  workflowIds: string[];
  context: Record<string, unknown>;
  lastUpdated: string;
  createdBy: string;
}

export interface ContextRollbackRequest {
  targetVersionId: ContextVersionId;
  reason: string;
  rollbackBy: string;
  preserveCurrentAsSnapshot: boolean;
}

// Agent Coordination Types
export type AgentStatus = "idle" | "busy" | "error" | "offline";
type TaskStatus =
  "PENDING" | "IN_PROGRESS" | "COMPLETED" | "BLOCKED" | "CANCELLED";

export interface AgentInfo {
  id: AgentId;
  status: AgentStatus;
  currentTask?: string;
  lastActivity: string;
  capabilities: string[];
  workload: number;
}

export interface CoordinationTask {
  id: string;
  type: string;
  status: TaskStatus;
  assignedAgent?: AgentId;
  priority: number;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

export interface AgentCoordinator {
  activeAgents: Map<AgentId, AgentInfo>;
  taskQueue: CoordinationTask[];
  metrics: {
    totalTasksProcessed: number;
    successRate: number;
    averageTaskDuration: number;
    activeTasksCount: number;
  };
}

export interface CoordinationEvent {
  id: CoordinationEventId;
  type:
    | "agent_registered"
    | "agent_disconnected"
    | "task_assigned"
    | "task_completed"
    | "task_failed";
  agentId?: AgentId;
  taskId?: string;
  timestamp: string;
  data: Record<string, unknown>;
}

// API Response Types for Admin Functionality
export interface WorkflowMonitoringResponse {
  success: boolean;
  data: {
    metrics: WorkflowMetrics;
    health: WorkflowHealthMetrics;
    alerts: WorkflowAlert[];
  };
  timestamp: string;
}

export interface ContextVersionResponse {
  success: boolean;
  data: {
    versions: ContextVersion[];
    sharedContexts: SharedContext[];
  };
  timestamp: string;
}

export interface AgentCoordinationResponse {
  success: boolean;
  data: {
    coordinator: AgentCoordinator;
    events: CoordinationEvent[];
  };
  timestamp: string;
}
