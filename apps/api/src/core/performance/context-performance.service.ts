import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import {
  getEventContext,
  EventContext as BaseEventContext,
  FlowContextMetadata,
} from '../events/observable-event.context';

/**
 * Performance optimization configuration for context handling
 */
export interface ContextPerformanceConfig {
  // Lazy loading settings
  enableLazyLoading?: boolean;
  lazyLoadThreshold?: number; // Number of context accesses before full load

  // Context sampling settings
  enableSampling?: boolean;
  samplingStrategies?: SamplingStrategy[];

  // Context size optimization
  enableContextCompression?: boolean;
  maxContextSize?: number; // Maximum size in bytes
  contextTTL?: number; // Time to live in milliseconds

  // Performance monitoring
  enablePerformanceMetrics?: boolean;
  metricsRetentionTime?: number; // How long to keep metrics
  performanceAlertThreshold?: number; // Alert if context operations take longer than this (ms)
}

export interface OptimizedContext extends BaseEventContext {
  _optimized: boolean;
  _minimal?: boolean;
  _compressed?: boolean;
  _truncated?: boolean;
  _timestamp?: number;
  metadata?: FlowContextMetadata;
}

export interface SamplingStrategy {
  name: string;
  condition: (
    context: BaseEventContext,
    metadata: FlowContextMetadata,
  ) => boolean;
  samplingRate: number; // 0.0 to 1.0
  priority: number; // Higher priority strategies are evaluated first
}

export interface ContextPerformanceMetrics {
  totalContextAccesses: number;
  lazyLoadHits: number;
  lazyLoadMisses: number;
  sampledContexts: number;
  averageContextSize: number;
  averageAccessTime: number;
  contextCompressionRatio: number;
  memoryUsage: number;
}

/**
 * Default sampling strategies for different scenarios
 */
const DEFAULT_SAMPLING_STRATEGIES: SamplingStrategy[] = [
  {
    name: 'high-volume-llm',
    condition: (_context: BaseEventContext, metadata: FlowContextMetadata) =>
      metadata.llmModel !== undefined && metadata.executionType === 'llm',
    samplingRate: 0.1, // 10% sampling for LLM operations
    priority: 10,
  },
  {
    name: 'debug-nodes',
    condition: (_context: BaseEventContext, metadata: FlowContextMetadata) =>
      metadata.nodeType === 'debug' || metadata.operationType === 'debug',
    samplingRate: 1.0, // Always sample debug operations
    priority: 20,
  },
  {
    name: 'error-contexts',
    condition: (_context: BaseEventContext, metadata: FlowContextMetadata) =>
      metadata.hasError === true,
    samplingRate: 1.0, // Always sample error contexts
    priority: 30,
  },
  {
    name: 'performance-critical',
    condition: (_context: BaseEventContext, metadata: FlowContextMetadata) =>
      !!metadata.serviceChain && metadata.serviceChain.length > 3,
    samplingRate: 0.05, // 5% sampling for deep service chains
    priority: 5,
  },
  {
    name: 'routine-operations',
    condition: (_context: BaseEventContext, metadata: FlowContextMetadata) =>
      metadata.operationType === 'read' || metadata.operationType === 'list',
    samplingRate: 0.01, // 1% sampling for routine operations
    priority: 1,
  },
];

/**
 * Default configuration
 */
const DEFAULT_CONFIG: Required<ContextPerformanceConfig> = {
  enableLazyLoading: true,
  lazyLoadThreshold: 3,
  enableSampling: true,
  samplingStrategies: DEFAULT_SAMPLING_STRATEGIES,
  enableContextCompression: true,
  maxContextSize: 8192, // 8KB max context
  contextTTL: 300000, // 5 minutes
  enablePerformanceMetrics: true,
  metricsRetentionTime: 3600000, // 1 hour
  performanceAlertThreshold: 10, // 10ms
};

/**
 * Context Performance Service
 *
 * Provides performance optimization for context handling including:
 * - Lazy loading of context metadata
 * - Intelligent sampling based on operation type
 * - Context compression and size optimization
 * - Performance monitoring and alerting
 *
 * This service helps reduce the overhead of context propagation in high-throughput scenarios
 * while maintaining full context for critical operations.
 */
@Injectable()
export class ContextPerformanceService implements OnModuleDestroy {
  private readonly logger = new Logger(ContextPerformanceService.name);
  private readonly config: Required<ContextPerformanceConfig>;
  private readonly metrics: ContextPerformanceMetrics;
  private readonly contextCache = new Map<string, OptimizedContext>();
  private readonly lazyLoadCounters = new Map<string, number>();
  private cleanupTimer?: ReturnType<typeof setInterval>;

  constructor(config: Partial<ContextPerformanceConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.metrics = {
      totalContextAccesses: 0,
      lazyLoadHits: 0,
      lazyLoadMisses: 0,
      sampledContexts: 0,
      averageContextSize: 0,
      averageAccessTime: 0,
      contextCompressionRatio: 0,
      memoryUsage: 0,
    };

    // Start background cleanup task
    this.startCleanupTask();
  }

