import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CodingPromptService } from '../coding-prompt.service';
import {
  createMockFlowExecutionService,
  createMockPrismaService,
} from '../../utils/testUtils';

describe('CodingPromptService', () => {
  let prisma: ReturnType<typeof createMockPrismaService>;
  let flowExecutionService: ReturnType<typeof createMockFlowExecutionService>;
  let mastraClient: { executeAgentStructured: jest.Mock };
  let reportService: { createCodingResearchReport: jest.Mock };
  let service: CodingPromptService;

  beforeEach(() => {
    prisma = createMockPrismaService();
    (prisma.db as any).flowExecution = {
      update: jest.fn().mockResolvedValue({ id: 'exec-1' }),
      findFirst: jest.fn(),
    };
    flowExecutionService = createMockFlowExecutionService();
    mastraClient = {
      executeAgentStructured: jest.fn(),
    };
    reportService = {
      createCodingResearchReport: jest.fn(),
    };
    (flowExecutionService.createFlowExecution as jest.Mock).mockResolvedValue({
      id: 'exec-1',
    });
    service = new CodingPromptService(
      { outgoing: jest.fn().mockResolvedValue([]) } as any,
      prisma as any,
      flowExecutionService as any,
      mastraClient as any,
      reportService as any,
    );
    prisma.db.agentSession.findFirst.mockResolvedValue({
      conversationId: 'conv-1',
      taskId: null,
      initiativeId: null,
      designDocId: null,
    });
    prisma.db.conversation.findUnique.mockResolvedValue({
      projectId: 'proj-1',
    });
  });

  describe('resolveResearchTarget', () => {
    it('rejects when neither taskId nor designDocId is provided', async () => {
      await expect(
        service.resolveResearchTarget('org-1' as any, {}),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects when both taskId and designDocId are provided', async () => {
      await expect(
        service.resolveResearchTarget('org-1' as any, {
          taskId: 'task-1',
          designDocId: 'doc-1',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('resolves taskId without planId', async () => {
      prisma.db.task.findFirst.mockResolvedValue({
        id: 'task-1',
        initiativeId: 'initiative-1',
      });
      prisma.db.projectInitiative.findFirst.mockResolvedValue({
        projectId: 'project-1',
      });

      const result = await service.resolveResearchTarget('org-1' as any, {
        taskId: 'task-1',
      });

      expect(result).toEqual({
        taskId: 'task-1',
        projectId: 'project-1',
        workflowAboutType: 'task',
        workflowAboutId: 'task-1',
      });
      expect(prisma.db.plan.findFirst).not.toHaveBeenCalled();
    });

    it('rejects when task and plan are inconsistent', async () => {
      prisma.db.task.findFirst.mockResolvedValue({
        id: 'task-1',
        initiativeId: 'initiative-1',
      });
      prisma.db.projectInitiative.findFirst.mockResolvedValue({
        projectId: 'project-1',
      });
      prisma.db.plan.findFirst.mockResolvedValue({
        id: 'plan-1',
        originatingProjectId: 'project-2',
      });

      await expect(
        service.resolveResearchTarget('org-1' as any, {
          taskId: 'task-1',
          planId: 'plan-1',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('resolves designDocId with matching planId', async () => {
      prisma.db.designDoc.findFirst.mockResolvedValue({
        id: 'doc-1',
        projectId: 'project-1',
      });
      prisma.db.task.findFirst.mockResolvedValue({
        id: 'plan-1',
        projectId: 'project-1',
      });

      const result = await service.resolveResearchTarget('org-1' as any, {
        designDocId: 'doc-1',
        planId: 'plan-1',
      });

      expect(result).toEqual({
        designDocId: 'doc-1',
        planId: 'plan-1',
        projectId: 'project-1',
        workflowAboutType: 'design-doc',
        workflowAboutId: 'doc-1',
      });
    });

    it('rejects planId without a primary target', async () => {
      await expect(
        service.resolveResearchTarget('org-1' as any, {
          planId: 'plan-1',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('createResearchExecution', () => {
    it('creates a started execution payload using resolved target', async () => {
      prisma.db.task.findFirst.mockResolvedValue({
        id: 'task-1',
        initiativeId: 'initiative-1',
      });
      prisma.db.projectInitiative.findFirst.mockResolvedValue({
        projectId: 'project-1',
      });

      const result = await service.createResearchExecution(
        'org-1' as any,
        'user-1' as any,
        { taskId: 'task-1' },
      );

      expect(result.status).toBe('STARTED');
      expect(result.executionId).toBe('exec-1');
      expect(result.target).toEqual({
        taskId: 'task-1',
        projectId: 'project-1',
        workflowAboutType: 'task',
        workflowAboutId: 'task-1',
      });
      expect(flowExecutionService.createFlowExecution).toHaveBeenCalledWith({
        userId: 'user-1',
        flowId: 'coding-prompt-research',
        organizationId: 'org-1',
        projectId: 'project-1',
        entityType: 'task',
        entityId: 'task-1',
        currentNode: 'coding-prompt-research-agent',
        totalNodes: 2,
        metadata: {
          executionType: 'coding-prompt-research',
          taskId: 'task-1',
          designDocId: null,
          planId: null,
          request: {
            taskId: 'task-1',
            designDocId: null,
            planId: null,
          },
        },
      });
      expect((prisma.db as any).flowExecution.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: 'exec-1',
            organizationId: 'org-1',
          },
          data: expect.objectContaining({
            flowState: expect.any(Object),
          }),
        }),
      );
    });
  });

  it('persists coding research report with target metadata', async () => {
    reportService.createCodingResearchReport.mockResolvedValue({
      id: 'report-1',
    });

    await (service as any).persistCodingResearchReport({
      organizationId: 'org-1',
      executionId: 'exec-1',
      target: {
        taskId: 'task-1',
        planId: 'plan-1',
        projectId: 'project-1',
        workflowAboutType: 'task',
        workflowAboutId: 'task-1',
      },
      result: { summary: 'research complete' },
    });

    expect(reportService.createCodingResearchReport).toHaveBeenCalledWith({
      organizationId: 'org-1',
      sourceExecutionId: 'exec-1',
      projectId: 'project-1',
      audience: 'WORKFLOW_ONLY',
      taskId: 'task-1',
      planId: 'plan-1',
      payload: { summary: 'research complete' },
    });
  });
});
