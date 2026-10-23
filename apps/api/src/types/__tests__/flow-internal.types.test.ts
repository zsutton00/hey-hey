import { LocalPromptType } from 'src/generated/local';
import {
  NodeType,
  AgentNodeBase,
  LlmQuestionsNodeBase,
  isAgentNode,
  isPromptConfigurableNode,
  type FlowContext,
  type FlowTemplate,
  type NodeRoutingConfig,
  type ProcessAgentResponseResult,
  type MutableContextHandle,
} from '../flow-internal.types';
import { createMutableContextHandle } from '../../utils/mutable-context';
import * as TestUtils from '../../utils/testUtils';
import { z } from 'zod';
import {
  type AgentResponseShape,
  type MastraAgentResponse,
} from '../../services/agents/mastra-client.service';

const assertDefined = <T>(value: T | undefined, label: string): T => {
  if (value === undefined) {
    throw new Error(`Expected ${label} to be defined`);
  }
  return value;
};

type AgentResponseHandler<TContext extends FlowContext> = (
  agentResponse: MastraAgentResponse<AgentResponseShape>,
  context: MutableContextHandle<TContext>,
) => Promise<ProcessAgentResponseResult>;

const buildSuccessResult = (
  nextNodeId: string,
): ProcessAgentResponseResult => ({
  nextNodeId,
  systemMessageData: {
    type: 'QUESTIONS',
    title: 'Agent response',
    response: 'ok',
    uiElements: [],
  },
});

class TestAgentNode<
  TContext extends FlowContext = FlowContext,
> extends AgentNodeBase<TContext> {
  readonly id: string;
  readonly title: string;
  readonly agentId: string;
  readonly userPrompt?: string;
  readonly responseSchema?: z.ZodSchema;
  private readonly handler: AgentResponseHandler<TContext>;

  constructor(options: {
    id: string;
    agentId: string;
    title?: string;
    userPrompt?: string;
    responseSchema?: z.ZodSchema;
    handler?: AgentResponseHandler<TContext>;
  }) {
    super();
    this.id = options.id;
    this.agentId = options.agentId;
    this.title = options.title ?? 'Test Agent';
    this.userPrompt = options.userPrompt;
    this.responseSchema = options.responseSchema;
    this.handler =
      options.handler ?? (async () => buildSuccessResult('next-node'));
  }

  async processAgentResponse(
    agentResponse: MastraAgentResponse<AgentResponseShape>,
    context: MutableContextHandle<TContext>,
  ): Promise<ProcessAgentResponseResult> {
    return this.handler(agentResponse, context);
  }

  async buildContext(
    context: MutableContextHandle<TContext>,
  ): Promise<Record<string, unknown>> {
    return {
      projectId: context.getContext().core.projectId,
    };
  }
}

class TestLlmQuestionsNode extends LlmQuestionsNodeBase<FlowContext> {
  readonly id: string;
  readonly promptConfig = {
    systemPromptTemplate: 'Test prompt',
    responseSchema: z.object({}),
  };

  constructor(id = 'test-llm') {
    super();
    this.id = id;
  }
}

