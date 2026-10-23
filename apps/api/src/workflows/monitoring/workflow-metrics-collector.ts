import { log } from '@temporalio/workflow';
import {
  WorkflowMetrics,
  StepMetrics,
  WorkflowError,
  WorkflowExecutionStatus,
  StepExecutionStatus,
  WorkflowTrace,
  TraceOperationType,
  TraceStatus,
} from './workflow-metrics.types';
import { WorkflowState } from '../conversation-workflow-state';

/**
 * Phase 3: Workflow Metrics Collection System
 *
 * Provides comprehensive metrics collection for workflow execution,
 * performance monitoring, and system observability.
 */

export class WorkflowMetricsCollector {
  private metrics: Map<string, WorkflowMetrics> = new Map();
  private stepMetrics: Map<string, StepMetrics[]> = new Map();
  private traces: Map<string, WorkflowTrace[]> = new Map();

  /**
   * Initializes metrics collection for a workflow
   */
  initializeWorkflowMetrics(state: WorkflowState): WorkflowMetrics {
    const metrics: WorkflowMetrics = {
      workflowId: state.workflowId,
      executionId: state.executionId,
      organizationId: state.organizationId,
      projectId: state.projectId,

      // Execution metrics
      startTime: new Date(),
      status: WorkflowExecutionStatus.INITIALIZING,

      // Step metrics
      totalSteps: 0,
      completedSteps: 0,
      failedSteps: 0,
      retryCount: 0,

      // Performance metrics
      averageStepDuration: 0,

      // Resource metrics
      memoryUsage: this.getMemoryUsage(),
      cpuUsage: 0,
      networkCalls: 0,

      // Signal metrics
      signalsProcessed: 0,
      signalsFailed: 0,
      averageSignalProcessingTime: 0,

      // Agent metrics
      agentExecutions: 0,
      agentFailures: 0,
      averageAgentExecutionTime: 0,

      // Error metrics
      errorCount: 0,
      criticalErrorCount: 0,

      // Business metrics
      userInteractions: 0,
      initiativesGenerated: 0,
      artifactsCreated: 0,
    };

    this.metrics.set(state.workflowId, metrics);
    this.stepMetrics.set(state.workflowId, []);
    this.traces.set(state.workflowId, []);

    log.trace('[MetricsCollector] Initialized metrics collection', {
      workflowId: state.workflowId,
      executionId: state.executionId,
    });

    return metrics;
  }

  /**
   * Updates workflow status
   */
  updateWorkflowStatus(
    workflowId: string,
    status: WorkflowExecutionStatus,
    endTime?: Date,
  ): void {
    const metrics = this.metrics.get(workflowId);
    if (!metrics) {
      log.warn('[MetricsCollector] Metrics not found for workflow', {
        workflowId,
      });
      return;
    }

    metrics.status = status;

    if (endTime) {
      metrics.endTime = endTime;
      metrics.duration = endTime.getTime() - metrics.startTime.getTime();
    }

    // Update resource metrics
    metrics.memoryUsage = this.getMemoryUsage();

    log.trace('[MetricsCollector] Updated workflow status', {
      workflowId,
      status,
      duration: metrics.duration,
    });
  }

  /**
   * Records step execution start
   */
  startStepExecution(
    workflowId: string,
    stepName: string,
    nodeId: string,
  ): void {
    const stepMetric: StepMetrics = {
      stepName,
      nodeId,
      startTime: new Date(),
      duration: 0,
      status: StepExecutionStatus.RUNNING,
      retryCount: 0,
    };

    const workflowSteps = this.stepMetrics.get(workflowId) || [];
    workflowSteps.push(stepMetric);
    this.stepMetrics.set(workflowId, workflowSteps);

    // Update workflow metrics
    const metrics = this.metrics.get(workflowId);
    if (metrics) {
      metrics.totalSteps++;
    }

    log.trace('[MetricsCollector] Started step execution', {
      workflowId,
      stepName,
      nodeId,
    });
  }

  /**
   * Records step execution completion
   */
  completeStepExecution(
    state: WorkflowState,
    status: StepExecutionStatus,
    endTime: Date = new Date(),
    errorMessage?: string,
  ): void {
    const workflowSteps = this.stepMetrics.get(state.workflowId) || [];
    const stepMetric = workflowSteps
      .slice()
      .reverse()
      .find(
        (step) => step.stepName === (state.step as string) && !step.endTime,
      );

    if (!stepMetric) {
      log.warn('[MetricsCollector] Step metric not found', {
        workflowId: state.workflowId,
        step: state.step,
      });
      return;
    }

    stepMetric.endTime = endTime;
    stepMetric.duration = endTime.getTime() - stepMetric.startTime.getTime();
    stepMetric.status = status;
    stepMetric.errorMessage = errorMessage;

    // Update workflow metrics
    const metrics = this.metrics.get(state.workflowId);
    if (metrics) {
      if (status === StepExecutionStatus.COMPLETED) {
        metrics.completedSteps++;
      } else if (status === StepExecutionStatus.FAILED) {
        metrics.failedSteps++;
      }

      // Update performance metrics
      this.updatePerformanceMetrics(metrics, workflowSteps);
    }

    log.trace('[MetricsCollector] Completed step execution', {
      workflowId: state.workflowId,
      currentNodeId: state.currentNodeId,
      stepName: state.step,
      status,
      duration: stepMetric.duration,
    });
  }