  /**
   * Optimized context retrieval with lazy loading and sampling
   */
  getOptimizedContext(requestId: string): OptimizedContext | null {
    const startTime = Date.now();
    this.metrics.totalContextAccesses++;

    try {
      const context = getEventContext();
      if (!context) {
        return null;
      }

      // Check if we should sample this context
      if (!this.shouldSampleContext(context)) {
        return this.createMinimalContext(context);
      }

      // Lazy loading logic
      if (this.config.enableLazyLoading) {
        return this.handleLazyLoading(requestId, context);
      }

      // Full context with potential compression
      return this.processFullContext(context);
    } finally {
      const duration = Date.now() - startTime;
      this.updatePerformanceMetrics(duration);

      if (duration > this.config.performanceAlertThreshold) {
        this.logger.warn(
          `Context access took ${duration}ms (threshold: ${this.config.performanceAlertThreshold}ms)`,
          {
            requestId,
            duration,
          },
        );
      }
    }
  }

  /**
   * Determine if context should be sampled based on configured strategies
   */
  private shouldSampleContext(context: BaseEventContext): boolean {
    if (!this.config.enableSampling) {
      return true;
    }

    const metadata = context.metadata || ({} as FlowContextMetadata);

    // Sort strategies by priority (descending)
    const sortedStrategies = [...this.config.samplingStrategies].sort(
      (a, b) => b.priority - a.priority,
    );

    for (const strategy of sortedStrategies) {
      if (strategy.condition(context, metadata)) {
        const shouldSample = Math.random() < strategy.samplingRate;

        if (shouldSample) {
          this.metrics.sampledContexts++;
        }

        this.logger.debug(`Applied sampling strategy: ${strategy.name}`, {
          samplingRate: strategy.samplingRate,
          shouldSample,
          contextId: context.correlationId?.slice(-8),
        });

        return shouldSample;
      }
    }

    // Default: sample everything if no strategy matches
    this.metrics.sampledContexts++;
    return true;
  }

  /**
   * Handle lazy loading of context data
   */
  private handleLazyLoading(
    requestId: string,
    context: BaseEventContext,
  ): OptimizedContext {
    const cacheKey = `${requestId}-${context.correlationId}`;

    // Increment access counter
    const currentCount = this.lazyLoadCounters.get(cacheKey) || 0;
    this.lazyLoadCounters.set(cacheKey, currentCount + 1);

    // Check if we've hit the lazy load threshold
    if (currentCount < this.config.lazyLoadThreshold) {
      this.metrics.lazyLoadHits++;

      // Return minimal context until threshold is reached
      return this.createMinimalContext(context);
    }

    this.metrics.lazyLoadMisses++;

    // Load full context and cache it
    const fullContext = this.processFullContext(context);
    this.contextCache.set(cacheKey, fullContext);

    return fullContext;
  }

  /**
   * Create minimal context for performance optimization
   */
  private createMinimalContext(context: BaseEventContext): OptimizedContext {
    const flowMetadata = context.metadata;

    return {
      ...context,
      metadata: {
        flowId: flowMetadata?.flowId,
        nodeId: flowMetadata?.nodeId,
        nodeType: flowMetadata?.nodeType,
        executionType: flowMetadata?.executionType,
        operationType: flowMetadata?.operationType,
        // Only include critical metadata
        hasError: flowMetadata?.hasError,
      } as FlowContextMetadata,
      _optimized: true,
      _minimal: true,
    };
  }

  /**
   * Process full context with optional compression
   */
  private processFullContext(context: BaseEventContext): OptimizedContext {
    let processedContext = { ...context };

    if (this.config.enableContextCompression) {
      processedContext = this.compressContext(processedContext);
    }

    // Check context size and truncate if necessary
    const contextSize = this.getContextSize(processedContext);
    if (contextSize > this.config.maxContextSize) {
      processedContext = this.truncateContext(processedContext);
    }

    const optimizedContext: OptimizedContext = {
      ...processedContext,
      _optimized: true,
      _compressed: this.config.enableContextCompression,
    };

    return optimizedContext;
  }

  /**
   * Compress context by removing verbose fields and optimizing data structures
   */
  private compressContext(context: BaseEventContext): BaseEventContext {
    const compressed = { ...context };
    const metadata = compressed.metadata || ({} as FlowContextMetadata);

    // Compress service chain
    if (metadata.serviceChain && Array.isArray(metadata.serviceChain)) {
      if (metadata.serviceChain.length > 5) {
        // Keep first 2, last 2, and indicate truncation
        metadata.serviceChain = [
          ...metadata.serviceChain.slice(0, 2),
          `...(${metadata.serviceChain.length - 4} more)`,
          ...metadata.serviceChain.slice(-2),
        ];
      }
    }

    // Compress long strings
    Object.keys(metadata).forEach((key) => {
      const value = (metadata as Record<string, unknown>)[key];
      if (typeof value === 'string' && value.length > 100) {
        (metadata as Record<string, unknown>)[key] =
          value.substring(0, 97) + '...';
      }
    });

    // Remove internal fields that are not needed for logging
    delete metadata.processingStartTime;
    delete metadata.llmCallStartTime;
    delete metadata.orchestrationStartTime;
    delete metadata.promptBuildStartTime;
    delete metadata.creationStartTime;

    compressed.metadata = metadata as Record<string, unknown>;
    return compressed;
  }

