import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import {
  conversationFlowWorkflow,
  StartConversationFlowWorkflowInput,
} from '../conversation-flow.workflow';
import {
  ConversationId,
  OrganizationId,
  ProjectId,
  RequestId,
  UserId,
  WorkflowId,
} from '../../types';
import { WorkflowSignals } from '../../utils/workflow-signals.util';
import {
  GenerationSystemMessageData,
  QuestionsSystemMessageData,
  SystemMessageData,
  SystemMessageResponseType,
} from '../../generated';
import * as TestUtils from '../../utils/testUtils';

const { testIds } = TestUtils;

// Mock activities for queue-based execution - completely isolated from real services
const createMockActivities = () => ({
  initializeConversationFlow: jest.fn(),
  executeFlowNode: jest.fn(),
  applyContextTransform: jest.fn(),
  createSystemMessage: jest.fn(),
  processUserMessage: jest.fn(),
  saveFlowState: jest.fn(),
  completeFlow: jest.fn(),
});

/**
 * @group long-running
 * Long-running Temporal workflow tests that should be run separately from the main test suite
 */
describe.skip('Conversation Flow Workflow - Queue-based Execution', () => {
  let testEnv: TestWorkflowEnvironment;

  beforeEach(async () => {
    // Use time-skipping test environment instead of createLocal
    // This avoids real network connections and Redis requirements
    testEnv = await TestWorkflowEnvironment.createTimeSkipping();
  }, 30000);

  afterEach(async () => {
    if (testEnv) {
      try {
        await testEnv.teardown();
      } catch (error) {
        // Ignore teardown errors in tests
        console.warn('Test teardown warning:', (error as Error).message);
      }
    }
  }, 15000);

  describe('queue-based node execution', () => {
    it('should handle queued execution with LLM response signals', async () => {
      console.log('🧪 [TEST] Starting queued execution test');
      const mockActivities = createMockActivities();
      const testWorkflowId = 'wf-queue-' + Date.now();
      const taskQueue = 'test-queue-' + Date.now();
      console.log('🧪 [TEST] Created test workflow ID:', testWorkflowId);

      const mockContext = TestUtils.createMockFlowContext({
        core: {
          workflowId: testWorkflowId as WorkflowId,
          projectId: testIds.project,
          organizationId: testIds.organization,
          conversationId: testIds.conversation,
          workflowAboutId: 'test-about-id',
          workflowAboutType: 'project',
          user: { id: testIds.user, role: 'member' },
          session: { startTime: new Date(), interactionCount: 0 },
        },
        flowId: 'onboarding',
        flowPath: {
          pathTaken: [],
          previousNode: undefined,
          previousTransition: undefined,
        },
      });

      const requestId = testIds.request;
      console.log('🧪 [TEST] Using requestId:', requestId);
      const mockLLMResponse: SystemMessageData = {
        type: 'QUESTIONS',
        response: 'What would you like to build?',
        detectedIntent: 'ready_to_proceed',
        intentConfidence: 0.9,
        uiElements: [
          {
            id: 'project_type',
            type: 'textarea',
            label: 'Project Description',
            required: true,
          },
        ],
      };

      // Setup mocks with detailed logging
      mockActivities.initializeConversationFlow.mockImplementation(
        (...args) => {
          console.log('🧪 [MOCK] initializeFlow called with:', args);
          return Promise.resolve(mockContext);
        },
      );
      mockActivities.executeFlowNode.mockImplementation((...args) => {
        console.log('🧪 [MOCK] executeFlowNode called with:', args);
        return Promise.resolve({ requestId });
      });
      mockActivities.applyContextTransform.mockImplementation((...args) => {
        console.log('🧪 [MOCK] applyContextTransform called with:', args);
        return Promise.resolve({});
      });
      mockActivities.saveFlowState.mockImplementation((...args) => {
        console.log('🧪 [MOCK] saveFlowState called with:', args);
        return Promise.resolve(undefined);
      });
      mockActivities.completeFlow.mockImplementation((...args) => {
        console.log('🧪 [MOCK] completeFlow called with:', args);
        return Promise.resolve(undefined);
      });

      const worker = await Worker.create({
        connection: testEnv.nativeConnection,
        taskQueue,
        workflowsPath: require.resolve('../conversation-flow.workflow'),
        activities: mockActivities,
        bundlerOptions: {
          ignoreModules: ['stream', 'ioredis', 'redis'],
        },
      });

      const workflowInput: StartConversationFlowWorkflowInput = {
        projectId: testIds.project,
        workflowId: testWorkflowId as WorkflowId,
        organizationId: testIds.organization,
        flowId: 'onboarding',
        userId: testIds.user,
        initiatedBy: 'SYSTEM',
        triggerEvent: 'test_trigger',
        title: 'Test Queue Flow',
        workflowAboutType: 'project',
        workflowAboutId: 'test-about-id',
      };

      await worker.runUntil(async () => {
        console.log('🧪 [TEST] Starting workflow execution');
        const handle = await testEnv.client.workflow.start(
          conversationFlowWorkflow,
          {
            args: [workflowInput],
            taskQueue,
            workflowId: 'test-queue-workflow-' + Date.now(),
          },
        );
        console.log('🧪 [TEST] Workflow started, handle created');

        // Wait longer for the workflow to reach the condition() wait
        console.log(
          '🧪 [TEST] Waiting for workflow to reach LLM response wait',
        );
        await new Promise((resolve) => setTimeout(resolve, 2000)); // Increased delay significantly

        // Send LLM response signal (simulating FlowNodeProcessor completing)
        console.log('🧪 [TEST] Sending LLM response signal');
        await handle.signal(
          WorkflowSignals.getLLMResponseSignalName(
            testWorkflowId as WorkflowId,
          ),
          {
            requestId,
            responseData: mockLLMResponse,
          },
        );
        console.log('🧪 [TEST] LLM response signal sent');

        // Wait a bit more for processing
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Send completion signal to end the workflow
        console.log('🧪 [TEST] Sending completion signal');
        await handle.signal(`completeFlow-${testWorkflowId}`);
        console.log('🧪 [TEST] Completion signal sent, waiting for result');

        await handle.result();
        console.log('🧪 [TEST] Workflow completed successfully');
      });

      // Verify the flow
      expect(mockActivities.initializeConversationFlow).toHaveBeenCalled();
      expect(mockActivities.executeFlowNode).toHaveBeenCalled();
      expect(mockActivities.saveFlowState).toHaveBeenCalledWith(
        expect.objectContaining({
          workflowState: expect.objectContaining({
            result: expect.objectContaining({
              message: mockLLMResponse.response,
              data: mockLLMResponse,
              uiElements: mockLLMResponse.uiElements,
            }),
          }),
        }),
      );
    }, 30000);

    it('should handle workflow completion signal during LLM wait', async () => {
      console.log('🧪 [COMPLETION TEST] Starting completion signal test');
      const mockActivities = createMockActivities();
      const testWorkflowId = 'wf-completion-' + Date.now();
      const taskQueue = 'test-completion-' + Date.now();
      console.log('🧪 [COMPLETION TEST] Created test IDs');

      const mockContext = TestUtils.createMockFlowContext({
        core: {
          workflowId: testWorkflowId as WorkflowId,
          projectId: testIds.project,
          organizationId: testIds.organization,
          conversationId: testIds.conversation,
          workflowAboutId: 'test-about-id',
          workflowAboutType: 'project',
          user: { id: testIds.user, role: 'member' },
          session: { startTime: new Date(), interactionCount: 0 },
        },
        flowId: 'onboarding',
        flowPath: {
          pathTaken: [],
          previousNode: undefined,
          previousTransition: undefined,
        },
      });

      const requestId = testIds.request;

      // Setup mocks
      mockActivities.initializeConversationFlow.mockResolvedValue(mockContext);
      mockActivities.executeFlowNode.mockResolvedValue({
        requestId,
      });
      mockActivities.applyContextTransform.mockResolvedValue({});
      mockActivities.completeFlow.mockResolvedValue(undefined);

      const worker = await Worker.create({
        connection: testEnv.nativeConnection,
        taskQueue,
        workflowsPath: require.resolve('../conversation-flow.workflow'),
        activities: mockActivities,
        bundlerOptions: {
          ignoreModules: ['stream', 'ioredis', 'redis'],
        },
      });

      const workflowInput: StartConversationFlowWorkflowInput = {
        projectId: testIds.project,
        workflowId: testWorkflowId as WorkflowId,
        organizationId: testIds.organization,
        flowId: 'onboarding',
        userId: testIds.user,
        initiatedBy: 'SYSTEM',
        triggerEvent: 'test_trigger',
        title: 'Test Completion Flow',
        workflowAboutType: 'project',
        workflowAboutId: 'test-about-id',
      };

      // Test that completion signal interrupts LLM wait
      await worker.runUntil(async () => {
        console.log('🧪 [COMPLETION TEST] Starting workflow');
        const handle = await testEnv.client.workflow.start(
          conversationFlowWorkflow,
          {
            args: [workflowInput],
            taskQueue,
            workflowId: 'test-completion-workflow-' + Date.now(),
          },
        );
        console.log('🧪 [COMPLETION TEST] Workflow started');

        // Wait a bit for workflow to start waiting for LLM response
        await new Promise((resolve) => setTimeout(resolve, 500));

        // Send completion signal instead of LLM response
        console.log('🧪 [COMPLETION TEST] Sending completion signal');
        await handle.signal(`completeFlow-${testWorkflowId}`);

        console.log('🧪 [COMPLETION TEST] Waiting for workflow to complete');
        await handle.result();
        console.log(
          '🧪 [COMPLETION TEST] Workflow completed via completion signal',
        );
      });

      expect(mockActivities.executeFlowNode).toHaveBeenCalled();
      expect(mockActivities.completeFlow).toHaveBeenCalled();
    }, 30000);
  });

  describe('error handling in queue-based execution', () => {
    it('should handle terminal nodes correctly', async () => {
      const mockActivities = createMockActivities();
      const testWorkflowId = 'wf-terminal-' + Date.now();
      const taskQueue = 'test-terminal-' + Date.now();

      const mockContext = TestUtils.createMockFlowContext({
        core: {
          workflowId: testWorkflowId as WorkflowId,
          projectId: testIds.project,
          organizationId: testIds.organization,
          conversationId: testIds.conversation,
          workflowAboutId: 'test-about-id',
          workflowAboutType: 'project',
          user: { id: testIds.user, role: 'member' },
          session: { startTime: new Date(), interactionCount: 0 },
        },
        flowId: 'onboarding',
        flowPath: {
          pathTaken: [],
          previousNode: undefined,
          previousTransition: undefined,
        },
      });

      const requestId = testIds.request;
      const terminalResponse: GenerationSystemMessageData = {
        type: SystemMessageResponseType.Initiatives,
        response: 'Here are your initiatives.',
        detectedIntent: 'flow_complete',
        intentConfidence: 1.0,
        generatedInitiativeIds: ['a'],
        summary: {
          totalInitiatives: 1,
          estimatedTimeline: '2 weeks',
          criticalPath: ['1'],
        },
        uiElements: [], // No UI elements = terminal
      };

      // Setup mocks
      mockActivities.initializeConversationFlow.mockResolvedValue(mockContext);
      mockActivities.executeFlowNode.mockResolvedValue({
        requestId,
      });
      mockActivities.applyContextTransform.mockResolvedValue({});
      mockActivities.saveFlowState.mockResolvedValue(undefined);
      mockActivities.completeFlow.mockResolvedValue(undefined);

      const worker = await Worker.create({
        connection: testEnv.nativeConnection,
        taskQueue,
        workflowsPath: require.resolve('../conversation-flow.workflow'),
        activities: mockActivities,
        bundlerOptions: {
          ignoreModules: ['stream', 'ioredis', 'redis'],
        },
      });

      const workflowInput: StartConversationFlowWorkflowInput = {
        projectId: testIds.project,
        workflowId: testWorkflowId as WorkflowId,
        organizationId: testIds.organization,
        flowId: 'onboarding',
        userId: testIds.user,
        initiatedBy: 'SYSTEM',
        triggerEvent: 'test_trigger',
        title: 'Test Terminal Flow',
        workflowAboutType: 'project',
        workflowAboutId: 'test-about-id',
      };

      await worker.runUntil(async () => {
        const handle = await testEnv.client.workflow.start(
          conversationFlowWorkflow,
          {
            args: [workflowInput],
            taskQueue,
            workflowId: 'test-terminal-workflow-' + Date.now(),
          },
        );

        // Small delay for workflow to start
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Send terminal response
        await handle.signal(
          WorkflowSignals.getLLMResponseSignalName(
            testWorkflowId as WorkflowId,
          ),
          {
            requestId,
            responseData: terminalResponse,
          },
        );

        await handle.result();
      });

      // Verify workflow completed properly
      expect(mockActivities.completeFlow).toHaveBeenCalled();
      expect(mockActivities.saveFlowState).toHaveBeenCalledWith(
        expect.objectContaining({
          workflowState: expect.objectContaining({
            result: expect.objectContaining({
              message: terminalResponse.response,
            }),
          }),
        }),
      );
    }, 30000);
  });
});
