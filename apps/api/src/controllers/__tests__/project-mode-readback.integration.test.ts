import { OrganizationGuard } from '../../auth/guards/organization.guard';
import { ProjectAccessGuard } from '../../auth/guards/project-access.guard';
import { Test, type TestingModule } from '@nestjs/testing';
import type { TaskResponseDto } from '../../generated';
import { TaskController } from '../task.controller';
import { GoalTracksService } from '../../services/tasks/goal-tracks.service';
import { TaskSupersedeService } from '../../services/tasks/task-supersede.service';
import { TaskService } from '../../services/tasks/task.service';
import { WorkItemTypeRegistryService } from '../../services/tasks/work-item-type-registry.service';
import { ProposalService } from '../../services/proposal/proposal.service';
import { createWarmWorkItemTypeRegistry } from '../../../test/setup/work-item-type-registry.fixture';
import * as TestUtils from '../../utils/testUtils';
import type { OrganizationId, ProjectId, TaskId } from '../../types';

describe('Project MODE canonical readback', () => {
  let controller: TaskController;
  let taskService: jest.Mocked<TaskService>;

  beforeEach(async () => {
    taskService = TestUtils.createMockTaskService();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [TaskController],
      providers: [
        { provide: TaskService, useValue: taskService },
        { provide: ProposalService, useValue: { create: jest.fn() } },
        {
          provide: GoalTracksService,
          useValue: { attachToGoal: jest.fn(), detachFromGoal: jest.fn() },
        },
        {
          provide: TaskSupersedeService,
          useValue: { supersedeTask: jest.fn() },
        },
        {
          provide: WorkItemTypeRegistryService,
          useValue: await createWarmWorkItemTypeRegistry(),
        },
      ],
    })
      .overrideGuard(OrganizationGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(ProjectAccessGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<TaskController>(TaskController);
  });

  it('returns the approved MODE representation unchanged through single and hierarchy reads', async () => {
    const filesContent = JSON.stringify({
      schemaVersion: 'project-mode-files.v1',
      files: {
        'MODE.md': 'Read this first.',
        'references/checklist.md': 'Check the list.',
      },
    });
    const sections = [
      {
        id: 'mode-description',
        key: 'description',
        order: 0,
        materializedMarkdown: 'Choose this mode for review work.',
        materializedProposalId: 'proposal-mode',
      },
      {
        id: 'mode-files',
        key: 'files',
        order: 1,
        materializedMarkdown: filesContent,
        materializedProposalId: 'proposal-mode',
      },
      {
        id: 'mode-settings',
        key: 'settings',
        order: 2,
        materializedMarkdown: JSON.stringify({
          schemaVersion: 'project-mode-settings.v1',
          projectAssistant: { enabled: false },
        }),
        materializedProposalId: 'proposal-mode',
      },
    ];
    const mode = TestUtils.createMockTaskResponseDto({
      id: '10000000-0000-4000-8000-000000000101' as TaskId,
      type: 'MODE',
      parentTaskId: '10000000-0000-4000-8000-000000000102',
      sections: sections as unknown as TaskResponseDto['sections'],
    });
    const hierarchy = { parent: undefined, task: mode, children: [] };
    taskService.findOneByOrganization.mockResolvedValue(mode);
    taskService.findHierarchyByOrganization.mockResolvedValue(hierarchy);

    await expect(
      controller.findOne(
        mode.id as TaskId,
        mode.projectId as ProjectId,
        mode.organizationId as OrganizationId,
        undefined,
        undefined,
        undefined,
        undefined,
      ),
    ).resolves.toBe(mode);
    await expect(
      controller.findHierarchy(
        mode.id as TaskId,
        mode.projectId as ProjectId,
        mode.organizationId as OrganizationId,
      ),
    ).resolves.toBe(hierarchy);
    expect(mode.parentTaskId).toBe('10000000-0000-4000-8000-000000000102');

    expect(taskService.findOneByOrganization).toHaveBeenCalledWith(
      mode.organizationId as OrganizationId,
      mode.id as TaskId,
      false,
      false,
      false,
      false,
      null,
    );
    expect(taskService.findHierarchyByOrganization).toHaveBeenCalledWith(
      mode.organizationId as OrganizationId,
      mode.id as TaskId,
      false,
      false,
      false,
    );
    expect(
      (
        await controller.findOne(
          mode.id as TaskId,
          mode.projectId as ProjectId,
          mode.organizationId as OrganizationId,
        )
      ).sections,
    ).toEqual(sections);
  });
});
