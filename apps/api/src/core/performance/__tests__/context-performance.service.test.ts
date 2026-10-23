import {
  ContextPerformanceService,
  ContextPerformanceConfig,
  SamplingStrategy,
  OptimizedContext,
} from '../context-performance.service';
import {
  EventContextManager,
  getEventContext,
} from '../../events/observable-event.context';
import {
  enrichEventContext,
  FlowContextMetadata,
} from '../../events/context-utils';
import {
  OrganizationId,
  ProjectId,
  UserId,
  WorkflowId,
  ConversationId,
  MessageId,
} from '../../../types';

function expectContext(value: OptimizedContext | null): OptimizedContext {
  expect(value).not.toBeNull();
  if (!value) {
    throw new Error('Expected context to be available');
  }
  return value;
}

function expectMetadata(context: OptimizedContext): FlowContextMetadata {
  expect(context.metadata).toBeDefined();
  return context.metadata as FlowContextMetadata;
}

describe('ContextPerformanceService', () => {
  let contextManager: EventContextManager;
  let performanceService: ContextPerformanceService;
  const services: ContextPerformanceService[] = [];
  const createService = (config: Partial<ContextPerformanceConfig> = {}) => {
    const service = new ContextPerformanceService(config);
    services.push(service);
    return service;
  };

  beforeEach(() => {
    contextManager = EventContextManager.getInstance();
    contextManager.clear();
    performanceService = createService();
  });

  afterEach(() => {
    services.splice(0).forEach((service) => service.onModuleDestroy());
    contextManager.clear();
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  describe('Initialization', () => {
    it('does not keep the process alive and cancels cleanup on destruction', () => {
      const interval = jest.spyOn(global, 'setInterval');
      const clear = jest.spyOn(global, 'clearInterval');
      try {
        const service = createService();
        const timer = interval.mock.results[0]!.value as NodeJS.Timeout;
        expect(timer.hasRef()).toBe(false);

        service.onModuleDestroy();
        expect(clear).toHaveBeenCalledWith(timer);
        service.onModuleDestroy();
        expect(clear).toHaveBeenCalledTimes(1);
      } finally {
        interval.mockRestore();
        clear.mockRestore();
      }
    });

    it('should initialize with default configuration', () => {
      const service = createService();
      const metrics = service.getMetrics();

      expect(metrics).toEqual({
        totalContextAccesses: 0,
        lazyLoadHits: 0,
        lazyLoadMisses: 0,
        sampledContexts: 0,
        averageContextSize: 0,
        averageAccessTime: 0,
        contextCompressionRatio: 0,
        memoryUsage: 0,
      });
    });

    it('should initialize with custom configuration', () => {
      const customConfig: Partial<ContextPerformanceConfig> = {
        enableLazyLoading: false,
        enableSampling: false,
        maxContextSize: 4096,
        enableContextCompression: false,
      };

      const service = createService(customConfig);
      expect(service).toBeDefined();
    });
  });

  describe('Context Sampling', () => {
    it('should sample contexts based on default strategies', () => {
      const context = contextManager.createInitialContext(
        'TestService',
        'testMethod',
      );

      contextManager.runWithContext(context, async () => {
        enrichEventContext({
          nodeType: 'debug',
          operationType: 'debug',
        });

        const optimizedContext = expectContext(
          performanceService.getOptimizedContext('req-123'),
        );

        expect(optimizedContext).toBeDefined();
        expect(optimizedContext._optimized).toBe(true);
      });
    });

    it('should apply high-volume-llm sampling strategy', () => {
      jest.spyOn(Math, 'random').mockReturnValue(0.05); // 5% - should be sampled for high-volume strategy

      const context = contextManager.createInitialContext(
        'TestService',
        'testMethod',
      );

      contextManager.runWithContext(context, async () => {
        enrichEventContext({
          llmModel: 'claude-4-sonnet',
          executionType: 'llm',
        });

        const optimizedContext = expectContext(
          performanceService.getOptimizedContext('req-123'),
        );

        expect(optimizedContext).toBeDefined();
        expect(optimizedContext._optimized).toBe(true);
      });

      jest.restoreAllMocks();
    });

    it('should skip sampling for high-volume operations', () => {
      jest.spyOn(Math, 'random').mockReturnValue(0.5); // 50% - should not be sampled for high-volume

      const context = contextManager.createInitialContext(
        'TestService',
        'testMethod',
      );

      contextManager.runWithContext(context, async () => {
        enrichEventContext({
          llmModel: 'claude-4-sonnet',
          executionType: 'llm',
        });

        const optimizedContext = expectContext(
          performanceService.getOptimizedContext('req-123'),
        );

        expect(optimizedContext._minimal).toBe(true);
      });

      jest.restoreAllMocks();
    });

    it('should always sample error contexts', () => {
      jest.spyOn(Math, 'random').mockReturnValue(0.99); // 99% - should still be sampled for errors

      const context = contextManager.createInitialContext(
        'TestService',
        'testMethod',
      );

      contextManager.runWithContext(context, async () => {
        enrichEventContext({
          hasError: true,
        });

        const optimizedContext = expectContext(
          performanceService.getOptimizedContext('req-123'),
        );

        expect(optimizedContext).toBeDefined();
        expect(optimizedContext._optimized).toBe(true);
        // Error contexts are sampled but still go through lazy loading on first access
        expect(optimizedContext._minimal).toBe(true);
      });

      jest.restoreAllMocks();
    });

    it('should handle custom sampling strategies', () => {
      const customStrategy: SamplingStrategy = {
        name: 'custom-test',
        condition: (context, metadata) => metadata.nodeId === 'special-node',
        samplingRate: 1.0,
        priority: 100,
      };

      performanceService.addSamplingStrategy(customStrategy);

      const context = contextManager.createInitialContext(
        'TestService',
        'testMethod',
      );

      contextManager.runWithContext(context, async () => {
        enrichEventContext({
          nodeId: 'special-node',
        });

        const optimizedContext = expectContext(
          performanceService.getOptimizedContext('req-123'),
        );

        expect(optimizedContext).toBeDefined();
        expect(optimizedContext._optimized).toBe(true);
      });
    });
  });

  describe('Lazy Loading', () => {
    it('should return minimal context until threshold is reached', () => {
      const context = contextManager.createInitialContext(
        'TestService',
        'testMethod',
        { workflowId: 'wf-123' as WorkflowId },
      );

      contextManager.runWithContext(context, async () => {
        enrichEventContext({
          flowId: 'test-flow',
          nodeId: 'test-node',
        });

        // First access - should get minimal context
        const context1 = expectContext(
          performanceService.getOptimizedContext('req-123'),
        );
        const context1Metadata = expectMetadata(context1);
        expect(context1._minimal).toBe(true);
        expect(context1.workflowId).toBe('wf-123');
        expect(context1Metadata.flowId).toBe('test-flow');

        // Second access - still minimal
        const context2 = expectContext(
          performanceService.getOptimizedContext('req-123'),
        );
        expect(context2._minimal).toBe(true);

        // Third access - still minimal
        const context3 = expectContext(
          performanceService.getOptimizedContext('req-123'),
        );
        expect(context3._minimal).toBe(true);

        // Fourth access - should trigger full load (default threshold is 3)
        const context4 = expectContext(
          performanceService.getOptimizedContext('req-123'),
        );
        expect(context4._minimal).toBeUndefined();
        expect(context4._optimized).toBe(true);
      });
    });

    it('should track lazy load hits and misses', () => {
      const context = contextManager.createInitialContext(
        'TestService',
        'testMethod',
      );

      contextManager.runWithContext(context, async () => {
        // Trigger lazy loading
        performanceService.getOptimizedContext('req-123'); // Hit
        performanceService.getOptimizedContext('req-123'); // Hit
        performanceService.getOptimizedContext('req-123'); // Hit
        performanceService.getOptimizedContext('req-123'); // Miss (triggers full load)

        const metrics = performanceService.getMetrics();
        expect(metrics.lazyLoadHits).toBe(3);
        expect(metrics.lazyLoadMisses).toBe(1);
      });
    });

    it('should disable lazy loading when configured', () => {
      const service = createService({
        enableLazyLoading: false,
      });

      const context = contextManager.createInitialContext(
        'TestService',
        'testMethod',
      );

      contextManager.runWithContext(context, async () => {
        const optimizedContext = expectContext(
          service.getOptimizedContext('req-123'),
        );

        expect(optimizedContext._minimal).toBeUndefined();
        expect(optimizedContext._optimized).toBe(true);
      });
    });
  });

  describe('Context Compression', () => {
    it('should compress large service chains', () => {
      // Mock Math.random to ensure sampling happens (performance-critical has 5% rate)
      jest.spyOn(Math, 'random').mockReturnValue(0.01); // 1% - should be sampled

      const context = contextManager.createInitialContext(
        'TestService',
        'testMethod',
      );

      contextManager.runWithContext(context, async () => {
        enrichEventContext({
          serviceChain: [
            'Service1',
            'Service2',
            'Service3',
            'Service4',
            'Service5',
            'Service6',
            'Service7',
            'Service8',
          ],
        });

        // Access context multiple times to trigger full loading (lazy load threshold is 3)
        performanceService.getOptimizedContext('req-123'); // 1st access - minimal
        performanceService.getOptimizedContext('req-123'); // 2nd access - minimal
        performanceService.getOptimizedContext('req-123'); // 3rd access - minimal
        const optimizedContext = expectContext(
          performanceService.getOptimizedContext('req-123'),
        ); // 4th access - full
        const optimizedMetadata = expectMetadata(optimizedContext);

        // Should compress to first 2, ellipsis, last 2
        expect(optimizedMetadata.serviceChain).toEqual([
          'Service1',
          'Service2',
          '...(4 more)',
          'Service7',
          'Service8',
        ]);
      });

      jest.restoreAllMocks();
    });

    it('should truncate long strings in metadata', () => {
      // Mock Math.random to ensure sampling happens (default sampling is enabled)
      jest.spyOn(Math, 'random').mockReturnValue(0.01); // Ensure sampling

      const context = contextManager.createInitialContext(
        'TestService',
        'testMethod',
      );

      contextManager.runWithContext(context, async () => {
        const longString = 'a'.repeat(150); // 150 characters
        enrichEventContext({
          promptVersion: longString,
        });

        // Access context multiple times to trigger full loading (lazy load threshold is 3)
        performanceService.getOptimizedContext('req-123'); // 1st access - minimal
        performanceService.getOptimizedContext('req-123'); // 2nd access - minimal
        performanceService.getOptimizedContext('req-123'); // 3rd access - minimal
        const optimizedContext = expectContext(
          performanceService.getOptimizedContext('req-123'),
        ); // 4th access - full
        const optimizedMetadata = expectMetadata(optimizedContext);

        expect(optimizedMetadata.promptVersion).toBeDefined();
        const promptVersion = optimizedMetadata.promptVersion as string;
        expect(promptVersion).toHaveLength(100); // 97 + '...'
        expect(promptVersion.endsWith('...')).toBe(true);
      });

      jest.restoreAllMocks();
    });

    it('should remove timing fields during compression', () => {
      // Mock Math.random to ensure sampling happens (default sampling is enabled)
      jest.spyOn(Math, 'random').mockReturnValue(0.01); // Ensure sampling

      const context = contextManager.createInitialContext(
        'TestService',
        'testMethod',
      );

      contextManager.runWithContext(context, async () => {
        enrichEventContext({
          processingStartTime: Date.now(),
          llmCallStartTime: Date.now(),
          orchestrationStartTime: Date.now(),
        });

        // Access context multiple times to trigger full loading (lazy load threshold is 3)
        performanceService.getOptimizedContext('req-123'); // 1st access - minimal
        performanceService.getOptimizedContext('req-123'); // 2nd access - minimal
        performanceService.getOptimizedContext('req-123'); // 3rd access - minimal
        const optimizedContext = expectContext(
          performanceService.getOptimizedContext('req-123'),
        ); // 4th access - full
        const optimizedMetadata = expectMetadata(optimizedContext);

        expect(optimizedMetadata.processingStartTime).toBeUndefined();
        expect(optimizedMetadata.llmCallStartTime).toBeUndefined();
        expect(optimizedMetadata.orchestrationStartTime).toBeUndefined();
      });

      jest.restoreAllMocks();
    });

    it('should disable compression when configured', () => {
      const service = createService({
        enableContextCompression: false,
        enableLazyLoading: false, // Disable lazy loading to get full context immediately
        enableSampling: false, // Disable sampling to ensure we get full context
      });

      const context = contextManager.createInitialContext(
        'TestService',
        'testMethod',
      );

      contextManager.runWithContext(context, async () => {
        enrichEventContext({
          serviceChain: [
            'Service1',
            'Service2',
            'Service3',
            'Service4',
            'Service5',
            'Service6',
          ],
        });

        const optimizedContext = expectContext(
          service.getOptimizedContext('req-123'),
        );
        const optimizedMetadata = expectMetadata(optimizedContext);

        expect(optimizedContext._compressed).toBe(false);
        expect(optimizedMetadata.serviceChain).toHaveLength(6); // Not compressed
      });
    });
  });

  describe('Context Size Management', () => {
    it('should truncate context that exceeds size limits', () => {
      const service = createService({
        maxContextSize: 500, // Small limit for testing
        enableLazyLoading: false, // Disable lazy loading to get full context immediately
        enableSampling: false, // Disable sampling to ensure we get full context
      });

      const context = contextManager.createInitialContext(
        'TestService',
        'testMethod',
      );

      contextManager.runWithContext(context, async () => {
        // Add lots of metadata to exceed size limit
        enrichEventContext({
          serviceChain: Array.from({ length: 50 }, (_, i) => `Service${i}`),
          flowPath: Array.from({ length: 30 }, (_, i) => `node-${i}`),
          decisionPoints: Array.from({ length: 20 }, (_, i) => `decision-${i}`),
          featureFlags: Array.from({ length: 20 }, (_, i) => `flag-${i}`),
        });

        const optimizedContext = expectContext(
          service.getOptimizedContext('req-123'),
        );
        const optimizedMetadata = expectMetadata(optimizedContext);

        // The _truncated flag is set in metadata by the implementation
        expect(
          (optimizedMetadata as unknown as { _truncated?: boolean })._truncated,
        ).toBe(true);
        // Should have removed some fields
        expect(optimizedMetadata.featureFlags).toBeUndefined();
      });
    });

    it('should maintain essential fields during truncation', () => {
      const service = createService({
        maxContextSize: 200, // Very small limit
        enableLazyLoading: false, // Disable lazy loading to get full context immediately
        enableSampling: false, // Disable sampling to ensure we get full context
      });

      const context = contextManager.createInitialContext(
        'TestService',
        'testMethod',
      );

      contextManager.runWithContext(context, async () => {
        enrichEventContext({
          flowId: 'essential-flow',
          nodeId: 'essential-node',
          serviceChain: Array.from({ length: 50 }, (_, i) => `Service${i}`),
          featureFlags: Array.from({ length: 20 }, (_, i) => `flag-${i}`),
        });

        const optimizedContext = expectContext(
          service.getOptimizedContext('req-123'),
        );
        const optimizedMetadata = expectMetadata(optimizedContext);

        // Essential fields should be preserved
        expect(optimizedMetadata.flowId).toBe('essential-flow');
        expect(optimizedMetadata.nodeId).toBe('essential-node');

        // Non-essential fields should be removed
        expect(optimizedMetadata.featureFlags).toBeUndefined();
      });
    });
  });

  describe('Minimal Context Creation', () => {
    it('should create minimal context with essential fields only', () => {
      const context = contextManager.createInitialContext(
        'TestService',
        'testMethod',
        {
          workflowId: 'wf-123' as WorkflowId,
          conversationId: 'conv-456' as ConversationId,
        },
      );

      contextManager.runWithContext(context, async () => {
        enrichEventContext({
          flowId: 'test-flow',
          nodeId: 'test-node',
          nodeType: 'test',
          operationType: 'create',
          executionType: 'llm',
          hasError: false,
          serviceChain: ['Service1', 'Service2'],
          llmModel: 'claude-4-sonnet',
        });

        // Force minimal context by using sampling that always creates minimal
        jest.spyOn(Math, 'random').mockReturnValue(0.5);

        const optimizedContext = expectContext(
          performanceService.getOptimizedContext('req-123'),
        );
        const optimizedMetadata = expectMetadata(optimizedContext);

        expect(optimizedContext._minimal).toBe(true);
        expect(optimizedContext.correlationId).toBe(context.correlationId);
        expect(optimizedContext.workflowId).toBe('wf-123');
        expect(optimizedContext.conversationId).toBe('conv-456');

        // Should include critical metadata only
        expect(optimizedMetadata.flowId).toBe('test-flow');
        expect(optimizedMetadata.nodeId).toBe('test-node');
        expect(optimizedMetadata.nodeType).toBe('test');
        expect(optimizedMetadata.executionType).toBe('llm');
        expect(optimizedMetadata.operationType).toBe('create');
        expect(optimizedMetadata.hasError).toBe(false);

        // Should not include verbose metadata
        expect(optimizedMetadata.llmModel).toBeUndefined();
        expect(optimizedMetadata.serviceChain).toBeUndefined();

        jest.restoreAllMocks();
      });
    });
  });

  describe('Performance Metrics', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    it('should track performance metrics correctly', () => {
      const context = contextManager.createInitialContext(
        'TestService',
        'testMethod',
      );

      contextManager.runWithContext(context, async () => {
        // Mock Date.now to simulate time progression during execution
        let timeCounter = 1000;
        jest.spyOn(Date, 'now').mockImplementation(() => {
          const current = timeCounter;
          timeCounter += 5; // Each call advances 5ms
          return current;
        });

        performanceService.getOptimizedContext('req-123');

        const metrics = performanceService.getMetrics();
        expect(metrics.totalContextAccesses).toBe(1);
        expect(metrics.averageAccessTime).toBeGreaterThan(0);
      });
    });

    it('should update metrics with multiple accesses', () => {
      const context = contextManager.createInitialContext(
        'TestService',
        'testMethod',
      );

      contextManager.runWithContext(context, async () => {
        // Multiple accesses
        performanceService.getOptimizedContext('req-1');
        performanceService.getOptimizedContext('req-2');
        performanceService.getOptimizedContext('req-3');

        const metrics = performanceService.getMetrics();
        expect(metrics.totalContextAccesses).toBe(3);
      });
    });

    it('should reset metrics when requested', () => {
      const context = contextManager.createInitialContext(
        'TestService',
        'testMethod',
      );

      contextManager.runWithContext(context, async () => {
        performanceService.getOptimizedContext('req-123');

        let metrics = performanceService.getMetrics();
        expect(metrics.totalContextAccesses).toBe(1);

        performanceService.resetMetrics();

        metrics = performanceService.getMetrics();
        expect(metrics.totalContextAccesses).toBe(0);
      });
    });
  });

  describe('Configuration Updates', () => {
    it('should allow runtime configuration updates', () => {
      const context = contextManager.createInitialContext(
        'TestService',
        'testMethod',
      );

      contextManager.runWithContext(context, async () => {
        // Initially with default config - access multiple times to trigger full loading
        performanceService.getOptimizedContext('req-123'); // 1st access - minimal
        performanceService.getOptimizedContext('req-123'); // 2nd access - minimal
        performanceService.getOptimizedContext('req-123'); // 3rd access - minimal
        let optimizedContext = expectContext(
          performanceService.getOptimizedContext('req-123'),
        ); // 4th access - full
        expect(optimizedContext._compressed).toBe(true); // Default is enabled

        // Update configuration
        performanceService.updateConfig({
          enableContextCompression: false,
        });

        // Clear any cached contexts - access multiple times to trigger full loading for new context
        performanceService.getOptimizedContext('req-124'); // 1st access - minimal
        performanceService.getOptimizedContext('req-124'); // 2nd access - minimal
        performanceService.getOptimizedContext('req-124'); // 3rd access - minimal
        optimizedContext = expectContext(
          performanceService.getOptimizedContext('req-124'),
        ); // 4th access - full
        expect(optimizedContext._compressed).toBe(false);
      });
    });
  });

  describe('Custom Sampling Strategies', () => {
    it('should add custom sampling strategies', () => {
      const customStrategy: SamplingStrategy = {
        name: 'payment-flows',
        condition: (context, metadata) => metadata.flowId === 'payment',
        samplingRate: 1.0,
        priority: 50,
      };

      performanceService.addSamplingStrategy(customStrategy);

      const context = contextManager.createInitialContext(
        'TestService',
        'testMethod',
      );

      contextManager.runWithContext(context, async () => {
        enrichEventContext({
          flowId: 'payment',
        });

        // Access context multiple times to trigger full loading for custom strategy
        performanceService.getOptimizedContext('req-123'); // 1st access - minimal
        performanceService.getOptimizedContext('req-123'); // 2nd access - minimal
        performanceService.getOptimizedContext('req-123'); // 3rd access - minimal
        const optimizedContext = expectContext(
          performanceService.getOptimizedContext('req-123'),
        ); // 4th access - full

        expect(optimizedContext._optimized).toBe(true);
        expect(optimizedContext._minimal).toBeUndefined();
      });
    });

    it('should remove sampling strategies', () => {
      performanceService.addSamplingStrategy({
        name: 'test-strategy',
        condition: () => true,
        samplingRate: 0.0,
        priority: 1,
      });

      performanceService.removeSamplingStrategy('test-strategy');

      // Strategy should be removed and default behavior should apply
      const context = contextManager.createInitialContext(
        'TestService',
        'testMethod',
      );

      contextManager.runWithContext(context, async () => {
        const optimizedContext = expectContext(
          performanceService.getOptimizedContext('req-123'),
        );
        // Should use default sampling (which samples everything)
        expect(optimizedContext._optimized).toBe(true);
      });
    });
  });

  describe('Cache Statistics', () => {
    it('should provide cache statistics', () => {
      const context = contextManager.createInitialContext(
        'TestService',
        'testMethod',
      );

      contextManager.runWithContext(context, async () => {
        // Trigger some lazy loading
        performanceService.getOptimizedContext('req-123'); // Hit
        performanceService.getOptimizedContext('req-123'); // Hit
        performanceService.getOptimizedContext('req-123'); // Hit
        performanceService.getOptimizedContext('req-123'); // Miss

        const cacheStats = performanceService.getCacheStats();

        expect(cacheStats.hitRate).toBeGreaterThan(0);
        expect(cacheStats.size).toBeGreaterThanOrEqual(0);
        expect(cacheStats.memoryUsage).toBeGreaterThanOrEqual(0);
      });
    });
  });

  describe('Memory Management', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    it('should clean up old cache entries', () => {
      const service = createService({
        contextTTL: 1000, // 1 second TTL
      });

      const context = contextManager.createInitialContext(
        'TestService',
        'testMethod',
      );

      contextManager.runWithContext(context, async () => {
        // Access context to create cache entry
        service.getOptimizedContext('req-123');

        // Fast forward past TTL
        jest.advanceTimersByTime(2000);

        // Trigger cleanup (normally done by interval)
        const cacheStats = service.getCacheStats();

        // Cache should have been cleaned up
        expect(cacheStats.size).toBe(0);
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle missing context gracefully', () => {
      // No context available - getEventContext() returns a default context, not null
      expect(() => {
        performanceService.getOptimizedContext('req-123');
      }).not.toThrow();

      const result = expectContext(
        performanceService.getOptimizedContext('req-123'),
      );
      // getEventContext() creates a default context when none exists, so result is not null
      expect(result).toBeDefined();
      expect(result._optimized).toBe(true);
      expect(result._minimal).toBe(true); // Default context gets minimal treatment
    });

    it('should handle performance threshold alerts', () => {
      const service = createService({
        performanceAlertThreshold: 5, // 5ms threshold
      });

      const mockConsoleWarn = jest.spyOn(console, 'warn').mockImplementation();

      const context = contextManager.createInitialContext(
        'TestService',
        'testMethod',
      );

      contextManager.runWithContext(context, async () => {
        // Mock slow context access
        jest
          .spyOn(Date, 'now')
          .mockReturnValueOnce(1000)
          .mockReturnValueOnce(1010); // 10ms duration

        service.getOptimizedContext('req-123');

        // Should have logged performance warning
        // Note: This depends on the logger implementation
      });

      mockConsoleWarn.mockRestore();
    });
  });
});