describe('Flow Internal Types', () => {
  describe('AgentNode Type Definition', () => {
    it('should enforce that AGENT nodes have an explicit agentId field for type safety', () => {
      // EXPECTATION: AgentNode type must require an agentId field to prevent runtime agent resolution failures
      // RATIONALE: Agent nodes need explicit agent IDs to ensure the flow processor can correctly
      // identify and execute the appropriate Mastra agent. Missing agent IDs would cause execution failures.

      const validAgentNode = new TestAgentNode({
        id: 'test-agent-node',
        agentId: 'test-agent',
        title: 'Test Agent Node',
      });

      expect(validAgentNode.agentId).toBe('test-agent');
      expect(validAgentNode.type).toBe(NodeType.AGENT);

      // TypeScript compilation validates that agentId is required
      expect(typeof validAgentNode.agentId).toBe('string');
    });

    it('should allow optional userPrompt and responseSchema for agent configuration', () => {
      // EXPECTATION: AgentNode should support optional userPrompt and responseSchema for flexibility
      // RATIONALE: Agents may use dynamic prompts or schema validation depending on the workflow.

      const agentNodeWithoutOptions = new TestAgentNode({
        id: 'minimal-agent',
        agentId: 'minimal-agent',
        title: 'Minimal Agent',
      });

      const agentNodeWithOptions = new TestAgentNode({
        id: 'config-agent',
        agentId: 'config-agent',
        title: 'Config Agent',
        userPrompt: 'Fallback prompt',
        responseSchema: z.object({}),
      });

      expect(agentNodeWithoutOptions.userPrompt).toBeUndefined();
      expect(agentNodeWithOptions.userPrompt).toBe('Fallback prompt');

      // Both should be valid AgentNode instances
      expect(agentNodeWithoutOptions.type).toBe(NodeType.AGENT);
      expect(agentNodeWithOptions.type).toBe(NodeType.AGENT);
    });

    it('should support proper flow context typing for initiative refinement workflows', () => {
      // EXPECTATION: AgentNode should work correctly with specific flow context types
      // RATIONALE: Initiative refinement flows have specific context requirements.
      // AgentNode must be compatible with these typed contexts to ensure proper data access.

      interface TestFlowContext extends FlowContext {
        initiativeId?: string;
        userFeedback?: Record<string, unknown>;
      }

      const contextSpecificAgentNode = new TestAgentNode<TestFlowContext>({
        id: 'context-agent',
        agentId: 'context-agent',
        title: 'Context-Aware Agent',
        handler: async (_agentResponse, context) => {
          // Should have access to typed context
          expect(context.getContext().core).toBeDefined();
          return buildSuccessResult('next-node');
        },
      });

      expect(contextSpecificAgentNode).toBeDefined();
      expect(contextSpecificAgentNode.agentId).toBe('context-agent');
    });

    it('should require processAgentResponse for custom agent completion handling', () => {
      // EXPECTATION: AgentNode should require processAgentResponse for handling agent completion
      // RATIONALE: Agent nodes must provide a routing decision and optional system message output.

      const agentNodeWithHandler = new TestAgentNode({
        id: 'custom-agent',
        agentId: 'custom-agent',
        title: 'Custom Agent',
        handler: async (agentResponse) => {
          if ((agentResponse.result?.confidence ?? 0) > 0.8) {
            return buildSuccessResult('success-node');
          }
          return buildSuccessResult('default-node');
        },
      });

      // Handler should be required and defined
      expect(agentNodeWithHandler.type).toBe(NodeType.AGENT);
      expect(typeof agentNodeWithHandler.processAgentResponse).toBe('function');
    });

    it('should ensure processAgentResponse returns a Promise<ProcessAgentResponseResult>', async () => {
      // EXPECTATION: processAgentResponse should return a Promise with routing + message data
      // RATIONALE: The flow processor needs a next node ID and optional system message details.

      const agentNode = new TestAgentNode({
        id: 'routing-agent',
        agentId: 'routing-agent',
        title: 'Routing Agent',
        handler: async (agentResponse) => {
          // Simulate processing
          await new Promise((resolve) => setTimeout(resolve, 1));

          if (agentResponse.result?.data) {
            return buildSuccessResult('success-node');
          }
          return buildSuccessResult('default-node');
        },
      });

      // Mock agent response and context
      const mockAgentResponse: MastraAgentResponse<AgentResponseShape> = {
        executionId: 'test-execution-id',
        status: 'completed' as const,
        result: {
          agentId: 'test-agent',
          data: {
            text: 'Agent completed successfully',
            summary: 'Test summary',
            reasoning: 'Test reasoning',
          },
          confidence: 0.9,
        },
        executionTime: 1000,
        cost: 0.01,
      };
      const testContext = TestUtils.createMockFlowContext({
        flowId: 'test-flow',
      });
      const mutableContext = createMutableContextHandle(testContext);
      // Call the handler and verify it returns routing data
      const result = await agentNode.processAgentResponse(
        mockAgentResponse,
        mutableContext,
      );

      expect(result.nextNodeId).toBe('success-node');
      if ('systemMessageData' in result) {
        const systemMessageData = assertDefined(
          result.systemMessageData,
          'system message data',
        );
        expect(systemMessageData.type).toBe('QUESTIONS');
      }
    });

    it('should support processAgentResponse with proper parameter types', () => {
      // EXPECTATION: processAgentResponse should have correctly typed parameters
      // RATIONALE: Type safety ensures the function receives the expected data structures
      // and prevents runtime errors during agent response processing.

      const agentNode = new TestAgentNode({
        id: 'typed-agent',
        agentId: 'typed-agent',
        title: 'Typed Agent',
        handler: async (agentResponse, context) => {
          // Verify types are available at compile time
          expect(agentResponse).toBeDefined();
          expect(context).toBeDefined();
          expect(context.getContext().core).toBeDefined();

          return buildSuccessResult('next-node');
        },
      });

      // Function should exist and be properly typed
      expect(typeof agentNode.processAgentResponse).toBe('function');
      expect(agentNode.processAgentResponse).toBeDefined();
    });
  });

  describe('Type Guard Functions', () => {
    it('should correctly identify AGENT nodes using isAgentNode type guard', () => {
      // EXPECTATION: isAgentNode should accurately distinguish AGENT nodes from other node types
      // RATIONALE: The flow processor uses type guards to determine how to execute different node types.
      // Incorrect type detection would cause AGENT nodes to be processed as regular LLM nodes,
      // bypassing agent execution logic.

      const agentNode = new TestAgentNode({
        id: 'test-agent',
        agentId: 'test-agent-id',
        title: 'Test Agent',
      });

      const nonAgentNode = new TestLlmQuestionsNode('test-gather');

      expect(isAgentNode(agentNode)).toBe(true);
      expect(isAgentNode(nonAgentNode)).toBe(false);
    });

    it('should exclude AGENT nodes from prompt-configurable type guard to prevent processing conflicts', () => {
      // EXPECTATION: isPromptConfigurableNode should return false for AGENT nodes to ensure proper type separation
      // RATIONALE: AGENT nodes have different processing logic than prompt-configurable LLM node types.
      // Including AGENT nodes in prompt-configurable LLM nodes would cause the flow processor to use incorrect
      // execution logic, bypassing agent-specific handling.

      const agentNode = new TestAgentNode({
        id: 'test-agent',
        agentId: 'test-agent-id',
        title: 'Test Agent',
      });

      const llmNode = new TestLlmQuestionsNode('test-confirm');

      expect(isPromptConfigurableNode(agentNode)).toBe(false);
      expect(isPromptConfigurableNode(llmNode)).toBe(true);
    });

    it('should provide type narrowing that enables safe property access', () => {
      // EXPECTATION: Type guards should enable TypeScript to narrow types for safe property access
      // RATIONALE: After type guard validation, developers should be able to access type-specific
      // properties without TypeScript errors. This enables safe runtime type handling.

      const unknownNode = new TestAgentNode({
        id: 'unknown-node',
        agentId: 'unknown-agent',
        title: 'Unknown Node',
      });

      if (isAgentNode(unknownNode)) {
        // TypeScript should allow access to agentId after type guard
        expect(unknownNode.agentId).toBe('unknown-agent');
        expect(typeof unknownNode.agentId).toBe('string');
      } else {
        fail('Type guard should have identified this as an AgentNode');
      }
    });
  });

  describe('Node Type Hierarchy', () => {
    it('should properly separate AGENT nodes from other LLM node types in the type hierarchy', () => {
      // EXPECTATION: AGENT nodes should be a distinct type category separate from LLMOptionalNode and LLMRequiredNode
      // RATIONALE: AGENT nodes have fundamentally different execution logic (delegating to Mastra agents)
      // compared to other LLM nodes (direct LLM API calls). This separation ensures proper type safety
      // and prevents incorrect processing logic.

      const agentNode = new TestAgentNode({
        id: 'hierarchy-agent',
        agentId: 'hierarchy-agent-id',
        title: 'Hierarchy Test Agent',
      });

      // Verify type properties
      expect(agentNode.type).toBe(NodeType.AGENT);
      expect('agentId' in agentNode).toBe(true);

      // Verify type separation
      expect(isAgentNode(agentNode)).toBe(true);
      expect(isPromptConfigurableNode(agentNode)).toBe(false);
    });

    it('should enforce required fields for AGENT nodes at compile time', () => {
      // EXPECTATION: TypeScript should enforce that all required AgentNode fields are present
      // RATIONALE: Missing required fields would cause runtime errors when the flow processor
      // tries to execute the agent. Compile-time enforcement prevents these errors.

      // These tests pass by virtue of TypeScript compilation
      // Missing required fields would cause compilation errors

      const completeAgentNode = new TestAgentNode({
        id: 'complete-agent',
        agentId: 'complete-agent-id',
        title: 'Complete Agent',
      });

      expect(completeAgentNode.id).toBeDefined();
      expect(completeAgentNode.type).toBeDefined();
      expect(completeAgentNode.agentId).toBeDefined();
      expect(completeAgentNode.title).toBeDefined();
    });
  });

  describe('Integration with Flow System', () => {
    it('should support routing configuration for post-agent-execution flow control', () => {
      // EXPECTATION: AgentNode should support the same routing capabilities as other flow nodes
      // RATIONALE: After agent execution, the flow must continue to the next appropriate node
      // based on agent results. AgentNode must support the same routing mechanisms as other nodes.

      const routingAgentNode = new TestAgentNode({
        id: 'routing-agent',
        agentId: 'routing-agent-id',
        title: 'Routing Test Agent',
      });

      const routingConfig: NodeRoutingConfig = {
        transitions: {
          success: {
            description: 'Agent success',
            nextNodeId: 'success-node',
          },
          failure: {
            description: 'Agent failure',
            nextNodeId: 'failure-node',
          },
          default: {
            description: 'Fallback routing',
            nextNodeId: 'default-node',
          },
        },
      };

      if ('transitions' in routingConfig) {
        const transitions = assertDefined(
          routingConfig.transitions,
          'routing transitions',
        );
        const success = assertDefined(
          transitions.success,
          'success transition',
        );
        const failure = assertDefined(
          transitions.failure,
          'failure transition',
        );
        const fallback = assertDefined(
          transitions.default,
          'default transition',
        );
        expect(success.nextNodeId).toBe('success-node');
        expect(failure.nextNodeId).toBe('failure-node');
        expect(fallback.nextNodeId).toBe('default-node');
      } else {
        fail('Routing config should include transitions for this test');
      }
      expect(routingAgentNode.type).toBe(NodeType.AGENT);
    });

    it('should maintain compatibility with existing flow execution infrastructure', () => {
      // EXPECTATION: AgentNode should work seamlessly with existing flow processing infrastructure
      // RATIONALE: AgentNode is an extension of the existing flow system, not a replacement.
      // It must maintain compatibility with existing flow processing, routing, and context management.

      const compatibleAgentNode = new TestAgentNode({
        id: 'compatible-agent',
        agentId: 'compatible-agent-id',
        title: 'Compatible Agent',
      });

      // Should have standard node properties
      expect(compatibleAgentNode.id).toBeDefined();
      expect(compatibleAgentNode.type).toBeDefined();
      expect(compatibleAgentNode.title).toBeDefined();

      // Should be usable in flow structures
      const mockFlow: FlowTemplate = {
        id: 'test-flow',
        name: 'Test Flow',
        description: 'Test flow for agent nodes',
        version: 1,
        startNode: compatibleAgentNode.id,
        terminalPromptType: LocalPromptType.free_form,
        nodes: {
          [compatibleAgentNode.id]: {
            nextNode: 'end',
          },
          end: {},
        },
      };

      expect(mockFlow.nodes[compatibleAgentNode.id]).toEqual({
        nextNode: 'end',
      });
    });
  });

  describe('Error Prevention and Validation', () => {
    it('should prevent common configuration errors through type constraints', () => {
      // EXPECTATION: The type system should prevent common misconfigurations that cause runtime errors
      // RATIONALE: Strong typing catches configuration errors at compile time rather than runtime,
      // improving system reliability and developer experience.

      // Valid configuration
      const validAgentNode = new TestAgentNode({
        id: 'valid-agent',
        agentId: 'valid-agent-id',
        title: 'Valid Agent',
      });

      expect(validAgentNode).toBeDefined();

      // TypeScript prevents these invalid configurations:
      // - Missing agentId field
      // - Wrong type value
      // - Invalid property types

      expect(validAgentNode.agentId).toBeTruthy();
      expect(validAgentNode.type).toBe(NodeType.AGENT);
    });

    it('should support extension without breaking existing functionality', () => {
      // EXPECTATION: The AgentNode type should be extensible for future enhancements
      // RATIONALE: As the system evolves, new capabilities may be added to agent nodes.
      // The type structure should support extension without breaking existing code.

      // Create an extended agent node by intersection
      class ExtendedAgentNode extends TestAgentNode {
        readonly executionTimeout = 60000;
        readonly retryPolicy = {
          maxRetries: 3,
          backoffMs: 1000,
        };
      }

      const baseAgentNode = new TestAgentNode({
        id: 'extended-agent',
        agentId: 'extended-agent-id',
        title: 'Extended Agent',
      });

      const extendedNode = new ExtendedAgentNode({
        id: 'extended-agent',
        agentId: 'extended-agent-id',
        title: 'Extended Agent',
      });

      // Should still be a valid AgentNode
      expect(isAgentNode(baseAgentNode)).toBe(true);
      expect(extendedNode.agentId).toBe('extended-agent-id');
      expect(extendedNode.executionTimeout).toBe(60000);
    });
  });
});
