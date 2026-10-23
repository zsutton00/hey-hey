import {
  enrichEventContext,
  extractEventContextData,
  withEventContext,
  createEnhancedChildContext,
  addToServiceChain,
  trackProcessingTime,
  requireEventContextWithFallback,
  validateContextCompleteness,
  FlowContextMetadata,
} from '../context-utils';
import {
  EventContextManager,
  getEventContext,
} from '../observable-event.context';
import {
  OrganizationId,
  ProjectId,
  UserId,
  WorkflowId,
  ConversationId,
  MessageId,
} from '../../../types';

describe('Context Utils', () => {
  let contextManager: EventContextManager;

  beforeEach(() => {
    contextManager = EventContextManager.getInstance();
  });

  afterEach(() => {
    // EventContextManager doesn't have a clear method
    // Context is automatically isolated per test by async_hooks
  });

  describe('enrichEventContext', () => {
    it('should enrich existing context with metadata', async () => {
      // Create initial context
      const initialContext = contextManager.createInitialContext(
        'TestService',
        'testMethod',
      );

      await contextManager.runWithContext(initialContext, async () => {
        // Enrich with metadata
        enrichEventContext({
          flowId: 'test-flow',
          nodeId: 'test-node',
          nodeType: 'test',
          operationType: 'create',
        });

        const context = getEventContext();
        expect(context?.metadata).toEqual(
          expect.objectContaining({
            flowId: 'test-flow',
            nodeId: 'test-node',
            nodeType: 'test',
            operationType: 'create',
          }),
        );
      });
    });

    it('should initialize metadata if it does not exist', async () => {
      const initialContext = contextManager.createInitialContext(
        'TestService',
        'testMethod',
      );
      // Ensure metadata is undefined
      initialContext.metadata = undefined;

      await contextManager.runWithContext(initialContext, async () => {
        enrichEventContext({
          flowId: 'test-flow',
        });

        const context = getEventContext();
        expect(context?.metadata).toEqual({
          flowId: 'test-flow',
        });
      });
    });

    it('should handle missing context gracefully', () => {
      // No context exists
      expect(() => {
        enrichEventContext({
          flowId: 'test-flow',
        });
      }).not.toThrow();
    });

    it('should merge metadata with existing values', () => {
      const initialContext = contextManager.createInitialContext(
        'TestService',
        'testMethod',
      );

      contextManager.runWithContext(initialContext, async () => {
        // First enrichment
        enrichEventContext({
          flowId: 'test-flow',
          nodeId: 'node-1',
        });

        // Second enrichment
        enrichEventContext({
          nodeId: 'node-2',
          operationType: 'update',
        });

        const context = getEventContext();
        expect(context?.metadata).toEqual(
          expect.objectContaining({
            flowId: 'test-flow',
            nodeId: 'node-2', // Should be updated
            operationType: 'update', // Should be added
          }),
        );
      });
    });
  });

  describe('extractEventContextData', () => {
    it('should extract serializable context data', () => {
      const context = contextManager.createInitialContext(
        'TestService',
        'testMethod',
        {
          userId: 'user-123' as UserId,
          organizationId: 'org-456' as OrganizationId,
          projectId: 'proj-789' as ProjectId,
          workflowId: 'wf-101' as WorkflowId,
          conversationId: 'conv-112' as ConversationId,
          messageId: 'msg-131' as MessageId,
        },
      );

      const extractedData = extractEventContextData(context);

      expect(extractedData).toEqual({
        correlationId: context.correlationId,
        causationId: context.causationId,
        sagaId: context.sagaId,
        userId: 'user-123',
        organizationId: 'org-456',
        projectId: 'proj-789',
        workflowId: 'wf-101',
        conversationId: 'conv-112',
        messageId: 'msg-131',
        sourceService: 'TestService',
        sourceMethod: 'testMethod',
        sourceVersion: context.sourceVersion,
        userAgent: context.userAgent,
        ipAddress: context.ipAddress,
        metadata: context.metadata,
      });
    });

    it('should handle context with metadata', () => {
      const context = contextManager.createInitialContext(
        'TestService',
        'testMethod',
      );
      context.metadata = {
        flowId: 'test-flow',
        nodeId: 'test-node',
      };

      const extractedData = extractEventContextData(context);

      expect(extractedData.metadata).toEqual({
        flowId: 'test-flow',
        nodeId: 'test-node',
      });
    });

    it('should clone metadata to prevent mutations', () => {
      const context = contextManager.createInitialContext(
        'TestService',
        'testMethod',
      );
      const originalMetadata = {
        flowId: 'test-flow',
        nodeId: 'test-node',
      };
      context.metadata = originalMetadata;

      const extractedData = extractEventContextData(context);

      // Mutate extracted metadata
      if (extractedData.metadata) {
        (extractedData.metadata as any).flowId = 'modified-flow';
      }

      // Original should be unchanged
      expect(originalMetadata.flowId).toBe('test-flow');
    });
  });

  describe('addToServiceChain', () => {
    it('should add service to empty service chain', () => {
      const initialContext = contextManager.createInitialContext(
        'TestService',
        'testMethod',
      );

      contextManager.runWithContext(initialContext, async () => {
        addToServiceChain('FirstService');

        const context = getEventContext();
        expect(context?.metadata?.serviceChain).toEqual(['FirstService']);
        expect(context?.metadata?.serviceDepth).toBe(1);
      });
    });

    it('should append service to existing service chain', () => {
      const initialContext = contextManager.createInitialContext(
        'TestService',
        'testMethod',
      );

      contextManager.runWithContext(initialContext, async () => {
        addToServiceChain('FirstService');
        addToServiceChain('SecondService');
        addToServiceChain('ThirdService');

        const context = getEventContext();
        expect(context?.metadata?.serviceChain).toEqual([
          'FirstService',
          'SecondService',
          'ThirdService',
        ]);
        expect(context?.metadata?.serviceDepth).toBe(3);
      });
    });

    it('should handle missing context gracefully', () => {
      // No context exists
      expect(() => {
        addToServiceChain('TestService');
      }).not.toThrow();
    });

    it('should preserve existing metadata when adding service chain', () => {
      const initialContext = contextManager.createInitialContext(
        'TestService',
        'testMethod',
      );

      contextManager.runWithContext(initialContext, async () => {
        enrichEventContext({
          flowId: 'test-flow',
          nodeId: 'test-node',
        });

        addToServiceChain('TestService');

        const context = getEventContext();
        expect(context?.metadata).toEqual(
          expect.objectContaining({
            flowId: 'test-flow',
            nodeId: 'test-node',
            serviceChain: ['TestService'],
            serviceDepth: 1,
          }),
        );
      });
    });
  });

  describe('trackProcessingTime', () => {
    it('should track processing time and duration', () => {
      const initialContext = contextManager.createInitialContext(
        'TestService',
        'testMethod',
      );

      contextManager.runWithContext(initialContext, async () => {
        const startTime = Date.now() - 100; // 100ms ago
        trackProcessingTime('processing', startTime);

        const context = getEventContext();
        expect(context?.metadata?.processingEndTime).toBeGreaterThan(startTime);
        expect(context?.metadata?.processingDuration).toBeGreaterThanOrEqual(
          100,
        );
        expect(context?.metadata?.processingDuration).toBeLessThan(200); // Should be close to 100ms
      });
    });

    it('should handle different operation types', () => {
      const initialContext = contextManager.createInitialContext(
        'TestService',
        'testMethod',
      );

      contextManager.runWithContext(initialContext, async () => {
        const startTime = Date.now() - 50;

        trackProcessingTime('llmCall', startTime);
        trackProcessingTime('orchestration', startTime);

        const context = getEventContext();
        expect(context?.metadata?.llmCallEndTime).toBeDefined();
        expect(context?.metadata?.llmCallDuration).toBeDefined();
        expect(context?.metadata?.orchestrationEndTime).toBeDefined();
        expect(context?.metadata?.orchestrationDuration).toBeDefined();
      });
    });

    it('should handle missing context gracefully', () => {
      expect(() => {
        trackProcessingTime('processing', Date.now() - 100);
      }).not.toThrow();
    });
  });

  describe('withEventContext', () => {
    it('should wrap activity function with context reconstruction', async () => {
      const mockActivity = jest.fn().mockResolvedValue('test-result');
      const wrappedActivity = withEventContext('TestActivity', mockActivity);

      const eventContextData = {
        correlationId: 'test-correlation',
        sourceService: 'TestService',
        sourceMethod: 'testMethod',
        userId: 'user-123' as UserId,
        organizationId: 'org-456' as OrganizationId,
      };

      const result = await wrappedActivity({ eventContext: eventContextData });

      expect(result).toBe('test-result');
      expect(mockActivity).toHaveBeenCalledWith({
        eventContext: eventContextData,
      });
    });

    it('should execute without context if eventContext is missing', async () => {
      const mockActivity = jest.fn().mockResolvedValue('test-result');
      const wrappedActivity = withEventContext('TestActivity', mockActivity);

      const result = await wrappedActivity({ someData: 'test' });

      expect(result).toBe('test-result');
      expect(mockActivity).toHaveBeenCalledWith({ someData: 'test' });
    });

    it('should preserve function signature and arguments', async () => {
      const mockActivity = jest.fn().mockResolvedValue('test-result');
      const wrappedActivity = withEventContext('TestActivity', mockActivity);

      const args = [
        { eventContext: { correlationId: 'test' } },
        'second-arg',
        { third: 'arg' },
      ];

      await wrappedActivity(...args);

      expect(mockActivity).toHaveBeenCalledWith(...args);
    });

    it('should handle activity function errors', async () => {
      const mockActivity = jest
        .fn()
        .mockRejectedValue(new Error('Activity failed'));
      const wrappedActivity = withEventContext('TestActivity', mockActivity);

      await expect(
        wrappedActivity({ eventContext: { correlationId: 'test' } }),
      ).rejects.toThrow('Activity failed');
    });
  });

  describe('createEnhancedChildContext', () => {
    it('should create child context with enhanced metadata', () => {
      const parentContext = contextManager.createInitialContext(
        'ParentService',
        'parentMethod',
      );
      parentContext.metadata = {
        flowId: 'parent-flow',
        nodeId: 'parent-node',
      };

      contextManager.runWithContext(parentContext, async () => {
        const childContext = createEnhancedChildContext('parent-event-id', {
          sourceService: 'ChildService',
          sourceMethod: 'childMethod',
          metadata: {
            nodeId: 'child-node',
            operationType: 'create',
          },
        });

        expect(childContext.sourceService).toBe('ChildService');
        expect(childContext.sourceMethod).toBe('childMethod');
        expect(childContext.causationId).toBe('parent-event-id');
        expect(childContext.metadata).toEqual(
          expect.objectContaining({
            flowId: 'parent-flow', // Inherited from parent
            nodeId: 'child-node', // Overridden by child
            operationType: 'create', // Added by child
          }),
        );
      });
    });

    it('should handle missing parent context', () => {
      // No parent context
      const childContext = createEnhancedChildContext('parent-event-id', {
        sourceService: 'ChildService',
        metadata: {
          flowId: 'child-flow',
        },
      });

      expect(childContext.sourceService).toBe('ChildService');
      expect(childContext.metadata).toEqual({
        flowId: 'child-flow',
      });
    });
  });

  describe('requireEventContextWithFallback', () => {
    it('should return existing context when available', () => {
      const existingContext = contextManager.createInitialContext(
        'ExistingService',
        'existingMethod',
      );

      contextManager.runWithContext(existingContext, async () => {
        const context = requireEventContextWithFallback(
          'FallbackService',
          'fallbackMethod',
        );

        expect(context).toBe(existingContext);
        expect(context.sourceService).toBe('ExistingService');
      });
    });

    it('should create fallback context when none exists', () => {
      const context = requireEventContextWithFallback(
        'FallbackService',
        'fallbackMethod',
      );

      expect(context).toBeDefined();
      expect(context.sourceService).toBe('FallbackService');
      expect(context.sourceMethod).toBe('fallbackMethod');
      expect(context.correlationId).toBeDefined();
    });
  });

  describe('validateContextCompleteness', () => {
    it('should validate complete context', () => {
      const context = contextManager.createInitialContext(
        'TestService',
        'testMethod',
        {
          userId: 'user-123' as UserId,
          organizationId: 'org-456' as OrganizationId,
        },
      );
      context.metadata = {
        flowId: 'test-flow',
        nodeId: 'test-node',
      };

      contextManager.runWithContext(context, async () => {
        const result = validateContextCompleteness([
          'correlationId',
          'sourceService',
          'userId',
          'flowId',
          'nodeId',
        ]);

        expect(result.isValid).toBe(true);
        expect(result.missingFields).toHaveLength(0);
      });
    });

    it('should identify missing fields', () => {
      const context = contextManager.createInitialContext(
        'TestService',
        'testMethod',
      );
      context.metadata = {
        flowId: 'test-flow',
      };

      contextManager.runWithContext(context, async () => {
        const result = validateContextCompleteness([
          'correlationId',
          'userId',
          'flowId',
          'nodeId',
          'operationType',
        ]);

        expect(result.isValid).toBe(false);
        expect(result.missingFields).toEqual([
          'userId',
          'nodeId',
          'operationType',
        ]);
      });
    });

    it('should handle missing context', () => {
      const result = validateContextCompleteness(['correlationId']);

      expect(result.isValid).toBe(false);
      expect(result.missingFields).toEqual(['entire context']);
    });

    it('should validate both context and metadata fields', () => {
      const context = contextManager.createInitialContext(
        'TestService',
        'testMethod',
      );
      // No metadata

      contextManager.runWithContext(context, async () => {
        const result = validateContextCompleteness([
          'correlationId', // Context field
          'flowId', // Metadata field
        ]);

        expect(result.isValid).toBe(false);
        expect(result.missingFields).toEqual(['flowId']);
      });
    });
  });

  describe('FlowContextMetadata interface compliance', () => {
    it('should handle all metadata fields correctly', () => {
      const context = contextManager.createInitialContext(
        'TestService',
        'testMethod',
      );

      contextManager.runWithContext(context, async () => {
        const completeMetadata: FlowContextMetadata = {
          // Flow identification
          flowId: 'test-flow',
          nodeId: 'test-node',
          nodeType: 'test',
          stepIndex: 1,
          flowExecutionId: 'exec-123',
          requestId: 'req-456',

          // LLM correlation
          llmModel: 'claude-4-sonnet',
          promptVersion: 'v1.0',
          llmRequestId: 'llm-req-789',
          llmJobId: 'llm-job-101',
          promptLength: 1000,
          llmStatus: 'success',
          llmTokensUsed: 250,

          // Performance tracking
          processingStartTime: Date.now() - 1000,
          processingEndTime: Date.now(),
          llmCallStartTime: Date.now() - 800,
          llmCallEndTime: Date.now() - 200,

          // Service orchestration
          serviceChain: ['Service1', 'Service2'],
          serviceDepth: 2,
          messageId: 'msg-112',
          jobId: 'job-131',
          executionType: 'llm',
          operationType: 'create',
        };

        enrichEventContext(completeMetadata);

        const updatedContext = getEventContext();
        expect(updatedContext?.metadata).toEqual(
          expect.objectContaining(completeMetadata),
        );
      });
    });
  });

  describe('Performance and memory considerations', () => {
    it('should handle large metadata objects', () => {
      const context = contextManager.createInitialContext(
        'TestService',
        'testMethod',
      );

      contextManager.runWithContext(context, async () => {
        const largeMetadata: Partial<FlowContextMetadata> = {
          serviceChain: Array.from({ length: 100 }, (_, i) => `Service${i}`),
          flowPath: Array.from({ length: 50 }, (_, i) => `node-${i}`),
          decisionPoints: Array.from({ length: 20 }, (_, i) => `decision-${i}`),
        };

        expect(() => {
          enrichEventContext(largeMetadata);
        }).not.toThrow();

        const updatedContext = getEventContext();
        expect(updatedContext?.metadata?.serviceChain).toHaveLength(100);
      });
    });

    it('should handle rapid successive enrichments', () => {
      const context = contextManager.createInitialContext(
        'TestService',
        'testMethod',
      );

      contextManager.runWithContext(context, async () => {
        // Rapid successive enrichments
        for (let i = 0; i < 100; i++) {
          enrichEventContext({
            stepIndex: i,
            processingStartTime: Date.now(),
          });
        }

        const updatedContext = getEventContext();
        expect(updatedContext?.metadata?.stepIndex).toBe(99);
      });
    });
  });
});
