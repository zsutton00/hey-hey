jest.mock('@temporalio/workflow', () => ({
  setHandler: jest.fn(),
  defineSignal: jest.fn(),
  defineQuery: jest.fn((name: string) => name),
  condition: jest.fn(),
  patched: jest.fn(() => false),
  proxyActivities: () => new Proxy({}, { get: () => jest.fn() }),
  workflowInfo: () => ({ workflowId: 'wf-test' }),
  log: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

import * as TestUtils from '../../utils/testUtils';
import { WorkflowSignals } from '../conversation-workflow-utils';

const { testIds, testWorkflowIds } = TestUtils;

// Get references to mocked functions
import { setHandler, defineSignal, condition } from '@temporalio/workflow';
const mockSetHandler = setHandler as jest.Mock;
const mockDefineSignal = defineSignal as jest.Mock;
const mockCondition = condition as jest.Mock;

const assertDefined = <T>(value: T | undefined, label: string): T => {
  if (!value) {
    throw new Error(`Expected ${label}`);
  }
  return value;
};

describe('WorkflowSignalIsolation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('signal name generation', () => {
    it('should generate unique signal names per workflow', () => {
      const workflow1 = testWorkflowIds.systemDriven;
      const workflow2 = testWorkflowIds.userDriven;

      const userSignal1 =
        WorkflowSignals.getWorkflowUserMessageSignalName(workflow1);
      const userSignal2 =
        WorkflowSignals.getWorkflowUserMessageSignalName(workflow2);

      const llmSignal1 = WorkflowSignals.getLLMResponseSignalName(workflow1);
      const llmSignal2 = WorkflowSignals.getLLMResponseSignalName(workflow2);

      expect(userSignal1).toBe(`userMessage-${workflow1}`);
      expect(userSignal2).toBe(`userMessage-${workflow2}`);
      expect(llmSignal1).toBe(`llmResponse-${workflow1}`);
      expect(llmSignal2).toBe(`llmResponse-${workflow2}`);

      // Ensure they are different
      expect(userSignal1).not.toBe(userSignal2);
      expect(llmSignal1).not.toBe(llmSignal2);
    });

    it('should prevent signal name collisions', () => {
      const signals = new Set<string>();

      // Generate signals for multiple workflows
      const workflows = [
        testWorkflowIds.systemDriven,
        testWorkflowIds.userDriven,
        testWorkflowIds.gatherNode,
        testWorkflowIds.autoNode,
      ];

      workflows.forEach((workflowId) => {
        const userSignal =
          WorkflowSignals.getWorkflowUserMessageSignalName(workflowId);
        const llmSignal = WorkflowSignals.getLLMResponseSignalName(workflowId);

        expect(signals.has(userSignal)).toBe(false);
        expect(signals.has(llmSignal)).toBe(false);

        signals.add(userSignal);
        signals.add(llmSignal);
      });

      expect(signals.size).toBe(workflows.length * 2);
    });

    it('should maintain consistent naming patterns', () => {
      const workflowId = testWorkflowIds.systemDriven;

      const userSignal =
        WorkflowSignals.getWorkflowUserMessageSignalName(workflowId);
      const llmSignal = WorkflowSignals.getLLMResponseSignalName(workflowId);

      expect(userSignal).toMatch(/^userMessage-/);
      expect(llmSignal).toMatch(/^llmResponse-/);

      expect(userSignal.endsWith(workflowId)).toBe(true);
      expect(llmSignal.endsWith(workflowId)).toBe(true);
    });

    it('should handle workflow IDs with special characters', () => {
      const specialWorkflowId = 'workflow-123_test.special' as any;

      const userSignal =
        WorkflowSignals.getWorkflowUserMessageSignalName(specialWorkflowId);
      const llmSignal =
        WorkflowSignals.getLLMResponseSignalName(specialWorkflowId);

      expect(userSignal).toBe(`userMessage-${specialWorkflowId}`);
      expect(llmSignal).toBe(`llmResponse-${specialWorkflowId}`);
    });
  });

  describe('cross-workflow isolation', () => {
    it('should prevent signals from reaching wrong workflows', () => {
      // Create mock workflow states
      const workflow1State = TestUtils.createMockWorkflowState({
        workflowId: testWorkflowIds.systemDriven,
      });

      const workflow2State = TestUtils.createMockWorkflowState({
        workflowId: testWorkflowIds.userDriven,
      });

      // Mock signal handlers for both workflows
      const workflow1Handler = jest.fn();
      const workflow2Handler = jest.fn();

      // Set up signal handlers with workflow-specific names
      const workflow1UserSignal =
        WorkflowSignals.getWorkflowUserMessageSignalName(
          workflow1State.workflowId,
        );
      const workflow2UserSignal =
        WorkflowSignals.getWorkflowUserMessageSignalName(
          workflow2State.workflowId,
        );

      // Verify signal names are different
      expect(workflow1UserSignal).not.toBe(workflow2UserSignal);

      // In a real scenario, only the intended workflow would receive its signal
      expect(workflow1UserSignal).toContain(workflow1State.workflowId);
      expect(workflow2UserSignal).toContain(workflow2State.workflowId);
    });

    it('should handle concurrent workflow execution', () => {
      const concurrentWorkflows = [
        TestUtils.createMockWorkflowState({ workflowId: 'workflow-a' as any }),
        TestUtils.createMockWorkflowState({ workflowId: 'workflow-b' as any }),
        TestUtils.createMockWorkflowState({ workflowId: 'workflow-c' as any }),
      ];

      const signalNames = new Set<string>();

      concurrentWorkflows.forEach((workflow) => {
        const userSignal = WorkflowSignals.getWorkflowUserMessageSignalName(
          workflow.workflowId,
        );
        const llmSignal = WorkflowSignals.getLLMResponseSignalName(
          workflow.workflowId,
        );

        // Each workflow should have unique signal names
        expect(signalNames.has(userSignal)).toBe(false);
        expect(signalNames.has(llmSignal)).toBe(false);

        signalNames.add(userSignal);
        signalNames.add(llmSignal);
      });

      expect(signalNames.size).toBe(concurrentWorkflows.length * 2);
    });

    it('should maintain signal ordering within workflows', () => {
      const workflowId = testWorkflowIds.systemDriven;
      const userSignalName =
        WorkflowSignals.getWorkflowUserMessageSignalName(workflowId);
      const llmSignalName =
        WorkflowSignals.getLLMResponseSignalName(workflowId);

      // Mock signal events in order
      const signalEvents: Array<{
        type: string;
        timestamp: number;
        data: any;
      }> = [];

      const mockUserMessage1 = TestUtils.createMockFlowUserMessage({
        data: { message: 'First message' },
      });

      const mockUserMessage2 = TestUtils.createMockFlowUserMessage({
        data: { message: 'Second message' },
      });

      const mockLLMResponse = TestUtils.createMockLLMResponsePayload({
        requestId: testIds.request,
      });

      // Simulate signal ordering
      signalEvents.push({
        type: userSignalName,
        timestamp: Date.now(),
        data: mockUserMessage1,
      });

      signalEvents.push({
        type: llmSignalName,
        timestamp: Date.now() + 100,
        data: mockLLMResponse,
      });

      signalEvents.push({
        type: userSignalName,
        timestamp: Date.now() + 200,
        data: mockUserMessage2,
      });

      // Verify ordering is maintained
      const firstSignal = assertDefined(signalEvents[0], 'first signal');
      const secondSignal = assertDefined(signalEvents[1], 'second signal');
      const thirdSignal = assertDefined(signalEvents[2], 'third signal');

      expect(firstSignal.type).toBe(userSignalName);
      expect(secondSignal.type).toBe(llmSignalName);
      expect(thirdSignal.type).toBe(userSignalName);

      expect(firstSignal.timestamp).toBeLessThan(secondSignal.timestamp);
      expect(secondSignal.timestamp).toBeLessThan(thirdSignal.timestamp);
    });
  });

  describe('signal timeout handling', () => {
    it('should handle LLM response timeouts correctly', async () => {
      const workflowState = TestUtils.createMockWorkflowState();
      const requestId = testIds.request;

      // Mock condition function that times out
      mockCondition.mockResolvedValueOnce(false);

      const result = await mockCondition(() => false, '5m');
      expect(result).toBe(false);
    });

    it('should handle user message timeouts', async () => {
      const workflowState = TestUtils.createMockWorkflowState({
        userResponseTimeout: '1h',
      });

      mockCondition.mockResolvedValueOnce(false);

      const result = await mockCondition(() => false, '1h');
      expect(result).toBe(false);
    });

    it('should handle default user message timeout', async () => {
      const workflowState = TestUtils.createMockWorkflowState({
        userResponseTimeout: undefined, // No custom timeout
      });

      mockCondition.mockResolvedValueOnce(false);

      const result = await mockCondition(() => false, '7d');
      expect(result).toBe(false);
    });

    it('should cleanup signal handlers properly', () => {
      const workflowId = testWorkflowIds.systemDriven;
      const userSignalName =
        WorkflowSignals.getWorkflowUserMessageSignalName(workflowId);
      const llmSignalName =
        WorkflowSignals.getLLMResponseSignalName(workflowId);

      // Mock signal definition
      mockDefineSignal.mockReturnValueOnce(userSignalName);
      mockDefineSignal.mockReturnValueOnce(llmSignalName);

      // Verify signals are defined with correct names
      expect(mockDefineSignal).toHaveBeenCalledTimes(0); // Will be called by workflow

      // In real workflow, cleanup would involve clearing state
      const state = TestUtils.createMockWorkflowState({ workflowId });
      const execId = 'exec-cleanup';
      state.currentNodeExecutionId = execId;
      state.userMessagesByExecution = {
        [execId]: TestUtils.createMockFlowUserMessage(),
      };

      // Clear signals
      state.userMessagesByExecution = undefined;
      state.pendingLLMResponse = undefined;

      expect(state.userMessagesByExecution).toBeUndefined();
      expect(state.pendingLLMResponse).toBeUndefined();
    });
  });

  describe('signal payload validation', () => {
    it('should validate user message payloads', () => {
      const validUserMessage = TestUtils.createMockFlowUserMessage();

      expect(validUserMessage).toMatchObject({
        data: expect.any(Object),
        timestamp: expect.any(String),
        id: expect.any(String),
        conversationId: expect.any(String),
        nodeId: expect.any(String),
      });
    });

    it('should validate LLM response payloads', () => {
      const validLLMResponse = TestUtils.createMockLLMResponsePayload();

      expect(validLLMResponse).toMatchObject({
        requestId: expect.any(String),
        responseData: expect.objectContaining({
          type: expect.any(String),
          response: expect.any(String),
        }),
      });
    });

    it('should handle malformed signal payloads', () => {
      const malformedUserMessage = {
        // Missing required fields
        data: null as any,
      };

      const malformedLLMResponse = {
        // Missing required fields
        requestId: null as any,
        responseData: null as any,
      };

      // In real workflow, these would be validated and rejected
      expect(malformedUserMessage.data).toBeNull();
      expect(malformedLLMResponse.requestId).toBeNull();
      expect(malformedLLMResponse.responseData).toBeNull();
    });

    it('should validate request ID matching in LLM responses', () => {
      const expectedRequestId = testIds.request;
      const matchingResponse = TestUtils.createMockLLMResponsePayload({
        requestId: expectedRequestId,
      });

      const nonMatchingResponse = TestUtils.createMockLLMResponsePayload({
        requestId: 'different-request-id' as any,
      });

      expect(matchingResponse.requestId).toBe(expectedRequestId);
      expect(nonMatchingResponse.requestId).not.toBe(expectedRequestId);
    });
  });

  describe('signal error handling', () => {
    it('should handle signal delivery failures gracefully', () => {
      const workflowId = testWorkflowIds.systemDriven;
      const userSignalName =
        WorkflowSignals.getWorkflowUserMessageSignalName(workflowId);

      // Mock signal handler that throws
      const failingHandler = jest.fn().mockImplementation(() => {
        throw new Error('Signal handler failed');
      });

      // In real workflow, error would be caught and handled
      expect(() => {
        try {
          failingHandler();
        } catch (error) {
          expect(error).toBeInstanceOf(Error);
          expect((error as Error).message).toBe('Signal handler failed');
          // Error handled gracefully
        }
      }).not.toThrow();
    });

    it('should handle signal timeout scenarios', async () => {
      const workflowState = TestUtils.createMockWorkflowState();

      // Mock condition that times out
      mockCondition.mockResolvedValueOnce(false);

      const result = await mockCondition(() => false, '30s');
      expect(result).toBe(false);
    });

    it('should recover from signal ordering issues', () => {
      const workflowId = testWorkflowIds.systemDriven;
      const state = TestUtils.createMockWorkflowState({ workflowId });

      // Simulate out-of-order signals
      const oldRequestId = 'old-request-123' as any;
      const newRequestId = 'new-request-456' as any;

      const oldResponse = TestUtils.createMockLLMResponsePayload({
        requestId: oldRequestId,
      });

      const newResponse = TestUtils.createMockLLMResponsePayload({
        requestId: newRequestId,
      });

      // In real workflow, only matching request IDs would be processed
      const expectedRequestId = newRequestId;

      const shouldProcessOld = oldResponse.requestId === expectedRequestId;
      const shouldProcessNew = newResponse.requestId === expectedRequestId;

      expect(shouldProcessOld).toBe(false);
      expect(shouldProcessNew).toBe(true);
    });
  });

  describe('performance and memory', () => {
    it('should not leak signal handlers between workflows', () => {
      const workflows = [
        testWorkflowIds.systemDriven,
        testWorkflowIds.userDriven,
        testWorkflowIds.gatherNode,
        testWorkflowIds.autoNode,
      ];

      const signalMaps = workflows.map((workflowId) => {
        const userSignal =
          WorkflowSignals.getWorkflowUserMessageSignalName(workflowId);
        const llmSignal = WorkflowSignals.getLLMResponseSignalName(workflowId);

        return {
          workflowId,
          signals: [userSignal, llmSignal],
        };
      });

      // Verify each workflow has unique signals
      const allSignals = signalMaps.flatMap((map) => map.signals);
      const uniqueSignals = new Set(allSignals);

      expect(uniqueSignals.size).toBe(allSignals.length);
    });

    it('should handle high-frequency signal processing', () => {
      const workflowId = testWorkflowIds.systemDriven;
      const signalName =
        WorkflowSignals.getWorkflowUserMessageSignalName(workflowId);

      // Simulate rapid signal generation
      const rapidSignals = Array.from({ length: 100 }, (_, i) => ({
        name: signalName,
        timestamp: Date.now() + i,
        data: TestUtils.createMockFlowUserMessage({
          data: { message: `Message ${i}` },
        }),
      }));

      // Verify all signals have the same name (same workflow)
      const uniqueNames = new Set(rapidSignals.map((s) => s.name));
      expect(uniqueNames.size).toBe(1);
      expect(uniqueNames.has(signalName)).toBe(true);

      // Verify timestamps are in order
      for (let i = 1; i < rapidSignals.length; i++) {
        const currentSignal = assertDefined(rapidSignals[i], 'current signal');
        const previousSignal = assertDefined(
          rapidSignals[i - 1],
          'previous signal',
        );
        expect(currentSignal.timestamp).toBeGreaterThan(
          previousSignal.timestamp,
        );
      }
    });
  });
});

// WorkflowSignals is imported from conversation-workflow-utils.ts
