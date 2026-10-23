import { LocalPromptType } from 'src/generated/local';
import { Test, TestingModule } from '@nestjs/testing';
import { WorkflowExecutionService } from '../workflow-execution.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { InitiativeService } from '../../initiatives/initiative.service';
import { materializedSectionsToContentMap } from '../../../utils/work-item-section.util';
import { TaskService } from '../../tasks/task.service';
import * as TestUtils from '../../../utils/testUtils';
import { FlowTemplate } from '../../../types/flow-internal.types';

const { testIds } = TestUtils;

describe('WorkflowExecutionService - Skip to Node', () => {
  let service: WorkflowExecutionService;
  let initiativeService: InitiativeService;
  let taskService: TaskService;

  const mockFlowTemplate: FlowTemplate = {
    id: 'task-generation',
    name: 'Task Generation',
    description: 'Test flow',
    version: 1,
    startNode: 'welcome',
    terminalPromptType: LocalPromptType.free_form,
    nodes: {
      welcome: {
        nextNode: 'classify',
      },
      classify: {
        transitions: {
          generate_tasks: {
            description: 'Generate tasks from the initiative',
            nextNodeId: 'generate',
          },
          conversation: {
            description: 'Continue the conversation',
            nextNodeId: 'conversation',
          },
          default: {
            description: 'Continue the conversation',
            nextNodeId: 'conversation',
          },
        },
      },
      conversation: {
        nextNode: 'classify',
      },
      generate: {
        nextNode: 'end',
        skipToNode: {
          allowed: true,
          validPreviousNodes: ['conversation'],
          validateState: async (context, services) => {
            const initiative =
              await services.initiativeService.findOneForAdapter(
                (context as any).initiativeId,
                context.core.organizationId,
              );

            if (!initiative) {
              return { canSkip: false, reason: 'Initiative not found' };
            }

            const content = materializedSectionsToContentMap(
              initiative.sections,
            );
            if (!content.description.trim()) {
              return {
                canSkip: false,
                reason:
                  'Initiative must have a description before generating tasks',
              };
            }

            return { canSkip: true };
          },
        },
      },
      end: {
        // End node has no routing
      },
    },
  };

  const mockContext = {
    ...TestUtils.createMockFlowContext(),
    initiativeId: testIds.initiative,
  } as any;

  beforeEach(async () => {
    const mockPrismaService = TestUtils.createMockPrismaService();
    const mockInitiativeService = TestUtils.createMockInitiativeService();
    const mockTaskService = TestUtils.createMockTaskService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkflowExecutionService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: InitiativeService,
          useValue: mockInitiativeService,
        },
        {
          provide: TaskService,
          useValue: mockTaskService,
        },
      ],
    }).compile();

    service = module.get<WorkflowExecutionService>(WorkflowExecutionService);
    initiativeService = module.get<InitiativeService>(InitiativeService);
    taskService = module.get<TaskService>(TaskService);
  });

  describe('validateSkipToNode', () => {
    it('should allow skip when all validations pass', async () => {
      // INTENT: Test successful skip validation with proper state
      jest.spyOn(initiativeService, 'findOneForAdapter').mockResolvedValue({
        id: testIds.initiative,
        organizationId: testIds.organization,
        sections: TestUtils.createMockMaterializedWorkItemSections({
          description: 'Test initiative description',
        }),
      } as any);

      const result = await service.validateSkipToNode(
        mockFlowTemplate,
        'conversation',
        'generate',
        mockContext,
        testIds.organization,
      );

      expect(result.canSkip).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('should reject skip to non-existent node', async () => {
      // INTENT: Test validation fails for invalid target node
      const result = await service.validateSkipToNode(
        mockFlowTemplate,
        'conversation',
        'invalid_node',
        mockContext,
        testIds.organization,
      );

      expect(result.canSkip).toBe(false);
      expect(result.reason).toContain('does not exist');
    });

    it('should reject skip to node without skipToNode config', async () => {
      // INTENT: Test validation fails for nodes that aren't skip-to-able
      const result = await service.validateSkipToNode(
        mockFlowTemplate,
        'conversation',
        'welcome',
        mockContext,
        testIds.organization,
      );

      expect(result.canSkip).toBe(false);
      expect(result.reason).toContain('not configured as skip-to-able');
    });

    it('should reject skip from invalid previous node', async () => {
      // INTENT: Test validation fails when skipping from wrong node
      const result = await service.validateSkipToNode(
        mockFlowTemplate,
        'welcome',
        'generate',
        mockContext,
        testIds.organization,
      );

      expect(result.canSkip).toBe(false);
      expect(result.reason).toContain('Cannot skip to');
      expect(result.reason).toContain('from');
    });

    it('should reject skip when state validation fails - no initiative', async () => {
      // INTENT: Test state validation rejects when entity not found
      jest
        .spyOn(initiativeService, 'findOneForAdapter')
        .mockResolvedValue(null);

      const result = await service.validateSkipToNode(
        mockFlowTemplate,
        'conversation',
        'generate',
        mockContext,
        testIds.organization,
      );

      expect(result.canSkip).toBe(false);
      expect(result.reason).toBe('Initiative not found');
    });

    it('should reject skip when state validation fails - no description', async () => {
      // INTENT: Test state validation checks entity properties
      jest.spyOn(initiativeService, 'findOneForAdapter').mockResolvedValue({
        id: testIds.initiative,
        organizationId: testIds.organization,
        sections: TestUtils.createMockMaterializedWorkItemSections({
          description: '',
        }),
      } as any);

      const result = await service.validateSkipToNode(
        mockFlowTemplate,
        'conversation',
        'generate',
        mockContext,
        testIds.organization,
      );

      expect(result.canSkip).toBe(false);
      expect(result.reason).toBe(
        'Initiative must have a description before generating tasks',
      );
    });

    it('should allow skip from any node when validPreviousNodes is "*"', async () => {
      // INTENT: Test wildcard validPreviousNodes allows all source nodes
      const templateWithWildcard: FlowTemplate = {
        ...mockFlowTemplate,
        nodes: {
          ...mockFlowTemplate.nodes,
          generate: {
            nextNode: 'end',
            skipToNode: {
              allowed: true,
              validPreviousNodes: '*',
            },
          },
        },
      };

      const result = await service.validateSkipToNode(
        templateWithWildcard,
        'welcome',
        'generate',
        mockContext,
        testIds.organization,
      );

      expect(result.canSkip).toBe(true);
    });
  });

  describe('getAvailableSkipNodes', () => {
    it('should return all skip-to-able nodes with availability status', async () => {
      // INTENT: Test discovery returns comprehensive list of skip options
      jest.spyOn(initiativeService, 'findOneForAdapter').mockResolvedValue({
        id: testIds.initiative,
        organizationId: testIds.organization,
        sections: TestUtils.createMockMaterializedWorkItemSections({
          description: 'Test initiative description',
        }),
      } as any);

      const result = await service.getAvailableSkipNodes(
        mockFlowTemplate,
        'conversation',
        mockContext,
        testIds.organization,
      );

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        nodeId: 'generate',
        label: 'Generate',
        canSkip: true,
        reason: undefined,
      });
    });

    it('should mark nodes as unavailable when validation fails', async () => {
      // INTENT: Test discovery shows why nodes cannot be skipped to
      jest.spyOn(initiativeService, 'findOneForAdapter').mockResolvedValue({
        id: testIds.initiative,
        organizationId: testIds.organization,
        sections: TestUtils.createMockMaterializedWorkItemSections({
          description: '',
        }),
      } as any);

      const result = await service.getAvailableSkipNodes(
        mockFlowTemplate,
        'conversation',
        mockContext,
        testIds.organization,
      );

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        nodeId: 'generate',
        label: 'Generate',
        canSkip: false,
        reason: 'Initiative must have a description before generating tasks',
      });
    });

    it('should not include nodes without skipToNode config', async () => {
      // INTENT: Test discovery only returns explicitly skip-to-able nodes
      const result = await service.getAvailableSkipNodes(
        mockFlowTemplate,
        'welcome',
        mockContext,
        testIds.organization,
      );

      // Only 'generate' node has skipToNode config
      expect(result).toHaveLength(1);
      const [node] = result;
      if (!node) {
        throw new Error('Expected skip node');
      }
      expect(node.nodeId).toBe('generate');
    });

    it('should format node labels correctly', async () => {
      // INTENT: Test node ID to human-readable label conversion
      const templateWithMultiWordNode: FlowTemplate = {
        ...mockFlowTemplate,
        nodes: {
          ...mockFlowTemplate.nodes,
          task_generation_complete: {
            nextNode: 'end',
            skipToNode: {
              allowed: true,
              validPreviousNodes: '*',
            },
          },
        },
      };

      const result = await service.getAvailableSkipNodes(
        templateWithMultiWordNode,
        'conversation',
        mockContext,
        testIds.organization,
      );

      const multiWordNode = result.find(
        (n) => n.nodeId === 'task_generation_complete',
      );
      expect(multiWordNode?.label).toBe('Task Generation Complete');
    });
  });
});
