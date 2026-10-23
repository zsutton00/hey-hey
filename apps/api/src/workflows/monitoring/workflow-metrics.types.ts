/**
 * Phase 3: Workflow Monitoring and Observability Types
 *
 * Provides comprehensive types for workflow metrics collection,
 * performance monitoring, and system observability.
 */

export interface WorkflowMetrics {
  workflowId: string;
  executionId: string;
  organizationId: string;
  projectId: string;

  // Execution metrics
  startTime: Date;
  endTime?: Date;
  duration?: number; // in milliseconds
  status: WorkflowExecutionStatus;

  // Step metrics
  totalSteps: number;
  completedSteps: number;
  failedSteps: number;
  retryCount: number;

  // Performance metrics
  averageStepDuration: number;
  slowestStep?: StepMetrics;
  fastestStep?: StepMetrics;

  // Resource metrics
  memoryUsage: number; // in bytes
  cpuUsage: number; // percentage
  networkCalls: number;

  // Signal metrics
  signalsProcessed: number;
  signalsFailed: number;
  averageSignalProcessingTime: number;

  // Agent metrics
  agentExecutions: number;
  agentFailures: number;
  averageAgentExecutionTime: number;

  // Error metrics
  errorCount: number;
  criticalErrorCount: number;
  lastError?: WorkflowError;

  // Business metrics
  userInteractions: number;
  initiativesGenerated: number;
  artifactsCreated: number;

  // Additional business metrics for custom tracking
  businessMetrics?: Record<string, number>;
}

export interface StepMetrics {
  stepName: string;
  nodeId: string;
  startTime: Date;
  endTime?: Date;
  duration: number;
  status: StepExecutionStatus;
  retryCount: number;
  errorMessage?: string;

  // Step-specific metrics
  llmCalls?: number;
  llmTokensUsed?: number;
  llmCost?: number;

  signalsReceived?: number;
  signalsProcessed?: number;

  agentExecutions?: number;
  agentSuccess?: boolean;
}

export interface WorkflowError {
  timestamp: Date;
  errorType: string;
  errorMessage: string;
  stackTrace?: string;
  context: Record<string, unknown>;
  recoverable: boolean;
  retryAttempt: number;
}

export enum WorkflowExecutionStatus {
  INITIALIZING = 'INITIALIZING',
  RUNNING = 'RUNNING',
  WAITING_FOR_INPUT = 'WAITING_FOR_INPUT',
  PROCESSING_SIGNALS = 'PROCESSING_SIGNALS',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
  TIMED_OUT = 'TIMED_OUT',
}

export enum StepExecutionStatus {
  PENDING = 'PENDING',
  RUNNING = 'RUNNING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  SKIPPED = 'SKIPPED',
  RETRYING = 'RETRYING',
}

export interface WorkflowHealthMetrics {
  timestamp: Date;

  // System health
  systemStatus: SystemHealthStatus;
  activeWorkflows: number;
  queuedWorkflows: number;
  failedWorkflows: number;

  // Performance health
  averageExecutionTime: number;
  p95ExecutionTime: number;
  p99ExecutionTime: number;

  // Resource health
  memoryUtilization: number;
  cpuUtilization: number;
  diskUtilization: number;

  // Signal processing health
  signalQueueLength: number;
  signalProcessingRate: number;
  signalFailureRate: number;

  // Agent health
  activeAgents: number;
  agentSuccessRate: number;
  averageAgentResponseTime: number;

  // Error rates
  errorRate: number;
  criticalErrorRate: number;
  timeoutRate: number;
}

export enum SystemHealthStatus {
  HEALTHY = 'HEALTHY',
  DEGRADED = 'DEGRADED',
  UNHEALTHY = 'UNHEALTHY',
  CRITICAL = 'CRITICAL',
}

export interface WorkflowAlert {
  id: string;
  timestamp: Date;
  severity: AlertSeverity;
  type: AlertType;
  workflowId?: string;

  title: string;
  description: string;

  // Alert context
  context: Record<string, unknown>;

