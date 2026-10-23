import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { getEventContext } from '../events/observable-event.context';
import { FlowContextMetadata } from '../events/context-utils';
import { ContextPerformanceService } from '../performance/context-performance.service';

/**
 * Health check configuration
 */
export interface ContextHealthConfig {
  // Monitoring intervals
  healthCheckInterval?: number; // milliseconds
  metricsRetentionPeriod?: number; // milliseconds
  alertCooldownPeriod?: number; // milliseconds

  // Health thresholds
  maxContextAccessTime?: number; // milliseconds
  maxContextSize?: number; // bytes
  minContextAvailability?: number; // percentage (0-1)
  maxErrorRate?: number; // percentage (0-1)

  // Alert configuration
  enableAlerting?: boolean;
  alertWebhookUrl?: string;
  alertEmailRecipients?: string[];
  slackWebhookUrl?: string;

  // Metrics collection
  enableMetricsCollection?: boolean;
  enablePerformanceTracing?: boolean;
  enableErrorTracking?: boolean;

  // Production optimizations
  samplingRate?: number; // For production monitoring (0-1)
  batchSize?: number; // Batch size for metrics
  enableDetailedTracing?: boolean; // Detailed tracing (disable in production)
}

/**
 * Health metrics structure
 */
export interface ContextHealthMetrics {
  // Availability metrics
  contextAvailabilityRate: number;
  totalContextRequests: number;
  failedContextRequests: number;

  // Performance metrics
  averageContextAccessTime: number;
  maxContextAccessTime: number;
  contextAccessTimeP95: number;
  contextAccessTimeP99: number;

  // Size and memory metrics
  averageContextSize: number;
  maxContextSize: number;
  totalMemoryUsage: number;
  contextLeaks: number;

  // Error metrics
  errorRate: number;
  totalErrors: number;
  criticalErrors: number;

  // Flow-specific metrics
  flowCoverageRate: number;
  nodesCovered: number;
  totalNodes: number;

  // Service integration metrics
  servicesWithContext: number;
  totalServices: number;
  serviceIntegrationRate: number;

  // Timestamp
  timestamp: number;
  collectionPeriod: string;
}

/**
 * Alert severity levels
 */
export enum AlertSeverity {
  INFO = 'info',
  WARNING = 'warning',
  ERROR = 'error',
  CRITICAL = 'critical',
}

/**
 * Alert structure
 */
export interface ContextHealthAlert {
  id: string;
  severity: AlertSeverity;
  title: string;
  description: string;
  metrics: Partial<ContextHealthMetrics>;
  recommendations: string[];
  timestamp: number;
  acknowledged: boolean;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: Required<ContextHealthConfig> = {
  healthCheckInterval: 60000, // 1 minute
  metricsRetentionPeriod: 24 * 60 * 60 * 1000, // 24 hours
  alertCooldownPeriod: 15 * 60 * 1000, // 15 minutes

  maxContextAccessTime: 50, // 50ms
  maxContextSize: 16384, // 16KB
  minContextAvailability: 0.95, // 95%
  maxErrorRate: 0.05, // 5%

  enableAlerting: true,
  alertWebhookUrl: '',
  alertEmailRecipients: [],
  slackWebhookUrl: '',

  enableMetricsCollection: true,
  enablePerformanceTracing: true,
  enableErrorTracking: true,

  samplingRate: 1.0, // 100% in development, should be lower in production
  batchSize: 100,
  enableDetailedTracing: false, // Disable in production
};

/**
 * Context Health Monitor Service
 *
 * Provides comprehensive monitoring and alerting for context health in production.
 * Features:
 * - Real-time health metrics collection
 * - Automated alerting for health issues
 * - Performance tracking and optimization recommendations
 * - Integration with external monitoring systems
 * - Production-ready with configurable sampling
 */
@Injectable()
export class ContextHealthMonitorService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(ContextHealthMonitorService.name);
  private readonly config: Required<ContextHealthConfig>;
  private readonly metrics: ContextHealthMetrics;
  private readonly alerts: Map<string, ContextHealthAlert> = new Map();
  private readonly metricsBatches: ContextHealthMetrics[] = [];

