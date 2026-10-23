import { OrganizationGuard } from '../../auth/guards/organization.guard';
import { ProjectAccessGuard } from '../../auth/guards/project-access.guard';
import { Test, TestingModule } from '@nestjs/testing';
import { CodingPromptController } from '../coding-prompt.controller';
import { CodingPromptService } from '../../services/coding-prompt.service';

describe('CodingPromptController', () => {
  let controller: CodingPromptController;
  const mockService = {
    createResearchExecution: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CodingPromptController],
      providers: [
        {
          provide: CodingPromptService,
          useValue: mockService,
        },
      ],
    })
      .overrideGuard(OrganizationGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(ProjectAccessGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<CodingPromptController>(CodingPromptController);
    jest.clearAllMocks();
  });

  it('delegates createResearchExecution to the service', async () => {
    mockService.createResearchExecution.mockResolvedValue({
      executionId: 'exec-1',
      status: 'STARTED',
      createdAt: new Date().toISOString(),
      target: {
        taskId: 'task-1',
        projectId: 'proj-1',
        workflowAboutType: 'task',
        workflowAboutId: 'task-1',
      },
    });

    const result = await controller.createResearchExecution(
      { taskId: 'task-1', planId: 'plan-1' },
      'org-1' as any,
      'user-1' as any,
    );

    expect(mockService.createResearchExecution).toHaveBeenCalledWith(
      'org-1',
      'user-1',
      { taskId: 'task-1', planId: 'plan-1' },
    );
    expect(result.executionId).toBe('exec-1');
  });
});
