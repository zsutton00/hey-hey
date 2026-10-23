import { z } from 'zod';
import { LocalPromptType } from '../../generated/local';
import * as TestUtils from '../../utils/testUtils';
import {
  NodeType,
  FlowContext,
  QuestionsNodeBase,
  LlmQuestionsNodeBase,
  ActionNodeBase,
  ExternalAgentNodeBase,
  ExternalAgentTriggerMessage,
  ExternalAgentValidationError,
  TypeEnum,
  isQuestionsNode,
  isLLMQuestionsNode,
  isActionNode,
  isExternalAgentNode,
  isExternalAgentNodeResult,
  isQuestionsNodeResult,
  isCompletionCandidateMessage,
  isNodeCompletionMessage,
  validateExternalAgentCompletion,
  ConversationNode,
  TypedNodeResult,
  FlowUserMessage,
  NodeResult,
  type MutableContextHandle,
} from '../flow-internal.types';
import { createMutableContextHandle } from '../../utils/mutable-context';
import { MessageStatus } from '../../constants/message-status.constants';

const { testIds } = TestUtils;

class TestQuestionsNode extends QuestionsNodeBase<FlowContext> {
  readonly id: string;
  readonly title: string;
  private readonly result: NodeResult;

  constructor(id: string, result: NodeResult, title = 'Test Questions') {
    super();
    this.id = id;
    this.title = title;
    this.result = result;
  }

  async execute(
    _context: MutableContextHandle<FlowContext>,
  ): Promise<NodeResult> {
    return this.result;
  }
}

class TestLlmQuestionsNode extends LlmQuestionsNodeBase<FlowContext> {
  readonly id: string;
  readonly title: string;
  readonly promptConfig = {
    systemPromptTemplate: 'Generate questions',
    responseSchema: z.object({
      questions: z.array(z.object({ id: z.string(), question: z.string() })),
    }),
  };

  constructor(id: string, title = 'LLM Questions') {
    super();
    this.id = id;
    this.title = title;
  }
}

class RoutingLlmQuestionsNode extends TestLlmQuestionsNode {
  async determineRoutingFromUserMessage(
    _context: Readonly<FlowContext>,
    _userMessage: FlowUserMessage,
  ): Promise<string | undefined> {
    return 'classification';
  }
}

class ContextPromptLlmQuestionsNode extends LlmQuestionsNodeBase<FlowContext> {
  readonly id: string;
  readonly title = 'Contextual Questions';
  readonly promptConfig = {
    systemPromptTemplate: (context: FlowContext) =>
      `Project ${context.core.projectId}`,
    responseSchema: z.object({}),
  };

  constructor(id: string) {
    super();
    this.id = id;
  }
}

class TestExternalAgentNode extends ExternalAgentNodeBase<FlowContext> {
  readonly id: string;
  readonly title: string;
  readonly promptType = LocalPromptType.startup_session;
  readonly actions = {
    DONE: { schema: z.object({}).optional(), waitForUser: false },
  };
  private readonly trigger: ExternalAgentTriggerMessage;

  constructor(
    id: string,
    trigger: ExternalAgentTriggerMessage,
    title = 'External Agent Node',
  ) {
    super();
    this.id = id;
    this.title = title;
    this.trigger = trigger;
  }

  async buildTriggerMessage(
    _tracker: MutableContextHandle<FlowContext>,
  ): Promise<ExternalAgentTriggerMessage> {
    return this.trigger;
  }
}

class TestActionNode extends ActionNodeBase<FlowContext> {
  readonly id: string;
  readonly title: string;
  private readonly result: NodeResult;

  constructor(id: string, result: NodeResult, title = 'Action Node') {
    super();
    this.id = id;
    this.title = title;
    this.result = result;
  }

  async execute(
    _context: MutableContextHandle<FlowContext>,
  ): Promise<NodeResult> {
    return this.result;
  }
}

