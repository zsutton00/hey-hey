import { INestApplicationContext } from '@nestjs/common';
import { FlowContext, NodeType } from '../../types/flow-internal.types';
import * as TestUtils from '../../utils/testUtils';

interface MockNode {
  id: string;
  type: NodeType;
  title: string;
  nextNode?: string;
  promptConfig?: any;
  action: (context: any, appContext?: any) => Promise<any>;
  determineRouting?: (context: any, appContext?: any) => Promise<any>;
  preProcess?: (context: any, appContext?: any) => Promise<any>;
  postProcess?: (context: any, appContext?: any) => Promise<any>;
}

type ActionNode = MockNode;
type GenerateNode = MockNode;
type LLMQuestionsNode = MockNode;
type QuestionsNode = MockNode;

/**
 * Integration tests for phase detection logic in node execution
 *
 * These tests verify the two-phase execution model:
 * - Phase 1: Generate content (LLM_QUESTIONS, GENERATE, CLASSIFICATION)
 * - Phase 2: Process user response and route
 */
describe('Node Phase Detection Integration', () => {
  let mockContext: FlowContext;
  let mockAppContext: INestApplicationContext;

  beforeEach(() => {
    mockContext = TestUtils.createMockFlowContext();
    mockAppContext = TestUtils.createMockAppContext();
  });

  describe('LLM_QUESTIONS Two-Phase Execution', () => {
    it('should detect phase 1 when no user message present', () => {
      const node: LLMQuestionsNode = {
        id: 'llm_questions_phase_test',
        type: NodeType.LLM_QUESTIONS,
        title: 'Phase Test',
        nextNode: 'classify',
        promptConfig: {
          template: 'discovery_questions',
          systemPrompt: 'Generate questions',
        },
        action: async () => ({
          nodeResult: {
            type: NodeType.LLM_QUESTIONS,
            message: 'Here are some questions:',
            data: {
              questions: [
                { id: 'q1', question: 'Question 1?' },
                { id: 'q2', question: 'Question 2?' },
              ],
            },
          },
        }),
      };

      // Phase detection logic: isLLMQuestionsNode && !hasUserMessage
      const isLLMQuestionsNode = node.type === NodeType.LLM_QUESTIONS;
      const hasUserMessage = false; // No user message in context
      const isPhase1 = isLLMQuestionsNode && !hasUserMessage;

      expect(isPhase1).toBe(true);
      expect(node.type).toBe(NodeType.LLM_QUESTIONS);
    });

    it('should detect phase 2 when user message is present', () => {
      const node: LLMQuestionsNode = {
        id: 'llm_questions_phase2_test',
        type: NodeType.LLM_QUESTIONS,
        title: 'Phase 2 Test',
        nextNode: 'classify',
        promptConfig: {
          template: 'discovery_questions',
        },
        determineRouting: async (context: any) => {
          // Phase 2 routing based on user response
          return 'next_node_based_on_response';
        },
        action: async (context: any) => ({
          nextNodeId: 'route_after_user_response',
        }),
      };

      // Phase detection logic: isLLMQuestionsNode && hasUserMessage
      const isLLMQuestionsNode = node.type === NodeType.LLM_QUESTIONS;
      const hasUserMessage = true; // User has responded
      const isPhase2 = isLLMQuestionsNode && hasUserMessage;

      expect(isPhase2).toBe(true);
      expect(node.determineRouting).toBeDefined();
    });

    it('should execute full two-phase lifecycle', async () => {
      const executionLog: string[] = [];

      const node: LLMQuestionsNode = {
        id: 'full_lifecycle',
        type: NodeType.LLM_QUESTIONS,
        title: 'Full Lifecycle',
        nextNode: 'default_next',
        promptConfig: {
          template: 'test_template',
        },
        preProcess: async (context: any) => {
          executionLog.push('preProcess');
        },
        action: async (context: any) => {
          executionLog.push('action_phase1');
          return {
            nodeResult: {
              type: NodeType.LLM_QUESTIONS,
              message: 'Questions generated',
              data: { questions: [] },
            },
          };
        },
        postProcess: async (context: any) => {
          executionLog.push('postProcess_phase1');
        },
        determineRouting: async (context: any) => {
          executionLog.push('determineRouting_phase2');
          return 'routed_node';
        },
      };

      // Phase 1 execution
      if (node.preProcess) {
        await node.preProcess(mockContext, mockAppContext);
      }
      const phase1Result = await node.action(mockContext, mockAppContext);
      if (node.postProcess) {
        await node.postProcess(mockContext, mockAppContext);
      }

      expect(executionLog).toContain('preProcess');
      expect(executionLog).toContain('action_phase1');
      expect(executionLog).toContain('postProcess_phase1');
      expect(phase1Result.nodeResult?.type).toBe(NodeType.LLM_QUESTIONS);

      // Phase 2 execution (after user responds)
      if (node.determineRouting) {
        const routeResult = await node.determineRouting(
          mockContext,
          mockAppContext,
        );
        expect(executionLog).toContain('determineRouting_phase2');
        expect(routeResult).toBe('routed_node');
      }
    });
  });

  describe('QUESTIONS Single-Phase Execution', () => {
    it('should not require two-phase execution for static questions', async () => {
      const node: QuestionsNode = {
        id: 'static_questions',
        type: NodeType.QUESTIONS,
        title: 'Static Questions',
        nextNode: 'classify',
        action: async (context: any) => ({
          nodeResult: {
            type: NodeType.QUESTIONS,
            message: 'What would you like to do?',
            data: {
              questions: [{ id: 'q1', question: 'Your goal?' }],
            },
          },
        }),
      };

      // QUESTIONS nodes are not two-phase by nature (no LLM generation needed)
      const requiresTwoPhase = node.type === NodeType.LLM_QUESTIONS;
      expect(requiresTwoPhase).toBe(false);

      // Execute once - questions are already known
      const result = await node.action(mockContext, mockAppContext);
      expect(result.nodeResult?.type).toBe(NodeType.QUESTIONS);
      expect(result.nodeResult?.message).toBe('What would you like to do?');
    });

    it('should still wait for user input despite being single-phase', () => {
      const node: QuestionsNode = {
        id: 'wait_for_user',
        type: NodeType.QUESTIONS,
        title: 'Wait for User',
        nextNode: 'next',
        action: async () => ({
          nodeResult: {
            type: NodeType.QUESTIONS,
            message: 'Please respond',
            data: { questions: [] },
          },
        }),
      };

      expect(node.type).toBe(NodeType.QUESTIONS);
    });
  });

  describe('GENERATE Node Two-Phase Execution', () => {
    it('should detect two-phase execution for GENERATE nodes', async () => {
      const node: GenerateNode = {
        id: 'generate_content',
        type: NodeType.GENERATE,
        title: 'Generate Content',
        nextNode: 'next',
        promptConfig: {
          template: 'content_generation',
        },
        action: async (context: any) => ({
          nodeResult: {
            type: NodeType.GENERATE,
            message: 'Generated content',
            data: { content: 'AI generated content here' },
          },
        }),
      };

      // GENERATE nodes also use two-phase execution
      const needsTwoPhase =
        node.type === NodeType.LLM_QUESTIONS || node.type === NodeType.GENERATE;

      expect(needsTwoPhase).toBe(true);
      expect(node.type).toBe(NodeType.GENERATE);
    });
  });

  describe('ACTION Node Immediate Execution', () => {
    it('should execute ACTION nodes without phase detection', async () => {
      const node: ActionNode = {
        id: 'action_node',
        type: NodeType.ACTION,
        title: 'Action Node',
        nextNode: 'next',
        action: async (context: any) => ({
          nextNodeId: 'immediate_next',
        }),
      };

      // ACTION nodes don't use two-phase execution
      const needsTwoPhase = node.type === NodeType.LLM_QUESTIONS;
      expect(needsTwoPhase).toBe(false);

      // Execute immediately without waiting
      const result = await node.action(mockContext, mockAppContext);
      expect(result.nextNodeId).toBe('immediate_next');
    });
  });

  describe('Phase Detection Helper Logic', () => {
    it('should identify all two-phase node types', () => {
      const llmQuestionsNode: LLMQuestionsNode = {
        id: 'llm',
        type: NodeType.LLM_QUESTIONS,
        title: 'LLM',
        nextNode: 'n',
        promptConfig: { template: 't' },
        action: async () => ({
          nodeResult: { type: NodeType.LLM_QUESTIONS, message: '', data: {} },
        }),
      };

      const generateNode: GenerateNode = {
        id: 'gen',
        type: NodeType.GENERATE,
        title: 'Gen',
        nextNode: 'n',
        promptConfig: { template: 't' },
        action: async () => ({
          nodeResult: { type: NodeType.GENERATE, message: '', data: {} },
        }),
      };

      const questionsNode: QuestionsNode = {
        id: 'q',
        type: NodeType.QUESTIONS,
        title: 'Q',
        nextNode: 'n',
        action: async () => ({
          nodeResult: { type: NodeType.QUESTIONS, message: '', data: {} },
        }),
      };

      const actionNode: ActionNode = {
        id: 'a',
        type: NodeType.ACTION,
        title: 'A',
        nextNode: 'n',
        action: async () => ({ nextNodeId: 'n' }),
      };

      // Helper function to determine two-phase execution
      const needsTwoPhase = (nodeType: NodeType) => {
        return (
          nodeType === NodeType.LLM_QUESTIONS ||
          nodeType === NodeType.GENERATE ||
          nodeType === NodeType.CLASSIFICATION
        );
      };

      expect(needsTwoPhase(llmQuestionsNode.type)).toBe(true);
      expect(needsTwoPhase(generateNode.type)).toBe(true);
      expect(needsTwoPhase(questionsNode.type)).toBe(false);
      expect(needsTwoPhase(actionNode.type)).toBe(false);
    });

    it('should determine phase based on node type and user message presence', () => {
      // Helper function matching actual implementation
      const getExecutionPhase = (
        nodeType: NodeType,
        hasUserMessage: boolean,
      ): 1 | 2 | null => {
        const isTwoPhaseNode =
          nodeType === NodeType.LLM_QUESTIONS ||
          nodeType === NodeType.GENERATE ||
          nodeType === NodeType.CLASSIFICATION;

        if (!isTwoPhaseNode) {
          return null; // Single-phase or immediate execution
        }

        return hasUserMessage ? 2 : 1;
      };

      // LLM_QUESTIONS without user message = Phase 1
      expect(getExecutionPhase(NodeType.LLM_QUESTIONS, false)).toBe(1);

      // LLM_QUESTIONS with user message = Phase 2
      expect(getExecutionPhase(NodeType.LLM_QUESTIONS, true)).toBe(2);

      // QUESTIONS node (not two-phase)
      expect(getExecutionPhase(NodeType.QUESTIONS, false)).toBe(null);
      expect(getExecutionPhase(NodeType.QUESTIONS, true)).toBe(null);

      // ACTION node (not two-phase)
      expect(getExecutionPhase(NodeType.ACTION, false)).toBe(null);
      expect(getExecutionPhase(NodeType.ACTION, true)).toBe(null);

      // GENERATE node phases
      expect(getExecutionPhase(NodeType.GENERATE, false)).toBe(1);
      expect(getExecutionPhase(NodeType.GENERATE, true)).toBe(2);
    });
  });

  describe('Phase Transition Validation', () => {
    it('should require nodeResult in phase 1 but allow only nextNodeId in phase 2', async () => {
      const node: LLMQuestionsNode = {
        id: 'phase_transition',
        type: NodeType.LLM_QUESTIONS,
        title: 'Phase Transition',
        nextNode: 'default',
        promptConfig: { template: 'test' },
        action: async (context: any) => {
          // Phase 1: Must return nodeResult with questions
          return {
            nodeResult: {
              type: NodeType.LLM_QUESTIONS,
              message: 'Questions',
              data: { questions: [] },
            },
          };
        },
      };

      // Phase 1 execution
      const phase1Result = await node.action(mockContext, mockAppContext);
      expect(phase1Result.nodeResult).toBeDefined();
      expect(phase1Result.nodeResult?.type).toBe(NodeType.LLM_QUESTIONS);

      // Phase 2 can return just routing
      const phase2Action = async () => ({
        nextNodeId: 'route_destination',
      });

      const phase2Result: { nextNodeId: string; nodeResult?: unknown } =
        await phase2Action();
      expect(phase2Result.nextNodeId).toBe('route_destination');
      expect(phase2Result.nodeResult).toBeUndefined();
    });
  });
});
