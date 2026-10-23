import { log } from '@temporalio/workflow';
import {
  WorkflowHealthMetrics,
  SystemHealthStatus,
  WorkflowAlert,
  AlertSeverity,
  AlertType,
  AlertStatus,
} from './workflow-metrics.types';
import { WorkflowMetricsCollector } from './workflow-metrics-collector';

/**
 * Phase 3: Workflow Health Monitoring System
 *
 * Provides comprehensive health monitoring for workflow system,
 * including performance monitoring, resource tracking, and alerting.
 */

export interface HealthCheckConfig {
  // Thresholds
  maxExecutionTime: number; // milliseconds
  maxErrorRate: number; // percentage
  maxMemoryUtilization: number; // percentage
  maxSignalQueueLength: number;
  minAgentSuccessRate: number; // percentage

  // Check intervals
  healthCheckInterval: number; // milliseconds
  metricsAggregationWindow: number; // milliseconds

  // Alert configuration
  alertCooldownPeriod: number; // milliseconds
  maxActiveAlerts: number;
}

export class WorkflowHealthChecker {
  private config: HealthCheckConfig;
  private metricsCollector: WorkflowMetricsCollector;
  private healthHistory: WorkflowHealthMetrics[] = [];
  private activeAlerts: Map<string, WorkflowAlert> = new Map();
  private lastHealthCheck: Date = new Date();

  constructor(
    metricsCollector: WorkflowMetricsCollector,
    config?: Partial<HealthCheckConfig>,
  ) {
    this.metricsCollector = metricsCollector;
    this.config = {
      // Default configuration
      maxExecutionTime: 300000, // 5 minutes
      maxErrorRate: 5, // 5%
      maxMemoryUtilization: 80, // 80%
      maxSignalQueueLength: 100,
      minAgentSuccessRate: 90, // 90%
      healthCheckInterval: 30000, // 30 seconds
      metricsAggregationWindow: 300000, // 5 minutes
      alertCooldownPeriod: 60000, // 1 minute
      maxActiveAlerts: 50,
      ...config,
    };
  }

  /**
   * Performs comprehensive health check
   */
  async performHealthCheck(): Promise<WorkflowHealthMetrics> {
    const now = new Date();

    log.debug('[HealthChecker] Performing health check', {
      timestamp: now.toISOString(),
    });

    // Collect current metrics
    const healthMetrics = await this.collectHealthMetrics(now);

    // Evaluate health status
    healthMetrics.systemStatus = this.evaluateSystemHealth(healthMetrics);

    // Store health metrics
    this.healthHistory.push(healthMetrics);
    this.trimHealthHistory();

    // Check for alerts
    await this.checkAlertConditions(healthMetrics);

    this.lastHealthCheck = now;

    log.debug('[HealthChecker] Health check completed', {
      systemStatus: healthMetrics.systemStatus,
      activeWorkflows: healthMetrics.activeWorkflows,
      errorRate: healthMetrics.errorRate,
      memoryUtilization: healthMetrics.memoryUtilization,
    });

    return healthMetrics;
  }

  /**
   * Collects current health metrics
   */
  private async collectHealthMetrics(
    timestamp: Date,
  ): Promise<WorkflowHealthMetrics> {
    // In a real implementation, these would come from actual system metrics
    // For now, we'll simulate or use available data

    const healthMetrics: WorkflowHealthMetrics = {
      timestamp,

      // System health
      systemStatus: SystemHealthStatus.HEALTHY, // Will be evaluated
      activeWorkflows: this.getActiveWorkflowCount(),
      queuedWorkflows: this.getQueuedWorkflowCount(),
      failedWorkflows: this.getFailedWorkflowCount(),

      // Performance health
      averageExecutionTime: this.getAverageExecutionTime(),
      p95ExecutionTime: this.getPercentileExecutionTime(95),
      p99ExecutionTime: this.getPercentileExecutionTime(99),

      // Resource health
      memoryUtilization: this.getMemoryUtilization(),
      cpuUtilization: this.getCpuUtilization(),
      diskUtilization: this.getDiskUtilization(),

      // Signal processing health
      signalQueueLength: this.getSignalQueueLength(),
      signalProcessingRate: this.getSignalProcessingRate(),
      signalFailureRate: this.getSignalFailureRate(),

      // Agent health
      activeAgents: this.getActiveAgentCount(),
      agentSuccessRate: this.getAgentSuccessRate(),
      averageAgentResponseTime: this.getAverageAgentResponseTime(),

      // Error rates
      errorRate: this.getErrorRate(),
      criticalErrorRate: this.getCriticalErrorRate(),
      timeoutRate: this.getTimeoutRate(),
    };

    return healthMetrics;
  }

