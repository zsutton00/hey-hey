import * as TestUtils from '../../../../utils/testUtils';
import { InitiativeRefinementWelcomeNode } from '../initiative-refinement-welcome.node';
import {
  InitiativeRefinementFlowContext,
  NodeType,
} from '../../../../types/flow-internal.types';
import { createMutableContextHandle } from '../../../../utils/mutable-context';
import { INITIATIVE_REFINEMENT_NODES } from '../../../constants/node-ids';
import { InitiativeService } from '../../../../services/initiatives/initiative.service';
import { WorkStatus, SystemMessageResponseType } from '../../../../generated';
import { Initiative } from '@prisma/client';

const { testIds } = TestUtils;

// Helper to create proper Prisma Initiative mock
function createMockPrismaInitiative(
  overrides: Partial<Initiative> = {},
): Initiative {
  return {
    id: testIds.initiative,
    name: 'Test Initiative',
    description: 'Test description',
    details: 'Test details',
    acceptanceCriteria: 'Test acceptance criteria',
    assigneeId: null,
    reasoning: 'Test reasoning',
    organizationId: testIds.organization,
    status: WorkStatus.RefiningDescription,
    priority: 'MEDIUM' as any,
    creatorType: 'SYSTEM' as any,
    dueDate: null,
    tags: ['test'],
    createdAt: new Date(),
    updatedAt: new Date(),
    archivedAt: null,
    sourceConversationId: null,
    ...overrides,
  } as Initiative;
}