  /**
   * Get approximate size of context object in bytes
   */
  private getContextSize(context: BaseEventContext | OptimizedContext): number {
    try {
      return new Blob([JSON.stringify(context)]).size;
    } catch {
      // Fallback estimation
      return JSON.stringify(context).length * 2; // Approximate UTF-16 encoding
    }
  }

  /**
   * Truncate context to fit within size limits
   */
  private truncateContext(context: BaseEventContext): BaseEventContext {
    const truncated = { ...context };
    const metadata = truncated.metadata || ({} as FlowContextMetadata);

    // Remove fields in order of decreasing importance
    const fieldsToRemove = [
      'featureFlags',
      'experimentIds',
      'errorContext',
      'flowPath',
      'decisionPoints',
      'serviceChain',
      'costCenter',
    ];

    for (const field of fieldsToRemove) {
      if (this.getContextSize(truncated) <= this.config.maxContextSize) {
        break;
      }
      delete (metadata as Record<string, unknown>)[field];
    }

    truncated.metadata = metadata as Record<string, unknown>;

    return {
      ...truncated,
      metadata: {
        ...(metadata as Record<string, unknown>),
        _truncated: true,
      } as Record<string, unknown>,
    };
  }

  /**
   * Update performance metrics
   */
  private updatePerformanceMetrics(duration: number): void {
    // Update average access time using exponential moving average
    const alpha = 0.1; // Smoothing factor
    this.metrics.averageAccessTime =
      this.metrics.averageAccessTime * (1 - alpha) + duration * alpha;
  }

  /**
   * Get current performance metrics
   */
  getMetrics(): ContextPerformanceMetrics {
    return { ...this.metrics };
  }

  /**
   * Reset performance metrics
   */
  resetMetrics(): void {
    this.metrics.totalContextAccesses = 0;
    this.metrics.lazyLoadHits = 0;
    this.metrics.lazyLoadMisses = 0;
    this.metrics.sampledContexts = 0;
    this.metrics.averageContextSize = 0;
    this.metrics.averageAccessTime = 0;
    this.metrics.contextCompressionRatio = 0;
    this.metrics.memoryUsage = 0;
  }

  /**
   * Update configuration at runtime
   */
  updateConfig(newConfig: Partial<ContextPerformanceConfig>): void {
    Object.assign(this.config, newConfig);
    this.logger.log('Context performance configuration updated', { newConfig });
  }

  /**
   * Add a custom sampling strategy
   */
  addSamplingStrategy(strategy: SamplingStrategy): void {
    this.config.samplingStrategies.push(strategy);
    // Re-sort by priority
    this.config.samplingStrategies.sort((a, b) => b.priority - a.priority);

    this.logger.log('Added custom sampling strategy', {
      name: strategy.name,
      priority: strategy.priority,
      samplingRate: strategy.samplingRate,
    });
  }

  /**
   * Remove a sampling strategy by name
   */
  removeSamplingStrategy(strategyName: string): void {
    const index = this.config.samplingStrategies.findIndex(
      (s) => s.name === strategyName,
    );
    if (index !== -1) {
      this.config.samplingStrategies.splice(index, 1);
      this.logger.log('Removed sampling strategy', { name: strategyName });
    }
  }

  /**
   * Start background cleanup task for cache and counters
   */
  private startCleanupTask(): void {
    this.cleanupTimer = setInterval(() => {
      const now = Date.now();

      // Clean up old cache entries
      const entriesToDelete: string[] = [];
      this.contextCache.forEach((value, key) => {
        if (
          value._timestamp &&
          now - value._timestamp > this.config.contextTTL
        ) {
          entriesToDelete.push(key);
        }
      });
      entriesToDelete.forEach((key) => this.contextCache.delete(key));

      // Clean up lazy load counters
      this.lazyLoadCounters.clear();

      // Update memory usage metric
      this.metrics.memoryUsage = this.estimateMemoryUsage();
    }, this.config.contextTTL / 2); // Run cleanup twice per TTL period
    this.cleanupTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
  }

  /**
   * Estimate current memory usage
   */
  private estimateMemoryUsage(): number {
    let totalSize = 0;

    this.contextCache.forEach((value, key) => {
      totalSize += key.length * 2; // Approximate string size
      totalSize += this.getContextSize(value);
    });

    return totalSize;
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; hitRate: number; memoryUsage: number } {
    const hitRate =
      this.metrics.lazyLoadHits /
        (this.metrics.lazyLoadHits + this.metrics.lazyLoadMisses) || 0;

    return {
      size: this.contextCache.size,
      hitRate: Math.round(hitRate * 100) / 100,
      memoryUsage: this.metrics.memoryUsage,
    };
  }
}
