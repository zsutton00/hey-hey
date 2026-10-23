import { BadRequestException } from '@nestjs/common';
import { CreateProjectDto, ProjectStatus } from '../../generated';
import { OrganizationId, ProjectId, UserId } from '../../types';
import { ProjectController } from '../project.controller';

describe('ProjectController', () => {
  const organizationId =
    'b747f6b1-3f44-43ad-9b6f-66b420743c5d' as OrganizationId;
  const projectId = '5f18ef50-d28b-4577-8b64-960608fdb49e' as ProjectId;
  const actorUserId = '2f0c8a54-6c5d-4e0e-9a39-1c6f5f4a7a10' as UserId;
  const mockLlmSessionId = '9db93370-808f-4bba-a38c-84c72cd35937';
  const createProjectDto: CreateProjectDto = {
    name: 'Mock-routed onboarding',
  };
  const projectService = {
    updateForAdapter: jest.fn(),
    createForAdapter: jest.fn().mockResolvedValue({
      id: projectId,
      name: createProjectDto.name,
      organizationId,
      status: ProjectStatus.Onboarding,
      createdAt: '2026-08-03T00:00:00.000Z',
      updatedAt: '2026-08-03T00:00:00.000Z',
    }),
  };
  const originalEnvironment = { ...process.env };
  const controller = new ProjectController(projectService as never);

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnvironment };
  });

  afterAll(() => {
    process.env = originalEnvironment;
  });

  function enableMockRouting(): void {
    process.env.NODE_ENV = 'test';
    process.env.MOCK_LLM_SESSION_ROUTING_ENABLED = 'true';
    process.env.MOCK_LLM_SERVER_URL = 'http://127.0.0.1:3001';
    process.env.ANTHROPIC_BASE_URL = 'http://127.0.0.1:3001';
    process.env.OPENAI_BASE_URL = 'http://127.0.0.1:3001/v1';
  }

  it('passes a validated session identity into onboarding creation', async () => {
    enableMockRouting();

    await controller.create(
      createProjectDto,
      organizationId,
      actorUserId,
      mockLlmSessionId,
    );

    expect(projectService.createForAdapter).toHaveBeenCalledWith(
      createProjectDto,
      organizationId,
      actorUserId,
      mockLlmSessionId,
    );
  });

  it.each(['TAKING_SHAPE', 'ESTABLISHED'] as const)(
    'passes the explicit maturity=%s choice with organization scope',
    async (maturity) => {
      const project = { maturity };
      projectService.updateForAdapter.mockResolvedValue(project);
      await expect(
        controller.update(projectId, { maturity }, organizationId, actorUserId),
      ).resolves.toEqual(project);
      expect(projectService.updateForAdapter).toHaveBeenCalledWith(
        projectId,
        { maturity },
        organizationId,
        actorUserId,
      );
    },
  );

  it('rejects the header when the API process is not explicitly mock-routed', async () => {
    process.env.MOCK_LLM_SESSION_ROUTING_ENABLED = 'false';

    await expect(
      controller.create(
        createProjectDto,
        organizationId,
        actorUserId,
        mockLlmSessionId,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(projectService.createForAdapter).not.toHaveBeenCalled();
  });

  it('rejects a malformed session identity before project creation', async () => {
    enableMockRouting();

    await expect(
      controller.create(
        createProjectDto,
        organizationId,
        actorUserId,
        'not-a-uuid',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(projectService.createForAdapter).not.toHaveBeenCalled();
  });
});
