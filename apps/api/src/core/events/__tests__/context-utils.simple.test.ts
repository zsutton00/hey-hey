import {
  enrichEventContext,
  extractEventContextData,
  withEventContext,
  addToServiceChain,
  trackProcessingTime,
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

describe('Context Utils - Simple Tests', () => {
  let contextManager: EventContextManager;

  beforeEach(() => {
    contextManager = EventContextManager.getInstance();
  });

  describe('enrichEventContext', () => {
    it('should enrich existing context with metadata', async () => {
      const initialContext = contextManager.createInitialContext(
        'TestService',
        'testMethod',
      );

      await contextManager.runWithContext(initialContext, async () => {
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

    it('should handle missing context gracefully', () => {
      expect(() => {
        enrichEventContext({
          flowId: 'test-flow',
        });
      }).not.toThrow();
    });
  });

  describe('addToServiceChain', () => {
    it('should add service to empty service chain', async () => {
      const initialContext = contextManager.createInitialContext(
        'TestService',
        'testMethod',
      );
      // Initialize metadata
      initialContext.metadata = {};

      await contextManager.runWithContext(initialContext, async () => {
        addToServiceChain('FirstService');

        const context = getEventContext();
        expect(context?.metadata?.serviceChain).toEqual(['FirstService']);
        expect(context?.metadata?.serviceDepth).toBe(1);
      });
    });

    it('should append service to existing service chain', async () => {
      const initialContext = contextManager.createInitialContext(
        'TestService',
        'testMethod',
      );
      // Initialize metadata
      initialContext.metadata = {};

      await contextManager.runWithContext(initialContext, async () => {
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
  });

  describe('trackProcessingTime', () => {
    it('should track processing time and duration', async () => {
      const initialContext = contextManager.createInitialContext(
        'TestService',
        'testMethod',
      );

      await contextManager.runWithContext(initialContext, async () => {
        const startTime = Date.now() - 100; // 100ms ago
        trackProcessingTime('processing', startTime);

        const context = getEventContext();
        expect(context?.metadata?.processingEndTime).toBeGreaterThan(startTime);
        expect(context?.metadata?.processingDuration).toBeGreaterThanOrEqual(
          100,
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
  });

  describe('validateContextCompleteness', () => {
    it('should validate complete context', async () => {
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

      await contextManager.runWithContext(context, async () => {
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

    it('should identify missing fields', async () => {
      const context = contextManager.createInitialContext(
        'TestService',
        'testMethod',
      );
      context.metadata = {
        flowId: 'test-flow',
      };

      await contextManager.runWithContext(context, async () => {
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
      // This test runs outside of any context
      const result = validateContextCompleteness(['userId', 'operationType']);

      expect(result.isValid).toBe(false);
      // When entire context is missing, should return 'entire context'
      expect(result.missingFields).toEqual(['entire context']);
    });
  });

  describe('Integration scenarios', () => {
    it('should handle complete metadata enrichment flow', async () => {
      const context = contextManager.createInitialContext(
        'TestService',
        'testMethod',
        {
          userId: 'user-123' as UserId,
          workflowId: 'wf-456' as WorkflowId,
        },
      );

      await contextManager.runWithContext(context, async () => {
        // Step 1: Initial enrichment
        enrichEventContext({
          flowId: 'test-flow',
          nodeId: 'test-node',
          nodeType: 'opener',
        });

        // Step 2: Add to service chain
        addToServiceChain('TestService');

        // Step 3: Track processing time
        const startTime = Date.now() - 50;
        trackProcessingTime('processing', startTime);

        // Step 4: Additional enrichment
        enrichEventContext({
          operationType: 'create',
          executionType: 'llm',
          llmModel: 'claude-4-sonnet',
        });

        // Verify all metadata is present
        const finalContext = getEventContext();
        expect(finalContext?.metadata).toEqual(
          expect.objectContaining({
            flowId: 'test-flow',
            nodeId: 'test-node',
            nodeType: 'opener',
            operationType: 'create',
            executionType: 'llm',
            llmModel: 'claude-4-sonnet',
            serviceChain: ['TestService'],
            serviceDepth: 1,
            processingEndTime: expect.any(Number),
            processingDuration: expect.any(Number),
          }),
        );

        // Verify context extraction
        const extractedData = extractEventContextData(finalContext);
        expect(extractedData.userId).toBe('user-123');
        expect(extractedData.workflowId).toBe('wf-456');
        expect(extractedData.metadata).toEqual(finalContext?.metadata);
      });
    });
  });
});