  /**
   * Records signal processing metrics
   */
  recordSignalProcessing(
    workflowId: string,
    signalType: string,
    processingTime: number,
    success: boolean,
  ): void {
    const metrics = this.metrics.get(workflowId);
    if (!metrics) {
      return;
    }

    metrics.signalsProcessed++;

    if (!success) {
      metrics.signalsFailed++;
    }

    // Update average processing time
    const totalProcessingTime =
      metrics.averageSignalProcessingTime * (metrics.signalsProcessed - 1);
    metrics.averageSignalProcessingTime =
      (totalProcessingTime + processingTime) / metrics.signalsProcessed;

    log.trace('[MetricsCollector] Recorded signal processing', {
      workflowId,
      signalType,
      processingTime,
      success,
      totalSignalsProcessed: metrics.signalsProcessed,
    });
  }

  /**
   * Records agent execution metrics
   */
  recordAgentExecution(
    workflowId: string,
    agentId: string,
    executionTime: number,
    success: boolean,
    tokensUsed?: number,
    cost?: number,
  ): void {
    const metrics = this.metrics.get(workflowId);
    if (!metrics) {
      return;
    }

    metrics.agentExecutions++;

    if (!success) {
      metrics.agentFailures++;
    }

    // Update average execution time
    const totalExecutionTime =
      metrics.averageAgentExecutionTime * (metrics.agentExecutions - 1);
    metrics.averageAgentExecutionTime =
      (totalExecutionTime + executionTime) / metrics.agentExecutions;

    // Update step metrics if available
    const workflowSteps = this.stepMetrics.get(workflowId) || [];
    const currentStep = workflowSteps[workflowSteps.length - 1];
    if (currentStep && currentStep.status === StepExecutionStatus.RUNNING) {
      currentStep.agentExecutions = (currentStep.agentExecutions || 0) + 1;
      currentStep.agentSuccess = success;

      if (tokensUsed) {
        currentStep.llmTokensUsed =
          (currentStep.llmTokensUsed || 0) + tokensUsed;
      }

      if (cost) {
        currentStep.llmCost = (currentStep.llmCost || 0) + cost;
      }
    }

    log.trace('[MetricsCollector] Recorded agent execution', {
      workflowId,
      agentId,
      executionTime,
      success,
      tokensUsed,
      cost,
    });
  }

  /**
   * Records workflow error
   */
  recordError(
    workflowId: string,
    error: Error,
    context: Record<string, unknown>,
    recoverable: boolean = true,
    retryAttempt: number = 0,
  ): void {
    const metrics = this.metrics.get(workflowId);
    if (!metrics) {
      return;
    }

    const workflowError: WorkflowError = {
      timestamp: new Date(),
      errorType: error.constructor.name,
      errorMessage: error.message,
      stackTrace: error.stack,
      context,
      recoverable,
      retryAttempt,
    };

    metrics.errorCount++;
    metrics.lastError = workflowError;

    // Check for critical errors
    if (
      !recoverable ||
      error.message.includes('critical') ||
      error.message.includes('system')
    ) {
      metrics.criticalErrorCount++;
    }

    log.error('[MetricsCollector] Recorded workflow error', {
      workflowId,
      errorType: workflowError.errorType,
      errorMessage: workflowError.errorMessage,
      recoverable,
      retryAttempt,
    });
  }

  /**
   * Records business metrics
   */
  recordBusinessMetric(
    workflowId: string,
    metricType:
      | 'user_interaction'
      | 'initiative_generated'
      | 'artifact_created'
      | 'user_response_processed'
      | 'agent_results_processed'
      | 'workflow_completed',
    count: number = 1,
  ): void {
    const metrics = this.metrics.get(workflowId);
    if (!metrics) {
      return;
    }

    switch (metricType) {
      case 'user_interaction':
        metrics.userInteractions += count;
        break;
      case 'initiative_generated':
        metrics.initiativesGenerated += count;
        break;
      case 'artifact_created':
        metrics.artifactsCreated += count;
        break;
      case 'user_response_processed':
        // Track as user interactions for now
        metrics.userInteractions += count;
        break;
      case 'agent_results_processed':
        // Create new metric or track as general business event
        if (!metrics.businessMetrics) {
          metrics.businessMetrics = {};
        }
        metrics.businessMetrics['agent_results_processed'] =
          (metrics.businessMetrics['agent_results_processed'] || 0) + count;
        break;
      case 'workflow_completed':
        // Track completion in business metrics
        if (!metrics.businessMetrics) {
          metrics.businessMetrics = {};
        }
        metrics.businessMetrics['workflow_completed'] =
          (metrics.businessMetrics['workflow_completed'] || 0) + count;
        break;
    }

    log.trace('[MetricsCollector] Recorded business metric', {
      workflowId,
      metricType,
      count,
    });
  }