  // Tracking arrays for statistical calculations
  private contextAccessTimes: number[] = [];
  private contextSizes: number[] = [];
  private recentErrors: Error[] = [];
  private lastAlertTimes: Map<string, number> = new Map();

  // Service tracking
  private serviceContextUsage: Map<
    string,
    { requests: number; errors: number }
  > = new Map();
  private nodeContextCoverage: Set<string> = new Set();
  private totalNodesDiscovered: Set<string> = new Set();

  private healthCheckInterval: NodeJS.Timeout | null = null;

  constructor(
    config: Partial<ContextHealthConfig> = {},
    private performanceService?: ContextPerformanceService,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.metrics = this.initializeMetrics();

    // Adjust config for production
    if (process.env.NODE_ENV === 'production') {
      this.config.samplingRate = Math.min(this.config.samplingRate, 0.1); // Max 10% sampling
      this.config.enableDetailedTracing = false;
      this.config.batchSize = Math.max(this.config.batchSize, 1000); // Larger batches
    }
  }

  onModuleInit(): void {
    this.logger.log('Context Health Monitor starting up', {
      samplingRate: this.config.samplingRate,
      enableDetailedTracing: this.config.enableDetailedTracing,
      environment: process.env.NODE_ENV,
    });

    this.startHealthChecks();
  }

  onModuleDestroy(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    // Flush any pending metrics
    this.flushMetrics();
  }

  /**
   * Initialize metrics structure
   */
  private initializeMetrics(): ContextHealthMetrics {
    return {
      contextAvailabilityRate: 1.0,
      totalContextRequests: 0,
      failedContextRequests: 0,

      averageContextAccessTime: 0,
      maxContextAccessTime: 0,
      contextAccessTimeP95: 0,
      contextAccessTimeP99: 0,

      averageContextSize: 0,
      maxContextSize: 0,
      totalMemoryUsage: 0,
      contextLeaks: 0,

      errorRate: 0,
      totalErrors: 0,
      criticalErrors: 0,

      flowCoverageRate: 0,
      nodesCovered: 0,
      totalNodes: 0,

      servicesWithContext: 0,
      totalServices: 0,
      serviceIntegrationRate: 0,

      timestamp: Date.now(),
      collectionPeriod: '1m',
    };
  }

  /**
   * Start health check monitoring
   */
  private startHealthChecks(): void {
    this.healthCheckInterval = setInterval(() => {
      this.collectHealthMetrics();
      this.evaluateHealthThresholds();
      this.cleanupOldData();
    }, this.config.healthCheckInterval);
  }

  /**
   * Record a context access for monitoring
   */
  recordContextAccess(
    serviceName: string,
    operation: string,
    startTime: number,
    success: boolean,
    contextSize?: number,
    error?: Error,
  ): void {
    // Sampling check
    if (Math.random() > this.config.samplingRate) {
      return;
    }

    const duration = Date.now() - startTime;

    // Update service tracking
    const serviceStats = this.serviceContextUsage.get(serviceName) || {
      requests: 0,
      errors: 0,
    };
    serviceStats.requests++;
    if (!success) {
      serviceStats.errors++;
    }
    this.serviceContextUsage.set(serviceName, serviceStats);

    // Record performance metrics
    this.contextAccessTimes.push(duration);
    if (contextSize) {
      this.contextSizes.push(contextSize);
    }

    // Record errors
    if (error) {
      this.recentErrors.push(error);
    }

    // Update current metrics
    this.updateCurrentMetrics();
  }