  // Alert status
  status: AlertStatus;
  acknowledgedBy?: string;
  acknowledgedAt?: Date;
  resolvedAt?: Date;

  // Alert rules
  threshold?: number;
  actualValue?: number;

  // Actions taken
  actionsTaken: string[];

  // Related alerts
  relatedAlerts: string[];
}

export enum AlertSeverity {
  INFO = 'INFO',
  WARNING = 'WARNING',
  ERROR = 'ERROR',
  CRITICAL = 'CRITICAL',
}

export enum AlertType {
  EXECUTION_TIME_EXCEEDED = 'EXECUTION_TIME_EXCEEDED',
  ERROR_RATE_HIGH = 'ERROR_RATE_HIGH',
  MEMORY_USAGE_HIGH = 'MEMORY_USAGE_HIGH',
  SIGNAL_QUEUE_FULL = 'SIGNAL_QUEUE_FULL',
  AGENT_FAILURE_RATE_HIGH = 'AGENT_FAILURE_RATE_HIGH',
  WORKFLOW_TIMEOUT = 'WORKFLOW_TIMEOUT',
  SYSTEM_DEGRADED = 'SYSTEM_DEGRADED',
}

export enum AlertStatus {
  ACTIVE = 'ACTIVE',
  ACKNOWLEDGED = 'ACKNOWLEDGED',
  RESOLVED = 'RESOLVED',
  SUPPRESSED = 'SUPPRESSED',
}

export interface WorkflowTrace {
  workflowId: string;
  executionId: string;
  timestamp: Date;

  // Trace hierarchy
  traceId: string;
  spanId: string;
  parentSpanId?: string;

  // Trace details
  operationName: string;
  operationType: TraceOperationType;

  startTime: Date;
  endTime?: Date;
  duration?: number;

  // Trace context
  context: Record<string, unknown>;
  tags: Record<string, string>;

  // Trace status
  status: TraceStatus;
  error?: string;

  // Related traces
  childSpans: string[];
}

export enum TraceOperationType {
  WORKFLOW_EXECUTION = 'WORKFLOW_EXECUTION',
  STEP_EXECUTION = 'STEP_EXECUTION',
  SIGNAL_PROCESSING = 'SIGNAL_PROCESSING',
  AGENT_EXECUTION = 'AGENT_EXECUTION',
  LLM_CALL = 'LLM_CALL',
  DATABASE_OPERATION = 'DATABASE_OPERATION',
  EXTERNAL_API_CALL = 'EXTERNAL_API_CALL',
}

export enum TraceStatus {
  SUCCESS = 'SUCCESS',
  ERROR = 'ERROR',
  TIMEOUT = 'TIMEOUT',
  CANCELLED = 'CANCELLED',
}

export interface MetricsQuery {
  // Time range
  startTime: Date;
  endTime: Date;

  // Filters
  workflowIds?: string[];
  organizationIds?: string[];
  projectIds?: string[];
  statuses?: WorkflowExecutionStatus[];

  // Grouping
  groupBy?: MetricsGroupBy[];

  // Aggregation
  aggregations?: MetricsAggregation[];

  // Pagination
  limit?: number;
  offset?: number;
}

export enum MetricsGroupBy {
  WORKFLOW_ID = 'WORKFLOW_ID',
  ORGANIZATION_ID = 'ORGANIZATION_ID',
  PROJECT_ID = 'PROJECT_ID',
  STATUS = 'STATUS',
  HOUR = 'HOUR',
  DAY = 'DAY',
  WEEK = 'WEEK',
}

export enum MetricsAggregation {
  COUNT = 'COUNT',
  AVERAGE = 'AVERAGE',
  SUM = 'SUM',
  MIN = 'MIN',
  MAX = 'MAX',
  P50 = 'P50',
  P95 = 'P95',
  P99 = 'P99',
}

export interface MetricsQueryResult {
  query: MetricsQuery;
  results: MetricsDataPoint[];
  totalCount: number;
  executionTime: number;
}

export interface MetricsDataPoint {
  timestamp: Date;
  dimensions: Record<string, string>;
  metrics: Record<string, number>;
}
