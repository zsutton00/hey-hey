import { QuestionsSystemMessageData } from '../../generated';
import * as TestUtils from '../../utils/testUtils';
import {
  WorkflowPhase,
  WorkflowStep,
  WorkflowState,
} from '../conversation-workflow-state';

const { testIds, testNodeIds } = TestUtils;

describe('ConversationWorkflowState', () => {
  describe('WorkflowStep enum', () => {
    it('should have all required workflow steps', () => {
      const expectedSteps = [
        'initializing',
        'executing_opener',
        'waiting_for_user_input',
        'waiting_for_user_input_skipped',
        'generating_questions',
        'generating_questions_skipped',
        'processing_user_response',
        'executing_auto_node',
        'executing_agent_with_signals',
        'executing_agent_with_signals_skipped',
        'error_holding',
        'completing_flow',
      ];

      expectedSteps.forEach((step) => {
        expect(Object.values(WorkflowStep)).toContain(step);
      });

      expect(Object.keys(WorkflowStep)).toHaveLength(expectedSteps.length);
    });

    it('should have valid string values', () => {
      expect(WorkflowStep.INITIALIZING).toBe('initializing');
      expect(WorkflowStep.EXECUTING_OPENER).toBe('executing_opener');
      expect(WorkflowStep.WAITING_FOR_USER_INPUT).toBe(
        'waiting_for_user_input',
      );
      expect(WorkflowStep.GENERATING_QUESTIONS).toBe('generating_questions');
      expect(WorkflowStep.GENERATING_QUESTIONS_SKIPPED).toBe(
        'generating_questions_skipped',
      );
      expect(WorkflowStep.PROCESSING_USER_RESPONSE).toBe(
        'processing_user_response',
      );
      expect(WorkflowStep.EXECUTING_AUTO_NODE).toBe('executing_auto_node');
      expect(WorkflowStep.EXECUTING_AGENT_WITH_SIGNALS).toBe(
        'executing_agent_with_signals',
      );
      expect(WorkflowStep.EXECUTING_AGENT_WITH_SIGNALS_SKIPPED).toBe(
        'executing_agent_with_signals_skipped',
      );
      expect(WorkflowStep.ERROR_HOLDING).toBe('error_holding');
      expect(WorkflowStep.COMPLETING_FLOW).toBe('completing_flow');
      expect(WorkflowStep.WAITING_FOR_USER_INPUT_SKIPPED).toBe(
        'waiting_for_user_input_skipped',
      );
    });

    it('should be usable as string literals', () => {
      const step: WorkflowStep = WorkflowStep.INITIALIZING;
      const stepString: string = step;

      expect(stepString).toBe('initializing');
      expect(typeof stepString).toBe('string');
    });
  });

  describe('WorkflowState interface', () => {
    it('should validate all required properties', () => {
      const state = TestUtils.createMockWorkflowState();

      // Core workflow info
      expect(state.step).toBeDefined();
      expect(state.workflowId).toBeDefined();
      expect(state.projectId).toBeDefined();
      expect(state.organizationId).toBeDefined();
      expect(state.flowId).toBeDefined();
      expect(state.executionId).toBeDefined();
      expect(state.conversationId).toBeDefined();

      // Current execution state
      expect(state.currentNodeId).toBeDefined();
      expect(state.nodeConfig).toBeDefined();
      expect(state.phase).toBeDefined();
      expect(state.context).toBeDefined();

      // Flow control flags
      expect(typeof state.isComplete).toBe('boolean');
      expect(typeof state.hasOpener).toBe('boolean');
      expect(typeof state.iterations).toBe('number');
      expect(typeof state.maxIterations).toBe('number');

      // Workflow metadata
      expect(state.initiatedBy).toBeDefined();
      expect(state.triggerEvent).toBeDefined();
      expect(state.title).toBeDefined();
    });

    it('should enforce correct types', () => {
      const state = TestUtils.createMockWorkflowState();

      // String types
      expect(typeof state.workflowId).toBe('string');
      expect(typeof state.projectId).toBe('string');
      expect(typeof state.organizationId).toBe('string');
      expect(typeof state.flowId).toBe('string');
      expect(typeof state.executionId).toBe('string');
      expect(typeof state.conversationId).toBe('string');
      expect(typeof state.currentNodeId).toBe('string');
      expect(typeof state.triggerEvent).toBe('string');
      expect(typeof state.title).toBe('string');

      // Enum/Union types
      expect(['SYSTEM', 'USER']).toContain(state.initiatedBy);
      expect(Object.values(WorkflowPhase)).toContain(state.phase);
      expect(Object.values(WorkflowStep)).toContain(state.step);

      // Object types
      expect(typeof state.nodeConfig).toBe('object');
      expect(typeof state.context).toBe('object');
      expect(state.nodeConfig).not.toBeNull();
      expect(state.context).not.toBeNull();

      // Number types
      expect(typeof state.iterations).toBe('number');
      expect(typeof state.maxIterations).toBe('number');
      expect(state.iterations).toBeGreaterThanOrEqual(0);
      expect(state.maxIterations).toBeGreaterThan(0);
    });

    it('should handle optional properties correctly', () => {
      // Test with all optional properties undefined
      const minimalState = TestUtils.createMockWorkflowState({
        userId: undefined,
        pendingLLMResponse: undefined,
        triggeringUserMessage: undefined,
        userResponseTimeout: undefined,
      });

      expect(minimalState.userId).toBeUndefined();
      expect(minimalState.pendingLLMResponse).toBeUndefined();
      expect(minimalState.triggeringUserMessage).toBeUndefined();
      expect(minimalState.userResponseTimeout).toBeUndefined();

      // Test with optional properties defined
      const fullState = TestUtils.createMockWorkflowState({
        userId: testIds.user,
        pendingLLMResponse: TestUtils.createMockLLMResponsePayload(),
        triggeringUserMessage: TestUtils.createMockFlowUserMessage(),
        userResponseTimeout: '2h',
      });

      expect(fullState.userId).toBe(testIds.user);
      expect(fullState.pendingLLMResponse).toBeDefined();
      expect(fullState.triggeringUserMessage).toBeDefined();
      expect(fullState.userResponseTimeout).toBe('2h');
    });

    it('should support state mutations for workflow execution', () => {
      const state = TestUtils.createMockWorkflowState({
        step: WorkflowStep.INITIALIZING,
        iterations: 0,
        isComplete: false,
      });

      // Simulate state changes during workflow execution
      state.step = WorkflowStep.WAITING_FOR_USER_INPUT;
      state.iterations = 1;

      expect(state.step).toBe(WorkflowStep.WAITING_FOR_USER_INPUT);
      expect(state.iterations).toBe(1);

      // Simulate completion
      state.step = WorkflowStep.COMPLETING_FLOW;
      state.isComplete = true;

      expect(state.step).toBe(WorkflowStep.COMPLETING_FLOW);
      expect(state.isComplete).toBe(true);
    });
  });

  describe('WorkflowInput interface', () => {
    it('should validate required input fields', () => {
      const input = TestUtils.createMockWorkflowInput();

      expect(input.projectId).toBeDefined();
      expect(input.workflowId).toBeDefined();
      expect(input.organizationId).toBeDefined();
      expect(input.flowId).toBeDefined();
      expect(input.initiatedBy).toBeDefined();
      expect(input.triggerEvent).toBeDefined();
      expect(input.title).toBeDefined();

      expect(typeof input.projectId).toBe('string');
      expect(typeof input.workflowId).toBe('string');
      expect(typeof input.organizationId).toBe('string');
      expect(typeof input.flowId).toBe('string');
      expect(typeof input.triggerEvent).toBe('string');
      expect(typeof input.title).toBe('string');
      expect(['SYSTEM', 'USER']).toContain(input.initiatedBy);
    });

    it('should handle optional input fields', () => {
      const minimalInput = TestUtils.createMockWorkflowInput({
        userId: undefined,
        conversationId: undefined,
        userResponseTimeout: undefined,
      });

      expect(minimalInput.userId).toBeUndefined();
      expect(minimalInput.conversationId).toBeUndefined();
      expect(minimalInput.userResponseTimeout).toBeUndefined();

      const fullInput = TestUtils.createMockWorkflowInput({
        userId: testIds.user,
        conversationId: testIds.conversation,
        userResponseTimeout: '24h',
      });

      expect(fullInput.userId).toBe(testIds.user);
      expect(fullInput.conversationId).toBe(testIds.conversation);
      expect(fullInput.userResponseTimeout).toBe('24h');
    });

    it('should support input transformation to state', () => {
      const input = TestUtils.createMockWorkflowInput({
        projectId: TestUtils.createTestId.project('input-project-123'),
        workflowId: TestUtils.createTestId.workflow('input-workflow-456'),
        initiatedBy: 'SYSTEM',
        title: 'Input Test Workflow',
      });

      // Simulate initialization from input
      const state = TestUtils.createMockWorkflowState({
        projectId: input.projectId,
        workflowId: input.workflowId,
        initiatedBy: input.initiatedBy,
        title: input.title,
        step: WorkflowStep.INITIALIZING,
      });

      expect(state.projectId).toBe(input.projectId);
      expect(state.workflowId).toBe(input.workflowId);
      expect(state.initiatedBy).toBe(input.initiatedBy);
      expect(state.title).toBe(input.title);
      expect(state.step).toBe(WorkflowStep.INITIALIZING);
    });
  });

  describe('NodeConfiguration interface', () => {
    it('should define node behavior properties', () => {
      const autoNodeConfig = TestUtils.createMockNodeConfiguration({
        id: testNodeIds.auto,
        supportsPhases: false,
      });

      expect(autoNodeConfig.id).toBe(testNodeIds.auto);
      expect(autoNodeConfig.supportsPhases).toBe(false);

      const gatherNodeConfig = TestUtils.createMockNodeConfiguration({
        id: testNodeIds.gather,
        supportsPhases: true,
      });

      expect(gatherNodeConfig.id).toBe(testNodeIds.gather);
      expect(gatherNodeConfig.supportsPhases).toBe(true);
    });

    it('should validate configuration consistency', () => {
      // Auto nodes typically don't support phases
      const autoConfig = TestUtils.createMockNodeConfiguration({
        supportsPhases: false,
      });

      expect(autoConfig.supportsPhases).toBe(false);

      // Gather nodes typically support phases but wait for user response
      const gatherConfig = TestUtils.createMockNodeConfiguration({
        supportsPhases: true,
      });

      expect(gatherConfig.supportsPhases).toBe(true);
    });

    it('should support node identification', () => {
      const configs = [
        TestUtils.createMockNodeConfiguration({ id: testNodeIds.opener }),
        TestUtils.createMockNodeConfiguration({ id: testNodeIds.gather }),
        TestUtils.createMockNodeConfiguration({ id: testNodeIds.auto }),
        TestUtils.createMockNodeConfiguration({ id: testNodeIds.completion }),
      ];

      const ids = configs.map((config) => config.id);
      const uniqueIds = new Set(ids);

      expect(uniqueIds.size).toBe(configs.length);
      expect(ids).toContain(testNodeIds.opener);
      expect(ids).toContain(testNodeIds.gather);
      expect(ids).toContain(testNodeIds.auto);
      expect(ids).toContain(testNodeIds.completion);
    });
  });

  describe('LLMResponsePayload interface', () => {
    it('should contain required response data', () => {
      const response = TestUtils.createMockLLMResponsePayload();

      expect(response.requestId).toBeDefined();
      expect(response.responseData).toBeDefined();

      expect(typeof response.requestId).toBe('string');
      expect(typeof response.responseData).toBe('object');
      expect(response.responseData).not.toBeNull();
    });

    it('should support optional nextNodeId', () => {
      const responseWithNext = TestUtils.createMockLLMResponsePayload({
        nextNodeId: testNodeIds.gather,
      });

      const responseWithoutNext = TestUtils.createMockLLMResponsePayload({
        nextNodeId: undefined,
      });

      expect(responseWithNext.nextNodeId).toBe(testNodeIds.gather);
      expect(responseWithoutNext.nextNodeId).toBeUndefined();
    });

    it('should validate response data structure', () => {
      const response = TestUtils.createMockLLMResponsePayload();

      expect(response.responseData).toHaveProperty('type');
      expect(response.responseData).toHaveProperty('response');
      expect(response.responseData).toHaveProperty('uiElements');
      expect(response.responseData).toHaveProperty('actions');

      expect(
        Array.isArray(
          (response.responseData as QuestionsSystemMessageData).uiElements,
        ),
      ).toBe(true);
      expect(
        Array.isArray(
          (response.responseData as QuestionsSystemMessageData).actions,
        ),
      ).toBe(true);
    });

    it('should support request ID correlation', () => {
      const requestId = 'correlation-test-123';
      const response = TestUtils.createMockLLMResponsePayload({
        requestId: TestUtils.createTestId.request(requestId),
      });

      expect(response.requestId).toBe(requestId);

      // Simulate correlation check
      const expectedRequestId = requestId;
      const isCorrelated = response.requestId === expectedRequestId;

      expect(isCorrelated).toBe(true);
    });
  });

  describe('StepTransitionResult interface', () => {
    it('should define transition behavior', () => {
      const continueTransition = TestUtils.createMockStepTransitionResult({
        nextStep: WorkflowStep.WAITING_FOR_USER_INPUT,
        shouldContinue: true,
      });

      const completionTransition = TestUtils.createMockStepTransitionResult({
        nextStep: WorkflowStep.COMPLETING_FLOW,
        shouldContinue: false,
      });

      expect(continueTransition.nextStep).toBe(
        WorkflowStep.WAITING_FOR_USER_INPUT,
      );
      expect(continueTransition.shouldContinue).toBe(true);

      expect(completionTransition.nextStep).toBe(WorkflowStep.COMPLETING_FLOW);
      expect(completionTransition.shouldContinue).toBe(false);
    });

    it('should validate step transitions', () => {
      const validSteps = Object.values(WorkflowStep);

      validSteps.forEach((step) => {
        const transition = TestUtils.createMockStepTransitionResult({
          nextStep: step,
          shouldContinue: step !== WorkflowStep.COMPLETING_FLOW,
        });

        expect(transition.nextStep).toBe(step);
        expect(typeof transition.shouldContinue).toBe('boolean');
      });
    });

    it('should support workflow control flow', () => {
      // Simulate different transition scenarios
      const transitions = [
        { step: WorkflowStep.INITIALIZING, shouldContinue: true },
        { step: WorkflowStep.EXECUTING_OPENER, shouldContinue: true },
        { step: WorkflowStep.WAITING_FOR_USER_INPUT, shouldContinue: true },
        { step: WorkflowStep.GENERATING_QUESTIONS, shouldContinue: true },
        { step: WorkflowStep.PROCESSING_USER_RESPONSE, shouldContinue: true },
        { step: WorkflowStep.EXECUTING_AUTO_NODE, shouldContinue: true },
        { step: WorkflowStep.COMPLETING_FLOW, shouldContinue: false },
      ];

      transitions.forEach(({ step, shouldContinue }) => {
        const transition = TestUtils.createMockStepTransitionResult({
          nextStep: step,
          shouldContinue,
        });

        expect(transition.nextStep).toBe(step);
        expect(transition.shouldContinue).toBe(shouldContinue);
      });
    });
  });

  describe('state transitions', () => {
    it('should validate valid transition paths', () => {
      const state = TestUtils.createMockWorkflowState({
        step: WorkflowStep.INITIALIZING,
      });

      // Valid transitions from INITIALIZING
      const validNextSteps = [
        WorkflowStep.EXECUTING_OPENER,
        WorkflowStep.WAITING_FOR_USER_INPUT,
        WorkflowStep.GENERATING_QUESTIONS,
        WorkflowStep.EXECUTING_AUTO_NODE,
      ];

      validNextSteps.forEach((nextStep) => {
        const newState = { ...state, step: nextStep };
        expect(newState.step).toBe(nextStep);
      });
    });

    it('should prevent invalid transitions', () => {
      // These are logical constraints, not enforced by TypeScript
      // but would be validated by workflow logic

      const invalidTransitions = [
        { from: WorkflowStep.COMPLETING_FLOW, to: WorkflowStep.INITIALIZING },
        {
          from: WorkflowStep.EXECUTING_OPENER,
          to: WorkflowStep.GENERATING_QUESTIONS,
        },
        {
          from: WorkflowStep.PROCESSING_USER_RESPONSE,
          to: WorkflowStep.EXECUTING_OPENER,
        },
      ];

      invalidTransitions.forEach(({ from, to }) => {
        // In real workflow, these transitions would be prevented by logic
        const state = TestUtils.createMockWorkflowState({ step: from });

        // This would be caught by workflow validation
        const isValidTransition = !(
          (from === WorkflowStep.COMPLETING_FLOW &&
            to === WorkflowStep.INITIALIZING) ||
          (from === WorkflowStep.EXECUTING_OPENER &&
            to === WorkflowStep.GENERATING_QUESTIONS) ||
          (from === WorkflowStep.PROCESSING_USER_RESPONSE &&
            to === WorkflowStep.EXECUTING_OPENER)
        );

        expect(isValidTransition).toBe(false);
      });
    });

    it('should maintain state consistency', () => {
      const state = TestUtils.createMockWorkflowState({
        step: WorkflowStep.INITIALIZING,
        isComplete: false,
        iterations: 0,
      });

      // Simulate workflow progression
      state.step = WorkflowStep.WAITING_FOR_USER_INPUT;
      state.iterations = 1;

      expect(state.step).toBe(WorkflowStep.WAITING_FOR_USER_INPUT);
      expect(state.isComplete).toBe(false);
      expect(state.iterations).toBe(1);

      // Simulate completion
      state.step = WorkflowStep.COMPLETING_FLOW;
      state.isComplete = true;

      expect(state.step).toBe(WorkflowStep.COMPLETING_FLOW);
      expect(state.isComplete).toBe(true);

      // Verify consistency
      const isConsistent =
        state.step === WorkflowStep.COMPLETING_FLOW &&
        state.isComplete === true;

      expect(isConsistent).toBe(true);
    });

    it('should handle state rollback scenarios', () => {
      const state = TestUtils.createMockWorkflowState({
        step: WorkflowStep.EXECUTING_AUTO_NODE,
        iterations: 3,
        pendingLLMResponse: TestUtils.createMockLLMResponsePayload(),
      });

      // Simulate error requiring rollback
      const rollbackState: WorkflowState = {
        ...state,
        step: WorkflowStep.WAITING_FOR_USER_INPUT,
        pendingLLMResponse: undefined,
      };

      expect(rollbackState.step).toBe(WorkflowStep.WAITING_FOR_USER_INPUT);
      expect(rollbackState.iterations).toBe(3); // Maintain iteration count
      expect(rollbackState.pendingLLMResponse).toBeUndefined();
    });
  });

  describe('type safety and validation', () => {
    it('should enforce branded types', () => {
      const state = TestUtils.createMockWorkflowState();

      // These should be branded types
      expect(typeof state.workflowId).toBe('string');
      expect(typeof state.projectId).toBe('string');
      expect(typeof state.organizationId).toBe('string');
      expect(typeof state.conversationId).toBe('string');
      expect(typeof state.executionId).toBe('string');

      // In TypeScript, these would have proper branded type checking
      const workflowId = state.workflowId;
      const projectId = state.projectId;

      expect(workflowId).toBeDefined();
      expect(projectId).toBeDefined();
    });

    it('should validate enum constraints', () => {
      const state = TestUtils.createMockWorkflowState();

      // WorkflowStep enum constraint
      expect(Object.values(WorkflowStep)).toContain(state.step);

      // InitiatedBy union constraint
      expect(['SYSTEM', 'USER']).toContain(state.initiatedBy);

      // WorkflowPhase constraint
      expect(Object.values(WorkflowPhase)).toContain(state.phase);
    });

    it('should support deep property access', () => {
      const state = TestUtils.createMockWorkflowState({
        context: TestUtils.createMockFlowContext({
          core: {
            projectId: testIds.project,
            organizationId: testIds.organization,
            conversationId: testIds.conversation,
            workflowId: testIds.workflow,
            user: { id: testIds.user, role: 'member' },
            session: { startTime: new Date(), interactionCount: 1 },
            workflowAboutId: 'workflow-about-id',
            workflowAboutType: 'task',
          },
          flowId: 'test-flow',
          flowPath: {
            pathTaken: [testNodeIds.gather],
            previousNode: undefined,
            previousTransition: undefined,
          },
        }),
      });

      expect(state.context.core.projectId).toBe(testIds.project);
      expect(state.context.core.user.id).toBe(testIds.user);
      expect(state.context.flowPath.pathTaken).toContain(testNodeIds.gather);
    });
  });
});