  /**
   * Record node context coverage
   */
  recordNodeCoverage(nodeId: string, hasContext: boolean): void {
    this.totalNodesDiscovered.add(nodeId);
    if (hasContext) {
      this.nodeContextCoverage.add(nodeId);
    }

    // Update current metrics
    this.updateCurrentMetrics();
  }

  /**
   * Update current metrics based on recorded data
   */
  private updateCurrentMetrics(): void {
    const now = Date.now();

    // Calculate availability rate
    let totalRequests = 0;
    let totalErrors = 0;
    for (const stats of this.serviceContextUsage.values()) {
      totalRequests += stats.requests;
      totalErrors += stats.errors;
    }

    this.metrics.totalContextRequests = totalRequests;
    this.metrics.failedContextRequests = totalErrors;
    this.metrics.contextAvailabilityRate =
      totalRequests > 0 ? (totalRequests - totalErrors) / totalRequests : 1.0;

    // Calculate performance metrics
    if (this.contextAccessTimes.length > 0) {
      this.metrics.averageContextAccessTime =
        this.contextAccessTimes.reduce((a, b) => a + b, 0) /
        this.contextAccessTimes.length;
      this.metrics.maxContextAccessTime = Math.max(...this.contextAccessTimes);
      this.metrics.contextAccessTimeP95 = this.calculatePercentile(
        this.contextAccessTimes,
        0.95,
      );
      this.metrics.contextAccessTimeP99 = this.calculatePercentile(
        this.contextAccessTimes,
        0.99,
      );
    }

    // Calculate size metrics
    if (this.contextSizes.length > 0) {
      this.metrics.averageContextSize =
        this.contextSizes.reduce((a, b) => a + b, 0) / this.contextSizes.length;
      this.metrics.maxContextSize = Math.max(...this.contextSizes);
    }

    // Calculate error rate
    this.metrics.totalErrors = this.recentErrors.length;
    this.metrics.errorRate =
      totalRequests > 0 ? totalErrors / totalRequests : 0;

    // Calculate flow coverage
    this.metrics.nodesCovered = this.nodeContextCoverage.size;
    this.metrics.totalNodes = this.totalNodesDiscovered.size;
    this.metrics.flowCoverageRate =
      this.metrics.totalNodes > 0
        ? this.metrics.nodesCovered / this.metrics.totalNodes
        : 0;

    // Calculate service integration rate
    this.metrics.servicesWithContext = this.serviceContextUsage.size;
    this.metrics.totalServices = this.serviceContextUsage.size; // Approximation
    this.metrics.serviceIntegrationRate = 1.0; // All tracked services have context

    this.metrics.timestamp = now;
  }

  /**
   * Calculate percentile from array of numbers
   */
  private calculatePercentile(values: number[], percentile: number): number {
    if (values.length === 0) return 0;

    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.ceil(sorted.length * percentile) - 1;
    return sorted[Math.max(0, index)] ?? 0;
  }

  /**
   * Collect comprehensive health metrics
   */
  private collectHealthMetrics(): void {
    if (!this.config.enableMetricsCollection) {
      return;
    }

    try {
      this.updateCurrentMetrics();

      // Add performance service metrics if available
      if (this.performanceService) {
        const perfMetrics = this.performanceService.getMetrics();
        this.metrics.totalMemoryUsage = perfMetrics.memoryUsage;
      }

      // Batch metrics for efficient processing
      this.metricsBatches.push({ ...this.metrics });

      if (this.metricsBatches.length >= this.config.batchSize) {
        this.flushMetrics();
      }

      this.logger.debug('Health metrics collected', {
        availabilityRate:
          Math.round(this.metrics.contextAvailabilityRate * 100) / 100,
        avgAccessTime:
          Math.round(this.metrics.averageContextAccessTime * 100) / 100,
        flowCoverage: Math.round(this.metrics.flowCoverageRate * 100) / 100,
        errorRate: Math.round(this.metrics.errorRate * 100) / 100,
      });
    } catch (error) {
      this.logger.error('Failed to collect health metrics', error);
    }
  }

