/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { TaskGenerationGenerateNode } from '../generate.node';
import { TaskService } from '../../../../services/tasks/task.service';
import { DesignDocService } from '../../../../services/design-doc/design-doc.service';
import * as TestUtils from '../../../../utils/testUtils';
import { MutableContext } from '../../../../utils/mutable-context';
import { TaskGenerationFlowContext } from '../../../../types/flow-internal.types';
import { Influence, Subfacet } from '@prisma/client';

describe('TaskGenerationGenerateNode', () => {
  let node: TaskGenerationGenerateNode;
  let taskService: jest.Mocked<TaskService>;
  let designDocService: jest.Mocked<DesignDocService>;
  const buildContext = (): TaskGenerationFlowContext => {
    const baseContext = TestUtils.createMockFlowContext();
    return {
      ...baseContext,
      core: {
        ...baseContext.core,
        organizationId: TestUtils.testIds.organization,
        projectId: TestUtils.testIds.project,
        conversationId: TestUtils.testIds.conversation,
        workflowAboutType: 'initiative',
        workflowAboutId: TestUtils.testIds.initiative,
      },
      initiativeId: TestUtils.testIds.initiative,
    };
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TaskGenerationGenerateNode,
        {
          provide: TaskService,
          useValue: TestUtils.createMockTaskService(),
        },
        {
          provide: DesignDocService,
          useValue: TestUtils.createMockDesignDocService(),
        },
      ],
    }).compile();

    node = module.get<TaskGenerationGenerateNode>(TaskGenerationGenerateNode);
    taskService = module.get(TaskService);
    designDocService = module.get(DesignDocService);
  });

  describe('processLlmResponse', () => {
    it('should pass artifact context through createFromDrafts', async () => {
      // Arrange
      const mockTasks = [
        TestUtils.createMockTaskResponseDto({ name: 'Task 1' }),
        TestUtils.createMockTaskResponseDto({ name: 'Task 2' }),
      ];

      (taskService.createFromDrafts as jest.Mock).mockResolvedValue(mockTasks);

      const systemMessageData = {
        type: 'TASKS',
        tasks: [
          {
            title: 'Task 1',
            description: 'Description 1',
            details: 'Details 1',
            acceptanceCriteria: 'Criteria 1',
            summary: 'Summary 1',
            category: 'technology',
            subfacets: [] as Subfacet[],
            priority_hint: {
              urgency: 'medium',
              importance: 'medium',
              effort: 'medium',
              blocking_state: 'independent',
            },
            influences: [] as Influence[],
          },
          {
            title: 'Task 2',
            description: 'Description 2',
            details: 'Details 2',
            acceptanceCriteria: 'Criteria 2',
            summary: 'Summary 2',
            category: 'product',
            subfacets: [] as Subfacet[],
            priority_hint: {
              urgency: 'high',
              importance: 'high',
              effort: 'large',
              blocking_state: 'blocking',
            },
            influences: [] as Influence[],
          },
        ],
        response: 'Created tasks successfully',
      };

      const context = buildContext();
      const tracker = new MutableContext<TaskGenerationFlowContext>(context);

      // Act
      await node.processLlmResponse(
        systemMessageData as any,
        undefined,
        tracker,
      );

      // Assert - Verify createFromDrafts was called with artifact context
      expect(taskService.createFromDrafts).toHaveBeenCalledTimes(1);
      expect(taskService.createFromDrafts).toHaveBeenCalledWith(
        expect.any(Array),
        TestUtils.testIds.organization,
        TestUtils.testIds.initiative,
        TestUtils.testIds.conversation,
        expect.objectContaining({
          projectId: TestUtils.testIds.project,
          generationModel: 'claude-haiku-4-5',
          generationPrompt: 'task-generation',
        }),
      );
    });

    it('should not fail task creation when task service resolves', async () => {
      // Arrange
      const mockTasks = [TestUtils.createMockTaskResponseDto()];
      (taskService.createFromDrafts as jest.Mock).mockResolvedValue(mockTasks);

      const systemMessageData = {
        type: 'TASKS',
        tasks: [
          {
            title: 'Task 1',
            description: 'Desc',
            details: 'Details',
            acceptanceCriteria: 'Criteria',
            summary: 'Summary',
            category: 'technology',
            subfacets: [] as Subfacet[],
            priority_hint: {
              urgency: 'medium',
              importance: 'medium',
              effort: 'medium',
              blocking_state: 'independent',
            },
            influences: [] as Influence[],
          },
        ],
        response: 'Created task',
      };

      const context = buildContext();
      const tracker = new MutableContext<TaskGenerationFlowContext>(context);

      // Act & Assert - Should NOT throw
      await expect(
        node.processLlmResponse(systemMessageData as any, undefined, tracker),
      ).resolves.toBeDefined();

      expect(taskService.createFromDrafts).toHaveBeenCalled();
    });

    it('should handle empty task arrays gracefully', async () => {
      // Arrange
      const mockTasks: any[] = [];
      (taskService.createFromDrafts as jest.Mock).mockResolvedValue(mockTasks);

      const systemMessageData = {
        type: 'TASKS',
        tasks: [] as Array<{
          title: string;
          description: string;
          details: string;
          acceptanceCriteria: string;
          summary: string;
          category: string;
          subfacets: Subfacet[];
          priority_hint: {
            urgency: string;
            importance: string;
            effort: string;
            blocking_state: string;
          };
          influences: Influence[];
        }>,
        response: 'No tasks to create',
      };

      const context = buildContext();
      const tracker = new MutableContext<TaskGenerationFlowContext>(context);

      // Act & Assert - Should handle empty array gracefully
      await expect(
        node.processLlmResponse(systemMessageData as any, undefined, tracker),
      ).resolves.toBeDefined();
    });
  });
});
