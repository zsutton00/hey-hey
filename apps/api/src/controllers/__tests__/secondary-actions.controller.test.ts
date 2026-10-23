import { Test, TestingModule } from '@nestjs/testing';
import { SecondaryActionsController } from '../secondary-actions.controller';
import { SecondaryActionsService } from '../../services/secondary-actions/secondary-actions.service';
import { OrganizationGuard } from '../../auth/guards/organization.guard';
import { ProjectAccessGuard } from '../../auth/guards/project-access.guard';

describe('SecondaryActionsController', () => {
  let controller: SecondaryActionsController;
  const mockService = {
    getActions: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SecondaryActionsController],
      providers: [
        {
          provide: SecondaryActionsService,
          useValue: mockService,
        },
      ],
    })
      .overrideGuard(OrganizationGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(ProjectAccessGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<SecondaryActionsController>(
      SecondaryActionsController,
    );
    jest.clearAllMocks();
  });

  it('delegates to SecondaryActionsService with query params', async () => {
    const mockActions = [{ id: 'a1', label: 'Test' }];
    mockService.getActions.mockResolvedValue(mockActions);

    const result = await controller.findAll(
      'org-1' as any,
      'coding_prompt_startup_plan',
      'session_start',
    );

    expect(mockService.getActions).toHaveBeenCalledWith({
      uiElement: 'coding_prompt_startup_plan',
      actionType: 'session_start',
    });
    expect(result).toEqual(mockActions);
  });

  it('passes undefined filters when query params are omitted', async () => {
    mockService.getActions.mockResolvedValue([]);

    await controller.findAll('org-1' as any, undefined, undefined);

    expect(mockService.getActions).toHaveBeenCalledWith({
      uiElement: undefined,
      actionType: undefined,
    });
  });
});