  /**
   * Evaluates overall system health status
   */
  private evaluateSystemHealth(
    metrics: WorkflowHealthMetrics,
  ): SystemHealthStatus {
    const criticalConditions = [
      metrics.errorRate > this.config.maxErrorRate * 2,
      metrics.memoryUtilization > 95,
      metrics.signalQueueLength > this.config.maxSignalQueueLength * 2,
      metrics.agentSuccessRate < 50,
    ];

    if (criticalConditions.some((condition) => condition)) {
      return SystemHealthStatus.CRITICAL;
    }

    const unhealthyConditions = [
      metrics.errorRate > this.config.maxErrorRate,
      metrics.memoryUtilization > this.config.maxMemoryUtilization,
      metrics.signalQueueLength > this.config.maxSignalQueueLength,
      metrics.agentSuccessRate < this.config.minAgentSuccessRate,
      metrics.averageExecutionTime > this.config.maxExecutionTime,
    ];

    if (unhealthyConditions.filter((condition) => condition).length >= 2) {
      return SystemHealthStatus.UNHEALTHY;
    }

    if (unhealthyConditions.some((condition) => condition)) {
      return SystemHealthStatus.DEGRADED;
    }

    return SystemHealthStatus.HEALTHY;
  }

  /**
   * Checks for alert conditions and creates alerts
   */
  private async checkAlertConditions(
    metrics: WorkflowHealthMetrics,
  ): Promise<void> {
    const alertChecks = [
      {
        condition: metrics.averageExecutionTime > this.config.maxExecutionTime,
        type: AlertType.EXECUTION_TIME_EXCEEDED,
        severity: AlertSeverity.WARNING,
        title: 'Execution Time Exceeded',
        description: `Average execution time (${metrics.averageExecutionTime}ms) exceeds threshold (${this.config.maxExecutionTime}ms)`,
        threshold: this.config.maxExecutionTime,
        actualValue: metrics.averageExecutionTime,
      },
      {
        condition: metrics.errorRate > this.config.maxErrorRate,
        type: AlertType.ERROR_RATE_HIGH,
        severity:
          metrics.errorRate > this.config.maxErrorRate * 2
            ? AlertSeverity.CRITICAL
            : AlertSeverity.ERROR,
        title: 'High Error Rate',
        description: `Error rate (${metrics.errorRate}%) exceeds threshold (${this.config.maxErrorRate}%)`,
        threshold: this.config.maxErrorRate,
        actualValue: metrics.errorRate,
      },
      {
        condition: metrics.memoryUtilization > this.config.maxMemoryUtilization,
        type: AlertType.MEMORY_USAGE_HIGH,
        severity:
          metrics.memoryUtilization > 95
            ? AlertSeverity.CRITICAL
            : AlertSeverity.WARNING,
        title: 'High Memory Usage',
        description: `Memory utilization (${metrics.memoryUtilization}%) exceeds threshold (${this.config.maxMemoryUtilization}%)`,
        threshold: this.config.maxMemoryUtilization,
        actualValue: metrics.memoryUtilization,
      },
      {
        condition: metrics.signalQueueLength > this.config.maxSignalQueueLength,
        type: AlertType.SIGNAL_QUEUE_FULL,
        severity: AlertSeverity.WARNING,
        title: 'Signal Queue Full',
        description: `Signal queue length (${metrics.signalQueueLength}) exceeds threshold (${this.config.maxSignalQueueLength})`,
        threshold: this.config.maxSignalQueueLength,
        actualValue: metrics.signalQueueLength,
      },
      {
        condition: metrics.agentSuccessRate < this.config.minAgentSuccessRate,
        type: AlertType.AGENT_FAILURE_RATE_HIGH,
        severity:
          metrics.agentSuccessRate < 50
            ? AlertSeverity.CRITICAL
            : AlertSeverity.ERROR,
        title: 'High Agent Failure Rate',
        description: `Agent success rate (${metrics.agentSuccessRate}%) below threshold (${this.config.minAgentSuccessRate}%)`,
        threshold: this.config.minAgentSuccessRate,
        actualValue: metrics.agentSuccessRate,
      },
      {
        condition:
          metrics.systemStatus === SystemHealthStatus.DEGRADED ||
          metrics.systemStatus === SystemHealthStatus.UNHEALTHY,
        type: AlertType.SYSTEM_DEGRADED,
        severity:
          metrics.systemStatus === SystemHealthStatus.UNHEALTHY
            ? AlertSeverity.CRITICAL
            : AlertSeverity.WARNING,
        title: 'System Degraded',
        description: `System health status is ${metrics.systemStatus}`,
        threshold: 0,
        actualValue: 1,
      },
    ];

    for (const check of alertChecks) {
      if (check.condition) {
        await this.createAlert(
          check.type,
          check.severity,
          check.title,
          check.description,
          {
            threshold: check.threshold,
            actualValue: check.actualValue,
            timestamp: metrics.timestamp,
          },
        );
      } else {
        // Resolve existing alert if condition is no longer met
        await this.resolveAlert(check.type);
      }
    }
  }

