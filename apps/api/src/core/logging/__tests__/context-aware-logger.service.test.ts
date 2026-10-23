import { Logger } from '@nestjs/common';
import {
  ContextAwareLogger,
  ContextAwareLoggerConfig,
} from '../context-aware-logger.service';
import {
  EventContextManager,
  getEventContext,
} from '../../events/observable-event.context';
import { enrichEventContext } from '../../events/context-utils';
import {
  OrganizationId,
  ProjectId,
  UserId,
  WorkflowId,
  ConversationId,
  MessageId,
} from '../../../types';

// Mock NestJS Logger
jest.mock('@nestjs/common', () => ({
  ...jest.requireActual('@nestjs/common'),
  Logger: jest.fn().mockImplementation(() => ({
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    verbose: jest.fn(),
    fatal: jest.fn(),
  })),
}));

const getFirstLoggedMessage = (mockFn: {
  mock: { calls: unknown[][] };
}): string => {
  const [call] = mockFn.mock.calls;
  if (!call) {
    throw new Error('Expected logger to be called');
  }
  const [message] = call;
  if (typeof message !== 'string') {
    throw new Error('Expected logger message to be a string');
  }
  return message;
};

describe('ContextAwareLogger', () => {
  let contextManager: EventContextManager;
  let mockLogger: jest.Mocked<Logger>;
  let contextAwareLogger: ContextAwareLogger;

  beforeEach(() => {
    contextManager = EventContextManager.getInstance();
    contextManager.clear();

    mockLogger = new Logger() as jest.Mocked<Logger>;
    contextAwareLogger = new ContextAwareLogger('TestService');

    // Replace internal logger with mock
    (contextAwareLogger as any).logger = mockLogger;
  });

  afterEach(() => {
    contextManager.clear();
    jest.clearAllMocks();
  });

  describe('Basic Logging', () => {
    it('should log with default context when no context available', () => {
      contextAwareLogger.log('Test message');

      const logged = getFirstLoggedMessage(mockLogger.log);
      expect(logged).toContain('[CTX]');
      expect(logged).toContain('Test message');
    });

    it('should include context in log message when context is available', () => {
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
        });

        contextAwareLogger.log('Test message');

        const loggedMessage = getFirstLoggedMessage(mockLogger.log);
        expect(loggedMessage).toContain('[CTX]');
        expect(loggedMessage).toContain('"workflowId": "wf-123"');
        expect(loggedMessage).toContain('"conversationId": "conv-456"');
        expect(loggedMessage).toContain('"flowId": "test-flow"');
        expect(loggedMessage).toContain('Test message');
      });
    });

    it('should handle all log levels with context', () => {
      const context = contextManager.createInitialContext(
        'TestService',
        'testMethod',
        { workflowId: 'wf-123' as WorkflowId },
      );

      contextManager.runWithContext(context, async () => {
        contextAwareLogger.log('Info message');
        contextAwareLogger.error('Error message');
        contextAwareLogger.warn('Warning message');
        contextAwareLogger.debug('Debug message');
        contextAwareLogger.verbose('Verbose message');
        contextAwareLogger.fatal('Fatal message');

        expect(mockLogger.log).toHaveBeenCalledWith(
          expect.stringContaining('"workflowId": "wf-123"'),
        );
        expect(mockLogger.error).toHaveBeenCalledWith(
          expect.stringContaining('"workflowId": "wf-123"'),
        );
        expect(mockLogger.warn).toHaveBeenCalledWith(
          expect.stringContaining('"workflowId": "wf-123"'),
        );
        expect(mockLogger.debug).toHaveBeenCalledWith(
          expect.stringContaining('"workflowId": "wf-123"'),
        );
        expect(mockLogger.verbose).toHaveBeenCalledWith(
          expect.stringContaining('"workflowId": "wf-123"'),
        );
        expect(mockLogger.fatal).toHaveBeenCalledWith(
          expect.stringContaining('"workflowId": "wf-123"'),
        );
      });
    });
  });

  describe('Configuration', () => {
    it('should respect custom configuration', () => {
      const config: Partial<ContextAwareLoggerConfig> = {
        includeWorkflowId: false,
        includeConversationId: false,
        includeFlowId: true,
        contextPrefix: '[CUSTOM]',
        contextSeparator: ' → ',
      };

      const customLogger = new ContextAwareLogger('TestService', config);
      (customLogger as any).logger = mockLogger;

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
        });

        customLogger.log('Test message');

        const logCall = getFirstLoggedMessage(mockLogger.log);
        expect(logCall).toContain('[CUSTOM]');
        expect(logCall).toContain('"flowId": "test-flow"');
        expect(logCall).not.toContain('"workflowId"');
        expect(logCall).not.toContain('"conversationId"');
      });
    });

    it('should allow runtime configuration updates', () => {
      contextAwareLogger.updateConfig({
        includeServiceChain: true,
        contextSeparator: ' • ',
      });

      const context = contextManager.createInitialContext(
        'TestService',
        'testMethod',
      );

      contextManager.runWithContext(context, async () => {
        enrichEventContext({
          serviceChain: ['Service1', 'Service2'],
        });

        contextAwareLogger.log('Test message');

        const logCall = getFirstLoggedMessage(mockLogger.log);
        expect(logCall).toContain('"serviceChain": "Service1→Service2"');
      });
    });
  });

  describe('Context Sampling', () => {
    it('should respect sampling configuration', () => {
      const sampledLogger = new ContextAwareLogger('TestService', {
        enableSampling: true,
        samplingRate: 0.0, // Never sample
      });
      (sampledLogger as any).logger = mockLogger;

      const context = contextManager.createInitialContext(
        'TestService',
        'testMethod',
        { workflowId: 'wf-123' as WorkflowId },
      );

      contextManager.runWithContext(context, async () => {
        sampledLogger.log('Test message');

        // Should not include context due to 0% sampling
        expect(mockLogger.log).toHaveBeenCalledWith('Test message');
        expect(mockLogger.log).not.toHaveBeenCalledWith(
          expect.stringContaining('[CTX]'),
        );
      });
    });

    it('should always include context when sampling is disabled', () => {
      const nonsampledLogger = new ContextAwareLogger('TestService', {
        enableSampling: false,
      });
      (nonsampledLogger as any).logger = mockLogger;

      const context = contextManager.createInitialContext(
        'TestService',
        'testMethod',
        { workflowId: 'wf-123' as WorkflowId },
      );

      contextManager.runWithContext(context, async () => {
        nonsampledLogger.log('Test message');

        expect(mockLogger.log).toHaveBeenCalledWith(
          expect.stringContaining('[CTX]'),
        );
      });
    });
  });

  describe('Context Truncation', () => {
    it('should truncate long context strings', () => {
      const shortContextLogger = new ContextAwareLogger('TestService', {
        maxContextLength: 50,
      });
      (shortContextLogger as any).logger = mockLogger;

      const context = contextManager.createInitialContext(
        'TestService',
        'testMethod',
        {
          workflowId: 'very-long-workflow-id-that-exceeds-limits' as WorkflowId,
          conversationId:
            'very-long-conversation-id-that-also-exceeds-limits' as ConversationId,
        },
      );

      contextManager.runWithContext(context, async () => {
        enrichEventContext({
          flowId: 'very-long-flow-id-that-should-be-truncated',
          nodeId: 'very-long-node-id-that-should-also-be-truncated',
        });

        shortContextLogger.log('Test message');

        const logCall = getFirstLoggedMessage(mockLogger.log);
        expect(logCall).toContain('...');
        expect(logCall.length).toBeLessThan(100); // Should be truncated
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle context formatting errors gracefully', () => {
      const context = contextManager.createInitialContext(
        'TestService',
        'testMethod',
      );

      // Create metadata object with property that throws when accessed
      const problematicMetadata = {};
      Object.defineProperty(problematicMetadata, 'flowId', {
        get() {
          throw new Error('Property access error');
        },
      });
      context.metadata = problematicMetadata;

      contextManager.runWithContext(context, async () => {
        expect(() => {
          contextAwareLogger.log('Test message');
        }).not.toThrow();

        // Should fallback to error indicator
        expect(mockLogger.log).toHaveBeenCalledWith(
          expect.stringContaining('"contextError": "context_format_failed"'),
        );
      });
    });

    it('should handle missing context fields gracefully', () => {
      const context = contextManager.createInitialContext(
        'TestService',
        'testMethod',
      );
      context.metadata = {
        // Some fields undefined
        flowId: undefined,
        nodeId: 'test-node',
      };

      contextManager.runWithContext(context, async () => {
        expect(() => {
          contextAwareLogger.log('Test message');
        }).not.toThrow();

        expect(mockLogger.log).toHaveBeenCalledWith(
          expect.stringContaining('"nodeId": "test-node"'),
        );
      });
    });
  });

  describe('Performance Metadata', () => {
    it('should include performance metadata when configured', () => {
      const perfLogger = new ContextAwareLogger('TestService', {
        includeProcessingTime: true,
        includeLLMMetadata: true,
      });
      (perfLogger as any).logger = mockLogger;

      const context = contextManager.createInitialContext(
        'TestService',
        'testMethod',
      );

      contextManager.runWithContext(context, async () => {
        enrichEventContext({
          processingStartTime: Date.now() - 100,
          llmModel: 'claude-4-sonnet',
          llmTokensUsed: 250,
        });

        perfLogger.log('Test message');

        const logCall = getFirstLoggedMessage(mockLogger.log);
        expect(logCall).toContain('"processingDurationMs"');
        expect(logCall).toContain('"llmModel": "claude-4-sonnet"');
        expect(logCall).toContain('"llmTokensUsed": "250"');
      });
    });

    it('should handle service chain display', () => {
      const chainLogger = new ContextAwareLogger('TestService', {
        includeServiceChain: true,
      });
      (chainLogger as any).logger = mockLogger;

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
          ],
        });

        chainLogger.log('Test message');

        const logCall = getFirstLoggedMessage(mockLogger.log);
        expect(logCall).toContain(
          '"serviceChain": "Service3→Service4→Service5"',
        );
      });
    });
  });

  describe('Static Factory Methods', () => {
    it('should create service logger with appropriate config', () => {
      const serviceLogger = ContextAwareLogger.createServiceLogger('MyService');
      expect(serviceLogger).toBeInstanceOf(ContextAwareLogger);
      expect(serviceLogger.getContext()).toBe('MyService');
    });

    it('should create performance logger with performance-focused config', () => {
      const perfLogger =
        ContextAwareLogger.createPerformanceLogger('PerfService');
      expect(perfLogger).toBeInstanceOf(ContextAwareLogger);

      // Should have sampling enabled
      const config = (perfLogger as any).config;
      expect(config.enableSampling).toBe(true);
      expect(config.includeProcessingTime).toBe(true);
      expect(config.includeLLMMetadata).toBe(true);
    });

    it('should create debug logger with comprehensive config', () => {
      const debugLogger = ContextAwareLogger.createDebugLogger('DebugService');
      expect(debugLogger).toBeInstanceOf(ContextAwareLogger);

      const config = (debugLogger as any).config;
      expect(config.includeServiceChain).toBe(true);
      expect(config.maxContextLength).toBe(500);
    });
  });

  describe('Child Logger Creation', () => {
    it('should create child logger with same configuration', () => {
      const parentLogger = new ContextAwareLogger('ParentService', {
        includeServiceChain: true,
        contextSeparator: ' → ',
      });

      const childLogger = parentLogger.createChildLogger('ChildService');

      expect(childLogger).toBeInstanceOf(ContextAwareLogger);
      expect(childLogger.getContext()).toBe('ChildService');

      // Should inherit parent configuration
      const childConfig = (childLogger as any).config;
      expect(childConfig.includeServiceChain).toBe(true);
      expect(childConfig.contextSeparator).toBe(' → ');
    });
  });

  describe('Object Message Handling', () => {
    it('should stringify object messages', () => {
      const context = contextManager.createInitialContext(
        'TestService',
        'testMethod',
        { workflowId: 'wf-123' as WorkflowId },
      );

      contextManager.runWithContext(context, async () => {
        const objectMessage = {
          action: 'test',
          data: { id: 123, name: 'test' },
        };

        contextAwareLogger.log(objectMessage);

        expect(mockLogger.log).toHaveBeenCalledWith(
          expect.stringContaining(
            '{"action":"test","data":{"id":123,"name":"test"}}',
          ),
        );
      });
    });
  });

  describe('Context Field Truncation', () => {
    it('should truncate correlation IDs to last 8 characters', () => {
      const context = contextManager.createInitialContext(
        'TestService',
        'testMethod',
      );
      // Set a long correlation ID
      context.correlationId =
        'very-long-correlation-id-that-should-be-truncated';

      contextManager.runWithContext(context, async () => {
        const logger = new ContextAwareLogger('TestService', {
          includeCorrelationId: true,
        });
        (logger as any).logger = mockLogger;

        logger.log('Test message');

        const logCall = getFirstLoggedMessage(mockLogger.log);
        expect(logCall).toContain(
          '"correlationId": "very-long-correlation-id-that-should-be-truncated"',
        );
      });
    });
  });

  describe('Integration with Real Context', () => {
    it('should work with complete context metadata', () => {
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

      contextManager.runWithContext(context, async () => {
        enrichEventContext({
          flowId: 'onboarding',
          nodeId: 'welcome_node',
          nodeType: 'opener',
          operationType: 'create',
          executionType: 'llm',
          serviceChain: ['Controller', 'FlowEngine', 'LLMClient'],
          processingStartTime: Date.now() - 150,
          llmModel: 'claude-4-sonnet',
          llmTokensUsed: 425,
        });

        contextAwareLogger.log('Processing complete');

        const logCall = getFirstLoggedMessage(mockLogger.log);
        expect(logCall).toContain('[CTX]');
        expect(logCall).toContain('"workflowId": "wf-101"');
        expect(logCall).toContain('"conversationId": "conv-112"');
        expect(logCall).toContain('"messageId": "msg-131"');
        expect(logCall).toContain('"flowId": "onboarding"');
        expect(logCall).toContain('Processing complete');
      });
    });
  });
});