describe('Node Behavior - QUESTIONS vs LLM_QUESTIONS', () => {
  let mockContext: FlowContext;

  beforeEach(() => {
    mockContext = TestUtils.createMockFlowContext();
  });

  describe('QUESTIONS Node Behavior', () => {
    it('should enforce twoPhase as true at type level', () => {
      const questionsNode = new TestQuestionsNode('test_questions', {
        type: NodeType.QUESTIONS,
        message: 'What would you like to do?',
        data: {
          questions: [{ id: 'q1', question: 'Test?' }],
        },
      } as unknown as TypedNodeResult);

      expect(questionsNode.type).toBe(NodeType.QUESTIONS);
      expect(questionsNode.twoPhase).toBe(true);
    });

    it('should return static UI elements without LLM call', async () => {
      const questionsNode = new TestQuestionsNode('static_questions', {
        type: NodeType.QUESTIONS,
        message: 'Please provide your input',
        data: {
          questions: [
            { id: 'q1', question: 'What is your goal?' },
            { id: 'q2', question: 'What is the priority?' },
          ],
        },
        uiElements: [
          {
            id: 'input_1',
            type: 'textarea',
            label: 'Your response',
          },
        ],
      } as unknown as TypedNodeResult);

      const result = await questionsNode.execute(
        createMutableContextHandle(mockContext),
      );

      expect(result).toBeDefined();
      expect(result.type).toBe(NodeType.QUESTIONS);
      expect(result.uiElements).toBeDefined();
      expect(result.uiElements).toHaveLength(1);
    });

    it('should not have promptConfig (no LLM required)', () => {
      const questionsNode = new TestQuestionsNode('no_llm_questions', {
        type: NodeType.QUESTIONS,
        message: 'Static question',
        data: { questions: [] },
      } as unknown as TypedNodeResult);

      expect('promptConfig' in questionsNode).toBe(false);
    });

    it('should be identified by type guard', () => {
      const questionsNode: ConversationNode = new TestQuestionsNode('test', {
        type: NodeType.QUESTIONS,
        message: '',
        data: { questions: [] },
      } as unknown as TypedNodeResult);

      expect(isQuestionsNode(questionsNode)).toBe(true);
      expect(isLLMQuestionsNode(questionsNode)).toBe(false);
    });
  });

  describe('LLM_QUESTIONS Node Behavior', () => {
    it('should support promptConfig for LLM generation', () => {
      const llmQuestionsNode = new TestLlmQuestionsNode('llm_questions');

      expect(llmQuestionsNode.promptConfig).toBeDefined();
      expect(llmQuestionsNode.promptConfig.systemPromptTemplate).toBe(
        'Generate questions',
      );
    });

    it('should support routing via determineRoutingFromUserMessage callback', async () => {
      const llmQuestionsNode = new RoutingLlmQuestionsNode(
        'two_phase_questions',
      );

      expect(llmQuestionsNode.determineRoutingFromUserMessage).toBeDefined();

      const mockUserMessage = {
        id: testIds.message,
        workflowId: testIds.workflow,
        projectId: testIds.project,
        type: 'USER' as const,
        status: MessageStatus.Open,
        data: { message: 'test message' },
        conversationId: testIds.conversation,
        parentMessageId: testIds.parentMessage,
        createdAt: new Date().toISOString(),
        timestamp: new Date().toISOString(),
      } as FlowUserMessage;

      const routingResult =
        await llmQuestionsNode.determineRoutingFromUserMessage(
          mockContext,
          mockUserMessage,
        );

      expect(routingResult).toBe('classification');
    });

    it('should allow prompt templates to use context', () => {
      const llmQuestionsNode = new ContextPromptLlmQuestionsNode(
        'contextual_questions',
      );

      const templateResult =
        llmQuestionsNode.promptConfig.systemPromptTemplate(mockContext);

      expect(templateResult).toContain(mockContext.core.projectId);
    });

    it('should be identified by type guard', () => {
      const llmQuestionsNode: ConversationNode = new TestLlmQuestionsNode(
        'test',
      );

      expect(isLLMQuestionsNode(llmQuestionsNode)).toBe(true);
      expect(isQuestionsNode(llmQuestionsNode)).toBe(false);
    });
  });

  describe('Behavioral Differences', () => {
    it('should differentiate static vs AI-generated questions by type', () => {
      const staticNode = new TestQuestionsNode(
        'static',
        {
          type: NodeType.QUESTIONS,
          message: '',
          data: { questions: [] },
        } as unknown as TypedNodeResult,
        'Static',
      );

      const aiNode = new TestLlmQuestionsNode('ai', 'AI');

      expect(staticNode.type).toBe(NodeType.QUESTIONS);
      expect(aiNode.type).toBe(NodeType.LLM_QUESTIONS);
      expect('promptConfig' in staticNode).toBe(false);
      expect('promptConfig' in aiNode).toBe(true);
    });

    it('should return NodeResult for QUESTIONS nodes', async () => {
      const questionsNode = new TestQuestionsNode(
        'q1',
        {
          type: NodeType.QUESTIONS,
          message: 'test',
          data: { questions: [] },
        } as unknown as TypedNodeResult,
        'Q1',
      );

      const questionsResult = await questionsNode.execute(
        createMutableContextHandle(mockContext),
      );

      expect(questionsResult).toHaveProperty('type', NodeType.QUESTIONS);
      expect(questionsResult).toHaveProperty('message', 'test');
    });

    it('should enforce twoPhase as true for both QUESTIONS and LLM_QUESTIONS', () => {
      const questionsNode = new TestQuestionsNode(
        'q',
        {
          type: NodeType.QUESTIONS,
          message: '',
          data: { questions: [] },
        } as unknown as TypedNodeResult,
        'Q',
      );

      const llmNode = new TestLlmQuestionsNode('llm', 'LLM');

      expect(questionsNode.twoPhase).toBe(true);
      expect(llmNode.twoPhase).toBe(true);
    });
  });

  describe('ACTION Node Comparison', () => {
    it('should allow ACTION nodes to continue without user response', () => {
      const actionNode = new TestActionNode('action', {
        type: NodeType.ACTION,
        message: 'Action executed',
        data: { type: 'ACTION_COMPLETE' },
      } as unknown as TypedNodeResult);

      expect(actionNode.twoPhase).toBe(false);
      expect(actionNode.type).toBe(NodeType.ACTION);
      expect(isActionNode(actionNode)).toBe(true);
    });

    it('should demonstrate that QUESTIONS nodes wait while ACTION nodes continue', () => {
      const questionsNode = new TestQuestionsNode(
        'q',
        {
          type: NodeType.QUESTIONS,
          message: '',
          data: { questions: [] },
        } as unknown as TypedNodeResult,
        'Q',
      );

      const actionNode = new TestActionNode(
        'a',
        {
          type: NodeType.ACTION,
          message: 'skip',
          data: { type: 'ACTION_COMPLETE' },
        } as unknown as TypedNodeResult,
        'A',
      );

      expect(questionsNode.type).toBe(NodeType.QUESTIONS);
      expect(actionNode.type).toBe(NodeType.ACTION);
      expect(questionsNode.twoPhase).toBe(true);
      expect(actionNode.twoPhase).toBe(false);
    });
  });

  describe('NodeResult Type Validation', () => {
    it('should validate QUESTIONS nodeResult structure', async () => {
      const node = new TestQuestionsNode(
        'validate_q',
        {
          type: NodeType.QUESTIONS,
          message: 'Test message',
          data: {
            questions: [{ id: 'q1', question: 'Test?' }],
          },
          uiElements: [
            {
              id: 'element1',
              type: 'textarea',
              label: 'Input',
            },
          ],
        } as unknown as TypedNodeResult,
        'Validate',
      );

      const result = await node.execute(
        createMutableContextHandle(mockContext),
      );

      expect(result).toBeDefined();
      expect(result.type).toBe(NodeType.QUESTIONS);
      expect(result.message).toBe('Test message');
      expect(result.data).toHaveProperty('questions');
      expect(result.uiElements).toHaveLength(1);
    });

    it('should validate LLM_QUESTIONS nodeResult structure', () => {
      const expectedResult: TypedNodeResult = {
        type: NodeType.LLM_QUESTIONS,
        message: 'AI generated message',
        data: {
          questions: [{ id: 'ai_q1', question: 'Context-aware question?' }],
        },
        uiElements: [
          {
            id: 'ai_element1',
            type: 'textarea',
            label: 'Your answer',
          },
        ],
      } as unknown as TypedNodeResult;

      expect(expectedResult.type).toBe(NodeType.LLM_QUESTIONS);
      expect(expectedResult.message).toBe('AI generated message');
      expect(expectedResult.data).toHaveProperty('questions');
      expect(expectedResult.uiElements).toHaveLength(1);
    });
  });
});