  /**
   * Creates a new alert
   */
  private async createAlert(
    type: AlertType,
    severity: AlertSeverity,
    title: string,
    description: string,
    context: Record<string, unknown>,
  ): Promise<void> {
    const alertId = `${type}_${Date.now()}`;

    // Check if similar alert exists and is in cooldown
    const existingAlert = Array.from(this.activeAlerts.values()).find(
      (alert) => alert.type === type && alert.status === AlertStatus.ACTIVE,
    );

    if (existingAlert) {
      const timeSinceLastAlert = Date.now() - existingAlert.timestamp.getTime();
      if (timeSinceLastAlert < this.config.alertCooldownPeriod) {
        return; // Skip creating alert due to cooldown
      }
    }

    const alert: WorkflowAlert = {
      id: alertId,
      timestamp: new Date(),
      severity,
      type,
      title,
      description,
      context,
      status: AlertStatus.ACTIVE,
      actionsTaken: [],
      relatedAlerts: [],
    };

    this.activeAlerts.set(alertId, alert);

    // Auto-acknowledge low severity alerts
    if (severity === AlertSeverity.INFO || severity === AlertSeverity.WARNING) {
      setTimeout(() => {
        this.acknowledgeAlert(alertId, 'system');
      }, 30000); // Auto-acknowledge after 30 seconds
    }

    log.warn('[HealthChecker] Alert created', {
      alertId,
      type,
      severity,
      title,
      description,
    });

    // Perform automated recovery actions
    await this.takeAutomatedActions(alert);
  }

  /**
   * Resolves an alert
   */
  private async resolveAlert(type: AlertType): Promise<void> {
    const existingAlert = Array.from(this.activeAlerts.values()).find(
      (alert) => alert.type === type && alert.status === AlertStatus.ACTIVE,
    );

    if (existingAlert) {
      existingAlert.status = AlertStatus.RESOLVED;
      existingAlert.resolvedAt = new Date();

      log.info('[HealthChecker] Alert resolved', {
        alertId: existingAlert.id,
        type: existingAlert.type,
        duration:
          existingAlert.resolvedAt.getTime() -
          existingAlert.timestamp.getTime(),
      });
    }
  }

  /**
   * Acknowledges an alert
   */
  acknowledgeAlert(alertId: string, acknowledgedBy: string): boolean {
    const alert = this.activeAlerts.get(alertId);
    if (!alert) {
      return false;
    }

    alert.status = AlertStatus.ACKNOWLEDGED;
    alert.acknowledgedBy = acknowledgedBy;
    alert.acknowledgedAt = new Date();

    log.info('[HealthChecker] Alert acknowledged', {
      alertId,
      acknowledgedBy,
    });

    return true;
  }

