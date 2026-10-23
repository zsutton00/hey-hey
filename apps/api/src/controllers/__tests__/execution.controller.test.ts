import { OrganizationGuard } from '../../auth/guards/organization.guard';
import { ProjectAccessGuard } from '../../auth/guards/project-access.guard';
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ExecutionController } from '../execution.controller';
import { WorkflowExecutionService } from '../../services/workflows/workflow-execution.service';

describe('ExecutionController', () => {
  let controller: ExecutionController;
  const mockWorkflowExecutionService = {
    getExecutionById: jest.fn(),
    getExecutionResultById: jest.fn(),
    waitForExecutionUpdate: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ExecutionController],
      providers: [
        {
          provide: WorkflowExecutionService,
          useValue: mockWorkflowExecutionService,
        },
      ],
    })
      .overrideGuard(OrganizationGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(ProjectAccessGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<ExecutionController>(ExecutionController);
    jest.clearAllMocks();
  });

  it('delegates getExecution to WorkflowExecutionService', async () => {
    mockWorkflowExecutionService.getExecutionById.mockResolvedValue({
      id: 'exec-1',
      flowId: 'coding-prompt-research',
      userId: 'user-1',
      organizationId: 'org-1',
      projectId: 'project-1',
      status: 'STARTED',
      startedAt: '2026-02-13T00:00:00.000Z',
      completedAt: null,
      currentNode: null,
      totalNodes: null,
      completedNodes: 0,
      executionTimeMs: null,
      errorMessage: null,
      errorCode: null,
      version: 1,
      metadata: null,
    });

    const result = await controller.getExecution('org-1' as any, 'exec-1');

    expect(result.id).toBe('exec-1');
    expect(mockWorkflowExecutionService.getExecutionById).toHaveBeenCalledWith(
      'org-1',
      'exec-1',
    );
  });

  it('delegates waitForExecution with parsed query params', async () => {
    mockWorkflowExecutionService.waitForExecutionUpdate.mockResolvedValue({
      id: 'exec-1',
      status: 'IN_PROGRESS',
      version: 2,
    });

    const result = await controller.waitForExecution(
      'org-1' as any,
      'exec-1',
      '25000',
      '1',
    );

    expect(result.status).toBe('IN_PROGRESS');
    expect(
      mockWorkflowExecutionService.waitForExecutionUpdate,
    ).toHaveBeenCalledWith('org-1', 'exec-1', {
      timeoutMs: 25000,
      sinceVersion: 1,
    });
  });

  it('delegates getExecutionResult to WorkflowExecutionService', async () => {
    mockWorkflowExecutionService.getExecutionResultById.mockResolvedValue({
      executionId: 'exec-1',
      status: 'COMPLETED',
      version: 3,
      ready: true,
      completedAt: '2026-02-13T00:00:10.000Z',
      result: {
        summary: 'done',
      },
    });

    const result = await controller.getExecutionResult(
      'org-1' as any,
      'exec-1',
    );

    expect(result.ready).toBe(true);
    expect(
      mockWorkflowExecutionService.getExecutionResultById,
    ).toHaveBeenCalledWith('org-1', 'exec-1');
  });

  it('throws for invalid timeoutMs', async () => {
    await expect(
      controller.waitForExecution('org-1' as any, 'exec-1', '-1', '1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