describe('Node Behavior - EXTERNAL_AGENT', () => {
  let mockContext: FlowContext;

  beforeEach(() => {
    mockContext = TestUtils.createMockFlowContext();
  });

  const buildMessage = (overrides: Partial<FlowUserMessage>): FlowUserMessage =>
    ({
      id: testIds.message,
      workflowId: testIds.workflow,
      projectId: testIds.project,
      type: 'USER' as const,
      status: MessageStatus.Open,
      data: { message: 'hello' },
      conversationId: testIds.conversation,
      createdAt: new Date().toISOString(),
      timestamp: new Date().toISOString(),
      ...overrides,
    }) as FlowUserMessage;

  it('enforces twoPhase=true and EXTERNAL_AGENT type', () => {
    const node = new TestExternalAgentNode('ext_agent', {
      response: '',
      uiElements: [],
      triggersAgent: {
        promptType: LocalPromptType.startup_session,
        nodeId: 'ext_agent',
      },
    } as unknown as ExternalAgentTriggerMessage);

    expect(node.type).toBe(NodeType.EXTERNAL_AGENT);
    expect(node.twoPhase).toBe(true);
    expect(isExternalAgentNode(node)).toBe(true);
    expect(isQuestionsNode(node)).toBe(false);
    expect(isLLMQuestionsNode(node)).toBe(false);
  });

  it('emits a standard NodeResult with uiElements on entry (QUESTIONS-like)', async () => {
    const node = new TestExternalAgentNode('ext_agent_entry', {
      response: 'Waiting for CLI completion',
      uiElements: [
        {
          id: 'cli_prompt',
          type: 'textarea',
          label: 'CLI response',
        },
      ],
      triggersAgent: {
        promptType: LocalPromptType.startup_session,
        nodeId: 'ext_agent_entry',
      },
    } as unknown as ExternalAgentTriggerMessage);

    const result = await node.execute(createMutableContextHandle(mockContext));

    expect(result.type).toBe(NodeType.EXTERNAL_AGENT);
    expect(result.message).toBe('Waiting for CLI completion');
    expect(result.uiElements).toHaveLength(1);
  });

  describe('isCompletionCandidateMessage', () => {
    it('treats agent-authored (userId=system) non-CONTROL messages as candidates', () => {
      expect(
        isCompletionCandidateMessage(buildMessage({ userId: 'system' })),
      ).toBe(true);
    });

    it('treats user-authored (human uuid) non-CONTROL messages as candidates', () => {
      // The core of the loosening: a USER button click is now a legitimate
      // completion candidate regardless of authorship.
      expect(
        isCompletionCandidateMessage(buildMessage({ userId: 'user-123' })),
      ).toBe(true);
    });

    it('excludes synthetic CONTROL messages regardless of authorship', () => {
      expect(
        isCompletionCandidateMessage(
          buildMessage({
            userId: 'system',
            data: { type: 'CONTROL', message: 'skip' },
          }),
        ),
      ).toBe(false);
      expect(
        isCompletionCandidateMessage(
          buildMessage({
            userId: 'user-123',
            data: { type: 'CONTROL', message: 'skip' },
          }),
        ),
      ).toBe(false);
    });
  });

  describe('isNodeCompletionMessage (twoPhase resume predicate)', () => {
    const agentMsg = buildMessage({ userId: 'system' });
    const userMsg = buildMessage({ userId: 'user-abc' });
    const controlMsg = buildMessage({
      userId: 'system',
      data: { type: 'CONTROL' },
    });

    it('EXTERNAL_AGENT advances on a user-authored (button click) message', () => {
      expect(isNodeCompletionMessage(NodeType.EXTERNAL_AGENT, userMsg)).toBe(
        true,
      );
    });

    it('EXTERNAL_AGENT advances on an agent-authored completion', () => {
      expect(isNodeCompletionMessage(NodeType.EXTERNAL_AGENT, agentMsg)).toBe(
        true,
      );
    });

    it('EXTERNAL_AGENT does not treat CONTROL messages as agent completions', () => {
      expect(isNodeCompletionMessage(NodeType.EXTERNAL_AGENT, controlMsg)).toBe(
        false,
      );
    });

    it('QUESTIONS preserves today behavior — accepts user-authored messages', () => {
      expect(isNodeCompletionMessage(NodeType.QUESTIONS, userMsg)).toBe(true);
    });

    it('LLM_QUESTIONS preserves today behavior — accepts user-authored messages', () => {
      expect(isNodeCompletionMessage(NodeType.LLM_QUESTIONS, userMsg)).toBe(
        true,
      );
    });

    it('non-EXTERNAL_AGENT twoPhase nodes still accept any message (no regression)', () => {
      for (const nodeType of [
        NodeType.QUESTIONS,
        NodeType.LLM_QUESTIONS,
        NodeType.GENERATE,
        NodeType.CLASSIFICATION,
        NodeType.AGENT,
        NodeType.CONFIRM,
        NodeType.FINALIZE,
      ]) {
        expect(isNodeCompletionMessage(nodeType, userMsg)).toBe(true);
        expect(isNodeCompletionMessage(nodeType, agentMsg)).toBe(true);
        expect(isNodeCompletionMessage(nodeType, controlMsg)).toBe(true);
      }
    });

    it('unknown node type strings default to accepting any message (safe fallback)', () => {
      // Future-proofing: callers pass `state.nodeConfig.type` which is a
      // string. An unknown value must not accidentally block every message.
      expect(isNodeCompletionMessage('UNKNOWN', userMsg)).toBe(true);
      expect(isNodeCompletionMessage('', userMsg)).toBe(true);
    });
  });

  describe('isCompletionCandidateMessage edge cases', () => {
    it('treats a candidate with missing data as a candidate (no type field)', () => {
      const msg = buildMessage({ userId: 'system' });
      (msg as FlowUserMessage).data = undefined as unknown as Record<
        string,
        unknown
      >;
      expect(isCompletionCandidateMessage(msg)).toBe(true);
    });

    it('treats data lacking a type field as a candidate', () => {
      expect(
        isCompletionCandidateMessage(
          buildMessage({ userId: 'user-123', data: { message: 'hi' } }),
        ),
      ).toBe(true);
    });

    it('treats non-CONTROL type values as candidates', () => {
      expect(
        isCompletionCandidateMessage(
          buildMessage({
            userId: 'user-123',
            data: {
              type: 'SOMETHING_ELSE',
            } as unknown as FlowUserMessage['data'],
          }),
        ),
      ).toBe(true);
    });

    it('is case-sensitive: only exact "CONTROL" is excluded', () => {
      // A near-miss type string must not accidentally be dropped — only the
      // exact CONTROL discriminator routes through the separate steering path.
      expect(
        isCompletionCandidateMessage(
          buildMessage({
            userId: 'system',
            data: { type: 'control' } as unknown as FlowUserMessage['data'],
          }),
        ),
      ).toBe(true);
    });
  });

  describe('isExternalAgentNodeResult type guard', () => {
    it('returns true for an EXTERNAL_AGENT-typed result', () => {
      const result: TypedNodeResult = {
        type: NodeType.EXTERNAL_AGENT,
        message: 'wait for CLI',
        data: { questions: [] },
      } as unknown as TypedNodeResult;

      expect(isExternalAgentNodeResult(result)).toBe(true);
    });

    it('returns false for QUESTIONS results (disambiguated from similar shape)', () => {
      const result: TypedNodeResult = {
        type: NodeType.QUESTIONS,
        message: 'ask',
        data: { questions: [] },
      } as unknown as TypedNodeResult;

      expect(isExternalAgentNodeResult(result)).toBe(false);
      expect(isQuestionsNodeResult(result)).toBe(true);
    });

    it('returns false for results of other node types', () => {
      for (const type of [
        NodeType.LLM_QUESTIONS,
        NodeType.ACTION,
        NodeType.AGENT,
        NodeType.CLASSIFICATION,
        NodeType.GENERATE,
        NodeType.FINALIZE,
      ]) {
        expect(
          isExternalAgentNodeResult({
            type,
            message: '',
            data: {},
          } as unknown as TypedNodeResult),
        ).toBe(false);
      }
    });
  });

  describe('TypeEnum zod schema', () => {
    it('accepts EXTERNAL_AGENT as a valid workflow structure node type', () => {
      expect(TypeEnum.safeParse(NodeType.EXTERNAL_AGENT).success).toBe(true);
      expect(TypeEnum.safeParse('external_agent').success).toBe(true);
    });

    it('still accepts every existing whitelisted node type (regression guard)', () => {
      const preExisting: readonly string[] = [
        NodeType.QUESTIONS,
        NodeType.LLM_QUESTIONS,
        NodeType.ANALYZE,
        NodeType.GENERATE,
        NodeType.FINALIZE,
        NodeType.NOOP,
        NodeType.ACTION,
        NodeType.AGENT,
        NodeType.CLASSIFICATION,
        NodeType.NON_INTERACTIVE,
      ];
      for (const value of preExisting) {
        expect(TypeEnum.safeParse(value).success).toBe(true);
      }
    });

    it('rejects unknown node type strings', () => {
      expect(TypeEnum.safeParse('not_a_real_node_type').success).toBe(false);
      expect(TypeEnum.safeParse('').success).toBe(false);
    });
  });

  describe('validateExternalAgentCompletion', () => {
    const actions = {
      NO_DISCREPANCY: {
        schema: z.object({}).optional(),
        waitForUser: false,
      },
      DISCREPANCY: {
        schema: z.object({ items: z.array(z.string()).min(1) }),
        waitForUser: true,
      },
    } as const;

    const buildMsg = (data: Record<string, unknown>): FlowUserMessage =>
      ({
        id: testIds.message,
        workflowId: testIds.workflow,
        projectId: testIds.project,
        type: 'USER' as const,
        status: MessageStatus.Open,
        conversationId: testIds.conversation,
        createdAt: new Date().toISOString(),
        timestamp: new Date().toISOString(),
        userId: 'system',
        data,
      }) as FlowUserMessage;

    it('returns the validated action on a matching schema', () => {
      const result = validateExternalAgentCompletion({
        nodeId: 'ext',
        actions,
        message: buildMsg({
          action: 'DISCREPANCY',
          payload: { items: ['spec field X missing'] },
        }),
      });

      expect(result.action).toBe('DISCREPANCY');
    });

    it('accepts actions whose schema permits an absent payload', () => {
      const result = validateExternalAgentCompletion({
        nodeId: 'ext',
        actions,
        message: buildMsg({ action: 'NO_DISCREPANCY' }),
      });

      expect(result.action).toBe('NO_DISCREPANCY');
    });

    it('throws ExternalAgentValidationError with reason=missing_action when action is absent', () => {
      expect(() =>
        validateExternalAgentCompletion({
          nodeId: 'ext',
          actions,
          message: buildMsg({ payload: { items: ['x'] } }),
        }),
      ).toThrow(ExternalAgentValidationError);

      try {
        validateExternalAgentCompletion({
          nodeId: 'ext',
          actions,
          message: buildMsg({}),
        });
      } catch (err) {
        expect(err).toBeInstanceOf(ExternalAgentValidationError);
        expect((err as ExternalAgentValidationError).reason).toBe(
          'missing_action',
        );
      }
    });

    it('throws with reason=unknown_action when action is not declared on the node', () => {
      try {
        validateExternalAgentCompletion({
          nodeId: 'ext',
          actions,
          message: buildMsg({ action: 'NEVER_DECLARED', payload: {} }),
        });
        fail('expected validation to throw');
      } catch (err) {
        expect(err).toBeInstanceOf(ExternalAgentValidationError);
        expect((err as ExternalAgentValidationError).reason).toBe(
          'unknown_action',
        );
        expect((err as ExternalAgentValidationError).action).toBe(
          'NEVER_DECLARED',
        );
      }
    });

    it('throws with reason=invalid_payload and surfaces zod issues when payload fails schema', () => {
      try {
        validateExternalAgentCompletion({
          nodeId: 'ext',
          actions,
          message: buildMsg({
            action: 'DISCREPANCY',
            payload: { items: [] },
          }),
        });
        fail('expected validation to throw');
      } catch (err) {
        expect(err).toBeInstanceOf(ExternalAgentValidationError);
        const validationErr = err as ExternalAgentValidationError;
        expect(validationErr.reason).toBe('invalid_payload');
        expect(validationErr.action).toBe('DISCREPANCY');
        expect(Array.isArray(validationErr.issues)).toBe(true);
        expect(validationErr.issues!.length).toBeGreaterThan(0);
      }
    });
  });
});
