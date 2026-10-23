import {
  ProjectAccessGuard,
  ProjectResourceId,
} from '../auth/guards/project-access.guard';
import {
  BadRequestException,
  Controller,
  Post,
  Get,
  Headers,
  Patch,
  Delete,
  Body,
  HttpCode,
  HttpStatus,
  Param,
  Query,
  NotFoundException,
  UseGuards,
} from '@nestjs/common';
import { validate as isUuid } from 'uuid';
import {
  AddProjectMemberDto,
  CreateProjectDto,
  PaginatedProjectMembersResponseDto,
  ProjectCountsResponseDto,
  ProjectMemberResponseDto,
  ProjectResponseDto,
  UpdateProjectDto,
} from '../generated';
import { PROJECT_CONTROLLER_PATH } from '../generated/api/path-constants';
import { ProjectService } from '../services/project.service';
import {
  CurrentUser,
  CurrentOrganization,
} from 'src/auth/decorators/current-user.decorator';
import { MockLlmSessionId, OrganizationId, ProjectId, UserId } from 'src/types';
import { OrganizationGuard } from 'src/auth/guards/organization.guard';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import {
  hasCompleteOnboardingMockProviderConfiguration,
  MOCK_LLM_SESSION_HEADER,
} from '../services/llm/mock-llm-routing';

@ProjectResourceId('project')
@Controller(`api/v1/${PROJECT_CONTROLLER_PATH}`)
@UseGuards(JwtAuthGuard, OrganizationGuard, ProjectAccessGuard)
export class ProjectController {
  constructor(private readonly projectService: ProjectService) {}

  @Post()
  async create(
    @Body() createProjectDto: CreateProjectDto,
    @CurrentOrganization() organizationId: OrganizationId,
    @CurrentUser('userId') actorUserId: UserId,
    @Headers(MOCK_LLM_SESSION_HEADER) mockLlmSessionHeader?: string,
  ): Promise<ProjectResponseDto> {
    const mockLlmSessionId = this.resolveMockLlmSessionId(mockLlmSessionHeader);
    return this.projectService.createForAdapter(
      createProjectDto,
      organizationId,
      actorUserId,
      mockLlmSessionId,
    );
  }

  private resolveMockLlmSessionId(
    rawHeader: string | undefined,
  ): MockLlmSessionId | undefined {
    if (rawHeader === undefined) return undefined;
    if (!hasCompleteOnboardingMockProviderConfiguration()) {
      throw new BadRequestException(
        `${MOCK_LLM_SESSION_HEADER} requires explicit mock-provider configuration`,
      );
    }
    const value = rawHeader.trim();
    if (!isUuid(value)) {
      throw new BadRequestException(
        `${MOCK_LLM_SESSION_HEADER} must be a UUID`,
      );
    }
    return value as MockLlmSessionId;
  }

  @Get()
  async findAll(
    @CurrentOrganization() organizationId: OrganizationId,
    @CurrentUser('userId') userId: UserId,
  ): Promise<ProjectResponseDto[]> {
    return this.projectService.findAllForAdapter(organizationId, userId);
  }

  @Get(':id')
  async findOne(
    @Param('id') id: string,
    @CurrentOrganization() organizationId: OrganizationId,
    @CurrentUser('userId') actorUserId: UserId,
  ): Promise<ProjectResponseDto> {
    const project = await this.projectService.findOneForAdapter(
      id,
      organizationId,
      actorUserId,
    );
    if (!project) {
      throw new NotFoundException('Project not found');
    }
    return project;
  }

  @Get(':id/counts')
  async getCounts(
    @CurrentUser('userId') actorUserId: UserId,
    @Param('id') id: ProjectId,
    @CurrentOrganization() organizationId: OrganizationId,
  ): Promise<ProjectCountsResponseDto> {
    return this.projectService.getCounts(actorUserId, id, organizationId);
  }

  @Patch(':id')
  async update(
    @Param('id') id: ProjectId,
    @Body() updateProjectDto: UpdateProjectDto,
    @CurrentOrganization() organizationId: OrganizationId,
    @CurrentUser('userId') actorUserId: UserId,
  ): Promise<ProjectResponseDto> {
    return this.projectService.updateForAdapter(
      id,
      updateProjectDto,
      organizationId,
      actorUserId,
    );
  }

  @Delete(':id')
  async remove(
    @Param('id') id: ProjectId,
    @CurrentOrganization() organizationId: OrganizationId,
    @CurrentUser('userId') actorUserId: UserId,
  ): Promise<ProjectResponseDto> {
    return this.projectService.removeForAdapter(
      id,
      organizationId,
      actorUserId,
    );
  }

  /**
   * Get active workflows for a project (useful for debugging)
   */
  @Get(':id/workflows')
  async getProjectWorkflows(
    @Param('id') id: ProjectId,
    @CurrentOrganization() organizationId: OrganizationId,
  ) {
    const workflows = await this.projectService.getProjectWorkflows(
      id,
      organizationId,
    );
    return {
      success: true,
      data: workflows,
      projectId: id,
    };
  }

  @Get(':id/members')
  async listMembers(
    @CurrentUser('userId') actorUserId: UserId,
    @Param('id') id: ProjectId,
    @CurrentOrganization() organizationId: OrganizationId,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ): Promise<PaginatedProjectMembersResponseDto> {
    const parsedPage = this.parseNumber(page);
    const parsedLimit = this.parseNumber(limit);
    return this.projectService.listProjectMembers(
      actorUserId,
      organizationId,
      id,
      {
        page: parsedPage,
        limit: parsedLimit,
      },
    );
  }

  private parseNumber(value?: string): number | undefined {
    if (!value) return undefined;
    const parsed = Number(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  }

  @Post(':id/members')
  async addMember(
    @CurrentUser('userId') actorUserId: UserId,
    @Param('id') id: ProjectId,
    @Body() dto: AddProjectMemberDto,
    @CurrentOrganization() organizationId: OrganizationId,
  ): Promise<ProjectMemberResponseDto> {
    return this.projectService.addProjectMember(
      actorUserId,
      organizationId,
      id,
      dto,
    );
  }

  @Delete(':id/members/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeMember(
    @CurrentUser('userId') actorUserId: UserId,
    @Param('id') id: ProjectId,
    @Param('userId') userId: UserId,
    @CurrentOrganization() organizationId: OrganizationId,
  ): Promise<void> {
    await this.projectService.removeProjectMember(
      actorUserId,
      organizationId,
      id,
      userId,
    );
  }

  /**
   * Manually terminate all workflows for a project (useful for cleanup)
   */
  @Post(':id/workflows/terminate')
  async terminateProjectWorkflows(
    @Param('id') id: ProjectId,
    @CurrentOrganization() organizationId: OrganizationId,
  ) {
    try {
      const result = await this.projectService.terminateWorkflowsForProject(
        id,
        organizationId,
        'Manual termination via API',
      );

      return {
        success: true,
        message: `Terminated ${result.terminated} workflows, ${result.failed} failed`,
        data: result,
        projectId: id,
      };
    } catch (error) {
      return {
        success: false,
        message: 'Failed to terminate workflows',
        error: (error as Error).message,
        projectId: id,
      };
    }
  }
}