  /**
   * Evaluate health thresholds and trigger alerts
   */
  private evaluateHealthThresholds(): void {
    if (!this.config.enableAlerting) {
      return;
    }

    const alerts: ContextHealthAlert[] = [];

    // Check availability threshold
    if (
      this.metrics.contextAvailabilityRate < this.config.minContextAvailability
    ) {
      alerts.push(
        this.createAlert(
          'context-availability-low',
          AlertSeverity.ERROR,
          'Context Availability Below Threshold',
          `Context availability is ${Math.round(this.metrics.contextAvailabilityRate * 100)}% (threshold: ${Math.round(this.config.minContextAvailability * 100)}%)`,
          [
            'Check service integrations',
            'Review error logs',
            'Verify @WithEventContext decorators',
          ],
        ),
      );
    }

    // Check performance threshold
    if (
      this.metrics.averageContextAccessTime > this.config.maxContextAccessTime
    ) {
      alerts.push(
        this.createAlert(
          'context-performance-slow',
          AlertSeverity.WARNING,
          'Context Access Performance Degraded',
          `Average context access time is ${Math.round(this.metrics.averageContextAccessTime)}ms (threshold: ${this.config.maxContextAccessTime}ms)`,
          [
            'Enable context sampling',
            'Review context metadata size',
            'Check for memory leaks',
          ],
        ),
      );
    }

    // Check context size threshold
    if (this.metrics.maxContextSize > this.config.maxContextSize) {
      alerts.push(
        this.createAlert(
          'context-size-large',
          AlertSeverity.WARNING,
          'Context Size Exceeds Threshold',
          `Maximum context size is ${this.metrics.maxContextSize} bytes (threshold: ${this.config.maxContextSize} bytes)`,
          [
            'Enable context compression',
            'Review metadata fields',
            'Implement lazy loading',
          ],
        ),
      );
    }

    // Check error rate threshold
    if (this.metrics.errorRate > this.config.maxErrorRate) {
      alerts.push(
        this.createAlert(
          'context-error-rate-high',
          AlertSeverity.ERROR,
          'High Context Error Rate',
          `Context error rate is ${Math.round(this.metrics.errorRate * 100)}% (threshold: ${Math.round(this.config.maxErrorRate * 100)}%)`,
          [
            'Check service logs',
            'Verify context propagation',
            'Review error handling',
          ],
        ),
      );
    }

    // Check flow coverage
    if (this.metrics.flowCoverageRate < 0.8) {
      // 80% coverage threshold
      alerts.push(
        this.createAlert(
          'flow-coverage-low',
          AlertSeverity.INFO,
          'Low Flow Context Coverage',
          `Only ${Math.round(this.metrics.flowCoverageRate * 100)}% of flow nodes have context coverage`,
          [
            'Add @WithEventContext to missing nodes',
            'Review flow templates',
            'Update context integration',
          ],
        ),
      );
    }

    // Process and send alerts
    for (const alert of alerts) {
      this.processAlert(alert);
    }
  }

  /**
   * Create an alert object
   */
  private createAlert(
    id: string,
    severity: AlertSeverity,
    title: string,
    description: string,
    recommendations: string[],
  ): ContextHealthAlert {
    return {
      id,
      severity,
      title,
      description,
      metrics: { ...this.metrics },
      recommendations,
      timestamp: Date.now(),
      acknowledged: false,
    };
  }

  /**
   * Process and potentially send an alert
   */
  private processAlert(alert: ContextHealthAlert): void {
    const now = Date.now();
    const lastAlertTime = this.lastAlertTimes.get(alert.id) || 0;

    // Check cooldown period
    if (now - lastAlertTime < this.config.alertCooldownPeriod) {
      return;
    }

    // Store alert
    this.alerts.set(alert.id, alert);
    this.lastAlertTimes.set(alert.id, now);

    // Log alert
    this.logger.warn(`Context Health Alert: ${alert.title}`, {
      severity: alert.severity,
      description: alert.description,
      recommendations: alert.recommendations,
    });

    // Send external notifications
    this.sendAlert(alert).catch((error) => {
      this.logger.error('Failed to send alert', error);
    });
  }