  /**
   * Takes automated recovery actions
   */
  private async takeAutomatedActions(alert: WorkflowAlert): Promise<void> {
    const actions: string[] = [];

    switch (alert.type) {
      case AlertType.MEMORY_USAGE_HIGH:
        // Trigger garbage collection if possible
        if (typeof global !== 'undefined' && global.gc) {
          global.gc();
          actions.push('triggered_garbage_collection');
        }
        break;

      case AlertType.SIGNAL_QUEUE_FULL:
        // Could implement queue priority adjustment
        actions.push('queue_priority_adjustment_considered');
        break;

      case AlertType.AGENT_FAILURE_RATE_HIGH:
        // Could implement agent circuit breaker
        actions.push('agent_circuit_breaker_considered');
        break;

      default:
        actions.push('no_automated_action_available');
        break;
    }

    alert.actionsTaken = actions;

    if (
      actions.length > 1 ||
      !actions.includes('no_automated_action_available')
    ) {
      log.info('[HealthChecker] Automated actions taken', {
        alertId: alert.id,
        actions,
      });
    }
  }

  /**
   * Gets active alerts
   */
  getActiveAlerts(): WorkflowAlert[] {
    return Array.from(this.activeAlerts.values()).filter(
      (alert) => alert.status === AlertStatus.ACTIVE,
    );
  }

  /**
   * Gets health history
   */
  getHealthHistory(limit: number = 100): WorkflowHealthMetrics[] {
    return this.healthHistory.slice(-limit);
  }

  /**
   * Gets current system status
   */
  getCurrentSystemStatus(): SystemHealthStatus {
    if (this.healthHistory.length === 0) {
      return SystemHealthStatus.HEALTHY;
    }

    const lastEntry = this.healthHistory[this.healthHistory.length - 1];
    return lastEntry?.systemStatus ?? SystemHealthStatus.HEALTHY;
  }

  /**
   * Trims health history to prevent unbounded growth
   */
  private trimHealthHistory(): void {
    const maxHistorySize = 1000; // Keep last 1000 health checks
    if (this.healthHistory.length > maxHistorySize) {
      this.healthHistory = this.healthHistory.slice(-maxHistorySize);
    }
  }

  // Placeholder methods for metrics collection
  // In a real implementation, these would integrate with actual system metrics

  private getActiveWorkflowCount(): number {
    // Implementation would query actual workflow state
    return 0;
  }

  private getQueuedWorkflowCount(): number {
    return 0;
  }

  private getFailedWorkflowCount(): number {
    return 0;
  }

  private getAverageExecutionTime(): number {
    return 0;
  }

  private getPercentileExecutionTime(percentile: number): number {
    return 0;
  }

  private getMemoryUtilization(): number {
    if (typeof process !== 'undefined' && process.memoryUsage) {
      const usage = process.memoryUsage();
      // Rough calculation - in reality would need system memory info
      return (usage.heapUsed / (usage.heapTotal + usage.external)) * 100;
    }
    return 0;
  }

  private getCpuUtilization(): number {
    // Would integrate with system CPU metrics
    return 0;
  }

  private getDiskUtilization(): number {
    // Would integrate with system disk metrics
    return 0;
  }

  private getSignalQueueLength(): number {
    // Would query actual signal queue lengths
    return 0;
  }

  private getSignalProcessingRate(): number {
    return 0;
  }

  private getSignalFailureRate(): number {
    return 0;
  }

  private getActiveAgentCount(): number {
    return 0;
  }

  private getAgentSuccessRate(): number {
    return 95; // Default good rate
  }

  private getAverageAgentResponseTime(): number {
    return 0;
  }

  private getErrorRate(): number {
    return 0;
  }

  private getCriticalErrorRate(): number {
    return 0;
  }

  private getTimeoutRate(): number {
    return 0;
  }
}
