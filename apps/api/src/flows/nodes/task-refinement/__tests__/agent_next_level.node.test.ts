import { TestingModule } from '@nestjs/testing';
import { createServiceTestingModule } from 'src/../test/setup/testing-module.factory';
import { TaskSectionUpdateSource, WorkStatus } from 'src/generated';
import { ArtifactService } from 'src/services/artifacts/artifact.service';
import { InitiativeService } from 'src/services/initiatives/initiative.service';
import { TaskService } from 'src/services/tasks/task.service';
import { WorkItemTypeRegistryService } from 'src/services/tasks/work-item-type-registry.service';
import {
  NodeType,
  TaskRefinementFlowContext,
} from 'src/types/flow-internal.types';
import * as TestUtils from 'src/utils/testUtils';
import { createMutableContextHandle } from 'src/utils/mutable-context';
import { createWarmWorkItemTypeRegistry } from 'src/../test/setup/work-item-type-registry.fixture';
import { TaskRefinementAgentNextLevelNode } from '../agent_next_level.node';

describe('TaskRefinementAgentNextLevelNode', () => {
  let module: TestingModule;
  let node: TaskRefinementAgentNextLevelNode;
  let taskService: ReturnType<typeof TestUtils.createMockTaskService>;
  let initiativeService: ReturnType<
    typeof TestUtils.createMockInitiativeService
  >;
  let artifactService: ReturnType<typeof TestUtils.createMockArtifactService>;
  const baseContext = TestUtils.createMockFlowContext();
  const context: TaskRefinementFlowContext = {
    ...baseContext,
    core: {
      ...baseContext.core,
      workflowAboutType: 'task',
      workflowAboutId: TestUtils.testIds.task,
    },
    taskId: TestUtils.testIds.task,
    initiativeId: TestUtils.testIds.initiative,
  };

  beforeEach(async () => {
    taskService = TestUtils.createMockTaskService();
    initiativeService = TestUtils.createMockInitiativeService();
    artifactService = TestUtils.createMockArtifactService();

    const warmWorkItemTypeRegistry = await createWarmWorkItemTypeRegistry();

    const setup = await createServiceTestingModule({
      providers: [TaskRefinementAgentNextLevelNode],
      overrides: [
        [TaskService, taskService],
        [InitiativeService, initiativeService],
        [ArtifactService, artifactService],
        [WorkItemTypeRegistryService, warmWorkItemTypeRegistry],
      ],
    });

    module = setup.module;
    node = module.get(TaskRefinementAgentNextLevelNode);
  });

  afterEach(async () => {
    await module?.close();
  });

  it('exposes metadata and schema', () => {
    expect(node.id).toBe('task-refinement-agent-next-level');
    expect(node.type).toBe(NodeType.AGENT);
    expect(node.responseSchema).toBeDefined();
  });

  it('uses task-refiner agent', () => {
    expect(node.agentId).toBe('task-refiner');
  });

  it('response schema validates operations pattern', () => {
    const validResponse = {
      ops: [
        {
          type: 'replace',
          target: 'details',
          text: 'Generated details content',
        },
      ],
      response: 'Here is the generated content',
      sectionCompleteConfidence: 0.9,
      relatedEntities: [],
    };

    const result = node.responseSchema.safeParse(validResponse);
    expect(result.success).toBe(true);
  });

  it('response schema supports operations with influences', () => {
    const responseWithInfluences = {
      ops: [
        {
          type: 'replace',
          target: 'acceptanceCriteria',
          text: 'Generated acceptance criteria',
        },
      ],
      response: 'Content generated based on context',
      sectionCompleteConfidence: 0.85,
      relatedEntities: [],
      influences: [
        {
          entityId: 'artifact-123',
          entityType: 'ARTIFACT',
          reasoning: 'Referenced for context',
          reasonType: 'explicit_mention',
          confidence: 0.9,
        },
      ],
    };

    const result = node.responseSchema.safeParse(responseWithInfluences);
    expect(result.success).toBe(true);
  });

  it('response schema requires valid operation types', () => {
    const invalidResponse = {
      ops: [
        {
          type: 'invalid_type',
          target: 'details',
          text: 'Test content',
        },
      ],
      sectionCompleteConfidence: 0.7,
      relatedEntities: [],
    };

    const result = node.responseSchema.safeParse(invalidResponse);
    expect(result.success).toBe(false);
  });

  describe('processAgentResponse', () => {
    it('with REFINING_DESCRIPTION status should progress to REFINING_ACCEPTANCE_CRITERIA and update acceptanceCriteria field', async () => {
      const task = TestUtils.createMockTaskResponseDto({
        status: 'REFINING_DESCRIPTION' as any,
      });
      taskService.findOne = jest.fn().mockResolvedValue(task);
      taskService.update = jest.fn().mockResolvedValue(undefined);

      const agentResponse = {
        result: {
          data: {
            ops: [
              {
                type: 'replace',
                target: 'acceptanceCriteria',
                text: 'Generated acceptance criteria',
              },
            ],
            response: 'Here is the generated content',
            sectionCompleteConfidence: 0.9,
            relatedEntities: [],
          },
        },
      } as any;

      const tracker = createMutableContextHandle(context);
      const result = await node.processAgentResponse(agentResponse, tracker);

      expect(taskService.update).toHaveBeenCalledWith(
        context.core.organizationId,
        context.initiativeId,
        task.id,
        {
          status: 'REFINING_ACCEPTANCE_CRITERIA',
          sections: [
            {
              key: 'acceptanceCriteria',
              content: 'Generated acceptance criteria',
              order: 1,
            },
          ],
          sectionUpdateSource: TaskSectionUpdateSource.AgentSuggested,
        },
      );
      expect(result.nextNodeId).toBe('task-refinement-agent-editor');
    });

    it('with GENERATING_DESCRIPTION status should transition to REFINING_DESCRIPTION and update description field', async () => {
      const task = TestUtils.createMockTaskResponseDto({
        status: 'GENERATING_DESCRIPTION' as any,
      });
      taskService.findOne = jest.fn().mockResolvedValue(task);
      taskService.update = jest.fn().mockResolvedValue(undefined);

      const agentResponse = {
        result: {
          data: {
            ops: [
              {
                type: 'replace',
                target: 'description',
                text: 'Generated description content',
              },
            ],
            response: 'Here is the generated content',
            sectionCompleteConfidence: 0.9,
            relatedEntities: [],
          },
        },
      } as any;

      const tracker = createMutableContextHandle(context);
      const result = await node.processAgentResponse(agentResponse, tracker);

      expect(taskService.update).toHaveBeenCalledWith(
        context.core.organizationId,
        context.initiativeId,
        task.id,
        {
          status: 'REFINING_DESCRIPTION',
          sections: [
            {
              key: 'description',
              content: 'Generated description content',
              order: 0,
            },
          ],
          sectionUpdateSource: TaskSectionUpdateSource.AgentSuggested,
        },
      );
      expect(result.nextNodeId).toBe('task-refinement-agent-editor');
    });

    it('with GENERATING_DETAILS status should transition to REFINING_ACCEPTANCE_CRITERIA and update acceptance field', async () => {
      const task = TestUtils.createMockTaskResponseDto({
        status: 'GENERATING_DETAILS' as any,
      });
      taskService.findOne = jest.fn().mockResolvedValue(task);
      taskService.update = jest.fn().mockResolvedValue(undefined);

      const agentResponse = {
        result: {
          data: {
            ops: [
              {
                type: 'replace',
                target: 'acceptanceCriteria',
                text: 'Generated acceptance criteria',
              },
            ],
            response: 'Here is the generated content',
            sectionCompleteConfidence: 0.85,
            relatedEntities: [],
          },
        },
      } as any;

      const tracker = createMutableContextHandle(context);
      const result = await node.processAgentResponse(agentResponse, tracker);

      expect(taskService.update).toHaveBeenCalledWith(
        context.core.organizationId,
        context.initiativeId,
        task.id,
        {
          status: 'REFINING_ACCEPTANCE_CRITERIA',
          sections: [
            {
              key: 'acceptanceCriteria',
              content: 'Generated acceptance criteria',
              order: 1,
            },
          ],
          sectionUpdateSource: TaskSectionUpdateSource.AgentSuggested,
        },
      );
      expect(result.nextNodeId).toBe('task-refinement-agent-editor');
    });

    it('with REFINING_DETAILS status should progress to REFINING_ACCEPTANCE_CRITERIA and update acceptanceCriteria field', async () => {
      const task = TestUtils.createMockTaskResponseDto({
        status: 'REFINING_DETAILS' as any,
      });
      taskService.findOne = jest.fn().mockResolvedValue(task);
      taskService.update = jest.fn().mockResolvedValue(undefined);

      const agentResponse = {
        result: {
          data: {
            ops: [
              {
                type: 'replace',
                target: 'acceptanceCriteria',
                text: 'Generated acceptance criteria',
              },
            ],
            response: 'Here is the generated content',
            sectionCompleteConfidence: 0.9,
            relatedEntities: [],
          },
        },
      } as any;

      const tracker = createMutableContextHandle(context);
      const result = await node.processAgentResponse(agentResponse, tracker);

      expect(taskService.update).toHaveBeenCalledWith(
        context.core.organizationId,
        context.initiativeId,
        task.id,
        {
          status: 'REFINING_ACCEPTANCE_CRITERIA',
          sections: [
            {
              key: 'acceptanceCriteria',
              content: 'Generated acceptance criteria',
              order: 1,
            },
          ],
          sectionUpdateSource: TaskSectionUpdateSource.AgentSuggested,
        },
      );
      expect(result.nextNodeId).toBe('task-refinement-agent-editor');
    });

    it('with GENERATING_ACCEPTANCE_CRITERIA status should transition to REFINING_ACCEPTANCE_CRITERIA and update acceptanceCriteria field', async () => {
      const task = TestUtils.createMockTaskResponseDto({
        status: 'GENERATING_ACCEPTANCE_CRITERIA' as any,
      });
      taskService.findOne = jest.fn().mockResolvedValue(task);
      taskService.update = jest.fn().mockResolvedValue(undefined);

      const agentResponse = {
        result: {
          data: {
            ops: [
              {
                type: 'replace',
                target: 'acceptanceCriteria',
                text: 'Generated acceptance criteria',
              },
            ],
            response: 'Here is the generated content',
            sectionCompleteConfidence: 0.88,
            relatedEntities: [],
          },
        },
      } as any;

      const tracker = createMutableContextHandle(context);
      const result = await node.processAgentResponse(agentResponse, tracker);

      expect(taskService.update).toHaveBeenCalledWith(
        context.core.organizationId,
        context.initiativeId,
        task.id,
        {
          status: 'REFINING_ACCEPTANCE_CRITERIA',
          sections: [
            {
              key: 'acceptanceCriteria',
              content: 'Generated acceptance criteria',
              order: 1,
            },
          ],
          sectionUpdateSource: TaskSectionUpdateSource.AgentSuggested,
        },
      );
      expect(result.nextNodeId).toBe('task-refinement-agent-editor');
    });

    it('should handle missing task gracefully', async () => {
      taskService.findOne = jest.fn().mockResolvedValue(null);

      const agentResponse = {
        result: {
          data: {
            ops: [
              {
                type: 'replace',
                target: 'details',
                text: 'Generated content',
              },
            ],
            response: 'Here is the generated content',
            sectionCompleteConfidence: 0.9,
            relatedEntities: [],
          },
        },
      } as any;

      const tracker = createMutableContextHandle(context);
      const result = await node.processAgentResponse(agentResponse, tracker);

      expect(result.nextNodeId).toBe('task-refinement-agent-next-level');
      if (!('errorMsg' in result)) {
        throw new Error('Expected error result');
      }
      expect(result.errorMsg).toBeDefined();
    });

    it('should return error when agent response has no result', async () => {
      const agentResponse = {
        result: null,
        executionId: 'test-exec-id',
        status: 'failed',
        error: 'Agent failed',
      } as any;

      const tracker = createMutableContextHandle(context);
      const result = await node.processAgentResponse(agentResponse, tracker);

      expect(result.nextNodeId).toBe('task-refinement-agent-next-level');
      if (!('errorMsg' in result)) {
        throw new Error('Expected error result');
      }
      expect(result.errorMsg).toContain('missing result field');
    });

    it('should return error when response validation fails', async () => {
      const task = TestUtils.createMockTaskResponseDto({
        status: 'REFINING_DESCRIPTION' as any,
      });
      taskService.findOne = jest.fn().mockResolvedValue(task);

      const agentResponse = {
        result: {
          data: {
            ops: [
              {
                type: 'invalid_operation_type',
                target: 'details',
                text: 'Invalid content',
              },
            ],
            sectionCompleteConfidence: 0.9,
            relatedEntities: [],
          },
        },
        executionId: 'test-exec-id',
      } as any;

      const tracker = createMutableContextHandle(context);
      const result = await node.processAgentResponse(agentResponse, tracker);

      expect(result.nextNodeId).toBe('task-refinement-agent-next-level');
      if (!('errorMsg' in result)) {
        throw new Error('Expected error result');
      }
      expect(result.errorMsg).toContain('validation failed');
    });

    it('should build valid UI element with influences', async () => {
      const task = TestUtils.createMockTaskResponseDto({
        status: 'REFINING_DESCRIPTION' as any,
      });
      taskService.findOne = jest.fn().mockResolvedValue(task);
      taskService.update = jest.fn().mockResolvedValue(undefined);

      const agentResponse = {
        result: {
          data: {
            ops: [
              {
                type: 'replace',
                target: 'acceptanceCriteria',
                text: 'Generated content',
              },
            ],
            response: 'Here is the generated content',
            sectionCompleteConfidence: 0.9,
            relatedEntities: [],
            influences: [
              {
                entityId: 'artifact-123',
                entityType: 'ARTIFACT',
                reasoning: 'Referenced for context',
                reasonType: 'explicit_mention',
                confidence: 0.9,
              },
            ],
          },
        },
      } as any;

      const tracker = createMutableContextHandle(context);
      const result = await node.processAgentResponse(agentResponse, tracker);

      expect(result.nextNodeId).toBe('task-refinement-agent-editor');
      if (
        !('systemMessageData' in result) ||
        !result.systemMessageData ||
        result.systemMessageData.type !== 'QUESTIONS'
      ) {
        throw new Error('Expected QUESTIONS system message');
      }
      expect(result.systemMessageData.uiElements).toHaveLength(1);
      expect(result.systemMessageData.uiElements?.[0]?.influences).toHaveLength(
        1,
      );
    });

    it('should apply multiple ops for current and future levels, advancing only to next section', async () => {
      const task = TestUtils.createMockTaskResponseDto({
        status: 'REFINING_DESCRIPTION' as any,
      });
      taskService.findOne = jest.fn().mockResolvedValue(task);
      taskService.update = jest.fn().mockResolvedValue(undefined);

      const agentResponse = {
        result: {
          data: {
            ops: [
              {
                type: 'replace',
                target: 'details',
                text: 'Generated details content',
              },
              {
                type: 'replace',
                target: 'acceptanceCriteria',
                text: 'Generated acceptance criteria content',
              },
            ],
            response: 'Generated content for multiple levels',
            sectionCompleteConfidence: 0.9,
            relatedEntities: [],
          },
        },
      } as any;

      const tracker = createMutableContextHandle(context);
      const result = await node.processAgentResponse(agentResponse, tracker);

      expect(taskService.update).toHaveBeenCalledWith(
        context.core.organizationId,
        context.initiativeId,
        task.id,
        {
          status: 'REFINING_ACCEPTANCE_CRITERIA',
          sections: [
            {
              key: 'acceptanceCriteria',
              content: 'Generated acceptance criteria content',
              order: 1,
            },
          ],
          sectionUpdateSource: TaskSectionUpdateSource.AgentSuggested,
        },
      );
      expect(result.nextNodeId).toBe('task-refinement-agent-editor');
    });
  });
});