describe('InitiativeRefinementWelcomeNode', () => {
  let mockInitiativeService: jest.Mocked<InitiativeService>;
  let node: InitiativeRefinementWelcomeNode;
  let context: InitiativeRefinementFlowContext;

  beforeEach(() => {
    mockInitiativeService = TestUtils.createMockInitiativeService();
    node = new InitiativeRefinementWelcomeNode(mockInitiativeService);

    context = {
      ...TestUtils.createMockFlowContext(),
      initiativeId: testIds.initiative,
    } as InitiativeRefinementFlowContext;
  });

  describe('node metadata', () => {
    it('should expose id, type, and title', () => {
      expect(node.id).toBe(INITIATIVE_REFINEMENT_NODES.WELCOME);
      expect(node.type).toBe(NodeType.OPENER);
      expect(node.title).toBe('Initiative Refinement Welcome');
    });
  });

  describe('execute - description level', () => {
    it('should display description level welcome for REFINING_DESCRIPTION status', async () => {
      const mockInitiative = createMockPrismaInitiative({
        status: WorkStatus.RefiningDescription,
        name: 'API Enhancement Project',
      });

      mockInitiativeService.findOne.mockResolvedValue(mockInitiative as any);

      const result = await node.execute(
        createMutableContextHandle<InitiativeRefinementFlowContext>(context),
      );

      expect(mockInitiativeService.findOne).toHaveBeenCalledWith(
        testIds.initiative,
        testIds.organization,
      );

      expect(result.type).toBe(NodeType.QUESTIONS);
      expect(result.uiElements?.[0]).toEqual(
        expect.objectContaining({
          id: 'initiative_intro',
          type: 'initiative_intro',
          label:
            "Let's review the high-level description of this initiative. What would you like to change or improve?",
          placeholder:
            'Share your thoughts on the initiative name, description, scope, or priority...',
        }),
      );
      expect(result.data).toEqual(
        expect.objectContaining({
          detectedIntent: 'opener_displayed',
          intentConfidence: 1,
          reasoning: mockInitiative.reasoning,
        }),
      );
    });

    it('should default to description placeholder when status is REFINING_DESCRIPTION', async () => {
      const mockInitiative = createMockPrismaInitiative({
        status: WorkStatus.RefiningDescription,
        name: 'New Project Initiative',
      });

      mockInitiativeService.findOne.mockResolvedValue(mockInitiative as any);

      const result = await node.execute(
        createMutableContextHandle<InitiativeRefinementFlowContext>(context),
      );

      expect(result.type).toBe(NodeType.QUESTIONS);
      expect(result.uiElements?.[0]?.placeholder).toBe(
        'Share your thoughts on the initiative name, description, scope, or priority...',
      );
    });
  });

  describe('execute - details level', () => {
    it('should display details level welcome for REFINING_DETAILS status', async () => {
      const mockInitiative = createMockPrismaInitiative({
        status: WorkStatus.RefiningDetails,
        name: 'Technical Implementation',
      });

      mockInitiativeService.findOne.mockResolvedValue(mockInitiative as any);

      const result = await node.execute(
        createMutableContextHandle<InitiativeRefinementFlowContext>(context),
      );

      expect(result.uiElements?.[0]?.label).toBe(
        "Now let's work on the technical details and implementation approach. What would you like to change or improve?",
      );
      expect(result.uiElements?.[0]?.placeholder).toBe(
        'Share your thoughts on the technical approach, resources, timeline, or implementation details...',
      );
    });
  });

  describe('execute - acceptance criteria level', () => {
    it('should display acceptance criteria level welcome for REFINING_ACCEPTANCE_CRITERIA status', async () => {
      const mockInitiative = createMockPrismaInitiative({
        status: WorkStatus.RefiningAcceptanceCriteria,
        name: 'Quality Validation',
      });

      mockInitiativeService.findOne.mockResolvedValue(mockInitiative as any);

      const result = await node.execute(
        createMutableContextHandle<InitiativeRefinementFlowContext>(context),
      );

      expect(result.uiElements?.[0]?.label).toBe(
        "Finally, let's define the acceptance criteria and validation requirements. What would you like to change or improve?",
      );
      expect(result.uiElements?.[0]?.placeholder).toBe(
        'Share your thoughts on the acceptance criteria, testing approach, or validation requirements...',
      );
    });
  });

  describe('error handling', () => {
    it('should handle initiative not found gracefully', async () => {
      mockInitiativeService.findOne.mockResolvedValue(null);

      const result = await node.execute(
        createMutableContextHandle<InitiativeRefinementFlowContext>(context),
      );

      expect(result).toEqual({
        type: NodeType.ERROR,
        message: 'Initiative data not found. Please try again.',
        data: {
          errorType: 'missing_data',
          context: 'initiative_not_loaded',
          temporary: true,
          detectedIntent: 'initiative_missing',
          intentConfidence: 1,
        },
      });
    });

    it('should surface database errors', async () => {
      mockInitiativeService.findOne.mockRejectedValue(
        new Error('Database connection failed'),
      );

      await expect(
        node.execute(
          createMutableContextHandle<InitiativeRefinementFlowContext>(context),
        ),
      ).rejects.toThrow('Database connection failed');
    });
  });

  describe('level-specific UI elements', () => {
    it('should provide appropriate placeholders for each level', async () => {
      const testCases = [
        {
          status: WorkStatus.RefiningDescription,
          expectedPlaceholder:
            'Share your thoughts on the initiative name, description, scope, or priority...',
        },
        {
          status: WorkStatus.RefiningDetails,
          expectedPlaceholder:
            'Share your thoughts on the technical approach, resources, timeline, or implementation details...',
        },
        {
          status: WorkStatus.RefiningAcceptanceCriteria,
          expectedPlaceholder:
            'Share your thoughts on the acceptance criteria, testing approach, or validation requirements...',
        },
      ];

      for (const testCase of testCases) {
        const mockInitiative = createMockPrismaInitiative({
          status: testCase.status,
        });

        mockInitiativeService.findOne.mockResolvedValue(mockInitiative as any);

        const result = await node.execute(
          createMutableContextHandle<InitiativeRefinementFlowContext>(context),
        );

        expect(result.uiElements?.[0]?.placeholder).toBe(
          testCase.expectedPlaceholder,
        );
      }
    });
  });

  describe('context integration', () => {
    it('should use initiative reasoning from database in response data', async () => {
      const mockInitiative = createMockPrismaInitiative({
        status: WorkStatus.RefiningDescription,
        reasoning: 'This initiative will improve API performance by 50%',
      });

      mockInitiativeService.findOne.mockResolvedValue(mockInitiative as any);

      const result = await node.execute(
        createMutableContextHandle<InitiativeRefinementFlowContext>(context),
      );

      expect((result.data as any).reasoning).toBe(
        'This initiative will improve API performance by 50%',
      );
    });

    it('should handle null reasoning gracefully', async () => {
      const mockInitiative = createMockPrismaInitiative({
        status: WorkStatus.RefiningDescription,
        reasoning: null,
      });

      mockInitiativeService.findOne.mockResolvedValue(mockInitiative as any);

      const result = await node.execute(
        createMutableContextHandle<InitiativeRefinementFlowContext>(context),
      );

      expect((result.data as any).reasoning).toBeUndefined();
    });
  });
});