  /**
   * Creates a trace for workflow operation
   */
  createTrace(
    workflowId: string,
    operationName: string,
    operationType: TraceOperationType,
    parentSpanId?: string,
  ): string {
    const traceId = this.generateTraceId();
    const spanId = this.generateSpanId();

    const trace: WorkflowTrace = {
      workflowId,
      executionId: this.metrics.get(workflowId)?.executionId || '',
      timestamp: new Date(),
      traceId,
      spanId,
      parentSpanId,
      operationName,
      operationType,
      startTime: new Date(),
      context: {},
      tags: {},
      status: TraceStatus.SUCCESS,
      childSpans: [],
    };

    const workflowTraces = this.traces.get(workflowId) || [];
    workflowTraces.push(trace);
    this.traces.set(workflowId, workflowTraces);

    // Add child span to parent if exists
    if (parentSpanId) {
      const parentTrace = workflowTraces.find((t) => t.spanId === parentSpanId);
      if (parentTrace) {
        parentTrace.childSpans.push(spanId);
      }
    }

    log.trace('[MetricsCollector] Created trace', {
      workflowId,
      operationName,
      operationType,
      traceId,
      spanId,
      parentSpanId,
    });

    return spanId;
  }

  /**
   * Completes a trace
   */
  completeTrace(
    workflowId: string,
    spanId: string,
    status: TraceStatus = TraceStatus.SUCCESS,
    error?: string,
  ): void {
    const workflowTraces = this.traces.get(workflowId) || [];
    const trace = workflowTraces.find((t) => t.spanId === spanId);

    if (!trace) {
      log.warn('[MetricsCollector] Trace not found', {
        workflowId,
        spanId,
      });
      return;
    }

    trace.endTime = new Date();
    trace.duration = trace.endTime.getTime() - trace.startTime.getTime();
    trace.status = status;
    trace.error = error;

    log.trace('[MetricsCollector] Completed trace', {
      workflowId,
      spanId,
      status,
      duration: trace.duration,
    });
  }

  /**
   * Gets metrics for a workflow
   */
  getWorkflowMetrics(workflowId: string): WorkflowMetrics | undefined {
    return this.metrics.get(workflowId);
  }

  /**
   * Gets step metrics for a workflow
   */
  getStepMetrics(workflowId: string): StepMetrics[] {
    return this.stepMetrics.get(workflowId) || [];
  }

  /**
   * Gets traces for a workflow
   */
  getWorkflowTraces(workflowId: string): WorkflowTrace[] {
    return this.traces.get(workflowId) || [];
  }

  /**
   * Exports all metrics for persistence
   */
  exportMetrics(workflowId: string):
    | {
        metrics: WorkflowMetrics;
        stepMetrics: StepMetrics[];
        traces: WorkflowTrace[];
      }
    | undefined {
    const metrics = this.metrics.get(workflowId);
    if (!metrics) {
      return undefined;
    }

    return {
      metrics,
      stepMetrics: this.stepMetrics.get(workflowId) || [],
      traces: this.traces.get(workflowId) || [],
    };
  }

  /**
   * Cleans up metrics for completed workflows
   */
  cleanup(workflowId: string): void {
    this.metrics.delete(workflowId);
    this.stepMetrics.delete(workflowId);
    this.traces.delete(workflowId);

    log.trace('[MetricsCollector] Cleaned up metrics', {
      workflowId,
    });
  }

  /**
   * Updates performance metrics based on step metrics
   */
  private updatePerformanceMetrics(
    metrics: WorkflowMetrics,
    stepMetrics: StepMetrics[],
  ): void {
    const completedSteps = stepMetrics.filter((step) => step.endTime);

    if (completedSteps.length === 0) {
      return;
    }

    // Calculate average step duration
    const totalDuration = completedSteps.reduce(
      (sum, step) => sum + step.duration,
      0,
    );
    metrics.averageStepDuration = totalDuration / completedSteps.length;

    // Find slowest and fastest steps
    const sortedSteps = completedSteps.sort((a, b) => a.duration - b.duration);
    metrics.fastestStep = sortedSteps[0];
    metrics.slowestStep = sortedSteps[sortedSteps.length - 1];
  }

  /**
   * Gets current memory usage
   */
  private getMemoryUsage(): number {
    if (typeof process !== 'undefined' && process.memoryUsage) {
      return process.memoryUsage().heapUsed;
    }
    return 0;
  }

  /**
   * Generates a unique trace ID
   */
  private generateTraceId(): string {
    return `trace_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Generates a unique span ID
   */
  private generateSpanId(): string {
    return `span_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