  /**
   * Send alert to external systems
   */
  private async sendAlert(alert: ContextHealthAlert): Promise<void> {
    const promises: Promise<void>[] = [];

    // Webhook notification
    if (this.config.alertWebhookUrl) {
      promises.push(this.sendWebhookAlert(alert));
    }

    // Slack notification
    if (this.config.slackWebhookUrl) {
      promises.push(this.sendSlackAlert(alert));
    }

    // Email notification (placeholder - would integrate with email service)
    if (this.config.alertEmailRecipients.length > 0) {
      promises.push(this.sendEmailAlert(alert));
    }

    await Promise.allSettled(promises);
  }

  /**
   * Send webhook alert
   */
  private async sendWebhookAlert(alert: ContextHealthAlert): Promise<void> {
    try {
      const response = await fetch(this.config.alertWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'context-health-alert',
          alert,
          environment: process.env.NODE_ENV,
          service: 'hey-hey-api',
        }),
      });

      if (!response.ok) {
        throw new Error(`Webhook responded with ${response.status}`);
      }
    } catch (error) {
      this.logger.error('Failed to send webhook alert', error);
    }
  }

  /**
   * Send Slack alert
   */
  private async sendSlackAlert(alert: ContextHealthAlert): Promise<void> {
    try {
      const color = {
        [AlertSeverity.INFO]: '#36a64f',
        [AlertSeverity.WARNING]: '#ff9500',
        [AlertSeverity.ERROR]: '#ff0000',
        [AlertSeverity.CRITICAL]: '#8b0000',
      }[alert.severity];

      const response = await fetch(this.config.slackWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          attachments: [
            {
              color,
              title: `🚨 ${alert.title}`,
              text: alert.description,
              fields: [
                {
                  title: 'Environment',
                  value: process.env.NODE_ENV || 'unknown',
                  short: true,
                },
                {
                  title: 'Severity',
                  value: alert.severity.toUpperCase(),
                  short: true,
                },
                {
                  title: 'Recommendations',
                  value: alert.recommendations.map((r) => `• ${r}`).join('\n'),
                  short: false,
                },
              ],
              ts: Math.floor(alert.timestamp / 1000),
            },
          ],
        }),
      });

      if (!response.ok) {
        throw new Error(`Slack webhook responded with ${response.status}`);
      }
    } catch (error) {
      this.logger.error('Failed to send Slack alert', error);
    }
  }

  /**
   * Send email alert (placeholder)
   */
  private async sendEmailAlert(alert: ContextHealthAlert): Promise<void> {
    // This would integrate with your email service (SendGrid, SES, etc.)
    this.logger.debug('Email alert would be sent', {
      recipients: this.config.alertEmailRecipients,
      alert: alert.title,
    });
  }

  /**
   * Flush metrics batch to storage/monitoring system
   */
  private flushMetrics(): void {
    if (this.metricsBatches.length === 0) {
      return;
    }

    try {
      // Here you would send metrics to your monitoring system
      // Examples: Prometheus, DataDog, CloudWatch, etc.
      this.logger.debug('Flushing metrics batch', {
        batchSize: this.metricsBatches.length,
        lastMetrics: this.metricsBatches[this.metricsBatches.length - 1],
      });

      // Clear the batch
      this.metricsBatches.length = 0;
    } catch (error) {
      this.logger.error('Failed to flush metrics', error);
    }
  }

  /**
   * Clean up old data to prevent memory leaks
   */
  private cleanupOldData(): void {
    const now = Date.now();
    const retentionCutoff = now - this.config.metricsRetentionPeriod;

    // Keep only recent access times (last hour)
    const recentAccessTimes = this.contextAccessTimes.filter(
      (_, index) => this.contextAccessTimes.length - index <= 1000,
    );
    this.contextAccessTimes = recentAccessTimes;

    // Keep only recent context sizes
    const recentSizes = this.contextSizes.filter(
      (_, index) => this.contextSizes.length - index <= 1000,
    );
    this.contextSizes = recentSizes;

    // Clean up old errors
    this.recentErrors = this.recentErrors.filter((error) => {
      // Assuming errors have a timestamp property or we add one
      return true; // Keep all for now, could add timestamp logic
    });

    // Clean up old alerts
    for (const [alertId, alert] of this.alerts.entries()) {
      if (alert.timestamp < retentionCutoff) {
        this.alerts.delete(alertId);
      }
    }
  }

  /**
   * Get current health metrics
   */
  getHealthMetrics(): ContextHealthMetrics {
    return { ...this.metrics };
  }

  /**
   * Get active alerts
   */
  getActiveAlerts(): ContextHealthAlert[] {
    return Array.from(this.alerts.values())
      .filter((alert) => !alert.acknowledged)
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * Acknowledge an alert
   */
  acknowledgeAlert(alertId: string): boolean {
    const alert = this.alerts.get(alertId);
    if (alert) {
      alert.acknowledged = true;
      return true;
    }
    return false;
  }

  /**
   * Get health summary for dashboards
   */
  getHealthSummary(): {
    status: 'healthy' | 'degraded' | 'unhealthy';
    score: number;
    issues: string[];
    recommendations: string[];
  } {
    const issues: string[] = [];
    const recommendations: string[] = [];
    let score = 100;

    // Check key metrics
    if (
      this.metrics.contextAvailabilityRate < this.config.minContextAvailability
    ) {
      issues.push(
        `Low availability: ${Math.round(this.metrics.contextAvailabilityRate * 100)}%`,
      );
      recommendations.push('Improve service integration reliability');
      score -= 30;
    }

    if (this.metrics.errorRate > this.config.maxErrorRate) {
      issues.push(
        `High error rate: ${Math.round(this.metrics.errorRate * 100)}%`,
      );
      recommendations.push('Review and fix context propagation errors');
      score -= 25;
    }

    if (
      this.metrics.averageContextAccessTime > this.config.maxContextAccessTime
    ) {
      issues.push(
        `Slow performance: ${Math.round(this.metrics.averageContextAccessTime)}ms`,
      );
      recommendations.push('Optimize context access patterns');
      score -= 20;
    }

    if (this.metrics.flowCoverageRate < 0.8) {
      issues.push(
        `Low coverage: ${Math.round(this.metrics.flowCoverageRate * 100)}%`,
      );
      recommendations.push('Expand context integration to more flow nodes');
      score -= 15;
    }

    // Determine status
    let status: 'healthy' | 'degraded' | 'unhealthy';
    if (score >= 90) {
      status = 'healthy';
    } else if (score >= 70) {
      status = 'degraded';
    } else {
      status = 'unhealthy';
    }

    return {
      status,
      score: Math.max(0, score),
      issues,
      recommendations,
    };
  }

  /**
   * Cron job for periodic health reporting
   */
  @Cron(CronExpression.EVERY_HOUR)
  generateHealthReport(): void {
    const summary = this.getHealthSummary();
    const activeAlerts = this.getActiveAlerts();

    this.logger.log('Context Health Report', {
      status: summary.status,
      score: summary.score,
      activeAlerts: activeAlerts.length,
      metrics: {
        availability:
          Math.round(this.metrics.contextAvailabilityRate * 100) / 100,
        avgAccessTime:
          Math.round(this.metrics.averageContextAccessTime * 100) / 100,
        errorRate: Math.round(this.metrics.errorRate * 100) / 100,
        coverage: Math.round(this.metrics.flowCoverageRate * 100) / 100,
      },
    });
  }
}
