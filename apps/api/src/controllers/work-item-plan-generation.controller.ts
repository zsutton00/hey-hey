import { ProjectAccessGuard } from '../auth/guards/project-access.guard';
import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { PlanSubmissionAdmissionRequest } from '../generated';
import {
  CurrentOrganization,
  CurrentUser,
} from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrganizationGuard } from '../auth/guards/organization.guard';
import { OrganizationId, PlanId, ProjectId, TaskId, UserId } from '../types';
import { WorkItemPlanGenerationService } from '../services/plan/work-item-plan-generation.service';
import { SkipTransform } from '../common/decorators/skip-transform.decorator';
import { PlanSubmissionAdmissionService } from '../services/plan/plan-submission-admission.service';

@Controller(
  'api/v1/organizations/:organizationId/projects/:projectId/work-items/:taskId/plan-generation',
)
@UseGuards(JwtAuthGuard, OrganizationGuard, ProjectAccessGuard)
@SkipTransform()
export class WorkItemPlanGenerationController {
  constructor(
    private readonly generation: WorkItemPlanGenerationService,
    private readonly admission: PlanSubmissionAdmissionService,
  ) {}

  @Post()
  @HttpCode(200)
  prepare(
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('projectId', ParseUUIDPipe) projectId: ProjectId,
    @Param('taskId', ParseUUIDPipe) taskId: TaskId,
    @CurrentUser('userId') userId: UserId,
  ) {
    return this.generation.prepare(organizationId, projectId, taskId, userId);
  }

  @Post('admission')
  @HttpCode(200)
  admit(
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('projectId', ParseUUIDPipe) projectId: ProjectId,
    @Param('taskId', ParseUUIDPipe) taskId: TaskId,
    @CurrentUser('userId') userId: UserId,
    @Body() request: PlanSubmissionAdmissionRequest,
  ) {
    return this.admission.admit({
      organizationId,
      projectId,
      planId: taskId as unknown as PlanId,
      userId,
      request,
    });
  }

  @Delete()
  @HttpCode(204)
  reset(
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('projectId', ParseUUIDPipe) projectId: ProjectId,
    @Param('taskId', ParseUUIDPipe) taskId: TaskId,
    @CurrentUser('userId') userId: UserId,
  ) {
    return this.generation.reset(organizationId, projectId, taskId, userId);
  }
}
