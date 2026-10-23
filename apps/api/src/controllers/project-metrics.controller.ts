import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  BadRequestException,
  Controller,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PROJECT_CONTROLLER_PATH } from '../generated/api/path-constants';
import type { ProjectMetricsResponseDto } from '../generated';
import { ActivityActorScopeMode } from '../generated';
import {
  CurrentOrganization,
  CurrentUser,
} from '../auth/decorators/current-user.decorator';
import { OrganizationGuard } from '../auth/guards/organization.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrganizationId, ProjectId, UserId } from '../types';
import { ProjectMetricsService } from '../services/project-metrics/project-metrics.service';

@ApiTags('Projects')
@ApiBearerAuth()
@Controller(`api/v1/${PROJECT_CONTROLLER_PATH}`)
@UseGuards(JwtAuthGuard, OrganizationGuard)
export class ProjectMetricsController {
  constructor(private readonly projectMetricsService: ProjectMetricsService) {}

  @Get('metrics')
  @ApiOperation({ summary: 'Get rolling project metrics' })
  async getProjectMetrics(
    @CurrentOrganization() organizationId: OrganizationId,
    @CurrentUser('userId') userId: UserId,
    @Query('actorScope') rawActorScope?: string,
    @Query('actorUserId') rawActorUserId?: string,
    @Query('projectId') rawProjectId?: string,
  ): Promise<ProjectMetricsResponseDto> {
    const projectId = this.normalizeProjectId(rawProjectId);
    const actorScope = this.normalizeActorScope(
      rawActorScope,
      rawActorUserId,
      userId,
    );
    return this.projectMetricsService.getProjectMetrics(
      organizationId,
      userId,
      projectId,
      actorScope,
    );
  }

  private normalizeActorScope(
    rawMode: string | undefined,
    rawActorUserId: string | undefined,
    authenticatedUserId: UserId,
  ) {
    if (rawMode === ActivityActorScopeMode.Organization) {
      if (rawActorUserId !== undefined) {
        throw new BadRequestException(
          'actorUserId is forbidden for organization scope',
        );
      }
      return { mode: 'ORGANIZATION' as const };
    }
    if (rawMode === ActivityActorScopeMode.Personal) {
      const actorUserId = rawActorUserId?.trim();
      if (!actorUserId) {
        throw new BadRequestException(
          'actorUserId is required for personal scope',
        );
      }
      if (actorUserId !== authenticatedUserId) {
        throw new BadRequestException(
          'Personal metrics may only use the signed-in user',
        );
      }
      return { mode: 'PERSONAL' as const, userId: authenticatedUserId };
    }
    throw new BadRequestException(
      'actorScope must be ORGANIZATION or PERSONAL',
    );
  }

  private normalizeProjectId(rawProjectId?: string): ProjectId | undefined {
    if (rawProjectId === undefined) {
      return undefined;
    }
    const projectId = rawProjectId.trim();
    if (projectId.length === 0) {
      throw new BadRequestException('projectId must not be empty');
    }
    return projectId as ProjectId;
  }
}
